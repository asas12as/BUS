/**
 * The shape rules a rider's own details have to pass.
 *
 * These live here because the same few rules are checked from more than one
 * screen: sign up, the profile form, the admin edit form, and the admin reset
 * password box. Each of those screens decides which message to show and in
 * what order, so the rule stays a plain yes/no here and the screen keeps the
 * wording.
 *
 * Every predicate trims first. The forms let you submit a field that is only
 * spaces, and "  " is not a name, so nothing here should accept it.
 */

/** Deliberately loose: it only rejects what is obviously not an address. */
export function isValidEmail(email: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
}

/**
 * Allows a leading `+`, then digits with spaces or dashes.
 *
 * Spaces and dashes are allowed because people type phone numbers the way they
 * read them off a card; the count is loose too, since numbering is per country
 * and this app is used in more than one.
 */
export function isValidPhone(phone: string): boolean {
  return /^[+\d][\d\s-]{6,}$/.test(phone.trim())
}

/** Below three characters a name is a typo rather than a name. */
export function isValidName(name: string): boolean {
  return name.trim().length >= 3
}

export function isValidPassword(password: string): boolean {
  return password.length >= 6
}
