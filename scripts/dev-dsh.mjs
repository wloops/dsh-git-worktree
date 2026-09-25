#!/usr/bin/env node

import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDefaultOptions,
  createDshLaunch,
  devCacheRoot,
  discoverHarnessRoot,
  ensureDevFixture,
  installLocalSnapshot,
  parseDevDshArgs,
  prepareIsolatedWorkspacePatch,
  removeLocalSnapshot,
  runProcess,
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
root to that home. Without --repo, a marker-protected disposable Git repository
is created at:
  ${defaults.repo}
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
      const installed = installLocalSnapshot({
        ...runtime,
        cacheRoot,
      })
      const fixture = ensureDevFixture(options.repo, { explicit: options.repoExplicit })
      console.log(`\nLocal snapshot: ${installed.archivePath}`)
      console.log(`${fixture.created ? 'Created' : 'Using'} test repository: ${fixture.path}`)
      const launch = createDshLaunch({
        projectRoot,
        harnessRoot: options.harnessRoot,
        workspaceRoot: fixture.path,
        profile: options.profile,
        port: options.port,
        ...(process.env.DSH_HOME ? { isolationPatchPath: prepareIsolatedWorkspacePatch(cacheRoot) } : {}),
      })
      console.log(`Starting DSH at http://127.0.0.1:${options.port}`)
      console.log(launch.source
        ? `Using Harness source checkout: ${options.harnessRoot}`
        : 'Using the installed dsh executable.')
      if (process.env.DSH_HOME) console.log(`Isolated default Workspace patch: ${launch.args[launch.args.indexOf('--patch') + 1]}`)
      console.log('Press Ctrl+C to stop. No npm/GitHub publication is performed.\n')
      runProcess(launch.command, launch.args, { cwd: launch.cwd })
    }
  }
} catch (error) {
  console.error(`dev:dsh failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
