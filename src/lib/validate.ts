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
 * and this app is used in more than one. Whether the number can actually be
 * dialled is a separate question, answered by `isValidPhone` in ./phone, which
 * is also what normalises it before it is stored.
 */
export function isValidPhone(phone: string): boolean {
  return /^[+\d][\d\s-]{6,}$/.test(phone.trim())
}

/** The least a full name has to be for this app. */
export const MIN_NAME_WORDS = 3

/**
 * A full name of at least three words.
 *
 * Three words, not three characters. `Ahmed` and `Ahmed Adel` are what the form
 * saw when it previously accepted a minimum length of 3, and neither is enough
 * to tell one rider from another at a bus window: the pass is checked against a
 * name by somebody who has never seen the rider before. `Ahmed Adel Ibrahim`
 * is.
 *
 * Counted on whitespace, with every run of spaces and any stray punctuation at
 * the edges ignored. A name written with an Arabic comma or a hyphen inside it
 * still counts its parts.
 */
export function isValidName(name: string): boolean {
  return countNameWords(name) >= MIN_NAME_WORDS
}

/** How many words a name has, as this app counts them. */
export function countNameWords(name: string): number {
  return name
    .split(/\s+/)
    // Punctuation alone does not make a word. Without this, `Ahmed - Adel`
    // counts as three and two names can slip past the rule the moment somebody
    // types a stray dash, which is what a phone keyboard produces easily.
    .map((part) => part.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((part) => part.length > 0).length
}

export function isValidPassword(password: string): boolean {
  return password.length >= 6
}
