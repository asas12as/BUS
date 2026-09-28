export type Role = 'user' | 'admin'
export type Lang = 'en' | 'ar'

/** Weekly subscription state: none -> pending -> subscribed (admin confirms). */
export type SubStatus = 'none' | 'pending' | 'subscribed'

export type PlaceRequestStatus = 'open' | 'approved' | 'rejected'

export interface User {
  id: string
  name: string
  phone: string
  email: string
  passwordHash: string
  role: Role
  createdAt: string
}

/** Per-day schedule only. Subscription state lives on the week, not the day. */
export interface DayEntry {
  date: string
  route: string
  time: string
}

export interface WeekSubscription {
  weekStart: string
  status: SubStatus
  /**
   * Weekly queue number, 1-999. Assigned the moment the user subscribes (not on
   * payment confirmation), unique per week, and never handed out twice.
   */
  number: number | null
  pickupId: string | null
  pickupName: string | null
  createdAt: string
  updatedAt: string
}

export interface PickupPlace {
  id: string
  name: string
  active: boolean
  createdAt: string
}

export interface PlaceRequest {
  id: string
  userId: string
  name: string
  status: PlaceRequestStatus
  createdAt: string
}

export interface Session {
  userId: string
  role: Role
}

export interface AppData {
  users: User[]
  session: Session | null
  days: Record<string, Record<string, DayEntry>>
  subscriptions: Record<string, Record<string, WeekSubscription>>
  /**
   * Highest number issued per week. Kept separately from the subscriptions so a
   * cancelled or deleted number is never re-issued to someone else.
   */
  weekCounters: Record<string, number>
  places: PickupPlace[]
  placeRequests: PlaceRequest[]
  lang: Lang
}
