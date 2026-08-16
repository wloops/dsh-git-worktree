import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// TypeScript does not delete outputs for removed source files. Always rebuild
// the publishable tree from an empty lib/ directory so stale UI modules cannot
// survive into a tarball.
rmSync(fileURLToPath(new URL('../lib/', import.meta.url)), { recursive: true, force: true })
