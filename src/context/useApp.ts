/**
 * The context object and its consumer hook, kept apart from the provider.
 *
 * The split is not cosmetic. React Fast Refresh only works on a file that
 * exports nothing but components, and AppContext.tsx has a provider in it. Keeping
 * the hook alongside the provider means a code change to either one blanks the
 * whole app in development instead of hot-swapping just the piece that moved.
 *
 * Nothing here holds state. It is the shape every screen reads and the one way
 * to reach the provider's value.
 */
import { createContext, useContext } from 'react'
import type { DayEntry, Lang, PickupPlace, PlaceKind, SubStatus, User, WeekSubscription } from '../lib/types'
import type { PlaceChoice, RepoResult, SyncState } from '../lib/useSessionStore'
import type { ScanResolution } from '../lib/mappers'
import type { TranslationKey } from '../i18n/translations'

/** How an action failed, in the form a screen can show. */
export interface ActionError extends RepoResult {
  error?: string | TranslationKey
}

export interface AppContextValue {
  /** Everything the server returned for the signed-in rider. */
  data: {
    user: User | null
    weeks: Array<{ userId: string; sub: WeekSubscription }>
    places: PickupPlace[]
    lang: Lang
  }
  sync: SyncState
  lang: Lang
  dir: 'ltr' | 'rtl'
  t: (key: TranslationKey) => string
  /** Renders an action message: a key if it is one, otherwise prose as sent. */
  show: (message: string | undefined) => string | null
  toggleLang: () => void

  currentUser: User | null
  isAdmin: boolean
  /** True until the first load for this session finishes. */
  booting: boolean
  /** False when the browser reports no network. */
  online: boolean
  /** True when the data on screen came from the cache rather than the server. */
  stale: boolean

  signUp: (input: {
    name: string
    phone: string
    email: string
    password: string
    pickupBus: string
  }) => Promise<ActionError & { needsConfirmation?: boolean }>
  login: (email: string, password: string) => Promise<ActionError>
  /**
   * Signs out and clears the cached snapshot.
   *
   * Awaited by callers that navigate away, so the previous rider's name is not
   * briefly still on screen under the login form.
   */
  logout: () => Promise<void>

  /* ------------------------------- lookups ------------------------------ */

  /** Active pickup places (`kind='place'`), for the per-week picker. */
  places: PickupPlace[]
  /** Every pickup place, archived included, for the admin's place section. */
  allPlaces: PickupPlace[]
  /** Active buses (`kind='bus'`), for the signup dropdown. */
  buses: PickupPlace[]
  /** Every bus, archived included, for the admin's bus section. */
  allBuses: PickupPlace[]
  /** The signed-in rider's record for a week, or null. */
  weekSubFor: (userId: string, weekStart: string) => WeekSubscription | null
  weekStatusFor: (userId: string, weekStart: string) => SubStatus
  overallStatusFor: (userId: string) => SubStatus
  /** Admin only: every rider account. */
  allUsers: User[]
  adminUsers: User[]

  /* ---------------------------- subscription ---------------------------- */

  subscribeWeek: (userId: string, weekStart: string, choice: PlaceChoice) => Promise<ActionError>
  cancelSubscription: (userId: string, weekStart: string) => Promise<ActionError>
  confirmWeek: (userId: string, weekStart: string) => Promise<ActionError>
  changePickup: (userId: string, weekStart: string, choice: PlaceChoice) => Promise<ActionError>
  setWeekStatus: (userId: string, weekStart: string, status: SubStatus) => Promise<ActionError>
  deleteSubscription: (userId: string, weekStart: string) => Promise<ActionError>

  windowOpen: boolean
  targetableWeek: string
  subscribeBlock: TranslationKey | null
  windowMinutesLeft: number

  /* -------------------------------- places ------------------------------ */

  addPlace: (name: string, kind: PlaceKind) => Promise<ActionError>
  renamePlace: (id: string, name: string) => Promise<ActionError>
  archivePlace: (id: string) => Promise<ActionError>
  restorePlace: (id: string) => Promise<ActionError>
  deletePlace: (id: string) => Promise<ActionError>

  /* -------------------------------- profile ------------------------------ */

  /**
   * Updates the signed-in rider's own row.
   *
   * Phone is included because migration 0002 made it a column, so it is an
   * ordinary field now. Email is deliberately absent: the address is the login
   * identity and lives in auth.users, which a client cannot write. A rider who
   * needs it changed has to ask an admin.
   */
  updateProfile: (
    patch: Partial<Pick<User, 'name' | 'avatar' | 'phone' | 'pickupLocation'>>
  ) => Promise<ActionError>
  changePassword: (current: string, next: string) => Promise<ActionError>
  setUserRole: (id: string, role: 'user' | 'admin') => Promise<ActionError>

  /* --------------------------- admin on riders --------------------------- */

  /** Admin-only correction of a rider's recorded details, including email. */
  adminUpdateProfile: (
    id: string,
    patch: Partial<Pick<User, 'name' | 'phone' | 'email'>>
  ) => Promise<ActionError>
  adminSetPassword: (id: string, password: string) => Promise<ActionError>
  adminDeleteUser: (id: string) => Promise<ActionError>

  /* -------------------------------- schedules ------------------------------ */

  /** Route and time per ISO date, as the admin assigned them. */
  daysFor: (userId: string) => Record<string, DayEntry>
  updateDay: (userId: string, date: string, patch: Partial<DayEntry>) => Promise<ActionError>

  /**
   * Current state of a scanned weekly number, from the server.
   *
   * Null when the server could not be asked at all, which the driver screen shows
   * as an error. A pass that no longer exists comes back as a resolution with
   * result 'not_found', which is an answer rather than a failure.
   */
  resolveWeeklyNumber: (weekStart: string, number: number) => Promise<ScanResolution | null>
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}