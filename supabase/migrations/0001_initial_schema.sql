-- NVU bus: initial schema.
--
-- Replaces the single localStorage blob with real tables plus row-level
-- security. The shape mirrors src/lib/types.ts so the storage layer can be
-- swapped without reshaping every caller at once.
--
-- Apply with `supabase db push`, or paste into the dashboard SQL Editor.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
-- One row per auth.users entry. `role` is the admin flag.
--
-- Deliberately not a column on auth.users: that table is owned by Supabase, so
-- admin status would live somewhere the app never reads.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null default '',
  role        text not null default 'user' check (role in ('user', 'admin')),
  lang        text not null default 'en' check (lang in ('en', 'ar')),
  avatar      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- places
-- ---------------------------------------------------------------------------
create table if not exists public.places (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Names are unique among live places, but an archived place keeps its name so a
-- historical pass can still be rendered. Hence a partial index rather than a
-- plain unique constraint. Partial constraints cannot be declared inline in
-- CREATE TABLE, only as an index.
create unique index if not exists places_live_name_unique
  on public.places (name)
  where archived = false;

-- ---------------------------------------------------------------------------
-- place_requests
-- ---------------------------------------------------------------------------
create table if not exists public.place_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  name         text not null,
  status       text not null default 'open' check (status in ('open', 'approved', 'rejected')),
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);

-- ---------------------------------------------------------------------------
-- week_subscriptions
-- ---------------------------------------------------------------------------
create table if not exists public.week_subscriptions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles (id) on delete cascade,
  week_start        date not null,
  days              jsonb not null default '{}'::jsonb,
  pickup_place_id   uuid references public.places (id) on delete set null,
  -- Name is denormalised alongside the id: a rider's pass has to stay readable
  -- after their pickup place is renamed, and a pass records what was agreed at
  -- the time rather than a live join.
  pickup_name       text,
  status            text not null default 'none' check (status in ('none', 'pending', 'subscribed')),
  weekly_number     integer,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The constraint that makes weekly numbers safe
-- ---------------------------------------------------------------------------
-- In localStorage, weeklyNumberUsed() / highestNumberInWeek() scanned for a
-- free number. That is correct only because there was exactly one writer. With
-- a server, two riders subscribing in the same instant can both read "12 is
-- free" and both be handed 12, after which a scanned weekly number refers to
-- two different people.
--
-- A partial unique index closes that at the database level, so it holds no
-- matter what the application does. Partial rather than plain unique because
-- unconfirmed rows have no number yet; Postgres would permit repeated NULLs
-- anyway, but an explicit predicate states the intent and stops a future
-- backfill from quietly introducing a duplicate.
create unique index if not exists week_subscriptions_number_per_week
  on public.week_subscriptions (week_start, weekly_number)
  where weekly_number is not null;

-- A rider holds at most one subscription per week.
create unique index if not exists week_subscriptions_one_per_user_week
  on public.week_subscriptions (user_id, week_start);

create index if not exists week_subscriptions_week_start
  on public.week_subscriptions (week_start);

create index if not exists week_subscriptions_user_id
  on public.week_subscriptions (user_id);

create index if not exists place_requests_user_id
  on public.place_requests (user_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists week_subscriptions_touch on public.week_subscriptions;
create trigger week_subscriptions_touch before update on public.week_subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New-user bootstrap
-- ---------------------------------------------------------------------------
-- auth.users is the source of truth for identity, so a profile appears from its
-- own signup metadata the moment that row does. Security definer because the
-- insert runs with elevated rights: under the new user's own RLS context it
-- would otherwise be refused.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, lang)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'lang', 'en')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- is_admin
-- ---------------------------------------------------------------------------
-- Every policy below asks this instead of reading profiles directly. Security
-- definer is required: otherwise the policy on profiles would recurse, needing
-- to read a profile in order to decide whether it may read profiles.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Privilege guards
-- ---------------------------------------------------------------------------
-- RLS decides which ROWS a caller may touch. It cannot decide which COLUMNS of
-- an otherwise-visible row they may change: a `with check` clause compares row
-- identity, not individual fields. So three rules that an admin alone should be
-- able to perform are enforced by comparing old and new values in a trigger.
--
-- Each guard lets `postgres` and `supabase_admin` through, which is what the
-- SQL Editor and service_role run as. That keeps manual administration possible
-- while closing the route a signed-in rider has.
--
-- The rider-facing hole these close, in the current localStorage build, is wide
-- open: isAdminEmail() is a client-side string comparison, so devtools is enough
-- to grant yourself admin, then confirm any week or scan any rider's pass.

-- A rider may not promote themselves. Worth guarding explicitly rather than
-- relying on the column simply being absent from an update payload, because a
-- client can always send it.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'only an admin may change a role'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role_change();

-- A pass is printed from status = 'subscribed', so a rider patching their own
-- row to that value would be self-confirming a subscription. They keep 'none',
-- which is how they cancel.
create or replace function public.guard_week_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.status is distinct from old.status
     and not public.is_admin()
     and new.status <> 'none' then
    raise exception 'only an admin may set week status to %', new.status
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists week_subscriptions_guard_status on public.week_subscriptions;
create trigger week_subscriptions_guard_status before update on public.week_subscriptions
  for each row execute function public.guard_week_status();

-- A rider may withdraw a request by deleting it, but cannot approve it.
create or replace function public.guard_request_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('postgres', 'supabase_admin') then
    return new;
  end if;

  if new.status is distinct from old.status and not public.is_admin() then
    raise exception 'only an admin may change a request status'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists place_requests_guard_status on public.place_requests;
create trigger place_requests_guard_status before update on public.place_requests
  for each row execute function public.guard_request_status();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- Off by default, then granted per operation below. Without this, every table
-- is readable by anyone holding the publishable key, which is a failure mode
-- the current shared-blob design cannot even express.
alter table public.profiles           enable row level security;
alter table public.places             enable row level security;
alter table public.place_requests     enable row level security;
alter table public.week_subscriptions enable row level security;

-- profiles ------------------------------------------------------------------
-- A rider reads their own row; admins read all of them so the dashboard can
-- list riders. Nobody reads anyone else's.
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

-- Which rows you may update. guard_role_change above restricts the columns.
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- No INSERT policy: rows arrive through the auth trigger.
-- No DELETE policy: self-deletion goes through a server-side path later.

-- places --------------------------------------------------------------------
-- Every signed-in rider needs to read places to render the pickup picker.
drop policy if exists places_select_all on public.places;
create policy places_select_all on public.places
  for select to authenticated
  using (true);

-- Creating, renaming and archiving places is an admin action, matching the
-- current PlacesManager, which only admins can reach.
drop policy if exists places_insert_admin on public.places;
create policy places_insert_admin on public.places
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists places_update_admin on public.places;
create policy places_update_admin on public.places
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists places_delete_admin on public.places;
create policy places_delete_admin on public.places
  for delete to authenticated
  using (public.is_admin());

-- place_requests ------------------------------------------------------------
drop policy if exists place_requests_select on public.place_requests;
create policy place_requests_select on public.place_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists place_requests_insert_own on public.place_requests;
create policy place_requests_insert_own on public.place_requests
  for insert to authenticated
  with check (user_id = auth.uid());

-- with check re-asserts ownership, so a rider cannot edit somebody else's
-- request by patching its id. guard_request_status restricts `status`.
drop policy if exists place_requests_update on public.place_requests;
create policy place_requests_update on public.place_requests
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

-- week_subscriptions --------------------------------------------------------
-- Riders read their own weeks; admins read every week, which is what the driver
-- needs in order to resolve a scanned pass that belongs to someone else.
--
-- This policy is also the privacy fix. Today every user can read every other
-- user's name, weekly number and pickup out of the shared localStorage blob,
-- including on a phone where accounts are supposed to be separate.
drop policy if exists week_subscriptions_select on public.week_subscriptions;
create policy week_subscriptions_select on public.week_subscriptions
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- A rider creates their own week. Allocating the number is deliberately not
-- possible here: weekly_number is assigned by allocate_weekly_number() under a
-- lock, so allowing a direct insert here would let a rider choose their own and
-- collide with the unique index instead of being assigned a free one.
--
-- status is checked in guard_week_status(): a rider may set 'none' to cancel but
-- not 'subscribed', which is what a pass is printed from.
drop policy if exists week_subscriptions_insert_own on public.week_subscriptions;
create policy week_subscriptions_insert_own on public.week_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid() and weekly_number is null);

drop policy if exists week_subscriptions_update_own on public.week_subscriptions;
create policy week_subscriptions_update_own on public.week_subscriptions
  for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

drop policy if exists week_subscriptions_delete_own on public.week_subscriptions;
create policy week_subscriptions_delete_own on public.week_subscriptions
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Weekly number allocation
-- ---------------------------------------------------------------------------
-- Done server-side under an advisory lock. Doing it in the client would
-- reintroduce the exact race the unique index above exists to prevent.
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
    select coalesce(max(weekly_number), 0) + 1 into v_next
    from public.week_subscriptions
    where week_start = p_week_start and weekly_number is not null;

    insert into public.week_subscriptions
      (user_id, week_start, days, pickup_place_id, pickup_name, status, weekly_number)
    values
      (p_user_id, p_week_start, p_days, p_pickup_place_id, p_pickup_name, 'pending', v_next)
    returning * into v_row;
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
-- Week confirmation
-- ---------------------------------------------------------------------------
-- The one place status may become 'subscribed'.
create or replace function public.confirm_week(
  p_user_id uuid,
  p_week_start date,
  p_status text default 'subscribed'
)
returns public.week_subscriptions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.week_subscriptions;
begin
  if not public.is_admin() then
    raise exception 'only an admin may confirm a week'
      using errcode = '42501';
  end if;

  update public.week_subscriptions
  set status = p_status,
      confirmed_at = case when p_status = 'subscribed' then now() else null end
  where user_id = p_user_id and week_start = p_week_start
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no subscription for that user and week'
      using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Only the two intended entry points are callable. Default-execute on new
-- functions is a quiet way to publish something, so both are revoked first.
revoke all on function public.allocate_weekly_number(uuid, date, jsonb, uuid, text) from public;
grant execute on function public.allocate_weekly_number(uuid, date, jsonb, uuid, text) to authenticated;

revoke all on function public.confirm_week(uuid, date, text) from public;
grant execute on function public.confirm_week(uuid, date, text) to authenticated;

-- is_admin, handle_new_user and the three guard functions are left ungranted,
-- so no client can call them directly. Policies and triggers invoke them
-- regardless: those are server-side evaluation, not client calls.