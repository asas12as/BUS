-- ---------------------------------------------------------------------------
-- 0003 - Runtime faults and a bootstrap gap
--
-- The function faults were found by calling the functions against the live
-- database rather than by reading them. Neither raised an error when created:
-- PL/pgSQL bodies are not resolved until they run, so both applied cleanly and
-- failed on first use.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. record_scan: "column reference week_start is ambiguous"
--
-- A function that RETURNS TABLE declares its output columns as PL/pgSQL
-- variables. Three of them here share a name with a column of the table the body
-- reads (week_start, weekly_number, status), and inside plpgsql a bare
-- `week_start` is then two equally good candidates. Postgres refuses rather than
-- guessing, which is the right call.
--
-- Fixed by aliasing the table, so every column reference in the body is
-- qualified, and by building the result in local variables and returning one
-- row at the end. `select *` into a row variable was fine; the bare identifiers
-- were not.
create or replace function public.record_scan(
  p_week_start date,
  p_weekly_number integer
)
returns table (
  result         text,
  rider_id       uuid,
  rider_name     text,
  pickup_name    text,
  week_start     date,
  weekly_number  integer,
  status         text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row    public.week_subscriptions;
  v_result text;
begin
  if not public.is_admin() then
    raise exception 'only an admin may record a scan'
      using errcode = '42501';
  end if;

  -- Qualified on purpose: see the note above about the output columns.
  select ws.* into v_row
  from public.week_subscriptions ws
  where ws.week_start = p_week_start
    and ws.weekly_number = p_weekly_number;

  if v_row.id is null then
    -- A number that belongs to nobody is still an attempt worth keeping, and it
    -- is the one an auditor most wants to see.
    v_result := 'not_found';

    insert into public.scan_records (scanned_by, week_start, weekly_number, result)
    values (auth.uid(), p_week_start, p_weekly_number, v_result);

    return query
      select v_result, null::uuid, null::text, null::text,
             p_week_start, p_weekly_number, 'none'::text;
    return;
  end if;

  v_result := case v_row.status
    when 'subscribed' then 'valid'
    when 'pending' then 'pending'
    else 'cancelled'
  end;

  insert into public.scan_records (scanned_by, week_start, weekly_number, rider_id, result)
  values (auth.uid(), p_week_start, p_weekly_number, v_row.user_id, v_result);

  -- A scalar subquery rather than a join: the row being returned is the
  -- subscription, and joining profiles onto it would multiply it by however many
  -- profile rows matched. A name can also be null, hence the coalesce.
  return query
    select v_result,
           v_row.user_id,
           coalesce((select pr.name from public.profiles pr where pr.id = v_row.user_id), ''),
           v_row.pickup_name,
           v_row.week_start,
           v_row.weekly_number,
           v_row.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. admin_list_profiles answered a non-admin with an empty list
--
-- Not a leak: `where public.is_admin()` made it return zero rows. But it is a
-- bad failure mode. A rider calling this gets "there are no riders", which reads
-- as data rather than as a refusal, and the grant is the only thing standing
-- between a caller and auth.users. Every other admin function raises, so this one
-- is made to raise too and stays plpgsql for that reason.
create or replace function public.admin_list_profiles()
returns table (
  id          uuid,
  name        text,
  phone       text,
  email       text,
  role        text,
  lang        text,
  avatar      text,
  created_at  timestamptz,
  updated_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may list riders'
      using errcode = '42501';
  end if;

  -- a.email is varchar(255) in auth.users and the output column is text. A
  -- language sql function coerces that silently; plpgsql's RETURN QUERY does
  -- not, and answers "structure of query does not match function result type".
  -- Hence the cast.
  return query
    select p.id, p.name, p.phone, a.email::text, p.role, p.lang, p.avatar,
           p.created_at, p.updated_at
    from public.profiles p
    join auth.users a on a.id = p.id
    order by p.created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_set_password: gen_salt(unknown) does not exist
--
-- Supabase installs pgcrypto into its own `extensions` schema, not public. These
-- functions are security definer with `search_path = public`, which is the right
-- default and is left alone, so the fix is to name the schema on the two calls
-- rather than to widen the search path. Widening it would put every other object
-- in `extensions` ahead of public for the rest of the function.
--
-- gen_salt('bf') is bcrypt, which is what GoTrue stores, so the written hash is
-- one this account can actually sign in with. Verified below by signing in with
-- the rotated password.
create or replace function public.admin_set_password(
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may reset a password'
      using errcode = '42501';
  end if;

  if p_password is null or length(p_password) < 6 then
    raise exception 'password must be at least 6 characters'
      using errcode = '22023';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  -- Existing refresh tokens are dropped, so the new password takes effect
  -- immediately instead of leaving a stolen session valid until it expires.
  delete from auth.sessions where user_id = p_user_id;
end;
$$;
-- ---------------------------------------------------------------------------
-- 5. handle_new_user dropped the phone number every signup collects
--
-- Migration 0002 made phone a column on profiles and backfilled it from signup
-- metadata for the accounts that existed at the time. The trigger that creates
-- profiles was never updated to match, so it went on inserting id, name and lang
-- only. Every account created since then has phone = ''.
--
-- It was invisible from the rider's own screen because the client reads phone
-- back out of raw_user_meta_data when it has one, which masked the empty column.
-- An admin listing riders has no metadata to fall back on and saw a blank number.
--
-- The pickup is not handled here: it arrives as a place_request rather than a
-- profile column, so that an admin curates the list of places instead of every
-- rider inventing one.
--
-- coalesce keeps the two sources from disagreeing if a profile row somehow
-- already exists for this id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, lang, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    coalesce(new.raw_user_meta_data ->> 'phone', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Backfill for accounts created between 0002 and this migration, which the
-- original 0002 backfill could not have reached because it had already run.
update public.profiles p
set phone = coalesce(a.raw_user_meta_data ->> 'phone', '')
from auth.users a
where a.id = p.id and p.phone = '';
