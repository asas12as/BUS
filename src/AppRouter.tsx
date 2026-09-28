import { BrowserRouter, HashRouter } from 'react-router-dom'
import type { ReactNode } from 'react'

/**
 * Picks the router based on how the document was opened.
 *
 * BrowserRouter keeps routes in the URL path, which works when the app is
 * served over http(s). Opened straight from a file:// URL the path is the file
 * itself and Chrome rejects pushState for file origins, so routes have to move
 * into the fragment, where HashRouter keeps them.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  const protocol = typeof location !== 'undefined' ? location.protocol : undefined
  if (isFileProtocol(protocol)) {
    return <HashRouter>{children}</HashRouter>
  }
  return <BrowserRouter>{children}</BrowserRouter>
}

/** Exported separately so the file:// decision can be tested directly. */
export function isFileProtocol(protocol: string | undefined): boolean {
  return protocol === 'file:'
}
