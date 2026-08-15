#!/usr/bin/env node

import { pathToFileURL } from 'node:url'

const [workspaceRoot, cliEntry, ...args] = process.argv.slice(2)
if (!workspaceRoot || !cliEntry) {
  throw new Error('dsh-source-runner requires <workspaceRoot> <cliEntry> [...args].')
}

// pnpm resolves tsx and the Harness workspace before this point. Switch only
// the application cwd so newly created DSH Sessions use the intended fixture.
process.chdir(workspaceRoot)
process.argv = [process.execPath, cliEntry, ...args]
await import(pathToFileURL(cliEntry).href)
