import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Offline build for transfer to a phone.
 *
 * The normal build emits ES modules and absolute asset paths, which Android
 * refuses to load from file:// (module scripts are blocked on opaque origins).
 * This build emits one classic IIFE script with relative paths so the whole app
 * can be inlined into a single .html file that opens with no network at all.
 *
 * Routing is handled at runtime in src/AppRouter.tsx, which detects file:// and
 * switches to HashRouter, so no build-time alias is needed here.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-offline',
    cssCodeSplit: false,
    assetsInlineLimit: 4 * 1024 * 1024,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]'
      }
    }
  }
})
