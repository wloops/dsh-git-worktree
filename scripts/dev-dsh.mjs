#!/usr/bin/env node

import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDefaultOptions,
  createDshLaunch,
  discoverHarnessRoot,
  ensureDevFixture,
  installLocalSnapshot,
  parseDevDshArgs,
  removeLocalSnapshot,
  runProcess,
  smokeLocalSnapshot,
} from './dev-dsh-lib.mjs'

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const cacheRoot = join(tmpdir(), 'dsh-git-worktree-dev')
const defaults = {
  ...createDefaultOptions(projectRoot, cacheRoot),
  harnessRoot: discoverHarnessRoot(projectRoot),
}

function printUsage() {
  console.log(`dsh-git-worktree local development

Usage:
  pnpm run dev:dsh -- [--profile web] [--repo <git-root>] [--port 3081] [--harness <path>]
  pnpm run dev:dsh:install -- [--profile web]
  pnpm run dev:dsh:smoke -- [--profile web]
  pnpm run dev:dsh:remove -- [--profile web]

The install path is a local tarball under the OS temporary directory. Nothing is
published to npm or pushed to Git. A sibling Harness source checkout is used
when available; override with DSH_HARNESS_ROOT or --harness. Without --repo, a
marker-protected disposable Git repository is created at:
  ${defaults.repo}
`)
}

try {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printUsage()
    process.exitCode = 0
  } else {
    const options = parseDevDshArgs(process.argv.slice(2), defaults)
    if (options.mode === 'install') {
      const installed = installLocalSnapshot({
        projectRoot,
        profile: options.profile,
        cacheRoot,
      })
      console.log(`\nLocal snapshot installed in profile "${options.profile}".`)
      console.log(`Archive retained for profile reproducibility: ${installed.archivePath}`)
    } else if (options.mode === 'smoke') {
      smokeLocalSnapshot({ projectRoot, profile: options.profile })
      console.log(`Profile "${options.profile}" composes dsh-git-worktree.`)
    } else if (options.mode === 'remove') {
      removeLocalSnapshot({ projectRoot, profile: options.profile, cacheRoot })
      console.log(`Removed dsh-git-worktree from profile "${options.profile}" and cleared local archives.`)
    } else {
      const installed = installLocalSnapshot({
        projectRoot,
        profile: options.profile,
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
      })
      console.log(`Starting DSH at http://127.0.0.1:${options.port}`)
      console.log(launch.source
        ? `Using Harness source checkout: ${options.harnessRoot}`
        : 'Using the installed dsh executable.')
      console.log('Press Ctrl+C to stop. No npm/GitHub publication is performed.\n')
      runProcess(launch.command, launch.args, { cwd: launch.cwd })
    }
  }
} catch (error) {
  console.error(`dev:dsh failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
