import { describe, it, expect } from 'vitest'
import {
  normalizePhone,
  isValidPhone,
  derivedEmailForPhone,
  DEFAULT_COUNTRY_CODE
} from './phone'

describe('normalizePhone', () => {
  it('reads every way of writing one Egyptian number as the same number', () => {
    const variants = [
      '+201001234567',
      '201001234567',
      '01001234567',
      '00201001234567',
      '+20 100 123 4567',
      '20-100-123-4567',
      '  +20 (100) 123-4567  '
    ]
    const normalized = variants.map((v) => normalizePhone(v))
    for (const value of normalized) expect(value).toBe('+201001234567')
  })

  it('does not treat the international prefix as part of the country code', () => {
    // The bug this guards: naive digit-stripping turned 00201001234567 into
    // +200201001234567, which is a different number and would have let the same
    // person hold two accounts.
    expect(normalizePhone('00201001234567')).toBe('+201001234567')
  })

  it('replaces the national trunk zero rather than prefixing it', () => {
    expect(normalizePhone('01001234567')).toBe('+201001234567')
  })

  it('keeps a number that already carries the country code', () => {
    expect(normalizePhone('201001234567')).toBe('+201001234567')
  })

  it('treats a number without a plus or a zero as national', () => {
    expect(normalizePhone('1001234567')).toBe('+201001234567')
  })

  it('honours a different country code', () => {
    expect(normalizePhone('0101234567', '966')).toBe('+966101234567')
  })

  it('trusts an explicit plus sign whatever the country', () => {
    // Without this, a Saudi number typed correctly becomes +20966101234567: a
    // number that belongs to nobody, so the rider could never sign in again.
    expect(normalizePhone('+966101234567')).toBe('+966101234567')
    expect(normalizePhone('+447700900123')).toBe('+447700900123')
    expect(normalizePhone('+201001234567')).toBe('+201001234567')
  })

  it('rejects what is not a number at all', () => {
    expect(normalizePhone('')).toBeNull()
    expect(normalizePhone('   ')).toBeNull()
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('+')).toBeNull()
  })

  it('rejects a number too long to be one', () => {
    expect(normalizePhone('+1234567890123456')).toBeNull()
  })

  it('rejects a number too short to be dialable', () => {
    expect(normalizePhone('1234')).toBeNull()
  })

  // Mirrored by public.is_valid_phone in 0005. The bounds are on the digit count
  // and not on the length of the returned string, which carries a leading '+'.
  // Counting characters instead makes the two disagree by one right here.
  it('agrees with the SQL mirror on the exact bounds', () => {
    expect(normalizePhone('+12345678')).toBe('+12345678')
    expect(normalizePhone('+1234567')).toBeNull()
    expect(normalizePhone('+123456789012345')).toBe('+123456789012345')
    expect(normalizePhone('+1234567890123456')).toBeNull()
  })

  it('counts digits, not characters, at both ends of the range', () => {
    // 8 digits and 15 digits are both real; 7 and 16 are not. Written in
    // international form, because a bare number is read as national and gains a
    // country code: `1234567` is not a 7-digit number, it is +20 1234567.
    expect(isValidPhone('+12345678')).toBe(true)
    expect(isValidPhone('+1234567')).toBe(false)
    expect(isValidPhone('+123456789012345')).toBe(true)
    expect(isValidPhone('+1234567890123456')).toBe(false)
  })

  it('reads a short bare number as national rather than as a broken number', () => {
    expect(normalizePhone('1234567')).toBe('+201234567')
  })

  it('returns null rather than throwing for a bad number', () => {
    // Login derives an address from whatever was typed. A throw here would be a
    // crash on a form field, not a validation message.
    expect(() => normalizePhone('nonsense')).not.toThrow()
  })
})

describe('isValidPhone', () => {
  it('accepts real numbers and rejects noise', () => {
    expect(isValidPhone('+201001234567')).toBe(true)
    expect(isValidPhone('01001234567')).toBe(true)
    expect(isValidPhone('hello')).toBe(false)
    expect(isValidPhone('')).toBe(false)
  })
})

describe('derivedEmailForPhone', () => {
  it('gives every spelling of one number the same address', () => {
    const expected = 'p201001234567@phone.invalid'
    expect(derivedEmailForPhone('+201001234567')).toBe(expected)
    expect(derivedEmailForPhone('01001234567')).toBe(expected)
    expect(derivedEmailForPhone('00201001234567')).toBe(expected)
  })

  it('uses a domain that cannot receive mail and cannot collide', () => {
    // RFC 2606 reserves .invalid, so no real rider can type it as their address.
    expect(derivedEmailForPhone('+201001234567').endsWith('@phone.invalid')).toBe(true)
  })

  it('cannot produce the address of a different number', () => {
    expect(derivedEmailForPhone('+201001234567')).not.toBe(derivedEmailForPhone('+201001234568'))
  })

  it('is stable, so signing in recomputes exactly the address used at signup', () => {
    expect(derivedEmailForPhone('01001234567')).toBe(derivedEmailForPhone('01001234567'))
  })

  it('throws for a number it cannot read', () => {
    expect(() => derivedEmailForPhone('abc')).toThrow()
  })
})

describe('country code default', () => {
  it('is Egypt, matching the numbers the app is used with', () => {
    expect(DEFAULT_COUNTRY_CODE).toBe('20')
  })
})