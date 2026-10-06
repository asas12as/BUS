-- ---------------------------------------------------------------------------
-- 0005 -- the signup rules the client asks for, enforced by the server too
-- ---------------------------------------------------------------------------
--
-- Follows 0004 and does not edit it: 0004 is applied to the live project, and
-- rewriting an applied migration is how a schema and its history drift apart.
--
-- 0004 made the phone number the identity and left validation where it already
-- lived, in the browser. Everything here exists because a browser check is a
-- courtesy, not a guarantee -- any of it can be skipped by typing at the REST
-- endpoint directly, and the rules below are ones a rider would be wrong to be
-- able to break.
--
-- 1. The bus list is readable before there is an account.
--
--    The pickup is chosen from the buses an admin maintains, and it is chosen
--    while registering. `places_select_all` is `to authenticated`, so a visitor
--    with no account could not read the list: the select was empty and the form
--    was unusable. This is the one deliberate widening of access in the file.
--    It exposes names the same riders already see once signed in, and nothing
--    else -- archived rows stay hidden, and no column here identifies a person.
--
--    A rider cannot pick a bus on an install that has none published, and buses
--    can only be published by an admin, so somebody has to be the first. The
--    first account ever registered becomes an admin, and the pickup is only
--    optional while the bus list is empty. Both exceptions close as soon as the
--    install is in use; see the trigger for the full reasoning and, for the
--    admin one, for what it costs.
--
-- 2. Three words in a name, and a number that could actually be dialled.
--
--    `src/lib/phone.ts` and `src/lib/validate.ts` have enforced these since the
--    cutover. Here they become the same two rules at the point of insertion, so
--    a one-word name or a four-digit "number" cannot be created by going around
--    the form. Mirrored rather than shared: SQL and TypeScript cannot literally
--    share a function, so the parity is held by the test cases in
--    src/lib/phone.test.ts and src/lib/validate.test.ts, which carry the same
--    inputs.
--
--    The two functions are immutable so they can be called from the trigger
--    and from a check without depending on session state. Only normalise_phone
--    has to survive being an index expression, and 0004 already made it
--    immutable for that reason.
--
-- 3. The rider list shows the address the rider actually gave.
--
--    0004 gave every account an address in auth.users derived from its number,
--    because the phone provider on this project is disabled and GoTrue refuses a
--    signup carrying both an email and a phone. So `admin_list_profiles` reading
--    `a.email` was handing admins `p201001234567@phone.invalid` -- an address
--    that does not exist and that no rider could ever receive mail at -- as if it
--    were contact information. It now reads the rider's own `profiles.email`,
--    which is null when they gave none, and the join to auth.users is gone.
--
-- Naming and shapes are unchanged: same functions, same tables, same columns.
-- ---------------------------------------------------------------------------


-- ---------------------------------------------------------------------------
-- 1. The bus list, before there is an account
-- ---------------------------------------------------------------------------
--
-- Narrower than places_select_all on purpose. A rider choosing where they get
-- on needs the current buses and nothing else; an archived one is a route that
-- no longer runs, and a signed-out caller has no business seeing it.
drop policy if exists places_select_active_anon on public.places;
create policy places_select_active_anon on public.places
  for select to anon
  using (archived = false);

-- A rider who is signed in is covered by the wider authenticated policy already.
-- This adds nothing for them, and leaving it to overlap would only make the
-- rule harder to read back.


-- ---------------------------------------------------------------------------
-- 2. The rules, mirrored from the client
-- ---------------------------------------------------------------------------
--
-- Words separated by whitespace, and a part only counts if something is left of
-- it once punctuation is stripped off both ends. That is exactly what
-- countNameWords does in src/lib/validate.ts, and the reason it is worth being
-- precise: `Ahmed - Adel` is two names with a dash between them, not three.
--
-- Stripping per part rather than per name is what makes that come out right.
-- Trimming only the ends of the whole string leaves the bare dash counted.
--
-- [:alpha:] and [:digit:] rather than the \p{L} / \p{N} that the TypeScript uses,
-- because this server rejects \p{...} and \pL outright -- "invalid escape \".
-- Measured against this database rather than assumed: [:alpha:] and [:alnum:]
-- both match Arabic, which was the reason for avoiding them in the first place.
-- Re-checked if the project moves to one with a different collation.
create or replace function public.count_name_words(p_name text)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select count(*)::integer
  from unnest(regexp_split_to_array(btrim(coalesce(p_name, '')), '[[:space:]]+')) as part
  where regexp_replace(part, '[^[:alpha:][:digit:]]', '', 'g') <> '';
$$;

comment on function public.count_name_words(text) is
  'Words in a name, mirroring countNameWords in src/lib/validate.ts.';

create or replace function public.is_valid_name(p_name text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(public.count_name_words(p_name) >= 3, false);
$$;

comment on function public.is_valid_name(text) is
  'True when a name carries at least 3 words. Mirrors isValidName in src/lib/validate.ts.';

-- Kept separate from normalise_phone rather than folded into it. That function
-- builds a unique index, and an index expression has to be total: if it
-- returned null for a too-short number, two such numbers would both normalise
-- to null, compare equal to nobody, and slip past the uniqueness guarantee
-- while looking like they had been checked. Normalising and validating are
-- different jobs and are kept apart here for the same reason.
create or replace function public.is_valid_phone(p_phone text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  -- Counts digits, not characters. normalise_phone returns a leading '+', so
  -- length() on its answer would be one higher than the count src/lib/phone.ts
  -- makes, and the two would disagree about exactly the numbers at the short
  -- end of the range.
  select case
    when public.normalise_phone(p_phone) is null then false
    when length(regexp_replace(public.normalise_phone(p_phone), '\D', '', 'g')) < 8 then false
    when length(regexp_replace(public.normalise_phone(p_phone), '\D', '', 'g')) > 15 then false
    else true
  end;
$$;

comment on function public.is_valid_phone(text) is
  'True when a number normalises to E.164 of 8 to 15 digits. Mirrors isValidPhone in src/lib/phone.ts.';


-- ---------------------------------------------------------------------------
-- 3. Enforced where the profile row is written
-- ---------------------------------------------------------------------------
--
-- The signup trigger. This is the one that matters: it is the only path a new
-- account takes, and it runs for every signup whatever the client sent.
--
-- Refused rather than quietly corrected. A name trimmed to two words is not the
-- name the rider typed, and storing it would leave the interface showing three
-- words and the bus staff seeing two.
--
-- The pickup is resolved here rather than written afterwards by the client.
-- That makes the signup one transaction -- no account can exist with the form
-- half-satisfied -- and it puts the "pickup is required" rule where it cannot be
-- skipped by calling the REST endpoint directly.
--
-- Two exceptions, and they are different ones:
--
--   The first account ever becomes the admin. Without it the app cannot install
--   itself: no admin means no published bus, and no published bus means no
--   pickup to require.
--
--   The pickup is only skippable while no bus has ever been published, because
--   after that there is always something to choose.
--
-- The reasoning behind the first is written out at the assignment below.
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
  v_place  public.places%rowtype;
  v_first  boolean;
  v_nothing_to_pick boolean;
begin
  if not public.is_valid_name(v_name) then
    raise exception 'name must be at least 3 words'
      using errcode = '22023';
  end if;

  if not public.is_valid_phone(v_phone) then
    raise exception 'phone number is not valid'
      using errcode = '22023';
  end if;

  -- Two separate conditions, because they answer two separate questions.
  --
  -- v_first: no rider has ever registered, so this is the first account. It
  -- becomes the admin -- otherwise nobody is, and with no admin there is no way
  -- to publish a bus, add a rider or change a role. This is the bootstrap.
  --
  -- The cost is stated plainly: on an install that has been wiped of its riders,
  -- the next person to register becomes an admin. Somebody with the ability to
  -- delete every profile has already destroyed the data, and an admin is the
  -- least of what that costs. The alternative -- promoting the first admin by
  -- hand over the SQL editor -- leaves the app unable to install itself and is
  -- the reason this would be rediscovered as a bug later.
  v_first := not exists (select 1 from public.profiles);
  --
  -- v_nothing_to_pick: there are no buses at all, so a required pickup would be
  -- unanswerable. Only ever true on an install that has never published a bus.
  -- With buses present the rider picks one, bootstrap or not.
  v_nothing_to_pick := not exists (select 1 from public.places);

  if v_pickup <> '' then
    select * into v_place
      from public.places
     where name = v_pickup and archived = false;

    if not found then
      raise exception 'pickup must be one of the listed buses'
        using errcode = '22023';
    end if;
  elsif not v_nothing_to_pick then
    raise exception 'pickup bus is required'
      using errcode = '22023';
  end if;

  insert into public.profiles (
    id, name, lang, phone, email, role, pickup_place_id, pickup_name
  )
  values (
    new.id,
    v_name,
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    coalesce(v_phone, ''),
    nullif(btrim(new.raw_user_meta_data ->> 'email'), ''),
    -- profiles_guard_role is a BEFORE UPDATE trigger, so this insert is not the
    -- thing it was written to stop; that one is there to stop a rider promoting
    -- themselves once the install is in use.
    case when v_first then 'admin' else 'user' end,
    v_place.id,
    nullif(v_pickup, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. The rider list, showing the address the rider gave
-- ---------------------------------------------------------------------------
--
-- Only the email column changes and the auth.users join goes. The admin check
-- and the ordering are left exactly as 0003 set them.
--
-- Losing the join is worth noting on its own: a security definer function that
-- reaches into auth.users has to be trusted to keep that table's shape, and it
-- had one already -- 0003 exists because a language sql function coerced
-- a.email silently where plpgsql refused it. Reading profiles alone removes the
-- coupling rather than documenting it.
drop function if exists public.admin_list_profiles();

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

  -- p.email, not a.email: see the note at the top. Null when the rider gave no
  -- address, which is the correct value to show rather than the derived one.
  return query
    select p.id, p.name, p.phone, p.email, p.role, p.lang, p.avatar,
           p.created_at, p.updated_at
    from public.profiles p
    order by p.created_at;
end;
$$;

revoke all on function public.admin_list_profiles() from public;
grant execute on function public.admin_list_profiles() to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Existing rows
-- ---------------------------------------------------------------------------
--
-- None of this repairs what is already stored. The table was empty when 0005
-- went on, and the unique index in 0004 refuses a duplicate at write time, so
-- there is nothing to backfill. This block is here so the migration is honest
-- if it is ever applied to a project that has riders: it reports rather than
-- silently leaves rows that break a rule the server now refuses.
--
-- Deliberately a report, not a delete. Silently destroying rider accounts to
-- tidy a migration is not a thing this file is allowed to do.
do $$
declare
  v_bad_names integer;
  v_bad_phones integer;
begin
  select count(*) into v_bad_names
    from public.profiles
    where not public.is_valid_name(name);

  select count(*) into v_bad_phones
    from public.profiles
    where phone <> '' and not public.is_valid_phone(phone);

  if v_bad_names > 0 or v_bad_phones > 0 then
    raise warning
      '0005: % profile(s) with fewer than 3 name words, % with an unusable phone. They were left in place; the server will refuse to change them until an admin fixes them.',
      v_bad_names, v_bad_phones;
  end if;
end;
$$;