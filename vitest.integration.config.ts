import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/integration/setup.ts'],
    testTimeout: 30_000,
    fileParallelism: false,
  },
})
