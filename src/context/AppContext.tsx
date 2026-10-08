/**
 * The app's context, now backed by Supabase.
 *
 * Keeps the same surface the screens already use, so pages did not have to be
 * rewritten in the same pass. What changed underneath is the important part:
 *
 * - The session comes from Supabase auth. There is no `isAdminEmail` string
 *   comparison, so an admin is a row-level-security decision rather than a
 *   devtools-away bypass.
 * - Nothing is written to localStorage except a snapshot of what the server
 *   returned. There is no write-behind and no queue: offline is read-only.
 * - Every action returns a Promise and reports why it failed, because a network
 *   refusal and a validation failure are different things to show a rider.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { DayEntry, PickupPlace, PlaceKind, SubStatus, User, WeekSubscription } from '../lib/types'
import { useSessionStore } from '../lib/useSessionStore'
import { AppContext, type AppContextValue } from './useApp'
import { blockedByCurrentWeek, isValidDayChoice, isWindowOpen, minutesRemaining, minutesUntilOpen, targetableWeekKey, weekKey } from '../lib/date'
import { isValidEmail, isValidName, isValidPassword, isValidPhone } from '../lib/validate'
import { ar, en, renderMessage, type TranslationKey } from '../i18n/translations'

function byKind(places: PickupPlace[], kind: PlaceKind): PickupPlace[] {
  return places.filter((p) => p.kind === kind)
}

function activePlaces(places: PickupPlace[], kind: PlaceKind): PickupPlace[] {
  return places.filter((p) => p.kind === kind && p.active)
}

/**
 * Most urgent state wins, because that is what the rider must act on:
 * not subscribed > pending payment > subscribed.
 */
function worstStatus(statuses: SubStatus[]): SubStatus {
  if (statuses.length === 0) return 'none'
  if (statuses.includes('none')) return 'none'
  if (statuses.includes('pending')) return 'pending'
  return 'subscribed'
}

export function AppProvider({ children }: { children: ReactNode }) {
  const store = useSessionStore()

  const lang = store.data.lang
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    const root = document.documentElement
    root.lang = lang
    root.dir = dir
  }, [lang, dir])

  const t = useCallback((key: TranslationKey) => (lang === 'ar' ? ar[key] : en[key]), [lang])

  /**
   * Renders a message that may be a key or prose.
   *
   * Exposed because every action result carries one string field that is either
   * kind: the app knows its own reasons and sends keys, Postgres sends English
   * it cannot localise. Screens need one helper rather than a decision each.
   */
  const show = useCallback((message: string | undefined) => renderMessage(t, message), [t])

  const currentUser = store.data.user
  const isAdmin = currentUser?.role === 'admin'

  const indexWeeks = useMemo(() => {
    const map = new Map<string, WeekSubscription>()
    for (const entry of store.data.weeks) map.set(`${entry.userId}|${entry.sub.weekStart}`, entry.sub)
    return map
  }, [store.data.weeks])

  const weekSubFor = useCallback(
    (userId: string, weekStart: string) => indexWeeks.get(`${userId}|${weekStart}`) ?? null,
    [indexWeeks]
  )

  const weekStatusFor = useCallback(
    (userId: string, weekStart: string) => indexWeeks.get(`${userId}|${weekStart}`)?.status ?? 'none',
    [indexWeeks]
  )

  const overallStatusFor = useCallback(
    (userId: string) =>
      worstStatus(
        [...indexWeeks.entries()]
          .filter(([key]) => key.startsWith(`${userId}|`))
          .map(([, sub]) => sub.status)
      ),
    [indexWeeks]
  )

  /**
   * The rider list (admin-only) and the day entries behind the calendars.
   *
   * The list is not part of the shared load, because a rider may not read it:
   * the profiles select policy limits a non-admin to their own row, so asking
   * for it unconditionally would fail the request for every rider.
   *
   * The day entries are everybody's business in one sense and nobody's in
   * another. The RLS policy on day_entries lets a rider read their own dates and
   * lets an admin read anyone's, so both roles load through the same call and
   * only the ids differ. That is the whole reason a rider's own calendar is not
   * permanently empty: the shared load skips these rows, so they have to be
   * fetched here or not at all.
   *
   * Refetched when the sync state changes rather than only on mount, so an admin
   * who changes a role or closes an account sees the list correct itself without
   * a reload.
   */
  // Stable identities for the "nothing loaded yet" case, so deriving the empty
  // value above does not hand every consumer a fresh object on every render.
  const EMPTY_USERS: User[] = []
  const EMPTY_SCHEDULES: Record<string, Record<string, DayEntry>> = {}

  const [loaded, setLoaded] = useState<{
    ownerId: string
    users: User[]
    schedules: Record<string, Record<string, DayEntry>>
  } | null>(null)

  // Derived rather than reset in the effect. Keyed by the id the data belongs to,
  // so signing out and back in as somebody else renders empty immediately
  // instead of showing the previous rider's schedule for a frame, and no
  // setState has to fire during the effect to clear it.
  const owned = loaded?.ownerId === currentUser?.id ? loaded : null
  const allUsers = owned?.users ?? EMPTY_USERS
  const schedules = owned?.schedules ?? EMPTY_SCHEDULES

  useEffect(() => {
    if (!currentUser) return
    let cancelled = false
    void (async () => {
      try {
        // The rider list is admin-only, so a rider skips the call entirely
        // rather than having the server refuse it.
        const users = isAdmin ? await store.allUsers() : []
        if (cancelled) return

        // Only the next fortnight, which is all any calendar shows. Fetching
        // every rider's whole history would be a lot of rows for a panel that
        // slices to fourteen.
        const start = new Date()
        const end = new Date(start.getTime() + 14 * 86400000)
        const first = start.toISOString().slice(0, 10)
        const last = end.toISOString().slice(0, 10)

        const load = async (id: string) => {
          const days = await store.daysFor(id)
          const recent: Record<string, DayEntry> = {}
          for (const [date, entry] of Object.entries(days)) {
            if (date >= first && date <= last) recent[date] = entry
          }
          return recent
        }

        const entries: Record<string, Record<string, DayEntry>> = {}
        for (const user of users) {
          if (cancelled) return
          entries[user.id] = await load(user.id)
        }
        // The rider's own entry, whether or not they are an admin, so
        // WeekCalendar has something to draw.
        entries[currentUser.id] = await load(currentUser.id)
        if (!cancelled) setLoaded({ ownerId: currentUser.id, users, schedules: entries })
      } catch {
        // Refused or offline. The screens render empty rather than stale, so
        // nothing on screen claims to be current when it is not.
        if (!cancelled) {
          setLoaded({ ownerId: currentUser.id, users: [], schedules: {} })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [
    currentUser,
    isAdmin,
    store,
    store.sync.stale,
    store.sync.error,
    store.data.weeks
  ])

  /* ------------------------------- actions ------------------------------ */

  const subscribeWeek = useCallback<AppContextValue['subscribeWeek']>(
    async (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) return { error: 'selectPlace', local: true }
      if (!isValidDayChoice(choice.days)) return { error: 'pickDaysCount', local: true }
      // Re-checked here rather than trusted from the form: the sheet can be left
      // open across the closing minute, and the window is a business rule.
      if (!store.sync.online) return { error: 'offlineReadOnly', local: true }
      if (!isWindowOpen()) return { error: 'windowClosed', local: true }
      if (weekStart !== targetableWeekKey()) return { error: 'notTargetWeek', local: true }
      if (blockedByCurrentWeek(weekStatusFor(userId, weekKey(new Date())))) {
        return { error: 'holdingThisWeek', local: true }
      }
      return store.subscribeWeek(userId, weekStart, choice)
    },
    [store, weekStatusFor]
  )

  const changePickup = useCallback<AppContextValue['changePickup']>(
    async (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) return { error: 'selectPlace', local: true }
      if (!isValidDayChoice(choice.days)) return { error: 'pickDaysCount', local: true }
      return store.changePickup(userId, weekStart, choice)
    },
    [store]
  )

  const signUp = useCallback<AppContextValue['signUp']>(
    async (input) => {
      // Same checks as before the cutover. They live in the client because they
      // are about giving immediate feedback on what was typed; the server
      // re-checks the things that matter for integrity.
      //
      // Email is optional: the number is the identity, and an account with no
      // address is a complete account. It is still checked when typed, so a
      // mistyped one is caught rather than silently stored as unusable contact.
      if (!input.name.trim() || !input.phone.trim() || !input.password) {
        return { error: 'requiredFields', local: true }
      }
      // Required whenever there is a bus to pick. With an empty list there is
      // nothing to pick and the field is disabled, so requiring it would block
      // the only account that can add the first one -- see the bootstrap note in
      // supabase/migrations/0005_signup_rules.sql. The server draws the line in
      // the same place and refuses a signup with no pickup once buses exist.
      const buses = store.data.places.filter((p) => p.kind === 'bus' && p.active)
      if (buses.length > 0 && !input.pickupBus.trim()) {
        return { error: 'selectPlace', local: true }
      }
      if (!isValidName(input.name)) return { error: 'nameTooShort', local: true }
      if (input.email.trim() && !isValidEmail(input.email)) {
        return { error: 'invalidEmail', local: true }
      }
      if (!isValidPhone(input.phone)) return { error: 'invalidPhone', local: true }
      if (!isValidPassword(input.password)) return { error: 'passwordTooShort', local: true }
      return store.signUp(input)
    },
    [store]
  )

  const login = useCallback<AppContextValue['login']>(
    async (phone, password) => {
      if (!phone.trim() || !password) return { error: 'requiredFields', local: true }
      if (!isValidPhone(phone)) return { error: 'invalidPhone', local: true }
      return store.signIn(phone, password)
    },
    [store]
  )

  const logout = useCallback(() => store.signOut(), [store])

  /**
   * Interface language.
   *
   * Deliberately not gated on being online. When signed in, the language is a
   * column on the profile row, so switching it offline has nowhere to go and the
   * store declines -- returning without switching is better than switching on
   * screen and reverting, which would flicker the whole interface for a change
   * that did not happen.
   *
   * When signed out there is no profile to write to, and refusing the switch
   * there is what left the button on the login and signup screens dead: a rider
   * who could not read the form had no way to change the language and no way to
   * register either. The store owns that distinction.
   */
  const online = store.sync.online
  const toggleLang = useCallback(() => {
    void store.toggleLang()
  }, [store])

  const updateProfile = useCallback<AppContextValue['updateProfile']>(
    async (patch) => {
      if (patch.name !== undefined && !isValidName(patch.name)) {
        return { error: 'nameTooShort', local: true }
      }
      return store.updateProfile(patch)
    },
    [store]
  )

  const changePassword = useCallback<AppContextValue['changePassword']>(
    async (current, next) => {
      if (!isValidPassword(next)) return { error: 'passwordTooShort', local: true }
      if (current === next) return { error: 'passwordUnchanged', local: true }
      return store.changePassword(current, next)
    },
    [store]
  )

  /* ------------------------------ admin actions --------------------------- */

  const adminUpdateProfile = useCallback<AppContextValue['adminUpdateProfile']>(
    async (id, patch) => {
      if (patch.name !== undefined && !isValidName(patch.name)) {
        return { error: 'nameTooShort', local: true }
      }
      if (patch.phone !== undefined && !isValidPhone(patch.phone)) {
        return { error: 'invalidPhone', local: true }
      }
      if (patch.email !== undefined && !isValidEmail(patch.email)) {
        return { error: 'invalidEmail', local: true }
      }
      return store.adminUpdateProfile(id, patch)
    },
    [store]
  )

  const adminSetPassword = useCallback<AppContextValue['adminSetPassword']>(
    async (id, password) => {
      if (!isValidPassword(password)) return { error: 'passwordTooShort', local: true }
      return store.adminSetPassword(id, password)
    },
    [store]
  )

  const adminDeleteUser = useCallback<AppContextValue['adminDeleteUser']>(
    async (id) => {
      if (id === currentUser?.id) return { error: 'cannotDeleteSelf', local: true }
      return store.adminDeleteUser(id)
    },
    [store, currentUser]
  )

  const daysFor = useCallback<AppContextValue['daysFor']>(
    (userId) => schedules[userId] ?? {},
    [schedules]
  )

  const updateDay = useCallback<AppContextValue['updateDay']>(
    async (userId, date, patch) => {
      const result = await store.updateDay(userId, date, patch)
      // Applied to the local copy too, so the control does not flicker back to
      // its old value while the reload is in flight. Written through `loaded`
      // rather than the derived `schedules`, which is read-only.
      if (result.ok) {
        setLoaded((prev) => {
          if (!prev || prev.ownerId !== currentUser?.id) return prev
          const forUser = prev.schedules[userId] ?? {}
          const existing = forUser[date]
          return {
            ...prev,
            schedules: {
              ...prev.schedules,
              [userId]: {
                ...forUser,
                [date]: {
                  date,
                  route: patch.route ?? existing?.route ?? '',
                  time: patch.time ?? existing?.time ?? ''
                }
              }
            }
          }
        })
      }
      return result
    },
    [store, currentUser?.id]
  )

  /* ------------------------------ window state --------------------------- */

  /**
   * Derived each render rather than stored, so it cannot drift from the clock.
   * The tick is what keeps the countdown live and the buttons disabled as the
   * window opens and shuts.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])
  const windowOpen = isWindowOpen(new Date(now))
  const targetableWeek = targetableWeekKey(new Date(now))
  const windowMinutesLeft = windowOpen
    ? minutesRemaining(new Date(now))
    : minutesUntilOpen(new Date(now))

  const subscribeBlock: AppContextValue['subscribeBlock'] = !store.sync.online
    ? 'offlineReadOnly'
    : !windowOpen
      ? 'windowClosed'
      : blockedByCurrentWeek(
          currentUser ? weekStatusFor(currentUser.id, weekKey(new Date())) : 'none'
        )
        ? 'holdingThisWeek'
        : null

  const value = useMemo<AppContextValue>(
    () => ({
      data: store.data,
      sync: store.sync,
      lang,
      dir,
      t,
      show,
      toggleLang,
      currentUser,
      isAdmin,
      booting: store.sync.loading,
      online,
      stale: store.sync.stale,
      signUp,
      login,
      logout,
      places: activePlaces(store.data.places, 'place'),
      allPlaces: byKind(store.data.places, 'place'),
      buses: activePlaces(store.data.places, 'bus'),
      allBuses: byKind(store.data.places, 'bus'),
      weekSubFor,
      weekStatusFor,
      overallStatusFor,
      allUsers,
      adminUsers: allUsers.filter((u) => u.role === 'user'),
      adminUpdateProfile,
      adminSetPassword,
      adminDeleteUser,
      daysFor,
      updateDay,
      subscribeWeek,
      cancelSubscription: store.cancelSubscription,
      confirmWeek: store.confirmWeek,
      changePickup,
      setWeekStatus: store.setWeekStatus,
      deleteSubscription: store.deleteSubscription,
      windowOpen,
      targetableWeek,
      subscribeBlock,
      windowMinutesLeft,
      addPlace: store.createPlace,
      renamePlace: store.renamePlace,
      archivePlace: store.archivePlace,
      restorePlace: store.restorePlace,
      deletePlace: store.deletePlace,
      setPlaceBus: store.setPlaceBus,
      updateProfile,
      changePassword,
      setUserRole: store.setUserRole,
      resolveWeeklyNumber: store.resolveWeeklyNumber
    }),
    [
      store,
      lang,
      dir,
      t,
      show,
      toggleLang,
      currentUser,
      isAdmin,
      signUp,
      login,
      logout,
      weekSubFor,
      weekStatusFor,
      overallStatusFor,
      allUsers,
      subscribeWeek,
      changePickup,
      updateProfile,
      changePassword,
      adminUpdateProfile,
      adminSetPassword,
      adminDeleteUser,
      daysFor,
      updateDay,
      windowOpen,
      targetableWeek,
      subscribeBlock,
      windowMinutesLeft,
      online
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
