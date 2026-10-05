import { BrowserRouter, HashRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { shouldUseHashRoutes } from './lib/router'

/**
 * Picks the router for how the app is currently being served. The policy itself
 * lives in src/lib/router.ts, which explains why each target needs what it does.
 */
export function AppRouter({ children }: { children: ReactNode }) {
  if (shouldUseHashRoutes(currentProtocol(), staticBuildRequested())) {
    return <HashRouter>{children}</HashRouter>
  }
  return <BrowserRouter>{children}</BrowserRouter>
}

function currentProtocol(): string | undefined {
  return typeof location !== 'undefined' ? location.protocol : undefined
}

/**
 * Vite inlines env vars at build time, so this collapses to a constant in the
 * bundle. Comparing against '1' rather than coercing is deliberate: the value
 * arrives as a string, and a stray 'true' or '0' must not enable routing by
 * accident.
 */
function staticBuildRequested(): boolean | undefined {
  return import.meta.env.VITE_HASH_ROUTER === '1' ? true : undefined
}