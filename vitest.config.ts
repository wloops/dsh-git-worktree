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
      'virtual:dsh-official-workspace-client-alpha': fileURLToPath(
        new URL('./tests/official-workspace-client-alpha.mock.ts', import.meta.url),
      ),
      'virtual:dsh-official-workspace-client-022': fileURLToPath(new URL('./tests/official-workspace-client-022.mock.ts', import.meta.url)),
      'virtual:dsh-official-workspace-client-rc5': fileURLToPath(
        new URL('./tests/official-workspace-client-rc5.mock.ts', import.meta.url),
      ),
      'virtual:dsh-official-workspace-client-next': fileURLToPath(
        new URL('./tests/official-workspace-client-next.mock.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    // Real Git/Worktree suites compete for disk and process resources across
    // platforms. Serialize files so publish gates remain reliable on developer
    // machines as well as CI; keep all cases and their existing timeouts.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
