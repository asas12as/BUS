import { describe, expect, it } from 'vitest'
import { isValidEmail, isValidName, isValidPassword, isValidPhone, countNameWords } from './validate'

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
  it('accepts a full name of three words', () => {
    expect(isValidName('Ahmed Adel Ibrahim')).toBe(true)
    expect(isValidName('Sara Maged Fahmy')).toBe(true)
  })

  it('rejects the short forms that were previously accepted', () => {
    // The old rule was three characters, so 'Ali' and 'Ahmed' both passed. That
    // is the gap this closes.
    expect(isValidName('Ali')).toBe(false)
    expect(isValidName('Ahmed')).toBe(false)
    expect(isValidName('Ahmed Adel')).toBe(false)
    expect(isValidName('Al')).toBe(false)
    expect(isValidName('')).toBe(false)
  })

  it('does not count padding as words', () => {
    expect(isValidName('  Ahmed Adel  ')).toBe(false)
    expect(isValidName('  Ahmed Adel Ibrahim  ')).toBe(true)
  })

  it('counts an Arabic name the same way', () => {
    expect(isValidName('أحمد عادل إبراهيم')).toBe(true)
    expect(isValidName('أحمد عادل')).toBe(false)
  })

  it('ignores punctuation stuck to the edges', () => {
    expect(isValidName('Ahmed Adel, Ibrahim.')).toBe(true)
    expect(isValidName(',,, Ahmed Adel Ibrahim !!!')).toBe(true)
    expect(isValidName('- Ahmed - Adel -')).toBe(false)
  })

  it('counts four words as valid', () => {
    expect(isValidName('Ahmed Adel Ibrahim Mohamed')).toBe(true)
  })
})

describe('countNameWords', () => {
  it('reports what it counted', () => {
    expect(countNameWords('Ahmed')).toBe(1)
    expect(countNameWords('Ahmed Adel')).toBe(2)
    expect(countNameWords('Ahmed Adel Ibrahim')).toBe(3)
    expect(countNameWords('Ahmed   Adel    Ibrahim')).toBe(3)
    expect(countNameWords('   ')).toBe(0)
  })

  it('does not count a number typed into the name field as a name part', () => {
    expect(countNameWords('123')).toBe(1)
  })

  // Mirrored by public.count_name_words in 0005. Each of these was a real
  // disagreement between the two implementations while 0005 was being written,
  // so they are here to keep the mirror honest rather than to document the rule.
  it('matches the SQL mirror on punctuation between names', () => {
    expect(countNameWords('Ahmed - Adel')).toBe(2)
    expect(countNameWords('Ahmed . Adel')).toBe(2)
    expect(countNameWords('Ahmed , , Adel')).toBe(2)
    expect(countNameWords('...')).toBe(0)
    expect(countNameWords('! Ahmed Adel Ibrahim ?')).toBe(3)
  })

  it('matches the SQL mirror on Arabic names', () => {
    // Arabic is the language the app is actually read in, and a mirror that
    // only holds for Latin names is not a mirror.
    expect(countNameWords('أحمد محمد علي')).toBe(3)
    expect(countNameWords('أحمد - محمد')).toBe(2)
  })

  it('treats a hyphen-joined name as one word', () => {
    // The rule is about being recognisable on the day, and a hyphen-joined
    // string is one token however long it is.
    expect(countNameWords('Ahmed-Mohamed-Ibrahim')).toBe(1)
    expect(countNameWords('Ahmed Mohamed Ibrahim')).toBe(3)
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
