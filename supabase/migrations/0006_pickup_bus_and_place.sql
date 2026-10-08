-- NVU bus: the pickup BUS and the pickup PLACE are two different things.
--
-- The bus is the line a rider is on. It is chosen once, at signup, and it is
-- what the admin publishes.
--
-- The place is the stop the rider boards from. It is chosen per week, when the
-- rider subscribes, because a rider may board at a different stop on different
-- weeks.
--
-- Before this file there was a single list (`places`) doing both jobs, which is
-- why the signup dropdown and the subscribe picker read from the same rows. This
-- migration splits them without introducing a second table: `places` gains a
-- `kind`, and every screen filters on it.
--
--   kind = 'place'  a stop. Default for existing rows; they were places.
--   kind = 'bus'    a line. New; the signup dropdown reads only these.
--
-- It also retires the place-request flow. Riders no longer ask an admin to add a
-- stop: a place can still be typed freely when subscribing, and the admin's list
-- is curated by the admin alone. `place_requests` is dropped with its policies.
--
-- This file is idempotent: it can be pasted into the SQL editor more than once
-- without error, because every statement is guarded.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The two lists share one table, separated by `kind`
-- ---------------------------------------------------------------------------

alter table public.places
  add column if not exists kind text not null default 'place'
    check (kind in ('place', 'bus'));

-- Existing rows predate the split and are stops. The default above covers them,
-- but a row inserted without a kind by an older client is caught here too.
update public.places set kind = 'place' where kind is null;

-- ---------------------------------------------------------------------------
-- 2. The bus a rider chose at signup, kept apart from their weekly place
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists pickup_bus_id uuid
    references public.places(id) on delete set null,
  add column if not exists pickup_bus_name text;

-- ---------------------------------------------------------------------------
-- 3. The place-request flow is retired
-- ---------------------------------------------------------------------------

-- Dropped rather than emptied: nothing reads it any more, and leaving an unused
-- table with a rider-insert policy is a write surface with no reader. `cascade`
-- takes its policies and any dependent grants with it.
drop table if exists public.place_requests cascade;

-- ---------------------------------------------------------------------------
-- 4. The signup trigger validates the pickup against the BUSES
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name   text := btrim(coalesce(new.raw_user_meta_data ->> 'name', ''));
  v_phone  text := public.normalise_phone(new.raw_user_meta_data ->> 'phone');
  v_pickup text := btrim(coalesce(new.raw_user_meta_data ->> 'pickup', ''));
  v_bus    public.places%rowtype;
  v_first  boolean;
begin
  if not public.is_valid_name(v_name) then
    raise exception 'name must be at least 3 words'
      using errcode = '22023';
  end if;

  if not public.is_valid_phone(v_phone) then
    raise exception 'phone number is not valid'
      using errcode = '22023';
  end if;

  -- No rider has ever registered, so this account becomes the admin. Without
  -- one nobody can publish a bus, add a rider or change a role. The cost is
  -- stated plainly: on an install wiped of its riders, the next signup becomes
  -- an admin. Somebody able to delete every profile has already destroyed the
  -- data; an admin is the least of that.
  v_first := not exists (select 1 from public.profiles);

  -- A pickup that was sent has to be a real, current BUS. Anything else is a
  -- client bug or a tamper and is refused.
  --
  -- A pickup that was NOT sent is recorded as no bus rather than refused. It
  -- used to raise here, which turned a deploy-ordering mistake into a total
  -- signup outage: the trigger went on before the client that sends the field
  -- was deployed, so every registration failed with GoTrue's opaque "Database
  -- error saving new user". The rule is enforced where it can be seen -- the
  -- form makes the choice required whenever there is a bus to choose -- and the
  -- database refuses an invalid one that is actually sent.
  if v_pickup <> '' then
    select * into v_bus
      from public.places
     where kind = 'bus' and archived = false and name = v_pickup;

    if not found then
      raise exception 'pickup must be one of the listed buses'
        using errcode = '22023';
    end if;
  end if;

  insert into public.profiles (
    id, name, lang, phone, email, role, pickup_bus_id, pickup_bus_name
  )
  values (
    new.id,
    v_name,
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    coalesce(v_phone, ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    -- profiles_guard_role is a BEFORE UPDATE trigger, so this insert is not the
    -- thing it was written to stop: that one stops a rider promoting themselves
    -- once the install is in use.
    case when v_first then 'admin' else 'user' end,
    v_bus.id,
    nullif(v_pickup, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Existing rows
-- ---------------------------------------------------------------------------
--
-- The split has nothing to backfill: the current rows were stops and keep that
-- meaning under the default. This block only reports a profile whose pickup_bus
-- points at a row that is no longer a bus, which would mean somebody edited the
-- kind by hand. It reports rather than repairs, because silently rewriting a
-- rider's bus is not a migration's job.
do $$
declare
  v_mismatched integer;
begin
  select count(*) into v_mismatched
    from public.profiles p
    join public.places b on b.id = p.pickup_bus_id
   where b.kind <> 'bus';

  if v_mismatched > 0 then
    raise warning
      '0006: % profile(s) point at a pickup_bus_id that is not a bus. Left in place; an admin should correct them.',
      v_mismatched;
  end if;
end;
$$;