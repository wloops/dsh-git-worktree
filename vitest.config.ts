import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL('./tests/support/ui-primitives.tsx', import.meta.url),
      ),
      'virtual:dsh-official-workspace-client': fileURLToPath(
        new URL('./tests/official-workspace-client.mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Heavy Git fixture suites contend for Windows process and file handles when
    // Vitest runs files concurrently, which can outlive the timeout and lock temp dirs.
    fileParallelism: process.platform !== 'win32',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
