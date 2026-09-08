import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // The suite asserts the Swedish email copy, so pin the locale rather than
    // letting it depend on whatever LOCALE the shell happens to carry.
    // strings.test.js sets its own per case.
    env: { LOCALE: 'sv' },
    include: ['test/**/*.test.js'],
    reporters: 'default',
    silent: false
  }
})
