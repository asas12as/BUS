/**
 * Where the app's routes should live: in the URL path, or in the fragment.
 *
 * Kept apart from the component that uses it so the policy can be reasoned about
 * and tested on its own, and so this module stays free of React and the DOM.
 */

/**
 * Two delivery targets force routes into the fragment, and they break for
 * different reasons:
 *
 * - Opened from a file:// URL, the path is the file itself and Chrome refuses
 *   pushState for file origins. This is opening a built index.html straight off
 *   disk, which is still how the build gets checked on a handset.
 * - Served by a static host that returns 404 for any path it cannot map to a
 *   file. GitHub Pages is the case that matters here: with path routing the app
 *   navigates fine in-session, but refreshing or sharing `/scan` asks the server
 *   for a file called `scan`, which does not exist, so the tester gets a 404.
 *   Fragment routing keeps every route after the `#`, where the server never
 *   looks.
 *
 * The second is decided at build time via VITE_HASH_ROUTER, so local development
 * keeps clean path-based URLs.
 */
export function shouldUseHashRoutes(
  protocol: string | undefined,
  staticBuild: boolean | undefined
): boolean {
  if (isFileProtocol(protocol)) return true
  return staticBuild === true
}

/**
 * Compares against the exact scheme rather than a `file://` prefix: a URL with a
 * path is still a file origin, and only the scheme decides this.
 */
export function isFileProtocol(protocol: string | undefined): boolean {
  return protocol === 'file:'
}