import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidName, isValidPassword, isValidPhone } from './validate'

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('rider@example.com')).toBe(true)
    expect(isValidEmail('first.last@example.co.uk')).toBe(true)
  })

  it('trims before judging, so a padded field is not rejected', () => {
    expect(isValidEmail('  rider@example.com  ')).toBe(true)
  })

  it('rejects addresses with no dot in the domain', () => {
    expect(isValidEmail('rider@example')).toBe(false)
  })

  it('rejects a missing or doubled @', () => {
    expect(isValidEmail('rider.example.com')).toBe(false)
    expect(isValidEmail('a@b@example.com')).toBe(false)
  })

  it('rejects empty and whitespace-only input', () => {
    expect(isValidEmail('')).toBe(false)
    expect(isValidEmail('   ')).toBe(false)
  })
})

describe('isValidPhone', () => {
  it('accepts digits, a leading +, and spaced or dashed groups', () => {
    expect(isValidPhone('0612345678')).toBe(true)
    expect(isValidPhone('+213 612 34 56 78')).toBe(true)
    expect(isValidPhone('0612-345-678')).toBe(true)
  })

  it('trims before judging', () => {
    expect(isValidPhone('  0612345678 ')).toBe(true)
  })

  it('rejects too few digits', () => {
    expect(isValidPhone('12345')).toBe(false)
  })

  it('rejects a leading dash', () => {
    expect(isValidPhone('-612345678')).toBe(false)
  })

  it('rejects letters', () => {
    expect(isValidPhone('0612abc678')).toBe(false)
  })
})

describe('isValidName', () => {
  it('accepts three characters or more', () => {
    expect(isValidName('Ali')).toBe(true)
  })

  it('rejects one or two characters', () => {
    expect(isValidName('Al')).toBe(false)
  })

  it('does not count padding as characters', () => {
    expect(isValidName('  Al  ')).toBe(false)
    expect(isValidName('  Ali  ')).toBe(true)
  })
})

describe('isValidPassword', () => {
  it('accepts six characters or more', () => {
    expect(isValidPassword('123456')).toBe(true)
  })

  it('rejects five characters or fewer', () => {
    expect(isValidPassword('12345')).toBe(false)
    expect(isValidPassword('')).toBe(false)
  })

  it('does not trim, so trailing spaces count toward the length', () => {
    expect(isValidPassword('12345 ')).toBe(true)
    expect(isValidPassword('1234 ')).toBe(false)
  })
})
