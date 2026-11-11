import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__test__/**/*.test.ts'],
    typecheck: {
      enabled: true,
      include: ['__test__/**/*.test-d.ts'],
    },
    coverage: {
      provider: 'v8',
      exclude: ['src/index.ts'],
    },
  },
})
