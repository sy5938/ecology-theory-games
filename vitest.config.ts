import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['prototype-v2/tests/**/*.test.ts'],
    environment: 'node',
  },
})
