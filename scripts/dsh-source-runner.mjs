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
const cli = await import(pathToFileURL(cliEntry).href)
// Recent Harness CLIs guard their entry with import.meta.main; importing the
// module from this cwd-preserving runner does not make it the Node main module.
if (typeof cli.runCli !== 'function') {
  throw new Error('Harness source CLI must export runCli() for the development runner.')
}
await cli.runCli()
