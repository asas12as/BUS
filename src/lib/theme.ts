import type { Theme } from './types'

/**
 * Still the old name on purpose, for the same reason as the app data key: this
 * is a storage key, not branding, and renaming it would silently reset the
 * theme choice on every device that has already set one. The inline bootstrap
 * in index.html reads the same key, so the two have to stay in step.
 */
const KEY = 'projectbus.theme'

/**
 * Theme is stored outside the app data blob on purpose: it is a per-device
 * preference, and app data is reseeded on some paths. Reading localStorage can
 * throw on a file:// origin, so every access is guarded.
 */
function safeGet(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) ?? null
  } catch {
    return null
  }
}

function safeSet(value: string): void {
  try {
    globalThis.localStorage?.setItem(KEY, value)
  } catch {
    // Storage blocked: the choice still applies for this session, it just will
    // not survive a reload.
  }
}

function prefersDark(): boolean {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  } catch {
    return false
  }
}

/** The theme in effect: the stored choice, else the OS preference. */
export function resolveTheme(): Theme {
  const stored = safeGet()
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark() ? 'dark' : 'light'
}

export function storeTheme(theme: Theme): void {
  safeSet(theme)
}

/**
 * Writes the theme onto <html> as data-theme so CSS can override the OS
 * preference. When theme is null the attribute is removed, handing control back
 * to prefers-color-scheme.
 */
export function applyTheme(theme: Theme | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (theme === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}