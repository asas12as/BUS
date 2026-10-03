import { describe, it, expect, beforeEach } from 'vitest'
import {
  readData,
  writeData,
  storageAvailable,
  subscribeWeek,
  changePickup,
  confirmWeek,
  clearWeek,
  getWeekSub,
  weekStatus,
  overallStatus,
  weeklyNumberUsed,
  highestNumberInWeek,
  weeklyNumberAvailable,
  needsNewNumber,
  worstSubStatus,
  hashPassword,
  isAdminEmail,
  adminCredentials,
  emailExists,
  approvePlaceRequest,
  rejectPlaceRequest,
  requestPlace,
  openPlaceRequests,
  activePlaces,
  ownerOfWeeklyNumber,
  deleteUser,
  setUserPassword
} from './storage'
import { MAX_WEEKLY_NUMBER, parseWeeklyNumber } from './weeklyNumber'
import type { AppData, SubStatus } from './types'
import { SELECTABLE_DAYS, nextWeekKey } from './date'

const KEY = 'projectbus.data.v1'
const WEEK = '2026-09-26'
const RIDERS = ['rider-a', 'rider-b', 'rider-c']
/** An in-memory stand-in, so these tests never touch a real browser store. */
function installStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial))
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).localStorage = storage
  return { storage, map }
}

function makeUser(id: string) {
  return {
    id,
    name: id,
    email: `${id}@example.com`,
    phone: '',
    passwordHash: hashPassword('secret123'),
    role: 'user' as const,
    createdAt: '2026-09-01T00:00:00.000Z'
  }
}

/** The week after the one an anchor falls in, i.e. the second eligible week. */
const nextWeekOf = (anchor: Date) => nextWeekKey(anchor)

const place = { id: 'p1', name: 'University Gate', active: true, createdAt: '' }

/** A minimal valid store, no seeding, so each test states what it needs. */
function baseData(): AppData {
  return {
    users: RIDERS.map(makeUser),
    session: null,
    lang: 'en',
    places: [place],
    placeRequests: [],
    subscriptions: {},
    weekCounters: {},
    days: {}
  }
}

/** Subscribes each rider in turn, which is how numbers get issued in the app. */
function subscribeAll(data: AppData, count = RIDERS.length): AppData {
  let out = data
  for (let i = 0; i < count; i++) {
    out = subscribeWeek(out, RIDERS[i], WEEK, { id: 'p1', name: 'University Gate', days: [...SELECTABLE_DAYS] })
  }
  return out
}

/**
 * The weekly number is the one field that cannot be given back: a number handed
 * to one rider must never reach another, even through cancellations, deletes or
 * a stale counter. These tests pin that.
 */
describe('weekly number allocation', () => {
  beforeEach(() => installStorage())

  it('numbers riders in subscribe order from 1', () => {
    const data = subscribeAll(baseData())
    expect(weeklyNumberUsed(data, WEEK)).toBe(3)
    for (const [i, id] of RIDERS.entries()) {
      expect(getWeekSub(data, id, WEEK)?.number).toBe(i + 1)
    }
  })

  it('keeps a number after a cancellation so it is never re-issued', () => {
    let data = subscribeAll(baseData())
    data = clearWeek(data, 'rider-a', WEEK)
    expect(getWeekSub(data, 'rider-a', WEEK)?.number).toBe(1)

    // The next rider continues past it rather than filling the gap.
    data = subscribeWeek(data, 'rider-a', WEEK, { id: 'p1', name: 'University Gate', days: [...SELECTABLE_DAYS] })
    expect(getWeekSub(data, 'rider-a', WEEK)?.number).toBe(1)
    data = subscribeWeek(data, 'rider-d', WEEK, { id: 'p1', name: 'University Gate', days: [...SELECTABLE_DAYS] })
    expect(getWeekSub(data, 'rider-d', WEEK)?.number).toBe(4)
  })

  it('keeps the number across a pickup change', () => {
    let data = subscribeAll(baseData())
    const before = getWeekSub(data, 'rider-b', WEEK)?.number
    data = changePickup(data, 'rider-b', WEEK, { id: 'p1', name: 'Stadium', days: [6, 0, 1, 2] })
    expect(getWeekSub(data, 'rider-b', WEEK)?.number).toBe(before)
    expect(getWeekSub(data, 'rider-b', WEEK)?.pickupName).toBe('Stadium')
  })

  it('does not hand out a number that a stored record already holds', () => {
    // A counter behind the real records must not produce a duplicate.
    const data = subscribeAll(baseData())
    const stale = { ...data, weekCounters: { [WEEK]: 0 } }
    expect(highestNumberInWeek(stale, WEEK)).toBe(3)
    const next = subscribeWeek(stale, 'rider-d', WEEK, {
      id: 'p1',
      name: 'University Gate',
      days: [...SELECTABLE_DAYS]
    })
    expect(getWeekSub(next, 'rider-d', WEEK)?.number).toBe(4)
  })

  it('reports availability from the higher of counter and records', () => {
    let data = subscribeAll(baseData())
    expect(needsNewNumber(data, 'rider-a', WEEK)).toBe(false)
    data = { ...data, weekCounters: { [WEEK]: MAX_WEEKLY_NUMBER } }
    expect(weeklyNumberAvailable(data, WEEK)).toBe(false)
  })

  it('refuses a live subscription once the week is exhausted', () => {
    // Better to reject the write than store a live subscription with no number.
    const full = {
      ...baseData(),
      weekCounters: { [WEEK]: MAX_WEEKLY_NUMBER },
      subscriptions: { 'rider-a': { [WEEK]: { weekStart: WEEK, status: 'none' as SubStatus, number: null, pickupId: null, pickupName: null, days: [...SELECTABLE_DAYS], createdAt: '', updatedAt: '' } } }
    }
    const out = subscribeWeek(full, 'rider-a', WEEK, {
      id: 'p1',
      name: 'University Gate',
      days: [...SELECTABLE_DAYS]
    })
    expect(weeklyNumberUsed(out, WEEK)).toBe(MAX_WEEKLY_NUMBER)
    expect(needsNewNumber(out, 'rider-a', WEEK)).toBe(true)
  })
})

describe('ownerOfWeeklyNumber', () => {
  beforeEach(() => installStorage())

  it('finds the rider holding a number in a given week', () => {
    const data = subscribeAll(baseData())
    const found = ownerOfWeeklyNumber(data, data.users, WEEK, 2)
    expect(found?.user.id).toBe('rider-b')
    expect(found?.sub.number).toBe(2)
  })

  it('resolves a lettered number to the same record', () => {
    // The printed form is what a driver reads; the stored form is an integer.
    const data: AppData = {
      ...baseData(),
      weekCounters: { [WEEK]: 1000 },
      subscriptions: {
        'rider-a': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: 1001,
            pickupId: null,
            pickupName: null,
            days: [...SELECTABLE_DAYS],
            createdAt: '',
            updatedAt: ''
          }
        }
      }
    }
    const parsed = parseWeeklyNumber('1A')
    expect(parsed).toBe(1001)
    expect(ownerOfWeeklyNumber(data, data.users, WEEK, parsed!)?.user.id).toBe('rider-a')
  })

  it('returns null when the number is not held in that week', () => {
    const data = subscribeAll(baseData())
    expect(ownerOfWeeklyNumber(data, data.users, WEEK, 99)).toBeNull()
    // Same number, different week: not a match.
    expect(ownerOfWeeklyNumber(data, data.users, '2026-10-03', 1)).toBeNull()
  })

  it('only searches the candidates it is given', () => {
    // The door scanner passes riders only, so an admin account holding a number
    // must not shadow them.
    const data = subscribeAll(baseData())
    const riders = data.users.filter((u) => u.role === 'user')
    expect(ownerOfWeeklyNumber(data, riders, WEEK, 1)?.user.id).toBe('rider-a')
    expect(ownerOfWeeklyNumber(data, [], WEEK, 1)).toBeNull()
  })

  it('ignores a record whose number was cleared', () => {
    const data = clearWeek(subscribeAll(baseData()), 'rider-a', WEEK)
    // clearWeek keeps the number on the record so it is never re-issued, so the
    // holder is still findable.
    expect(ownerOfWeeklyNumber(data, data.users, WEEK, 1)?.user.id).toBe('rider-a')
  })
})

describe('subscription state', () => {
  beforeEach(() => installStorage())

  it('a user subscribe lands in pending, never straight to paid', () => {
    const data = subscribeAll(baseData())
    expect(weekStatus(data, 'rider-a', WEEK)).toBe('pending')
  })

  it('an admin confirmation moves pending to subscribed', () => {
    const data = confirmWeek(subscribeAll(baseData()), 'rider-a', WEEK)
    expect(weekStatus(data, 'rider-a', WEEK)).toBe('subscribed')
  })

  it('picks the most urgent state across weeks', () => {
    // "Most urgent" is what the user must act on, not the newest state.
    expect(worstSubStatus([])).toBe('none')
    expect(worstSubStatus(['subscribed', 'pending'])).toBe('pending')
    expect(worstSubStatus(['subscribed', 'pending', 'none'])).toBe('none')
    expect(worstSubStatus(['subscribed'])).toBe('subscribed')
  })

  it('reports the most urgent status across the two eligible weeks', () => {
    // overallStatus reads the anchor's own week and the next. The anchor has to
    // fall inside WEEK for the fixture below to be one of the two.
    const anchor = new Date(`${WEEK}T12:00:00`)
    const data = subscribeAll(baseData())

    // The next week has no subscription, and "not subscribed" outranks
    // "pending payment", so the rider still has something to act on.
    expect(overallStatus(data, 'rider-a', anchor)).toBe('none')

    // Subscribe to both weeks and the more urgent of the two shows through.
    const both = subscribeWeek(data, 'rider-a', nextWeekOf(anchor), {
      id: 'p1',
      name: 'University Gate',
      days: [...SELECTABLE_DAYS]
    })
    expect(overallStatus(both, 'rider-a', anchor)).toBe('pending')

    // Only once both weeks are paid does the rider have nothing left to do.
    const paid = confirmWeek(confirmWeek(both, 'rider-a', WEEK), 'rider-a', nextWeekOf(anchor))
    expect(overallStatus(paid, 'rider-a', anchor)).toBe('subscribed')
    expect(overallStatus(paid, 'nobody', anchor)).toBe('none')
  })

  it('raises a place request when subscribing with a new pickup name', () => {
    const data = subscribeWeek(baseData(), 'rider-a', WEEK, {
      id: null,
      name: 'New Stop',
      days: [...SELECTABLE_DAYS]
    })
    expect(data.placeRequests.map((r) => r.name)).toContain('New Stop')
  })
})

describe('places', () => {
  beforeEach(() => installStorage())

  it('hides inactive places from the active list', () => {
    const data = { ...baseData(), places: [place, { id: 'p2', name: 'Old', active: false, createdAt: '' }] }
    expect(activePlaces(data).map((p) => p.name)).toEqual(['University Gate'])
  })

  it('approving a request creates the place and links it', () => {
    let data = subscribeWeek(baseData(), 'rider-a', WEEK, {
      id: null,
      name: 'New Stop',
      days: [...SELECTABLE_DAYS]
    })
    const request = data.placeRequests[0]
    data = approvePlaceRequest(data, request.id)
    const created = data.places.find((p) => p.name === 'New Stop')
    expect(created).toBeDefined()
    // The request is kept and marked, not deleted: it is the audit trail for
    // who asked for the stop.
    expect(openPlaceRequests(data)).toHaveLength(0)
    expect(data.placeRequests[0].status).toBe('approved')
    // The rider's record now points at a real place.
    expect(getWeekSub(data, 'rider-a', WEEK)?.pickupId).toBe(created?.id)
  })

  it('rejecting a request leaves the rider on the typed name', () => {
    let data = subscribeWeek(baseData(), 'rider-a', WEEK, {
      id: null,
      name: 'New Stop',
      days: [...SELECTABLE_DAYS]
    })
    data = rejectPlaceRequest(data, data.placeRequests[0].id)
    expect(openPlaceRequests(data)).toHaveLength(0)
    expect(getWeekSub(data, 'rider-a', WEEK)?.pickupName).toBe('New Stop')
    // Nothing was created, so the rider keeps a name rather than an id.
    expect(getWeekSub(data, 'rider-a', WEEK)?.pickupId).toBeNull()
    expect(data.places.some((p) => p.name === 'New Stop')).toBe(false)
  })

  it('does not ask twice for the same open place', () => {
    let data = subscribeWeek(baseData(), 'rider-a', WEEK, {
      id: null,
      name: 'New Stop',
      days: [...SELECTABLE_DAYS]
    })
    // Same rider, same name, different spelling of case and spacing.
    data = requestPlace(data, 'rider-a', '  new stop ')
    expect(openPlaceRequests(data)).toHaveLength(1)
  })

  it('allows two riders to request the same new stop', () => {
    // Dedupe is per rider: one person's request must not silence another's.
    let data = subscribeWeek(baseData(), 'rider-a', WEEK, {
      id: null,
      name: 'New Stop',
      days: [...SELECTABLE_DAYS]
    })
    data = requestPlace(data, 'rider-b', 'New Stop')
    expect(openPlaceRequests(data)).toHaveLength(2)
  })
})

describe('users', () => {
  beforeEach(() => installStorage())

  it('stores a password as a hash, never as the plain text', () => {
    const data = baseData()
    const stored = data.users[0].passwordHash
    expect(stored).not.toContain('secret123')
    expect(hashPassword('secret123')).toBe(stored)
  })

  it('treats email as case insensitive when checking for duplicates', () => {
    expect(emailExists(baseData().users, 'RIDER-A@example.com')).toBe(true)
    expect(emailExists(baseData().users, 'nobody@example.com')).toBe(false)
  })

  it('knows the seeded admin', () => {
    expect(isAdminEmail('admin@nvu-bus.app')).toBe(true)
    expect(isAdminEmail('ADMIN@NVU-BUS.APP')).toBe(true)
    expect(isAdminEmail('rider-a@example.com')).toBe(false)
    expect(adminCredentials().password).toBe('admin123')
  })

  it('re-hashes a password on change', () => {
    const data = setUserPassword(baseData(), 'rider-a', 'newsecret')
    expect(getWeekSub(data, 'rider-a', WEEK)).toBeNull()
    expect(data.users[0].passwordHash).toBe(hashPassword('newsecret'))
  })

  it('deleting a user takes their subscriptions and requests with them', () => {
    let data = subscribeAll(baseData())
    data = requestPlace(data, 'rider-a', 'New Stop')
    data = deleteUser(data, 'rider-a')
    expect(data.users.map((u) => u.id)).not.toContain('rider-a')
    expect(data.subscriptions['rider-a']).toBeUndefined()
    expect(data.placeRequests).toHaveLength(0)
  })
})

describe('persistence and migration', () => {
  it('round trips through storage', () => {
    const { map } = installStorage()
    const data = subscribeAll(baseData())
    writeData(data)
    expect(JSON.parse(map.get(KEY) as string).users).toHaveLength(3)
    expect(weeklyNumberUsed(readData(), WEEK)).toBe(3)
  })

  it('issues numbers to records saved before numbers existed', () => {
    // A record with no number gets one at load, oldest first, continuing after
    // the highest already stored.
    const legacy = {
      users: [],
      subscriptions: {
        'rider-a': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: null,
            pickupId: 'p1',
            pickupName: 'University Gate',
            days: [6, 0, 1, 2, 3],
            createdAt: '2026-09-01T00:00:00.000Z',
            updatedAt: ''
          }
        },
        'rider-b': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: null,
            pickupId: 'p1',
            pickupName: 'University Gate',
            days: [6, 0, 1, 2, 3],
            createdAt: '2026-09-02T00:00:00.000Z',
            updatedAt: ''
          }
        }
      },
      weekCounters: { [WEEK]: 5 }
    }
    installStorage({ [KEY]: JSON.stringify(legacy) })
    const data = readData()
    // Backfill counts from the numbers it can actually see in the records, so
    // these two start at 1. The saved counter of 5 is merged afterwards and
    // only moves where the *next* number comes from, which is what stops a
    // later subscription colliding with them.
    expect(getWeekSub(data, 'rider-a', WEEK)?.number).toBe(1)
    expect(getWeekSub(data, 'rider-b', WEEK)?.number).toBe(2)
    expect(weeklyNumberUsed(data, WEEK)).toBe(5)
  })

  it('continues after the highest number actually held in a record', () => {
    // The case that matters: a week holding numbers 3 and nothing below it,
    // plus a record that never got one. Backfilling from 1 would hand out a
    // number that is already on someone's pass.
    const partial = {
      subscriptions: {
        'rider-a': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: 3,
            pickupId: null,
            pickupName: null,
            days: [6, 0, 1, 2, 3],
            createdAt: '',
            updatedAt: ''
          }
        },
        'rider-b': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: null,
            pickupId: null,
            pickupName: null,
            days: [6, 0, 1, 2, 3],
            createdAt: '',
            updatedAt: ''
          }
        }
      }
    }
    installStorage({ [KEY]: JSON.stringify(partial) })
    const data = readData()
    expect(getWeekSub(data, 'rider-a', WEEK)?.number).toBe(3)
    expect(getWeekSub(data, 'rider-b', WEEK)?.number).toBe(4)
  })

  it('repairs a corrupt day list instead of reading it as broken', () => {
    const broken = {
      subscriptions: {
        'rider-a': {
          [WEEK]: {
            weekStart: WEEK,
            status: 'subscribed',
            number: 1,
            pickupId: null,
            pickupName: null,
            days: 'not an array',
            createdAt: '',
            updatedAt: ''
          }
        }
      }
    }
    installStorage({ [KEY]: JSON.stringify(broken) })
    expect(getWeekSub(readData(), 'rider-a', WEEK)?.days).toEqual([...SELECTABLE_DAYS])
  })

  it('gives a user saved before passwords existed the legacy hash', () => {
    installStorage({ [KEY]: JSON.stringify({ users: [{ id: 'old', name: 'old', email: 'old@x.com', phone: '' }] }) })
    const data = readData()
    expect(data.users[0].passwordHash).toBeTruthy()
  })

  it('seeds a working store when there is nothing saved', () => {
    installStorage()
    const data = readData()
    expect(data.users.length).toBeGreaterThan(0)
    expect(data.places.length).toBeGreaterThan(0)
  })

  it('survives unparseable saved data', () => {
    installStorage({ [KEY]: '{ this is not json' })
    expect(readData().users.length).toBeGreaterThan(0)
  })

  it('keeps the existing storage key, so saved data is not orphaned', () => {
    // The key is the app's identity on disk. Changing it silently signs every
    // existing rider out, so it is pinned here deliberately.
    const { map } = installStorage()
    writeData(baseData())
    expect(map.has('projectbus.data.v1')).toBe(true)
  })
})

describe('storageAvailable', () => {
  it('is true when writes succeed', () => {
    installStorage()
    expect(storageAvailable()).toBe(true)
  })

  it('is false when the store throws, so the UI can say so', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0
    }
    expect(storageAvailable()).toBe(false)
  })
})
