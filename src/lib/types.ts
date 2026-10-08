export type Role = 'user' | 'admin'
export type Lang = 'en' | 'ar'

export type Theme = 'light' | 'dark'

/** Weekly subscription state: none -> pending -> subscribed (admin confirms). */
export type SubStatus = 'none' | 'pending' | 'subscribed'

/**
 * What a `places` row is.
 *
 * A 'bus' is the line a rider is on, chosen once at signup. A 'place' is the
 * stop they board from, chosen per week when subscribing. The two share a table
 * and are told apart by this field.
 */
export type PlaceKind = 'place' | 'bus'

export interface User {
  id: string
  name: string
  phone: string
  email: string
  role: Role
  createdAt: string
  /**
   * Profile picture as a downscaled data URL. Optional and absent for everyone
   * who never set one. Stored inline rather than in a bucket because it is a
   * column on the profile row and the app has no image storage to upload to.
   */
  avatar?: string | null
  /**
   * The rider's usual pickup place, which is the same "place" the subscription
   * sheet uses: either the id of a curated place or, when the rider wrote their
   * own, the free-text name. Both fields are optional so accounts created before
   * this existed still load.
   */
  pickupId?: string | null
  pickupLocation?: string | null
  /**
   * The bus the rider chose at signup. Separate from the pickup place, which is
   * chosen per week. Optional so accounts created before the split still load.
   */
  pickupBusId?: string | null
  pickupBusName?: string | null
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
   * Weekly queue number, 1-1000 and then lettered (1A, 1B, ...). Stored as a
 * plain integer; the printed form is produced by weeklyNumberLabel. Assigned
 * the moment the user subscribes (not on
   * payment confirmation), unique per week, and never handed out twice.
   */
  number: number | null
  pickupId: string | null
  pickupName: string | null
  /**
   * Days of the week the rider takes the bus, as JS day numbers (0 = Sunday).
   * Only Saturday to Wednesday can be chosen, and the count must be 4 or 5.
   * Null means every selectable day, which is what a record saved before this
   * field existed is treated as.
   */
  days: number[] | null
  createdAt: string
  updatedAt: string
}

/**
 * A row of the shared `places` table, as either a bus or a place.
 *
 * The same shape backs both lists; `kind` says which one a row belongs to.
 */
export interface PickupPlace {
  id: string
  name: string
  kind: PlaceKind
  active: boolean
  createdAt: string
}

/**
 * There is no whole-app state type here any more.
 *
 * It used to describe one localStorage blob holding every user, subscription and
 * place on the device, and it went when that blob did. Keeping the shape around
 * would only invite somebody to build a second source of truth beside the
 * database.
 */
