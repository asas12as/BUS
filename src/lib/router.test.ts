import { describe, expect, it } from 'vitest'
import { isFileProtocol, shouldUseHashRoutes } from './router'

/**
 * The routing decision has to hold for three delivery targets at once: the local
 * dev server, the GitHub Pages deployment, and the file:// phone artifact. They
 * disagree about where routes belong, and getting it wrong fails in a way that
 * only shows up for the person who did not write it, so it is pinned here.
 */
describe('shouldUseHashRoutes', () => {
  it('uses path routes for a normal http(s) dev server', () => {
    expect(shouldUseHashRoutes('http:', undefined)).toBe(false)
    expect(shouldUseHashRoutes('https:', undefined)).toBe(false)
  })

  it('uses hash routes for the offline phone artifact', () => {
    // Android Chrome refuses pushState on a file origin, so the path is not
    // available to route with at all.
    expect(shouldUseHashRoutes('file:', undefined)).toBe(true)
    expect(shouldUseHashRoutes('file:', false)).toBe(true)
  })

  it('uses hash routes for a static host that cannot rewrite URLs', () => {
    // GitHub Pages returns 404 for a path with no matching file, so a shared or
    // refreshed /scan link would otherwise break.
    expect(shouldUseHashRoutes('https:', true)).toBe(true)
  })

  it('does not read a truthy string as enabled', () => {
    // The flag is compared against '1' in source and arrives as a string, so a
    // stray 'true' or '0' must not be treated as a boolean.
    expect(shouldUseHashRoutes('https:', undefined)).toBe(false)
    expect(shouldUseHashRoutes('https:', false)).toBe(false)
  })

  it('survives an environment with no location', () => {
    // Guards the typeof check rather than assuming the global exists.
    expect(shouldUseHashRoutes(undefined, undefined)).toBe(false)
  })
})

describe('isFileProtocol', () => {
  it('matches only the file scheme, not any file:// prefix', () => {
    expect(isFileProtocol('file:')).toBe(true)
    expect(isFileProtocol('file:///C:/app/index.html')).toBe(false)
    expect(isFileProtocol('http:')).toBe(false)
    expect(isFileProtocol(undefined)).toBe(false)
  })
})