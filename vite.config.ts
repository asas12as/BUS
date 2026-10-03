import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The display font is inlined rather than emitted as a separate file. It is
    // the only asset over the default 4KB limit, and inlining it keeps the app
    // to a single request while matching what the offline build already does.
    assetsInlineLimit: 128 * 1024
  }
})
