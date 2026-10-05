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

  /**
   * Supabase project URL. Public by nature: it is the address of the API.
   */
  readonly VITE_SUPABASE_URL?: string

  /**
   * The publishable/anon key. Safe to ship because row-level security decides
   * what it may read; see supabase/migrations/0001_initial_schema.sql.
   *
   * Note there is deliberately no VITE_-prefixed variable for the service-role
   * key or the database password. Anything with this prefix is inlined into the
   * bundle and handed to every visitor.
   */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}