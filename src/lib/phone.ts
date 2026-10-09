/**
 * Phone numbers as identity.
 *
 * The rider's number is who they are: it is the thing they remember, the thing
 * they sign in with, and the thing that must not belong to two accounts. But
 * people type the same number several ways -- `+201001234567`, `01001234567`,
 * `00201001234567` -- and those are one number, not three. Every comparison in
 * the app therefore runs on the normalised form from here, never on what was
 * typed.
 *
 * Numbers are assumed Egyptian. A leading `0` is the national form, so it is
 * replaced by the country code rather than kept; a number that already carries
 * the country code is left alone. That is a deliberate simplification, stated
 * plainly: a landline typed without its leading zero is read as international
 * and comes out wrong. Riders type the zero, and the alternative is a country
 * code per form field.
 */

/** The country code used when a number is written in its national form. */
export const DEFAULT_COUNTRY_CODE = '20'

/**
 * The domain of the address GoTrue stores for a phone-only account.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, which
 * makes it the right home for an address that must exist for Supabase's unique
 * index but must never receive mail. It cannot collide with a real address.
 */
const DERIVED_DOMAIN = 'phone.invalid'

/** Digits only, which is what every rule below is really about. */
function digitsOnly(input: string): string {
  return input.replace(/\D/g, '')
}

/**
 * The number in E.164 form, or null if it cannot be read as one.
 *
 * E.164 allows 8 to 15 digits. The bounds here are looser at the bottom because
 * the country is not the only one this app is used in, but a number that cannot
 * be a phone number at all is rejected rather than stored, so that a typo
 * cannot become an unreachable account.
 */
export function normalizePhone(
  input: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string | null {
  const trimmed = input.trim()
  const digits = digitsOnly(trimmed)
  if (digits.length === 0) return null

  let e164: string
  if (trimmed.startsWith('+')) {
    // Written in international form. Taken at face value, whatever the country:
    // assuming the default here would turn +966101234567 into +20966101234567,
    // which is a different number belonging to nobody.
    e164 = digits
  } else if (digits.startsWith('00')) {
    // International prefix: the country code is already there.
    e164 = digits.slice(2)
  } else if (digits.startsWith('0')) {
    // National form. The trunk zero is dropped, not the country code added to it.
    e164 = countryCode + digits.slice(1)
  } else if (digits.startsWith(countryCode) && digits.length >= 10) {
    // Already international: someone typed the country code without a plus.
    e164 = digits
  } else {
    e164 = countryCode + digits
  }

  if (e164.length < 8 || e164.length > 15) return null
  return `+${e164}`
}

/** True when the number can be read as a dialable phone number. */
export function isValidPhone(input: string): boolean {
  return normalizePhone(input) !== null
}

/**
 * The GoTrue address for a phone-only account.
 *
 * GoTrue will only enforce uniqueness on an address, and this project's build
 * rejects a signup that carries both an email and a phone, so the address is
 * derived from the number instead. The derivation is pure and total, which is
 * what makes sign-in possible without a lookup: the client runs this again and
 * signs in as the address it arrives at.
 *
 * The `p` prefix keeps the local part from being read as a domain, and cannot
 * collide with a real address because the domain is `.invalid`.
 */
export function derivedEmailForPhone(
  phone: string,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string {
  const normalized = normalizePhone(phone, countryCode)
  if (!normalized) {
    // Unreachable for a number that passed isValidPhone. Kept total because this
    // value is used as a login key, where a thrown error would strand a rider who
    // already has an account.
    throw new Error('Cannot derive an address from an unreadable phone number')
  }
  return `p${normalized.replace('+', '')}@${DERIVED_DOMAIN}`
}