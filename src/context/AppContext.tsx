import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AppData,
  DayEntry,
  Lang,
  PickupPlace,
  PlaceRequest,
  Role,
  SubStatus,
  User,
  WeekSubscription
} from '../lib/types'
import { useAppData } from '../lib/useAppData'
import { isValidEmail, isValidName, isValidPassword, isValidPhone } from '../lib/validate'
import {
  activePlaces,
  addPlace as applyAddPlace,
  approvePlaceRequest as applyApproveRequest,
  archivePlace as applyArchivePlace,
  changePickup as applyChangePickup,
  clearWeek as applyClearWeek,
  confirmWeek as applyConfirmWeek,
  deletePlace as applyDeletePlace,
  deletePlaceRequest as applyDeletePlaceRequest,
  deleteUser as applyDeleteUser,
  deleteWeekSub as applyDeleteWeekSub,
  emailExists,
  generateDays,
  hashPassword,
  needsNewNumber,
  openPlaceRequests,
  overallStatus,
  rejectPlaceRequest as applyRejectRequest,
  renamePlace as applyRenamePlace,
  requestPlace,
  restorePlace as applyRestorePlace,
  setLang as applyLang,
  setUserPassword as applySetUserPassword,
  setWeekStatus as applySetWeekStatus,
  subscribeWeek as applySubscribeWeek,
  updateDay as applyUpdateDay,
  updateUserRecord as applyUpdateUserRecord,
  upsertUser,
  weeklyNumberAvailable,
  weekStatus,
  type PickupChoice
} from '../lib/storage'
import { ar, en, type TranslationKey } from '../i18n/translations'
import {
  blockedByCurrentWeek,
  isValidDayChoice,
  isWindowOpen,
  minutesRemaining,
  minutesUntilOpen,
  targetableWeekKey,
  weekKey
} from '../lib/date'

interface Result {
  ok: boolean
  error?: TranslationKey
}

interface AppContextValue {
  data: AppData
  lang: Lang
  dir: 'ltr' | 'rtl'
  t: (key: TranslationKey) => string
  toggleLang: () => void
  currentUser: User | null
  isAdmin: boolean
  signUp: (input: {
    name: string
    phone: string
    email: string
    password: string
    /** Free text, the same "place" the subscription sheet collects. */
    pickupLocation: string
  }) => Result
  login: (email: string, password: string) => Result
  logout: () => void

  daysFor: (userId: string) => Record<string, DayEntry>
  weekSubFor: (userId: string, weekStart: string) => WeekSubscription | null
  /** False when the browser refuses localStorage, e.g. some file:// contexts. */
  storageOk: boolean
  weekStatusFor: (userId: string, weekStart: string) => SubStatus
  overallStatusFor: (userId: string) => SubStatus
  subscribeWeek: (userId: string, weekStart: string, choice: PickupChoice) => Result
  cancelSubscription: (userId: string, weekStart: string) => void
  confirmWeek: (userId: string, weekStart: string) => void

  /** Subscription window state, recomputed each render so the countdown stays live. */
  windowOpen: boolean
  /** The one week that may be subscribed right now. */
  targetableWeek: string
  /** Why subscribing is blocked, or null when it is allowed. */
  subscribeBlock: 'windowClosed' | 'holdingThisWeek' | null
  /** Minutes until the window opens or closes, 0 when not applicable. */
  windowMinutesLeft: number

  places: PickupPlace[]
  allPlaces: PickupPlace[]
  addPlace: (name: string) => Result
  renamePlace: (id: string, name: string) => Result
  archivePlace: (id: string) => void
  restorePlace: (id: string) => void
  placeRequests: PlaceRequest[]
  approveRequest: (id: string) => void
  rejectRequest: (id: string) => void

  updateProfile: (patch: Partial<Pick<User, 'name' | 'phone' | 'email' | 'avatar' | 'pickupId' | 'pickupLocation'>>) => Result
  changePassword: (current: string, next: string) => Result
  adminUsers: User[]

  /* ------------------------- admin: full control ------------------------- */
  allUsers: User[]
  changePickup: (userId: string, weekStart: string, choice: PickupChoice) => Result
  setWeekStatus: (userId: string, weekStart: string, status: SubStatus) => void
  deleteSubscription: (userId: string, weekStart: string) => void
  deletePlace: (id: string) => void
  deletePlaceRequest: (id: string) => void
  updateUser: (id: string, patch: Partial<Pick<User, 'name' | 'phone' | 'email'>>) => Result
  setUserRole: (id: string, role: Role) => void
  setUserPassword: (id: string, plain: string) => Result
  deleteUser: (id: string) => void
  updateDay: (userId: string, date: string, patch: Partial<Pick<DayEntry, 'route' | 'time'>>) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const { data, persist, simpleAction, storageOk } = useAppData()

  const lang = data.lang
  const dir: 'ltr' | 'rtl' = lang === 'ar' ? 'rtl' : 'ltr'

  useEffect(() => {
    const root = document.documentElement
    root.lang = lang
    root.dir = dir
  }, [lang, dir])

  const t = useCallback(
    (key: TranslationKey) => (lang === 'ar' ? ar[key] : en[key]),
    [lang]
  )

  const toggleLang = useCallback(() => {
    const next: Lang = lang === 'en' ? 'ar' : 'en'
    persist(applyLang(data, next))
  }, [data, lang, persist])

  const currentUser = useMemo(() => {
    if (!data.session) return null
    return data.users.find((u) => u.id === data.session?.userId) ?? null
  }, [data])

  const isAdmin = currentUser?.role === 'admin'

  const signUp: AppContextValue['signUp'] = useCallback(
    (input) => {
      if (
        !input.name.trim() ||
        !input.phone.trim() ||
        !input.email.trim() ||
        !input.password ||
        !input.pickupLocation.trim()
      ) {
        return { ok: false, error: 'requiredFields' }
      }
      if (!isValidName(input.name)) {
        return { ok: false, error: 'nameTooShort' }
      }
      if (!isValidEmail(input.email)) {
        return { ok: false, error: 'invalidEmail' }
      }
      if (!isValidPhone(input.phone)) {
        return { ok: false, error: 'invalidPhone' }
      }
      if (!isValidPassword(input.password)) {
        return { ok: false, error: 'passwordTooShort' }
      }
      // Resolve the typed name against the curated list. A rider who typed an
      // existing place stores its id; a brand new one stores the text and is
      // filed as a request, exactly like the subscription sheet does.
      const wanted = input.pickupLocation.trim()
      const known =
        data.places.find((p) => p.active && p.name.trim().toLowerCase() === wanted.toLowerCase()) ??
        null
      if (emailExists(data.users, input.email)) {
        return { ok: false, error: 'emailTaken' }
      }
      const user: User = {
        id: `u_${Date.now().toString(36)}`,
        name: input.name.trim(),
        phone: input.phone.trim(),
        email: input.email.trim().toLowerCase(),
        passwordHash: hashPassword(input.password),
        role: 'user',
        pickupId: known?.id ?? null,
        pickupLocation: known ? known.name : wanted,
        createdAt: new Date().toISOString()
      }
      const withUser = upsertUser(data, user)
      const withDays = {
        ...withUser,
        days: { ...withUser.days, [user.id]: generateDays() },
        subscriptions: { ...withUser.subscriptions, [user.id]: {} }
      }
      persist(
        known
          ? { ...withDays, session: { userId: user.id, role: 'user' } }
          : {
              ...requestPlace(withDays, user.id, wanted),
              session: { userId: user.id, role: 'user' }
            }
      )
      return { ok: true }
    },
    [data, persist]
  )

  const login: AppContextValue['login'] = useCallback(
    (email, password) => {
      const found = data.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase())
      if (!found || found.passwordHash !== hashPassword(password)) {
        return { ok: false, error: 'invalidCredentials' }
      }
      persist({ ...data, session: { userId: found.id, role: found.role } })
      return { ok: true }
    },
    [data, persist]
  )

  const logout = useCallback(() => {
    persist({ ...data, session: null })
  }, [data, persist])

  const daysFor = useCallback(
    (userId: string) => data.days[userId] ?? {},
    [data]
  )

  const weekSubFor = useCallback(
    (userId: string, weekStart: string) => data.subscriptions[userId]?.[weekStart] ?? null,
    [data]
  )

  const weekStatusFor = useCallback(
    (userId: string, weekStart: string) => weekStatus(data, userId, weekStart),
    [data]
  )

  const overallStatusFor = useCallback(
    (userId: string) => overallStatus(data, userId),
    [data]
  )

  const subscribeWeek: AppContextValue['subscribeWeek'] = useCallback(
    (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) {
        return { ok: false, error: 'selectPlace' }
      }
      // The day picker is a UI affordance like the place list, so the count and
      // the range are re-checked here rather than trusted from the form.
      if (!isValidDayChoice(choice.days)) {
        return { ok: false, error: 'pickDaysCount' }
      }
      // Enforced here as well as in the UI: the sheet can be left open across
      // the closing minute, and the window is a business rule, not a hint.
      if (!isWindowOpen()) return { ok: false, error: 'windowClosed' }
      if (weekStart !== targetableWeekKey()) return { ok: false, error: 'notTargetWeek' }
      // One week at a time: a live subscription for the week in progress blocks
      // taking on the next one.
      if (blockedByCurrentWeek(weekStatus(data, userId, weekKey(new Date())))) {
        return { ok: false, error: 'holdingThisWeek' }
      }
      // Only a brand new weekly number can run out; an existing one is kept.
      if (needsNewNumber(data, userId, weekStart) && !weeklyNumberAvailable(data, weekStart)) {
        return { ok: false, error: 'weekFull' }
      }
      persist(applySubscribeWeek(data, userId, weekStart, choice))
      return { ok: true }
    },
    [data, persist]
  )

  /** Changes an existing pickup without reissuing the weekly number. */
  const changePickup: AppContextValue['changePickup'] = useCallback(
    (userId, weekStart, choice) => {
      if (!choice.name.trim() && choice.id === null) {
        return { ok: false, error: 'selectPlace' }
      }
      if (!isValidDayChoice(choice.days)) {
        return { ok: false, error: 'pickDaysCount' }
      }
      persist(applyChangePickup(data, userId, weekStart, choice))
      return { ok: true }
    },
    [data, persist]
  )

  /**
   * User-initiated cancel. Blocked once the admin has verified the payment,
   * since the user has already paid. Admins keep their own routes
   * (setWeekStatus / deleteSubscription), which are deliberately not gated.
   */
  const cancelSubscription = useCallback(
    (userId: string, weekStart: string) => {
      if (weekStatus(data, userId, weekStart) === 'subscribed') return
      persist(applyClearWeek(data, userId, weekStart))
    },
    [data, persist]
  )

  const confirmWeek = simpleAction(applyConfirmWeek)

  /**
   * Window state is derived rather than stored, so it cannot go stale against
   * the data, but it still has to be recomputed as the clock moves: without a
   * tick the countdown would freeze and the buttons would not disable
   * themselves when the window opens or shuts.
   */
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(id)
  }, [])

  const windowOpen = isWindowOpen(new Date(now))
  const targetableWeek = targetableWeekKey(new Date(now))
  const windowMinutesLeft = windowOpen ? minutesRemaining(new Date(now)) : minutesUntilOpen(new Date(now))

  const subscribeBlock: AppContextValue['subscribeBlock'] = !windowOpen
    ? 'windowClosed'
    : blockedByCurrentWeek(currentUser ? weekStatus(data, currentUser.id, weekKey(new Date())) : 'none')
      ? 'holdingThisWeek'
      : null

  const places = useMemo(() => activePlaces(data), [data])
  const allPlaces = data.places
  const placeRequests = useMemo(() => openPlaceRequests(data), [data])

  const addPlace: AppContextValue['addPlace'] = useCallback(
    (name) => {
      if (!name.trim()) return { ok: false, error: 'placeNameRequired' }
      persist(applyAddPlace(data, name))
      return { ok: true }
    },
    [data, persist]
  )

  const renamePlace: AppContextValue['renamePlace'] = useCallback(
    (id, name) => {
      if (!name.trim()) return { ok: false, error: 'placeNameRequired' }
      persist(applyRenamePlace(data, id, name))
      return { ok: true }
    },
    [data, persist]
  )

  const archivePlace = simpleAction(applyArchivePlace)

  const restorePlace = simpleAction(applyRestorePlace)

  const approveRequest = simpleAction(applyApproveRequest)

  const rejectRequest = simpleAction(applyRejectRequest)

  const updateProfile: AppContextValue['updateProfile'] = useCallback(
    (patch) => {
      if (!currentUser) return { ok: false, error: 'invalidCredentials' }
      if (patch.email && emailExists(data.users, patch.email) && patch.email !== currentUser.email) {
        return { ok: false, error: 'emailTaken' }
      }
      if (patch.email && !isValidEmail(patch.email)) {
        return { ok: false, error: 'invalidEmail' }
      }
      if (patch.name !== undefined && !isValidName(patch.name)) {
        return { ok: false, error: 'nameTooShort' }
      }
      // Same resolution as sign-up: match the curated list, otherwise keep the text
      // and point at no place until an admin creates one.
      const wanted = patch.pickupLocation?.trim()
      const known = wanted
        ? data.places.find(
            (p) => p.active && p.name.trim().toLowerCase() === wanted.toLowerCase()
          ) ?? null
        : null
      const next: User = {
        ...currentUser,
        ...patch,
        ...(wanted === undefined
          ? {}
          : { pickupId: known?.id ?? null, pickupLocation: known ? known.name : wanted })
      }
      persist(upsertUser(data, next))
      return { ok: true }
    },
    [currentUser, data, persist]
  )

  const changePassword: AppContextValue['changePassword'] = useCallback(
    (current, next) => {
      if (!currentUser) return { ok: false, error: 'invalidCredentials' }
      if (currentUser.passwordHash !== hashPassword(current)) {
        return { ok: false, error: 'invalidCredentials' }
      }
      if (!isValidPassword(next)) return { ok: false, error: 'passwordTooShort' }
      persist(upsertUser(data, { ...currentUser, passwordHash: hashPassword(next) }))
      return { ok: true }
    },
    [currentUser, data, persist]
  )

  const allUsers = useMemo(() => (isAdmin ? data.users : []), [data, isAdmin])

  const adminUsers = useMemo(
    () => (isAdmin ? data.users.filter((u) => u.role === 'user') : []),
    [data, isAdmin]
  )

  const setWeekStatus: AppContextValue['setWeekStatus'] = useCallback(
    (userId, weekStart, status) => {
      // Admin can subscribe on a user's behalf, which must also take a number.
      if (
        status !== 'none' &&
        needsNewNumber(data, userId, weekStart) &&
        !weeklyNumberAvailable(data, weekStart)
      ) {
        return
      }
      persist(applySetWeekStatus(data, userId, weekStart, status))
    },
    [data, persist]
  )

  const deleteSubscription: AppContextValue['deleteSubscription'] = simpleAction(applyDeleteWeekSub)

  const deletePlace: AppContextValue['deletePlace'] = simpleAction(applyDeletePlace)

  const deletePlaceRequest: AppContextValue['deletePlaceRequest'] = simpleAction(applyDeletePlaceRequest)

  const updateUser: AppContextValue['updateUser'] = useCallback(
    (id, patch) => {
      const target = data.users.find((u) => u.id === id)
      if (!target) return { ok: false, error: 'invalidCredentials' }
      const name = patch.name !== undefined ? patch.name.trim() : target.name
      const phone = patch.phone !== undefined ? patch.phone.trim() : target.phone
      const email = patch.email !== undefined ? patch.email.trim() : target.email
      if (!name || !phone || !email) return { ok: false, error: 'requiredFields' }
      if (!isValidEmail(email)) return { ok: false, error: 'invalidEmail' }
      if (emailExists(data.users.filter((u) => u.id !== id), email)) {
        return { ok: false, error: 'emailTaken' }
      }
      persist(applyUpdateUserRecord(data, id, { name, phone, email: email.toLowerCase() }))
      return { ok: true }
    },
    [data, persist]
  )

  const setUserRole: AppContextValue['setUserRole'] = simpleAction((d: AppData, id: string, role: Role) =>
    applyUpdateUserRecord(d, id, { role })
  )

  const setUserPassword: AppContextValue['setUserPassword'] = useCallback(
    (id, plain) => {
      if (!isValidPassword(plain)) return { ok: false, error: 'passwordTooShort' }
      persist(applySetUserPassword(data, id, plain))
      return { ok: true }
    },
    [data, persist]
  )

  const deleteUser: AppContextValue['deleteUser'] = simpleAction(applyDeleteUser)

  const updateDay: AppContextValue['updateDay'] = simpleAction(applyUpdateDay)

  const value = useMemo<AppContextValue>(
    () => ({
      data,
      lang,
      dir,
      t,
      toggleLang,
      currentUser,
      isAdmin,
      signUp,
      login,
      logout,
      daysFor,
      weekSubFor,
      weekStatusFor,
      overallStatusFor,
      subscribeWeek,
      cancelSubscription,
      confirmWeek,
      windowOpen,
      targetableWeek,
      subscribeBlock,
      windowMinutesLeft,
      places,
      allPlaces,
      addPlace,
      renamePlace,
      archivePlace,
      restorePlace,
      placeRequests,
      approveRequest,
      rejectRequest,
      updateProfile,
      changePassword,
      adminUsers,
      allUsers,
      storageOk,
      changePickup,
      setWeekStatus,
      deleteSubscription,
      deletePlace,
      deletePlaceRequest,
      updateUser,
      setUserRole,
      setUserPassword,
      deleteUser,
      updateDay
    }),
    [
      data,
      lang,
      dir,
      t,
      toggleLang,
      currentUser,
      isAdmin,
      signUp,
      login,
      logout,
      daysFor,
      weekSubFor,
      weekStatusFor,
      overallStatusFor,
      subscribeWeek,
      cancelSubscription,
      confirmWeek,
      windowOpen,
      targetableWeek,
      subscribeBlock,
      windowMinutesLeft,
      places,
      allPlaces,
      addPlace,
      renamePlace,
      archivePlace,
      restorePlace,
      placeRequests,
      approveRequest,
      rejectRequest,
      updateProfile,
      changePassword,
      adminUsers,
      allUsers,
      storageOk,
      changePickup,
      setWeekStatus,
      deleteSubscription,
      deletePlace,
      deletePlaceRequest,
      updateUser,
      setUserRole,
      setUserPassword,
      deleteUser,
      updateDay
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
