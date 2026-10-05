/**
 * The last server snapshot, kept so the app can render without a network.
 *
 * This is a cache and nothing else. It is never written to after a sign-in
 * unless the data came from the server, and it is never read as a source of
 * truth: no role, no status and no weekly number is taken from here. That
 * distinction is the whole point, because the previous design let any device
 * edit the shared blob and call it authoritative.
 *
 * Keyed by user id, so signing in on a shared tablet does not show the previous
 * rider's subscriptions for a frame before the fetch lands.
 */
import type { Lang, PickupPlace, PlaceRequest, User, WeekSubscription } from './types'

/**
 * Separate from the old `projectbus.data.v1` blob on purpose.
 *
 * Reusing that key would read the previous shared-blob data back as if it were a
 * server snapshot, which is precisely the confusion this cutover exists to
 * remove. The old key is left alone and simply stops being read.
 */
const KEY = 'nvu.bus.cache.v1'

export interface CacheSnapshot {
  userId: string
  user: User
  weeks: Array<{ userId: string; sub: WeekSubscription }>
  places: PickupPlace[]
  placeRequests: PlaceRequest[]
  lang: Lang
  savedAt: string
}

/**
 * Probes whether localStorage works at all.
 *
 * Same reason as the old storageAvailable(): file:// on some mobile browsers and
 * private windows with storage disabled both throw, and the app should say so
 * rather than fail silently on the first save.
 */
export function cacheAvailable(): boolean {
  try {
    const probe = '__nvu_bus_cache_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

/** Writes a snapshot, keyed by user. A quota failure is silent by design. */
export function writeCache(snapshot: Omit<CacheSnapshot, 'savedAt'>): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() })
    )
  } catch {
    // Nothing to do. The cache is an optimisation for offline display, so
    // failing to store it must never break the session that just succeeded.
  }
}

/**
 * The snapshot for one user, or null.
 *
 * Returns null when the stored id does not match. That check is what stops a
 * shared device from rendering the last rider's name and weekly number to
 * whoever signs in next.
 */
export function readCache(userId: string): CacheSnapshot | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CacheSnapshot>
    if (parsed.userId !== userId) return null
    if (!Array.isArray(parsed.weeks) || !parsed.places) return null
    return parsed as CacheSnapshot
  } catch {
    return null
  }
}

/** Drops the snapshot. Called on sign-out so nothing of the rider's survives. */
export function clearCache(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // As above: a cache that cannot be cleared is a reason to try again later,
    // not a reason to break the sign-out.
  }
}