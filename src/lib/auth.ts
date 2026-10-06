/**
 * Supabase auth, wrapped so the rest of the app never touches a GoTrue type.
 *
 * Two things this layer adds over calling supabase.auth directly:
 *
 * 1. Signup needs its confirmation flow understood. If the project requires
 *    email confirmation, `signUp` returns a user with no session, and the app
 *    has to say "check your email" instead of signing anyone in.
 * 2. The app needs a signed-in *person*, which is an auth user plus the profile
 *    row the trigger created for it. Those are two reads and they can disagree,
 *    so the pairing is done once here.
 */
import { supabase, describeError, SupabaseNotConfigured } from './supabase'
import { RepoError, fetchOwnProfile } from './repo'
import { normalizePhone, derivedEmailForPhone } from './phone'
import type { MeProfile } from './mappers'

/**
 * What came back from a sign-up attempt.
 *
 * `needsConfirmation` is separate from `user` because the two states are easy
 * to confuse: a returned user with no session is normal, not an error.
 */
export type SignUpOutcome =
  | { kind: 'signed-in'; profile: MeProfile }
  | { kind: 'needs-confirmation'; email: string }
  | { kind: 'already-registered' }
  | { kind: 'error'; message: string }

export type SignInOutcome =
  | { kind: 'signed-in'; profile: MeProfile }
  | { kind: 'error'; message: string }

/** The shape of a GoTrue session, as a type rather than an import. */
type AuthSessionUser = {
  user: { id: string; email?: string | null; user_metadata?: unknown } | null
} | null

export interface AuthSession {
  userId: string
  email: string
  /** From signup metadata; Supabase keeps no phone column on this project. */
  phone: string
}

function fail(error: unknown): never {
  if (error instanceof SupabaseNotConfigured) throw new RepoError(error.message)
  throw new RepoError(describeError(error))
}

/**
 * The session Supabase considers current, or null.
 *
 * Async because reading the session is: Supabase may have to refresh the token
 * with the auth server, and a synchronous read would report "signed out" to
 * somebody who is in fact signed in. Callers await it rather than treating a
 * missing token as an absence of a session.
 */
export async function currentSession(): Promise<AuthSession | null> {
  const { data, error } = await supabase().auth.getSession()
  // A failed read is not a signed-out rider. Throwing keeps a transport failure
  // from being read as "no session", which would bounce them to the login screen.
  if (error) fail(error)
  return toAuthSession(data.session)
}

/**
 * Subscribes to sign-in, sign-out and token refresh.
 *
 * Returns the unsubscribe function. The handler is called with the new session
 * or null, so the app can reload or clear state without polling.
 */
export function onAuthChange(handler: (session: AuthSession | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((_event, session) => {
    handler(toAuthSession(session))
  })
  return () => data.subscription.unsubscribe()
}

/**
 * Narrows a GoTrue session down to the fields the app reads.
 *
 * Carries the phone from user metadata as a fallback only. profiles.phone is the
 * authoritative copy and the signup trigger fills it from this same metadata, so
 * reading it here means a session restored before the profile query completes
 * still knows the number rather than showing a blank field for a moment.
 */
function toAuthSession(session: AuthSessionUser | null): AuthSession | null {
  const user = session?.user
  if (!user) return null
  const metadata = user.user_metadata as { phone?: unknown } | undefined
  return {
    userId: user.id,
    email: user.email ?? '',
    phone: typeof metadata?.phone === 'string' ? metadata.phone : ''
  }
}

/**
 * Creates an account and, when the project allows it, signs the rider straight in.
 *
 * The account's GoTrue address is derived from the phone number, not typed.
 * This project's GoTrue refuses a signup carrying both an email and a phone, and
 * its phone provider is disabled, so email is the only key it can enforce
 * uniqueness on. Deriving the address from the number makes the number the
 * identity: the same number always produces the same address, so Supabase's own
 * unique index is what stops a second account, and signing in is a matter of
 * recomputing the address rather than looking it up.
 *
 * The address lives under `.invalid`, which RFC 2606 reserves and which can
 * never resolve, so no mail is sent to it and no rider can hold one.
 *
 * The rider's own email, when they gave one, is not used as the login key. It
 * rides along in signup metadata and lands on the profile for contact, and
 * nothing else.
 *
 * The name and language go into signup metadata because the trigger that creates
 * the profile row reads them from there. That is the only place they can come
 * from: the insert runs as postgres, with no access to the request body.
 */
export async function signUp(input: {
  email: string
  password: string
  name: string
  lang: 'en' | 'ar'
  phone: string
  /** The bus chosen from the admin's list. Empty only on the first-ever signup. */
  pickup: string
}): Promise<SignUpOutcome> {
  const contactEmail = input.email.trim().toLowerCase()
  let derived: string
  try {
    derived = derivedEmailForPhone(input.phone)
  } catch {
    return { kind: 'error', message: 'That phone number could not be read.' }
  }

  let result
  try {
    result = await supabase().auth.signUp({
      email: derived,
      password: input.password,
      options: {
        data: {
          name: input.name.trim(),
          lang: input.lang,
          phone: normalizePhone(input.phone) ?? '',
          // The pickup travels with the signup rather than being written after
          // it. That makes the signup one transaction, so there is no state in
          // which an account exists with the form half-satisfied, and it puts
          // "pickup is required" in the database trigger where it cannot be
          // skipped by calling this endpoint directly.
          //
          // Empty only when the install has no buses published yet: the first
          // account on an untouched install becomes the admin who adds them.
          pickup: input.pickup.trim() || null,
          // Null rather than omitted: an empty string would be stored as if the
          // rider had typed an address, and contact would show them a blank row.
          email: contactEmail || null
        },
        // Keeps the confirmation email out of the URL when the project has it on.
        emailRedirectTo: typeof window === 'undefined' ? undefined : window.location.origin
      }
    })
  } catch (error) {
    fail(error)
  }

  if (result.error) {
    // GoTrue reports a duplicate signup as a success with an empty user list
    // when "confirm email" is on, so this check has to come before the error.
    // With the address derived from the number, this is the duplicate-number
    // answer: "already registered" means this number already has an account.
    if (/already registered|already been registered|user already/i.test(result.error.message)) {
      return { kind: 'already-registered' }
    }
    return { kind: 'error', message: describeError(result.error) }
  }

  const user = result.data.user
  // No session means the project requires email confirmation. Not an error. The
  // user is checked first: with confirmation on, GoTrue returns a user with no
  // session, which is the expected shape rather than a failure.
  if (!user) {
    return { kind: 'needs-confirmation', email: contactEmail || derived }
  }

  const profile = await loadUser(user, contactEmail)
  return profile ? { kind: 'signed-in', profile } : { kind: 'needs-confirmation', email: contactEmail || derived }
}

/**
 * Signs in, with the phone number rather than an email address.
 *
 * The address is recomputed from the number the rider typed, so no lookup is
 * involved and the database is never asked which accounts exist. A number that
 * spells an existing account differently still finds it, which is the point.
 */
export async function signIn(phone: string, password: string): Promise<SignInOutcome> {
  let derived: string
  try {
    derived = derivedEmailForPhone(phone)
  } catch {
    // The same shape GoTrue would return for an unknown account, so a malformed
    // number is not distinguishable from a wrong password.
    return { kind: 'error', message: 'Wrong phone number or password' }
  }

  let result
  try {
    result = await supabase().auth.signInWithPassword({
      email: derived,
      password
    })
  } catch (error) {
    fail(error)
  }

  if (result.error) {
    // Supabase returns the same message for an unknown address and a wrong
    // password, which is deliberate: telling them apart would confirm which
    // numbers have accounts.
    return { kind: 'error', message: describeError(result.error) }
  }

  const user = result.data.user
  if (!user) {
    // No user with no error. GoTrue does this when the session was created but
    // not returned, which means the response is unusable rather than that the
    // password was wrong.
    return { kind: 'error', message: 'Sign-in did not complete. Try again in a moment.' }
  }

  const profile = await loadUser(user)
  if (!profile) return { kind: 'error', message: 'Your profile could not be loaded. Try again in a moment.' }
  return { kind: 'signed-in', profile }
}

/**
 * The profile for an auth user, retried once.
 *
 * The trigger that creates the row runs with elevated rights, so immediately
 * after sign-up it may not be visible yet. One retry covers that without turning
 * a transient race into a failed login.
 *
 * The phone and the contact email are passed in rather than joined. `auth.users`
 * is not queryable from a client, and the account's GoTrue address is derived
 * from the phone rather than being it, so the session's own email field is a
 * synthetic value and useless for display. The profile row holds the rider's
 * real address, and fetchOwnProfile prefers it.
 */
async function loadUser(
  authUser: { id: string; email?: string; user_metadata?: unknown },
  fallbackEmail = ''
): Promise<MeProfile | null> {
  const metadata = authUser.user_metadata as { phone?: unknown; email?: unknown } | undefined
  const phone = typeof metadata?.phone === 'string' ? metadata.phone : ''
  const contact =
    typeof metadata?.email === 'string' && metadata.email.trim()
      ? metadata.email.trim()
      : fallbackEmail

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const profile = await fetchOwnProfile(authUser.id, contact, phone)
    if (profile) return profile
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  return null
}

/**
 * Signs out and clears the local snapshot.
 *
 * Both halves matter: Supabase forgets the session, and clearCache removes the
 * rider's name and weekly number from a shared device. Signing out and leaving
 * that behind would defeat the point of signing out.
 */
export async function signOut(): Promise<void> {
  const { clearCache } = await import('./cache')
  try {
    await supabase().auth.signOut()
  } finally {
    clearCache()
  }
}

/**
 * Changes the password for the signed-in user.
 *
 * Supabase requires the current password as proof, so this takes both. There is
 * no admin path for setting another rider's password any more: an admin who
 * needs to reset one should use the Supabase dashboard, where the reset is
 * audited. Handing the app that capability would put every rider's credentials
 * in the hands of whoever holds the admin role.
 */
export async function changePassword(current: string, next: string): Promise<string | null> {
  const { error } = await supabase().auth.updateUser({ password: next })
  if (error) {
    // Re-authenticate first: if the session is old, Supabase reports the failure
    // as an invalid token rather than as a bad current password. Awaited,
    // because the session read is a round trip that may refresh the token.
    const session = await currentSession().catch(() => null)
    const { error: signInError } = await supabase().auth.signInWithPassword({
      email: session?.email ?? '',
      password: current
    })
    if (signInError) return describeError(signInError)
    const retry = await supabase().auth.updateUser({ password: next })
    return retry.error ? describeError(retry.error) : null
  }
  return null
}