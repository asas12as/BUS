import { describe, expect, it } from 'vitest'
import { toUser, type ProfileInput } from './mappers'

const base: ProfileInput = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Rider One',
  phone: '',
  role: 'user',
  lang: 'en',
  avatar: null,
  pickup_place_id: null,
  pickup_name: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  email: 'rider@example.com'
}

describe('toUser', () => {
  // Migration 0003 made the signup trigger write profiles.phone. Before that the
  // column stayed empty and the client's metadata fallback was the only source,
  // which meant an admin listing riders saw a blank number for every account.
  it('prefers the phone column over signup metadata', () => {
    const user = toUser({ ...base, phone: '+966500000123' }, '+966500000999')
    expect(user.phone).toBe('+966500000123')
  })

  it('falls back to metadata when the column is empty', () => {
    const user = toUser({ ...base, phone: '' }, '+966500000999')
    expect(user.phone).toBe('+966500000999')
  })

  it('reports no number rather than the string undefined', () => {
    expect(toUser({ ...base, phone: '' }).phone).toBe('')
  })

  it('maps role onto its own union', () => {
    expect(toUser({ ...base, role: 'admin' }).role).toBe('admin')
    expect(toUser({ ...base, role: 'user' }).role).toBe('user')
  })

  // An unrecognised role must not become an admin. This is the row the scanner
  // and the week controls read, and 'admin' here would mean a row-level-security
  // bypass the database refused to give.
  it('falls back to rider for an unknown role', () => {
    expect(toUser({ ...base, role: 'superuser' }).role).toBe('user')
  })

  it('keeps a missing email as an empty string, not null', () => {
    expect(toUser({ ...base, email: null }).email).toBe('')
  })

  it('reports an unapproved pickup as none', () => {
    expect(toUser(base).pickupId).toBeNull()
    expect(toUser({ ...base, pickup_place_id: 'p1', pickup_name: 'Gate' })).toMatchObject({
      pickupId: 'p1',
      pickupLocation: 'Gate'
    })
  })
})