#!/usr/bin/env node

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDefaultOptions,
  devCacheRoot,
  discoverHarnessRoot,
  installLocalSnapshot,
  parseDevDshArgs,
  removeLocalSnapshot,
  runDevelopmentWeb,
  smokeLocalSnapshot,
} from './dev-dsh-lib.mjs'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cacheRoot = devCacheRoot()
const defaults = {
  ...createDefaultOptions(projectRoot, cacheRoot, Boolean(process.env.DSH_HOME)),
  harnessRoot: discoverHarnessRoot(projectRoot),
}

function printUsage() {
  console.log(`dsh-git-worktree local development

Usage:
  pnpm run dev:dsh -- [--profile web] [--repo <git-root>] [--port 3081] [--harness <path>]
  pnpm run dev:dsh:install -- [--profile web] [--harness <path>]
  pnpm run dev:dsh:smoke -- [--profile web] [--harness <path>]
  pnpm run dev:dsh:remove -- [--profile web] [--harness <path>]

Nothing is published to npm or pushed to Git. Nearby Harness source checkouts
are scanned; use DSH_HARNESS_ROOT or --harness for a specific checkout. Install
and build that source checkout first. The source's own pnpm version is selected
automatically. Set DSH_HOME to a fresh temporary directory to isolate the web
Profile, archive, and default Workspace; this also patches the Host's Documents
root to that home. Without --repo, DSH keeps its normal Workspace selection;
no disposable repository is created or required. Prefer --harness <path> to select
one source checkout explicitly. Required CLI and declared Web client artifacts
are checked before plugin installation; missing files stop without fallback.
`)
}

try {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    process.exitCode = 0
  } else {
    const options = parseDevDshArgs(process.argv.slice(2), defaults)
    const runtime = {
      projectRoot,
      profile: options.profile,
      harnessRoot: options.harnessRoot,
    }
    if (options.mode === 'install') {
      const installed = installLocalSnapshot({
        ...runtime,
        cacheRoot,
      })
      console.log(`\nLocal snapshot installed in profile "${options.profile}".`)
      console.log(`Archive retained for profile reproducibility: ${installed.archivePath}`)
    } else if (options.mode === 'smoke') {
      smokeLocalSnapshot(runtime)
      console.log(`Profile "${options.profile}" composes dsh-git-worktree.`)
    } else if (options.mode === 'remove') {
      removeLocalSnapshot({ ...runtime, cacheRoot })
      console.log(`Removed dsh-git-worktree from profile "${options.profile}" and cleared local archives.`)
    } else {
      runDevelopmentWeb({
        ...runtime,
        ...options,
        cacheRoot,
        launchRoot: defaults.launchRoot,
        isolated: Boolean(process.env.DSH_HOME),
      })
    }
  }
} catch (error) {
  console.error(`dev:dsh failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
