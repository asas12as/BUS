/// <reference types="vite/client" />

/**
 * Declared explicitly rather than left to a loose index signature, so a typo in
 * a `VITE_` name fails the build instead of silently evaluating to undefined.
 */
interface ImportMetaEnv {
  /**
   * Set to '1' when publishing to a static host that cannot rewrite URLs, such
   * as GitHub Pages. See src/AppRouter.tsx for what it changes.
   */
  readonly VITE_HASH_ROUTER?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}