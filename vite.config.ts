import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  /**
   * Relative asset URLs, so one build works at any mount point.
   *
   * Vite defaults to `/`, which assumes the site is served from the domain root.
   * GitHub Pages serves a project repo from a subdirectory
   * (`/<owner>/<repo>/`), so absolute URLs resolve to `github.io/assets/...`
   * and 404. A relative base is what lets the same output run from a domain
   * root, a subdirectory, or straight off the filesystem.
   */
  base: './',
  plugins: [react()],
  build: {
    // The display font is inlined rather than emitted as a separate file. It is
    // the only asset over the default 4KB limit, and inlining it keeps the app to
    // a single request, so a first paint on a slow connection is one round trip
    // rather than two.
    assetsInlineLimit: 128 * 1024
  }
})
