import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Nothing here touches the network or the clock at import time, but a hung
    // run should fail fast rather than sit there.
    testTimeout: 5000
  }
})
