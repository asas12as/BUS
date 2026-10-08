/**
 * Everything the app knows about the signed-in rider and the server.
 *
 * Replaces useAppData, which wrote the whole app state to localStorage on every
 * change. The shape is deliberately similar, because every screen already
 * depends on it, but the important differences are:
 *
 * - The session comes from Supabase, not from a row in the shared blob.
 * - Nothing is written locally except a snapshot of what the server returned.
 * - A failed write is reported and dropped. There is no queue, because offline
 *   is read-only by decision.
 * - `role` comes from the database on every load. It is never inferred from an
 *   email address, which is what made the previous admin check a devtools away
 *   from being bypassed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DayEntry, Lang, PickupPlace, SubStatus, User, WeekSubscription } from './types'
import { isValidDayChoice } from './date'
import { cacheAvailable, readCache, writeCache, clearCache, readDeviceLang, writeDeviceLang } from './cache'
import * as repo from './repo'
import { RepoError } from './repo'
import * as auth from './auth'
import { networkAvailable, supabaseConfigured } from './supabase'
import type { ScanResolution } from './mappers'

/**
 * The outcome of an action.
 *
 * `ok` is optional rather than required, so a failure can be written as
 * `{ error }` alone. That is the shape most call sites want, and requiring
 * `ok: false` on every failure made it easy to return a truthy-looking result
 * by mistake.
 */
export interface RepoResult {
  ok?: boolean
  /** A message from the server, or a translation key the screen renders. */
  error?: string
  /** True when the app declined the action itself, not the server. */
  local?: boolean
  /**
   * The account was created but the rider still has to confirm their address.
   *
   * Not a failure: `ok` stays false because there is no session to go on to,
   * but the caller should say so rather than reporting a problem, because
   * retrying the sign-up would just report the address as already registered.
   */
  needsConfirmation?: boolean
  /**
   * The role of the account that was just signed in or created.
   *
   * Returned because the screen that starts the flow needs it immediately, to
   * decide where to send the rider. Reading it from context at that moment
   * reads the state from before the sign-in, which is nobody's role at all, and
   * an admin who lands on the rider's home page instead of the dashboard looks
   * like a broken login.
   */
  role?: User['role']
}

export interface SyncState {
  /** True while the first load for this session is in flight. */
  loading: boolean
  /** True when the last read or write failed. */
  error: string | null
  /** False when the browser reports no network, or a call failed on transport. */
  online: boolean
  /** True when the app is showing a cached snapshot because the server is unreachable. */
  stale: boolean
}

interface ServerState {
  user: User | null
  weeks: Array<{ userId: string; sub: WeekSubscription }>
  places: PickupPlace[]
  lang: Lang
}

const EMPTY: ServerState = {
  user: null,
  weeks: [],
  places: [],
  lang: 'en'
}

/**
 * The state a signed-out visitor starts from.
 *
 * Carries whatever language this device last chose, so the login and signup
 * screens open in it rather than always in English. Read once at module load
 * rather than in an effect, because the first paint is the one that decides
 * whether somebody can read the form at all.
 */
function signedOutState(): ServerState {
  return { ...EMPTY, lang: readDeviceLang() ?? 'en' }
}

export interface SessionStore {
  data: ServerState
  sync: SyncState
  cacheOk: boolean
  configured: boolean

  /** Latest server state, for the many screens that only read it. */
  refresh: () => Promise<void>
  /** Runs a repository call and folds the result into local state. */
  mutate: <T>(work: () => Promise<T>, after?: () => Promise<void>) => Promise<RepoResult>

  signUp: (input: {
    name: string
    phone: string
    email: string
    password: string
    pickupBus: string
  }) => Promise<RepoResult>
  signIn: (phone: string, password: string) => Promise<RepoResult>
  signOut: () => Promise<void>

  toggleLang: () => Promise<void>

  subscribeWeek: (userId: string, weekStart: string, choice: PlaceChoice) => Promise<RepoResult>
  cancelSubscription: (userId: string, weekStart: string) => Promise<RepoResult>
  confirmWeek: (userId: string, weekStart: string) => Promise<RepoResult>

  createPlace: (name: string, kind: 'place' | 'bus', busId?: string | null) => Promise<RepoResult>
  renamePlace: (id: string, name: string) => Promise<RepoResult>
  archivePlace: (id: string) => Promise<RepoResult>
  restorePlace: (id: string) => Promise<RepoResult>
  deletePlace: (id: string) => Promise<RepoResult>

  setPlaceBus: (id: string, busId: string | null) => Promise<RepoResult>

  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'avatar' | 'phone' | 'pickupLocation'>>
  ) => Promise<RepoResult>
  changePassword: (current: string, next: string) => Promise<RepoResult>
  setUserRole: (id: string, role: 'user' | 'admin') => Promise<RepoResult>
  deleteSubscription: (userId: string, weekStart: string) => Promise<RepoResult>
  changePickup: (userId: string, weekStart: string, choice: PlaceChoice) => Promise<RepoResult>
  setWeekStatus: (userId: string, weekStart: string, status: SubStatus) => Promise<RepoResult>

  /* --------------------------- admin on riders --------------------------- */

  /** Admin-only list of every account, with emails joined server-side. */
  allUsers: () => Promise<User[]>
  adminUpdateProfile: (
    userId: string,
    patch: Partial<Pick<User, 'name' | 'phone' | 'email'>>
  ) => Promise<RepoResult>
  adminSetPassword: (userId: string, password: string) => Promise<RepoResult>
  adminDeleteUser: (userId: string) => Promise<RepoResult>

  /* ------------------------------- schedules ------------------------------ */

  /** Route and time for a rider's days, as the admin assigned them. */
  daysFor: (userId: string) => Promise<Record<string, DayEntry>>
  updateDay: (userId: string, date: string, patch: Partial<DayEntry>) => Promise<RepoResult>

  /**
   * Resolves a scanned weekly number and records the attempt.
   *
   * Used by the scanner, where the scanned code is only an identifier and the
   * answer has to come from the current books: a rider's own saved screenshot
   * may show a week that was since cancelled. Returns null when there is no
   * such subscription now, which is the honest answer for a stale screenshot.
   */
  resolveWeeklyNumber: (weekStart: string, number: number) => Promise<ScanResolution | null>
}

export interface PlaceChoice {
  id: string | null
  name: string
  days: number[]
}

/** One-time per session flag so a failed first load is not retried in a loop. */
const MAX_AUTORETRY = 2

export function useSessionStore(): SessionStore {
  // Read first, because `loading` is initialised from it below: a build with no
  // database has nothing to wait for and should never show a loading state.
  const [configured] = useState<boolean>(() => supabaseConfigured())
  const [data, setData] = useState<ServerState>(EMPTY)
  const [sync, setSync] = useState<SyncState>({
    loading: configured,
    error: null,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    stale: false
  })
  const [cacheOk] = useState<boolean>(() => cacheAvailable())

  /**
   * Kept in a ref so the auth callback and the mutation helpers can read the
   * current user without depending on it. A ref rather than a closure because
   * this callback is registered once, and a stale user id there would write
   * another rider's rows.
   */
  const userRef = useRef<User | null>(null)
  /**
   * Language, mirrored into a ref because loadAll needs it but must not depend
   * on it. A ref rather than a closure because the callback is created once: a
   * captured `data.lang` would be the empty initial state forever, and a failed
   * profile read would silently reset the interface to English.
   */
  const langRef = useRef<Lang>('en')
  const retried = useRef(0)
  /** Auth subscription teardown, held because it is created after an await. */
  const unsubscribeRef = useRef<(() => void) | null>(null)

  /**
   * Moves a language chosen before signing in onto the profile.
   *
   * The device preference outranks the stored one on purpose: somebody who has
   * just read a form in Arabic and then typed a password expects to still be
   * reading Arabic, not to be switched back on the strength of a column written
   * months ago on another device. Best effort -- if the write fails the profile
   * keeps its own language and the interface still shows what was chosen here.
   */
  const promoteDeviceLang = useCallback(async (userId: string, profileLang: Lang) => {
    const chosen = readDeviceLang()
    if (!chosen || chosen === profileLang) return
    try {
      await repo.saveLanguage(userId, chosen)
      langRef.current = chosen
      setData((prev) => ({ ...prev, lang: chosen }))
    } catch {
      // The rider is signed in either way. Leaving the interface on the language
      // they just chose is better than reverting it for a failed preference write.
    }
  }, [])

  useEffect(() => {
    userRef.current = data.user
  }, [data.user])

  useEffect(() => {
    langRef.current = data.lang
  }, [data.lang])

  /** Folds a snapshot into the cache. Never the source of truth. */
  const saveSnapshot = useCallback((state: ServerState) => {
    if (!state.user) return
    writeCache({
      userId: state.user.id,
      user: state.user,
      weeks: state.weeks,
      places: state.places,
      lang: state.lang
    })
  }, [])

  const loadAll = useCallback(async () => {
    const userId = userRef.current?.id
    if (!userId) {
      // The pickup list is needed before there is an account, because the rider
      // chooses their bus while registering. Fetched on its own rather than as
      // part of the signed-in load, and a failure here is swallowed so a dropped
      // request leaves the session alone instead of tearing down the provider.
      try {
        const places = await repo.fetchPlaces()
        setData((prev) => ({ ...prev, places }))
      } catch {
        // Left as it was. The form then says no bus is available yet, which is
        // true from this device's point of view and does not pretend otherwise.
      }
      return
    }
    setSync((s) => ({ ...s, loading: true, error: null }))
    try {
      const [me, weeks, places] = await Promise.all([
        repo.fetchOwnProfile(userId, userRef.current?.email, userRef.current?.phone),
        repo.fetchWeekSubscriptions(),
        repo.fetchPlaces()
      ])
      const next: ServerState = {
        user: me?.user ?? userRef.current,
        weeks,
        places,
        // Language comes from the profile row, which is per account. Falling
        // back to what is already on screen keeps a read failure from flipping
        // the interface back to English.
        lang: me?.lang ?? langRef.current
      }
      if (me) userRef.current = me.user
      setData(next)
      saveSnapshot(next)
      retried.current = 0
      setSync({ loading: false, error: null, online: true, stale: false })
    } catch (error) {
      // Fall back to the last snapshot so a rider opening the app on the bus
      // still sees their pass, flagged as not current.
      const cached = readCache(userId)
      if (cached) {
        setData({
          user: cached.user,
          weeks: cached.weeks,
          places: cached.places,
          lang: cached.lang
        })
      }
      const message = error instanceof RepoError ? error.message : 'Could not reach the server'
      setSync({
        loading: false,
        error: message,
        online: !(error instanceof RepoError && error.isOffline),
        stale: Boolean(cached)
      })
    }
    // Depends only on saveSnapshot, which is stable. The user and language come
    // from refs for the same reason: including `data` would rebuild this on
    // every load, and the auth subscription below would then be torn down and
    // re-registered each time.
  }, [saveSnapshot])

  /** Reload after a sign-in or a write. */
  const refresh = useCallback(async () => {
    await loadAll()
  }, [loadAll])

  /* ------------------------------ auth wiring ----------------------------- */

  useEffect(() => {
    // Nothing to start: with no database configured, `sync.loading` was
    // initialised to false above and every action returns the same refusal.
    if (!configured) return

    let cancelled = false

    // Establish the session first. This is async because Supabase restores it
    // from localStorage, and everything below depends on knowing who is signed
    // in before it reads anything.
    const start = async () => {
      // The session read is awaited and its failure swallowed here rather than
      // allowed to escape: a transport problem on startup should leave the app
      // in its signed-out-but-retryable state, not crash the provider.
      const existing = await auth.currentSession().catch(() => null)
      if (existing) {
        const me = await repo.fetchOwnProfile(existing.userId, existing.email, existing.phone).catch(() => null)
        if (cancelled) return
        if (me) {
          userRef.current = me.user
          setData((prev) => ({ ...prev, user: me.user, lang: me.lang }))
        }
      }

      await loadAll()
      if (cancelled) return

      // Then listen, so a sign-out in another tab clears this one. The handle
      // goes into a ref because the subscription is registered after two awaits,
      // so the cleanup function above has already been created by the time it
      // exists.
      unsubscribeRef.current = auth.onAuthChange(async (session) => {
        if (cancelled) return
        if (!session) {
          userRef.current = null
          setData(EMPTY)
          setSync((s) => ({ ...s, loading: false, error: null, stale: false }))
          return
        }
        const me = await repo.fetchOwnProfile(session.userId, session.email)
        if (cancelled) return
        userRef.current = me?.user ?? null
        setData((prev) => ({ ...prev, user: me?.user ?? null, lang: me?.lang ?? prev.lang }))
        retried.current = 0
        await loadAll()
      })
    }

    void start()

    return () => {
      cancelled = true
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
    }
    // Depends on loadAll, which is stable, so this runs once per configuration.
  }, [configured, loadAll])

  /* ---------------------------- connectivity ----------------------------- */

  useEffect(() => {
    if (!configured) return
    const goOnline = () => {
      // Coming back into range is worth a refetch: the snapshot on screen may be
      // from before a cancellation or a new weekly number.
      if (retried.current < MAX_AUTORETRY) {
        retried.current += 1
        void loadAll()
      }
    }
    const goOffline = () => setSync((s) => ({ ...s, online: false }))

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [configured, loadAll])

  /* ------------------------------- mutations ----------------------------- */

  /**
   * Runs a write, then reloads.
   *
   * The reload is unconditional rather than patched locally, because the server
   * decides things the browser cannot: which weekly number was issued, whether a
   * status change was permitted. Patching from what was sent would show the rider
   * a number that the database then refused.
   */
  const mutate = useCallback(
    async <T,>(work: () => Promise<T>, after?: () => Promise<void>): Promise<RepoResult> => {
      if (!networkAvailable()) {
        return { error: 'offline', local: true }
      }
      try {
        await work()
        if (after) await after()
        await loadAll()
        return { ok: true }
      } catch (error) {
        const message = error instanceof RepoError ? error.message : 'Something went wrong'
        if (error instanceof RepoError && error.isOffline) {
          setSync((s) => ({ ...s, online: false, error: message, stale: true }))
        } else {
          setSync((s) => ({ ...s, error: message }))
        }
        return { error: message }
      }
    },
    [loadAll]
  )

  /* --------------------------------- auth --------------------------------- */

  const signUp = useCallback<SessionStore['signUp']>(
    async (input) => {
      if (!configured) return { error: 'This build has no database configured', local: true }
      try {
        // Asked before the signup rather than only relied on afterwards. GoTrue
        // reports a duplicate on the derived address in its own words, which is
        // both English-only and about an address the rider never typed -- so the
        // number is checked here and refused in the language being read.
        //
        // Only a fast "yes" is believed. A false is not proof the number is free:
        // the function is deliberately answerable by anyone, so a transport
        // failure must fall through to the signup attempt rather than lock a
        // rider out of a number they may well own. The unique index is what
        // actually enforces it, and it fires either way.
        if (await repo.isPhoneRegistered(input.phone)) return { error: 'phoneTaken' }

        const outcome = await auth.signUp({
          email: input.email,
          password: input.password,
          name: input.name,
          lang: data.lang,
          phone: input.phone,
          pickup: input.pickupBus
        })
        if (outcome.kind === 'error') return { error: outcome.message }
        if (outcome.kind === 'already-registered') return { error: 'phoneTaken' }
        if (outcome.kind === 'needs-confirmation') {
          return { needsConfirmation: true, error: outcome.email }
        }
        userRef.current = outcome.profile.user
        setData((prev) => ({ ...prev, user: outcome.profile.user, lang: outcome.profile.lang }))

        // The bus went out with the signup and the database stored it, so there is
        // nothing to write here. An empty one means the install had no bus to
        // choose yet, which is only true of the very first account.
        await promoteDeviceLang(outcome.profile.user.id, outcome.profile.lang)
        await loadAll()
        return { ok: true, role: outcome.profile.user.role }
      } catch (error) {
        const message = error instanceof RepoError ? error.message : 'Could not create the account'
        return { error: message }
      }
    },
    [configured, data.lang, loadAll, promoteDeviceLang]
  )

  const signIn = useCallback<SessionStore['signIn']>(
    async (phone, password) => {
      if (!configured) return { error: 'This build has no database configured', local: true }
      try {
        const outcome = await auth.signIn(phone, password)
        if (outcome.kind === 'error') return { error: outcome.message }
        userRef.current = outcome.profile.user
        setData((prev) => ({ ...prev, user: outcome.profile.user, lang: outcome.profile.lang }))
        await promoteDeviceLang(outcome.profile.user.id, outcome.profile.lang)
        await loadAll()
        return { ok: true, role: outcome.profile.user.role }
      } catch (error) {
        const message = error instanceof RepoError ? error.message : 'Could not sign in'
        return { error: message }
      }
    },
    [configured, loadAll, promoteDeviceLang]
  )

  const signOut = useCallback(async () => {
    await auth.signOut()
    clearCache()
    userRef.current = null
    setData(signedOutState())
    setSync({ loading: false, error: null, online: sync.online, stale: false })
  }, [sync.online])

  /* ------------------------------ preferences ---------------------------- */

  /**
   * Switches the interface language.
   *
   * Two cases, because there are two situations and one rule:
   *
   * Signed in, the language is a column on the profile and this is a write. It
   * is refused offline like every other one, and refused rather than applied
   * locally first, so the switch does not take effect until the server has
   * accepted it. That is honest: a language only this device remembered would
   * quietly disagree with the profile the rider sees on another one.
   *
   * Signed out, there is no profile to write to, and the switch used to do
   * nothing at all -- which left the button on the login and signup screens
   * dead. A rider who cannot read the form cannot register, and cannot reach the
   * screen where the language would have been changeable. So before sign-in the
   * choice is kept on the device, applied immediately, and promoted to the
   * profile at sign-in and at sign-up.
   */
  const toggleLang = useCallback(async () => {
    const next: Lang = data.lang === 'en' ? 'ar' : 'en'
    const user = userRef.current

    if (!user) {
      langRef.current = next
      writeDeviceLang(next)
      setData((prev) => ({ ...prev, lang: next }))
      return
    }

    if (!networkAvailable()) return
    try {
      await repo.saveLanguage(user.id, next)
      langRef.current = next
      setData((prev) => ({ ...prev, lang: next }))
    } catch {
      // Left on the old language, and the failure is visible as the switch doing
      // nothing. Swapping it first and reverting would flicker the whole UI.
    }
  }, [data.lang])

  /* ----------------------------- subscriptions --------------------------- */

  const subscribeWeek = useCallback<SessionStore['subscribeWeek']>(
    async (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) return { error: 'selectPlace', local: true }
      if (!isValidDayChoice(choice.days)) return { error: 'pickDaysCount', local: true }
      return mutate(() =>
        repo.allocateWeek({
          userId,
          weekStart,
          days: choice.days,
          pickupPlaceId: choice.id,
          pickupName: choice.name.trim() || null
        })
      )
    },
    [mutate]
  )

  const cancelSubscription = useCallback<SessionStore['cancelSubscription']>(
    async (userId, weekStart) => {
      const existing = data.weeks.find((w) => w.userId === userId && w.sub.weekStart === weekStart)?.sub
      // Blocked once paid, same as before. Checked against the server's copy so
      // the rule holds even if the screen is showing a stale snapshot.
      if (existing?.status === 'subscribed') return { error: 'alreadyPaid', local: true }
      return mutate(() => repo.cancelWeekOnServer(userId, weekStart))
    },
    [data.weeks, mutate]
  )

  const confirmWeek = useCallback<SessionStore['confirmWeek']>(
    async (userId, weekStart) => mutate(() => repo.confirmWeekOnServer(userId, weekStart, 'subscribed')),
    [mutate]
  )

  const setWeekStatus = useCallback<SessionStore['setWeekStatus']>(
    async (userId, weekStart, status) =>
      mutate(() => repo.confirmWeekOnServer(userId, weekStart, status)),
    [mutate]
  )

  const deleteSubscription = useCallback<SessionStore['deleteSubscription']>(
    async (userId, weekStart) => mutate(() => repo.deleteWeekOnServer(userId, weekStart)),
    [mutate]
  )

  const changePickup = useCallback<SessionStore['changePickup']>(
    async (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) return { error: 'selectPlace', local: true }
      if (!isValidDayChoice(choice.days)) return { error: 'pickDaysCount', local: true }
      return mutate(() =>
        repo.changePickupOnServer({
          userId,
          weekStart,
          days: choice.days,
          pickupPlaceId: choice.id,
          pickupName: choice.name.trim() || null
        })
      )
    },
    [mutate]
  )

  /* --------------------------------- places ------------------------------- */

  const createPlace = useCallback<SessionStore['createPlace']>(
    async (name, kind, busId) => {
      if (!name.trim()) return { error: 'placeNameRequired', local: true }
      return mutate(() => repo.createPlace(name, kind, busId))
    },
    [mutate]
  )

  const renamePlace = useCallback<SessionStore['renamePlace']>(
    async (id, name) => {
      if (!name.trim()) return { error: 'placeNameRequired', local: true }
      return mutate(() => repo.renamePlaceOnServer(id, name))
    },
    [mutate]
  )

  const archivePlace = useCallback<SessionStore['archivePlace']>(
    async (id) => mutate(() => repo.archivePlaceOnServer(id)),
    [mutate]
  )

  const restorePlace = useCallback<SessionStore['restorePlace']>(
    async (id) => mutate(() => repo.restorePlaceOnServer(id)),
    [mutate]
  )

  const deletePlace = useCallback<SessionStore['deletePlace']>(
    async (id) => mutate(() => repo.deletePlaceOnServer(id)),
    [mutate]
  )

  const setPlaceBus = useCallback<SessionStore['setPlaceBus']>(
    async (id, busId) => mutate(() => repo.setPlaceBus(id, busId)),
    [mutate]
  )

  /* --------------------------------- profile ------------------------------ */

  const updateProfile = useCallback<SessionStore['updateProfile']>(
    async (patch) => {
      const user = userRef.current
      if (!user) return { error: 'notSignedIn', local: true }
      return mutate(async () => {
        await repo.updateOwnProfile(user.id, patch)
        // Re-read rather than patching from what was sent: the row is the
        // authority for role and for anything a trigger changed.
        const me = await repo.fetchOwnProfile(user.id)
        if (me) {
          userRef.current = me.user
          setData((prev) => ({ ...prev, user: me.user, lang: me.lang }))
        }
      })
    },
    [mutate]
  )

  const changePassword = useCallback<SessionStore['changePassword']>(
    async (current, next) => {
      try {
        const error = await auth.changePassword(current, next)
        return error ? { error } : { ok: true }
      } catch (err) {
        return { error: err instanceof RepoError ? err.message : 'Could not change the password' }
      }
    },
    []
  )

  const setUserRole = useCallback<SessionStore['setUserRole']>(
    async (id, role) => {
      if (!networkAvailable()) return { error: 'offline', local: true }
      try {
        await repo.setUserRole(id, role)
        await loadAll()
        return { ok: true }
      } catch (error) {
        const message = error instanceof RepoError ? error.message : 'Could not change the role'
        return { error: message }
      }
    },
    [loadAll]
  )

  /* ---------------------------- admin on riders ---------------------------- */

  const allUsers = useCallback<SessionStore['allUsers']>(async () => {
    if (userRef.current?.role !== 'admin') return []
    return repo.fetchAllProfiles()
  }, [])

  const adminUpdateProfile = useCallback<SessionStore['adminUpdateProfile']>(
    async (userId, patch) => {
      if (userRef.current?.role !== 'admin') return { error: 'notAllowed', local: true }
      if (!patch.name?.trim() && patch.phone !== undefined && !patch.phone.trim()) {
        return { error: 'requiredFields', local: true }
      }
      return mutate(() => repo.adminUpdateProfile({ userId, ...patch }))
    },
    [mutate]
  )

  const adminSetPassword = useCallback<SessionStore['adminSetPassword']>(
    async (userId, password) => {
      if (userRef.current?.role !== 'admin') return { error: 'notAllowed', local: true }
      if (password.length < 6) return { error: 'passwordTooShort', local: true }
      return mutate(() => repo.adminSetPassword(userId, password))
    },
    [mutate]
  )

  const adminDeleteUser = useCallback<SessionStore['adminDeleteUser']>(
    async (userId) => {
      if (userRef.current?.role !== 'admin') return { error: 'notAllowed', local: true }
      if (userId === userRef.current?.id) return { error: 'cannotDeleteSelf', local: true }
      // mutate() reloads afterwards, which matters here: the deleted account is
      // gone from the server and the admin list has to stop showing it.
      return mutate(() => repo.adminDeleteUser(userId))
    },
    [mutate]
  )

  /* -------------------------------- schedules ------------------------------ */

  const daysFor = useCallback<SessionStore['daysFor']>(
    async (userId) => {
      if (userRef.current?.role !== 'admin' && userRef.current?.id !== userId) return {}
      const entries = await repo.fetchDayEntries(userId)
      const out: Record<string, DayEntry> = {}
      for (const entry of entries) out[entry.date] = entry
      return out
    },
    []
  )

  const updateDay = useCallback<SessionStore['updateDay']>(
    async (userId, date, patch) => {
      if (userRef.current?.role !== 'admin') return { error: 'notAllowed', local: true }
      return mutate(() => repo.saveDayEntry(userId, date, patch))
    },
    [mutate]
  )

  /* -------------------------------- scanning ------------------------------ */

  /**
   * Resolves a scanned weekly number against the server and records the attempt.
   *
   * The scanned text is treated as an identifier, not as the truth. A rider's
   * saved screenshot may show a pass that has since been cancelled or moved, and
   * a driver acting on the picture rather than the books would let someone travel
   * on a subscription that was withdrawn. So this asks the server what is true now
   * and returns what it says.
   *
   * Returns null only when the call could not be made at all, so the caller can
   * distinguish "offline, try again" from "no such pass". A miss comes back as a
   * resolution with result 'not_found', which is a real answer and is recorded.
   */
  const resolveWeeklyNumber = useCallback<SessionStore['resolveWeeklyNumber']>(
    async (weekStart, number) => {
      if (!networkAvailable()) return null
      try {
        const resolution = await repo.recordScan(weekStart, number)
        // The rider list changes what a scan means, so the admin screens should
        // pick up a new name on the next render rather than the next load.
        if (resolution.user) void loadAll()
        return resolution
      } catch {
        // Treated as "could not ask", not as "no such pass". Returning null here
        // is what stops the driver screen from reporting an invalid ticket for a
        // network problem.
        return null
      }
    },
    [loadAll]
  )

  return useMemo<SessionStore>(
    () => ({
      data,
      sync,
      cacheOk,
      configured,
      refresh,
      mutate,
      signUp,
      signIn,
      signOut,
      toggleLang,
      subscribeWeek,
      cancelSubscription,
      confirmWeek,
      createPlace,
      renamePlace,
      archivePlace,
      restorePlace,
      deletePlace,
      setPlaceBus,
      updateProfile,
      changePassword,
      setUserRole,
      deleteSubscription,
      changePickup,
      setWeekStatus,
      allUsers,
      adminUpdateProfile,
      adminSetPassword,
      adminDeleteUser,
      daysFor,
      updateDay,
      resolveWeeklyNumber
    }),
    [
      data,
      sync,
      cacheOk,
      configured,
      refresh,
      mutate,
      signUp,
      signIn,
      signOut,
      toggleLang,
      subscribeWeek,
      cancelSubscription,
      confirmWeek,
      createPlace,
      renamePlace,
      archivePlace,
      restorePlace,
      deletePlace,
      setPlaceBus,
      updateProfile,
      changePassword,
      setUserRole,
      deleteSubscription,
      changePickup,
      setWeekStatus,
      allUsers,
      adminUpdateProfile,
      adminSetPassword,
      adminDeleteUser,
      daysFor,
      updateDay,
      resolveWeeklyNumber
    ]
  )
}

