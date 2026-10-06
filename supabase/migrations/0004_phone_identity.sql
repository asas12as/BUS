-- ---------------------------------------------------------------------------
-- 0004: the phone number is the account
-- ---------------------------------------------------------------------------
--
-- Four changes, all of them about identity.
--
-- 1. One number, one account.
--    profiles.phone held whatever the rider typed, so +201001234567 and
--    01001234567 were two different strings and two accounts. The column now
--    stores the normalised E.164 form and a unique index is built over the
--    normalised value, so the guarantee is the database's rather than the
--    client's. The index is a partial one because an account with no number is
--    still allowed to exist, and several of those must not collide on the empty
--    string.
--
-- 2. normalise_phone is immutable so the index can be built on an expression.
--    A generated column needs an immutable expression, which is why this is
--    plain SQL rather than the plpgsql used elsewhere in this schema. It
--    mirrors src/lib/phone.ts; the two are tested against the same cases and
--    must not drift.
--
-- 3. email becomes optional. GoTrue on this project rejects a signup that
--    carries both an email and a phone, and its phone provider is disabled, so
--    an account whose rider typed no email is given an address derived from the
--    number by the client. That address is real to Supabase and undeliverable
--    to anyone, which is what makes it safe to key uniqueness on. The rider's
--    actual address, when they gave one, is kept here for contact.
--
-- 4. phone_in_use exists so the signup form can say "this number is already
--    registered" instead of surfacing a raw unique-violation. It is a convenience,
--    not the guarantee: a check that is answered before a write can be raced, and
--    the index in (1) is what actually holds. The error message is deliberately
--    the same one Supabase returns for a duplicate address, because that is
--    already the shape of the answer.
--
-- Naming: the table stays profiles and the column stays phone. Renaming either
-- would touch every policy, function and column reference in the schema for no
-- behavioural gain.

-- ---------------------------------------------------------------------------
-- 1. Normalisation
-- ---------------------------------------------------------------------------

-- The same rules as src/lib/phone.ts, in the order that matters:
--   * a leading + means the number is already international and is trusted
--     whatever the country, because assuming otherwise corrupts it;
--   * a leading 00 is the international prefix;
--   * a leading 0 is the national trunk zero, dropped rather than prefixed;
--   * a bare country code is taken as international;
--   * anything else is national.
--
-- Written as SQL rather than plpgsql because a generated column will only accept
-- an immutable expression. That immutability is not a property this function
-- really has -- it reads a hard-coded country code -- so if the country ever has
-- to become configurable, this constraint has to go and the uniqueness has to
-- move to a trigger. Stated here so the trade-off is not rediscovered later.
create or replace function public.normalise_phone(p_phone text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when p_phone is null then null
    when regexp_replace(p_phone, '\D', '', 'g') = '' then null
    when btrim(p_phone) like '+%'
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    when regexp_replace(p_phone, '\D', '', 'g') like '00%'
      then '+' || substring(regexp_replace(p_phone, '\D', '', 'g') from 3)
    when regexp_replace(p_phone, '\D', '', 'g') like '0%'
      then '+20' || substring(regexp_replace(p_phone, '\D', '', 'g') from 2)
    when regexp_replace(p_phone, '\D', '', 'g') like '20%'
         and length(regexp_replace(p_phone, '\D', '', 'g')) >= 10
      then '+' || regexp_replace(p_phone, '\D', '', 'g')
    else '+20' || regexp_replace(p_phone, '\D', '', 'g')
  end;
$$;

comment on function public.normalise_phone(text) is
  'Phone number to E.164, assuming Egypt (+20). Mirrors src/lib/phone.ts.';

-- ---------------------------------------------------------------------------
-- 2. One number, one account
-- ---------------------------------------------------------------------------

-- Existing values are rewritten first. Without this the index below would fail
-- to build on any table that already held two spellings of one number, which is
-- exactly the state this migration exists to end.
update public.profiles
set phone = coalesce(public.normalise_phone(phone), '')
where phone <> ''
  and phone is distinct from coalesce(public.normalise_phone(phone), '');

-- Any duplicate that survives normalisation is a genuine collision: two accounts
-- holding the same number in the same spelling. These cannot be merged safely
-- from SQL, since choosing a winner discards the other's subscriptions. They are
-- blanked and left for an admin to reconcile, which keeps signup working for
-- everyone else instead of failing the whole migration.
update public.profiles p
set phone = ''
where p.phone <> ''
  and exists (
    select 1 from public.profiles other
    where other.phone = p.phone and other.id <> p.id
  );

create unique index if not exists profiles_phone_unique
  on public.profiles (public.normalise_phone(phone))
  where phone <> '';

-- ---------------------------------------------------------------------------
-- 3. Optional email
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists email text;

update public.profiles p
set email = a.email
from auth.users a
where a.id = p.id and p.email is null;

-- ---------------------------------------------------------------------------
-- 4. The signup trigger
-- ---------------------------------------------------------------------------

-- Now writes the normalised number and the rider's own address when they gave
-- one. A violation of profiles_phone_unique here aborts the signup, which is the
-- behaviour wanted: the second holder of a number should not end up with an
-- account that cannot sign in.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, lang, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'lang', 'en'),
    coalesce(public.normalise_phone(new.raw_user_meta_data ->> 'phone'), ''),
    nullif(new.raw_user_meta_data ->> 'email', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. A readable answer for the signup form
-- ---------------------------------------------------------------------------

-- Answers only whether the number is taken. Deliberately reveals nothing else:
-- no name, no account id, no whether a given name exists. The rider already
-- learns that a number is in use by attempting to sign up, so this changes the
-- wording of that answer, not who can ask.
create or replace function public.phone_in_use(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where public.normalise_phone(p.phone) is not null
      and public.normalise_phone(p.phone) = public.normalise_phone(p_phone)
  );
$$;

revoke all on function public.phone_in_use(text) from public;
grant execute on function public.phone_in_use(text) to anon, authenticated;