-- NVU bus: schema additions found missing once the client was wired up.
--
-- Five things 0001 did not cover, each of which a screen already needs:
--
--   1. profiles.phone, and the sign-up pickup. The phone was being read from
--      signup metadata, which is only present on the session that created the
--      account; every later reload showed a blank number on the pass.
--   2. day_entries. Route and time per rider per date were in the localStorage
--      blob and had no table at all.
--   3. scan_records. Scans have to leave an audit trail, and the record has to
--      be written server-side or a driver could keep a local copy that says
--      somebody travelled when they did not.
--   4. Admin operations on auth.users. Emails cannot be listed, details cannot be
--      corrected, passwords cannot be reset and accounts cannot be closed from a
--      client, because auth.users is not exposed through PostgREST.
--   5. A weekly-number ledger. Deleting a subscription row freed its number for
--      reissue, which is the one thing the numbering must never allow: a pass
--      already printed with that number would then scan as the new holder.
--
-- Apply with `supabase db push`, or paste into the dashboard SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Profile fields that belong to the account
-- ---------------------------------------------------------------------------
-- Idempotent so this can be applied to a database that already has the column
-- from a hand-edit.
alter table public.profiles add column if not exists phone text not null default '';

-- Sign-up pickup. Two columns rather than one nullable pair with a sentinel:
-- pickup_place_id points at a curated place, pickup_name holds what the rider
-- typed when it is not one. This is the same shape week_subscriptions uses, and
-- for the same reason -- a pass must stay readable after a place is renamed.
alter table public.profiles
  add column if not exists pickup_place_id uuid references public.places (id) on delete set null;

alter table public.profiles add column if not exists pickup_name text;

-- Backfill the phone from metadata for accounts created before this column
-- existed. Only reads its own row, so it is safe to run as any role.
update public.profiles p
set phone = coalesce(a.raw_user_meta_data ->> 'phone', '')
from auth.users a
where a.id = p.id and p.phone = '';

-- ---------------------------------------------------------------------------
-- 2. day_entries: route and time per rider per date
-- ---------------------------------------------------------------------------
-- A rider's schedule is not a property of the week. A week says which days they
-- ride and which number they hold; this says which bus and what time, and it
-- changes day to day.
create table if not exists public.day_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  entry_date  date not null,
  route       text not null default '',
  time        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- One entry per rider per date. The upsert in the repository relies on this, and
-- without it a second save would leave two rows for the same day and the
-- schedule would show the date twice.
create unique index if not exists day_entries_user_date
  on public.day_entries (user_id, entry_date);

create index if not exists day_entries_date on public.day_entries (entry_date);

drop trigger if exists day_entries_touch on public.day_entries;
create trigger day_entries_touch before update on public.day_entries
  for each row execute function public.touch_updated_at();

alter table public.day_entries enable row level security;

-- Riders read their own schedule; admins read every rider's, because assigning
-- routes is the admin's job.
drop policy if exists day_entries_select on public.day_entries;
create policy day_entries_select on public.day_entries
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Only an admin writes this table. A rider setting their own route would let
-- them claim a seat on a bus they are not booked on.
drop policy if exists day_entries_write_admin on public.day_entries;
create policy day_entries_write_admin on public.day_entries
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. scan_records
-- ---------------------------------------------------------------------------
-- What the driver saw and what the server said at the time.
--
-- `result` is stored rather than inferred later, because the answer depends on
-- the subscription's status at the moment of the scan. A record of "valid" for a
-- rider who cancelled last week would be a false history if it were re-derived
-- from the current row.
create table if not exists public.scan_records (
  id             uuid primary key default gen_random_uuid(),
  scanned_at     timestamptz not null default now(),
  scanned_by     uuid references public.profiles (id) on delete set null,
  week_start     date not null,
  weekly_number  integer,
  rider_id       uuid references public.profiles (id) on delete set null,
  -- 'valid', 'not_found', 'cancelled' or 'pending'.
  result         text not null check (result in ('valid', 'not_found', 'cancelled', 'pending'))
);

-- Recent scans per rider, which is what a dispute is about.
create index if not exists scan_records_rider on public.scan_records (rider_id, scanned_at desc);

-- Number lookups. A scan resolves (week, number) on every pass, so this is the
-- hot path.
create index if not exists scan_records_number on public.scan_records (week_start, weekly_number);

alter table public.scan_records enable row level security;

-- Scans are the driver's business. A rider reading the log would learn who
-- scanned them and when, which is not something the pass implies.
drop policy if exists scan_records_select_admin on public.scan_records;
create policy scan_records_select_admin on public.scan_records
  for select to authenticated
  using (public.is_admin());

drop policy if exists scan_records_insert_admin on public.scan_records;
create policy scan_records_insert_admin on public.scan_records
  for insert to authenticated
  with check (public.is_admin() and scanned_by = auth.uid());

-- No update or delete policy: a scan log is append-only. Correcting a mistaken
-- scan means recording a new one.

-- ---------------------------------------------------------------------------
-- 4. Weekly-number ledger
-- ---------------------------------------------------------------------------
-- The number a rider holds, and the numbers that have ever been issued for a
-- week.
--
-- 0001 computed the next number as max(weekly_number) + 1 over existing rows, so
-- deleting the highest-numbered row made that number free again. A pass printed
-- before the delete would then resolve to whoever subscribed next, and a driver
-- checking the barcode would wave through the wrong person.
--
-- The ledger closes that: the row survives the subscription, so allocation can
-- still see the number it must not hand out again.
create table if not exists public.weekly_number_ledger (
  week_start    date not null,
  weekly_number integer not null,
  user_id       uuid references public.profiles (id) on delete set null,
  issued_at     timestamptz not null default now(),
  primary key (week_start, weekly_number)
);

-- Backfill anything already issued under 0001, so a database that has been in
-- use does not restart numbering from 1.
insert into public.weekly_number_ledger (week_start, weekly_number, user_id)
select week_start, weekly_number, user_id
from public.week_subscriptions
where weekly_number is not null
on conflict do nothing;

alter table public.weekly_number_ledger enable row level security;

-- Nobody reads this directly. It exists so allocation cannot repeat a number,
-- and letting a client read it would leak the size of each week's queue.

-- ---------------------------------------------------------------------------
-- Allocation now reads the ledger
-- ---------------------------------------------------------------------------
create or replace function public.allocate_weekly_number(
  p_user_id uuid,
  p_week_start date,
  p_days jsonb default '{}'::jsonb,
  p_pickup_place_id uuid default null,
  p_pickup_name text default null
)
returns public.week_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next integer;
  v_row  public.week_subscriptions;
begin
  -- Caller must be this rider, or an admin acting on their behalf.
  if auth.uid() is distinct from p_user_id and not public.is_admin() then
    raise exception 'not permitted to allocate for this user'
      using errcode = '42501';
  end if;

  -- Serialise allocation for this week. Keyed on week_start, so unrelated
  -- weeks never block one another.
  perform pg_advisory_xact_lock(hashtextextended(p_week_start::text, 0));

  select * into v_row
  from public.week_subscriptions
  where user_id = p_user_id and week_start = p_week_start;

  if v_row.id is null then
    -- From the ledger, not from the subscriptions: a deleted row must still
    -- hold its number.
    select coalesce(max(weekly_number), 0) + 1 into v_next
    from public.weekly_number_ledger
    where week_start = p_week_start;

    insert into public.week_subscriptions
      (user_id, week_start, days, pickup_place_id, pickup_name, status, weekly_number)
    values
      (p_user_id, p_week_start, p_days, p_pickup_place_id, p_pickup_name, 'pending', v_next)
    returning * into v_row;

    -- Recorded before the transaction commits, so the number is burned even if
    -- the subscription is deleted a moment later.
    insert into public.weekly_number_ledger (week_start, weekly_number, user_id)
    values (p_week_start, v_next, p_user_id)
    on conflict do nothing;
  else
    -- Keep any number already issued: changing it would invalidate whatever the
    -- driver has written down.
    update public.week_subscriptions
    set days = p_days,
        pickup_place_id = p_pickup_place_id,
        pickup_name = p_pickup_name
    where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Scan resolution
-- ---------------------------------------------------------------------------
-- Looks the pass up and writes the outcome in one call.
--
-- Both halves are here rather than left to the client on purpose. If the client
-- checked and then separately reported, a driver on a flaky connection could
-- produce a pass that resolved as valid with no record of the scan, or a record
-- of a scan that was never actually checked. The point of scanning is that the
-- answer and its evidence arrive together.
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
  v_row public.week_subscriptions;
begin
  if not public.is_admin() then
    raise exception 'only an admin may record a scan'
      using errcode = '42501';
  end if;

  select * into v_row
  from public.week_subscriptions
  where week_start = p_week_start and weekly_number = p_weekly_number;

  if v_row.id is null then
    insert into public.scan_records (scanned_by, week_start, weekly_number, result)
    values (auth.uid(), p_week_start, p_weekly_number, 'not_found')
    returning scan_records.result into result;

    rider_id := null;
    rider_name := null;
    pickup_name := null;
    week_start := p_week_start;
    weekly_number := p_weekly_number;
    status := 'none';
    return next;
    return;
  end if;

  result := case v_row.status
    when 'subscribed' then 'valid'
    when 'pending' then 'pending'
    else 'cancelled'
  end;

  insert into public.scan_records (scanned_by, week_start, weekly_number, rider_id, result)
  values (auth.uid(), p_week_start, p_weekly_number, v_row.user_id, result);

  return query
  select
    result,
    v_row.user_id,
    coalesce(p.name, ''),
    v_row.pickup_name,
    v_row.week_start,
    v_row.weekly_number,
    v_row.status;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin operations on auth.users
-- ---------------------------------------------------------------------------
-- These cannot be a client call. auth.users is owned by Supabase and not
-- reachable from PostgREST with the publishable key, so a browser has no way to
-- read an address, change one, or close an account. Security definer, and each
-- one re-checks is_admin() rather than trusting the RLS layer that granted the
-- call, because these run outside it.

-- Rider list with the fields the dashboard shows, joined from auth.users.
--
-- Restricted to admins in the function body as well as by the grant. The grant
-- alone would be enough to keep a rider out, but a security definer function
-- that reads other people's credentials should not depend on a grant to stay
-- correct.
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
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.name, p.phone, a.email, p.role, p.lang, p.avatar, p.created_at, p.updated_at
  from public.profiles p
  join auth.users a on a.id = p.id
  where public.is_admin()
  order by p.created_at;
$$;

-- Corrects a rider's recorded details.
create or replace function public.admin_update_profile(
  p_user_id uuid,
  p_name text default null,
  p_phone text default null,
  p_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may change another account'
      using errcode = '42501';
  end if;

  if p_name is not null then
    update public.profiles set name = p_name where id = p_user_id;
  end if;

  if p_phone is not null then
    update public.profiles set phone = p_phone where id = p_user_id;
  end if;

  -- The address lives in auth.users, so it is changed there and not mirrored.
  -- Leaving a stale copy on profiles would show one address on the pass and
  -- another in the login form.
  if p_email is not null then
    update auth.users set email = p_email where id = p_user_id;
  end if;
end;
$$;

-- Resets a rider's password.
--
-- Only the hash is written, never the password: this runs as SQL, so anything
-- logged or visible in a query plan would be the secret itself. crypt() is
-- pgcrypto's, and it must be the same salt format GoTrue expects or the
-- account is left unable to sign in.
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
  set encrypted_password = crypt(p_password, gen_salt('bf')),
      updated_at = now()
  where id = p_user_id;

  -- Existing refresh tokens are dropped, so the new password takes effect
  -- immediately instead of leaving a stolen session valid until it expires.
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

-- Closes an account.
--
-- Deleting the auth.users row cascades to profiles and from there to weeks,
-- entries and requests, which is the intent: a closed account should leave
-- nothing behind. The ledger's user_id is nulled instead of cascaded, because a
-- weekly number must stay retired whoever held it.
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin may delete an account'
      using errcode = '42501';
  end if;

  -- Refuse to remove the last admin: the app has no recovery path, and losing
  -- every admin means nobody can restore access from the UI.
  if exists (
    select 1 from public.profiles
    where id = p_user_id and role = 'admin'
  ) and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'cannot delete the last admin account'
      using errcode = '42501';
  end if;

  delete from auth.users where id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Place requests can be withdrawn
-- ---------------------------------------------------------------------------
-- The rider screen has had a delete action since before the cutover, and 0001
-- gave place_requests select, insert and update but not delete, so it was refused
-- silently. Own request or admin.
drop policy if exists place_requests_delete on public.place_requests;
create policy place_requests_delete on public.place_requests
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Every function above is revoked from public first. Default-execute on new
-- functions is a quiet way to publish something, and these reach auth.users.
revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;

revoke all on function public.admin_update_profile(uuid, text, text, text) from public;
grant execute on function public.admin_update_profile(uuid, text, text, text) to authenticated;

revoke all on function public.admin_set_password(uuid, text) from public;
grant execute on function public.admin_set_password(uuid, text) to authenticated;

revoke all on function public.admin_delete_user(uuid) from public;
grant execute on function public.admin_delete_user(uuid) to authenticated;

revoke all on function public.record_scan(date, integer) from public;
grant execute on function public.record_scan(date, integer) to authenticated;

-- The ledger and the scan log are server-side. No client reads them directly:
-- scanning goes through record_scan() so the lookup and the evidence are the
-- same call, and allocation reads the ledger under its advisory lock.
revoke all on public.weekly_number_ledger from anon, authenticated;
revoke all on public.scan_records from anon;