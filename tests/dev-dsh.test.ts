import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'

import {
  createDefaultOptions,
  createDshLaunch,
  discoverHarnessRoot,
  ensureDevFixture,
  executable,
  installLocalSnapshot,
  parseDevDshArgs,
  removeLocalSnapshot,
  runProcess,
  smokeLocalSnapshot,
} from '../scripts/dev-dsh-lib.mjs'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function createHarnessRoot(root: string, options: { ready?: boolean } = {}): string {
  mkdirSync(join(root, 'apps', 'cli', 'src'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"private":true}')
  writeFileSync(join(root, 'apps', 'cli', 'src', 'bin.ts'), '')
  if (options.ready !== false) {
    mkdirSync(join(root, 'node_modules', 'tsx'), { recursive: true })
    writeFileSync(join(root, 'node_modules', 'tsx', 'package.json'), '{"name":"tsx"}')
  }
  return root
}

function sourceDshArgs(args: string[]): string[] | undefined {
  const cliIndex = args.findIndex(value => value.replaceAll('\\', '/').endsWith('/apps/cli/src/bin.ts'))
  return cliIndex === -1 ? undefined : args.slice(cliIndex + 1)
}

describe('local DSH development workflow', () => {
  test('Given no options When parsing the run command Then safe reusable defaults are selected', () => {
    const root = join(tmpdir(), 'dsh-plugin-root')
    const defaults = createDefaultOptions(root, join(tmpdir(), 'dsh-git-worktree-dev'))

    expect(parseDevDshArgs(['run'], defaults)).toEqual({
      mode: 'run',
      profile: 'web',
      port: 3081,
      repo: join(tmpdir(), 'dsh-git-worktree-dev', 'fixture'),
      repoExplicit: false,
    })
  })

  test('Given explicit development options When parsing Then profile, repository and port are preserved', () => {
    const root = join(tmpdir(), 'dsh-plugin-root')
    const defaults = createDefaultOptions(root, join(tmpdir(), 'dsh-git-worktree-dev'))

    expect(parseDevDshArgs([
      'install',
      '--',
      '--profile', 'worktree-web',
      '--repo', './sample-repo',
      '--port=4090',
      '--harness', '../DeepSeek/deepseek-harness',
    ], defaults)).toEqual({
      mode: 'install',
      profile: 'worktree-web',
      port: 4090,
      repo: join(root, 'sample-repo'),
      repoExplicit: true,
      harnessRoot: join(tmpdir(), 'DeepSeek', 'deepseek-harness'),
    })
  })

  test('Given a Harness source checkout When planning launch Then DSH keeps the fixture as process cwd', () => {
    const harnessRoot = createHarnessRoot(mkdtempSync(join(tmpdir(), 'dsh harness 源码-')))
    const projectRoot = join(tmpdir(), 'dsh-plugin-root')
    const workspaceRoot = join(tmpdir(), 'dsh-fixture')
    const launch = createDshLaunch({
      projectRoot,
      harnessRoot,
      workspaceRoot,
      profile: 'web',
      port: 4091,
    })

    expect([launch.command, ...launch.args]).toEqual([
      expect.stringContaining('pnpm'),
      '--dir', harnessRoot,
      'exec', 'node', '--import', 'tsx/esm',
      join(projectRoot, 'scripts', 'dsh-source-runner.mjs'),
      workspaceRoot,
      join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts'),
      '--profile', 'web', '--port', '4091',
    ])
    expect(launch.cwd).toBe(projectRoot)
  })

  test('Given a platform command shim When executing it Then arguments are forwarded without a shell error', () => {
    expect(runProcess(executable('pnpm'), ['--version'], { capture: true }).stdout).toMatch(/^\d+\.\d+\.\d+/)
  })

  test('Given a nearer unprepared Harness and an upper ready Harness When discovery runs from Local or a linked Worktree Then the ready checkout wins', () => {
    const layoutRoot = mkdtempSync(join(tmpdir(), 'dsh-harness-discovery-'))
    const projectParent = join(layoutRoot, 'my')
    const localProjectRoot = join(projectParent, 'dsh-git-worktree')
    mkdirSync(localProjectRoot, { recursive: true })
    git(localProjectRoot, ['init'])
    writeFileSync(join(localProjectRoot, 'tracked.txt'), 'base\n')
    git(localProjectRoot, ['add', 'tracked.txt'])
    git(localProjectRoot, ['-c', 'user.name=DSH Test', '-c', 'user.email=dsh-test@example.local', 'commit', '-m', 'test: base'])
    createHarnessRoot(join(projectParent, 'deepseek-harness'), { ready: false })
    const readyHarnessRoot = createHarnessRoot(join(layoutRoot, 'deepseek-harness'))
    const linkedRoot = join(projectParent, 'managed-worktrees', 'task')
    mkdirSync(join(projectParent, 'managed-worktrees'))
    git(localProjectRoot, ['worktree', 'add', '--detach', linkedRoot])

    expect(discoverHarnessRoot(localProjectRoot, {})).toBe(readyHarnessRoot)
    expect(discoverHarnessRoot(linkedRoot, {})).toBe(readyHarnessRoot)
  })

  test('Given DSH_HARNESS_ROOT points anywhere When discovery runs Then the explicit source checkout wins', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'dsh-plugin-location-'))
    const harnessRoot = createHarnessRoot(join(mkdtempSync(join(tmpdir(), 'arbitrary-parent-')), 'Harness 源码'))

    expect(discoverHarnessRoot(projectRoot, { DSH_HARNESS_ROOT: harnessRoot })).toBe(harnessRoot)
  })

  test('Given an explicit unprepared Harness When installing Then the workflow fails before building with an actionable command', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-unprepared-source-'))
    const harnessRoot = createHarnessRoot(join(root, 'deepseek-harness'), { ready: false })
    const cacheRoot = join(root, 'cache')
    const run = vi.fn(() => ({ stdout: '' }))

    expect(() => installLocalSnapshot({
      projectRoot: join(root, 'plugin'), harnessRoot, profile: 'web', cacheRoot, run,
    })).toThrow(`pnpm --dir "${harnessRoot}" install`)
    expect(run).not.toHaveBeenCalled()
    expect(existsSync(cacheRoot)).toBe(false)
  })

  test('Given an invalid port or unknown option When parsing Then the workflow fails before executing commands', () => {
    const defaults = createDefaultOptions(process.cwd(), join(tmpdir(), 'dsh-git-worktree-dev'))

    expect(() => parseDevDshArgs(['run', '--port', '70000'], defaults)).toThrow('port')
    expect(() => parseDevDshArgs(['run', '--publish'], defaults)).toThrow('Unknown option')
  })

  test('Given the managed fixture does not exist When preparing it Then a clean committed Git repository is created', () => {
    const parent = mkdtempSync(join(tmpdir(), 'dsh-dev-fixture-test-'))
    const fixture = join(parent, 'fixture')

    const result = ensureDevFixture(fixture, { explicit: false })

    expect(result.created).toBe(true)
    expect(git(fixture, ['status', '--porcelain'])).toBe('')
    expect(git(fixture, ['rev-parse', '--show-toplevel']).replaceAll('\\', '/').toLowerCase())
      .toBe(fixture.replaceAll('\\', '/').toLowerCase())
    expect(readFileSync(join(fixture, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(existsSync(join(fixture, '.dsh-git-worktree-fixture.json'))).toBe(true)
  })

  test('Given an unexpected non-empty default fixture path When preparing it Then existing bytes are preserved and initialization fails closed', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dsh-dev-fixture-occupied-'))
    const sentinel = join(fixture, 'important.txt')
    writeFileSync(sentinel, 'keep me')

    expect(() => ensureDevFixture(fixture, { explicit: false })).toThrow('not managed')
    expect(readFileSync(sentinel, 'utf8')).toBe('keep me')
    expect(existsSync(join(fixture, '.git'))).toBe(false)
  })

  test('Given an explicit repository When preparing it Then it is validated but never initialized or rewritten', () => {
    const repo = mkdtempSync(join(tmpdir(), 'dsh-dev-explicit-repo-'))
    git(repo, ['init'])
    writeFileSync(join(repo, 'keep.txt'), 'unchanged')

    const result = ensureDevFixture(repo, { explicit: true })

    expect(result.created).toBe(false)
    expect(readFileSync(join(repo, 'keep.txt'), 'utf8')).toBe('unchanged')
    expect(existsSync(join(repo, '.dsh-git-worktree-fixture.json'))).toBe(false)
  })

  test('Given a local snapshot install When it runs Then only local build, pack, profile add and config smoke commands execute', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dev-install-root-'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'dsh-git-worktree',
      version: '0.1.2',
      scripts: { prepare: 'pnpm run build' },
      files: ['lib', 'cordis.patch.yml'],
    }))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib', 'index.js'), 'export {}')
    writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
    const cacheRoot = join(root, 'cache')
    const profileManifestPath = join(root, 'profile', 'package.json')
    mkdirSync(join(root, 'profile'))
    writeFileSync(profileManifestPath, JSON.stringify({ dependencies: {} }))
    const calls: Array<{ command: string; args: string[] }> = []
    let stagedManifest: { version?: string; scripts?: Record<string, string> } | undefined
    const runner = vi.fn((command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ command, args })
      if (command.includes('pnpm') && args[0] === 'pack') {
        stagedManifest = JSON.parse(readFileSync(join(options!.cwd!, 'package.json'), 'utf8'))
        const outIndex = args.indexOf('--out')
        writeFileSync(args[outIndex + 1]!, 'tarball')
      }
      if (command.includes('dsh') && args[0] === 'plugin' && args.includes('add')) {
        writeFileSync(profileManifestPath, JSON.stringify({
          dependencies: { 'dsh-git-worktree': `file:${args.at(-1)}` },
        }))
      }
      if (command.includes('dsh') && args.includes('--dump-config')) {
        return { stdout: '# == dsh-git-worktree\n- id: dsh-git-worktree\n' }
      }
      return { stdout: '' }
    })

    const result = installLocalSnapshot({
      projectRoot: root,
      profile: 'web',
      cacheRoot,
      now: () => 1234,
      profileManifestPath,
      run: runner,
    })

    expect(result.archivePath).toBe(join(cacheRoot, 'dsh-git-worktree-1234.tgz'))
    expect(stagedManifest).toMatchObject({ version: '0.1.2-dev.1234' })
    expect(stagedManifest?.scripts).toEqual({})
    expect(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version).toBe('0.1.2')
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      [expect.stringContaining('pnpm'), 'run', 'typecheck'],
      [expect.stringContaining('pnpm'), 'run', 'build'],
      [expect.stringContaining('pnpm'), 'pack', '--out', result.archivePath, '--json'],
      [expect.stringContaining('dsh'), 'plugin', '--profile', 'web', 'add', result.archivePath],
      [expect.stringContaining('dsh'), '--profile', 'web', '--dump-config'],
    ])
    expect(calls.flatMap(({ args }) => args)).not.toContain('publish')
  })

  test('Given a Harness source checkout When installing, smoking and removing Then every DSH command uses the source CLI', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dev-source-cli-'))
    const harnessRoot = createHarnessRoot(join(root, 'Harness 源码'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib', 'index.js'), 'export {}')
    writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'dsh-git-worktree', version: '0.1.2', scripts: {}, files: ['lib', 'cordis.patch.yml'],
    }))
    const cacheRoot = join(root, 'cache')
    const profileManifestPath = join(root, 'profile', 'package.json')
    mkdirSync(join(root, 'profile'))
    writeFileSync(profileManifestPath, JSON.stringify({ dependencies: {} }))
    const calls: Array<{ command: string; args: string[] }> = []
    const runner = (command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ command, args })
      if (command.includes('pnpm') && args[0] === 'pack') {
        writeFileSync(args[args.indexOf('--out') + 1]!, 'tarball')
      }
      const dshArgs = sourceDshArgs(args)
      if (dshArgs?.[0] === 'plugin' && dshArgs.includes('add')) {
        writeFileSync(profileManifestPath, JSON.stringify({
          dependencies: { 'dsh-git-worktree': `file:${dshArgs.at(-1)}` },
        }))
      }
      if (dshArgs?.includes('--dump-config')) return { stdout: '# == dsh-git-worktree\n' }
      return { stdout: '' }
    }

    installLocalSnapshot({
      projectRoot: root, harnessRoot, profile: 'web', cacheRoot, now: () => 1234,
      profileManifestPath, run: runner,
    })
    smokeLocalSnapshot({ projectRoot: root, harnessRoot, profile: 'web', run: runner })
    removeLocalSnapshot({ projectRoot: root, harnessRoot, profile: 'web', cacheRoot, run: runner })

    const sourceCalls = calls
      .map(call => ({ ...call, dshArgs: sourceDshArgs(call.args) }))
      .filter(call => call.dshArgs !== undefined)
    expect(sourceCalls.map(call => call.dshArgs)).toEqual([
      ['plugin', '--profile', 'web', 'add', join(cacheRoot, 'dsh-git-worktree-1234.tgz')],
      ['--profile', 'web', '--dump-config'],
      ['--profile', 'web', '--dump-config'],
      ['plugin', '--profile', 'web', 'remove', 'dsh-git-worktree'],
    ])
    expect(sourceCalls.every(call => call.command.includes('pnpm'))).toBe(true)
    expect(sourceCalls.every(call => call.args.slice(0, 2).join('|') === `--dir|${harnessRoot}`)).toBe(true)
    expect(calls.some(call => call.command.replaceAll('\\', '/').endsWith('/dsh.cmd'))).toBe(false)
  })

  test('Given another profile references an older local archive When installing a new snapshot Then that profile archive is preserved', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dev-multi-profile-'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib', 'index.js'), 'export {}')
    writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'dsh-git-worktree', version: '0.1.2', scripts: {}, files: ['lib', 'cordis.patch.yml'],
    }))
    const cacheRoot = join(root, 'cache')
    mkdirSync(cacheRoot)
    const dshHome = join(root, '.dsh')
    const webProfile = join(dshHome, 'profiles', 'web', 'package.json')
    const otherProfile = join(dshHome, 'profiles', 'other', 'package.json')
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
    mkdirSync(join(dshHome, 'profiles', 'other'), { recursive: true })
    const oldWebArchive = join(cacheRoot, 'dsh-git-worktree-1000.tgz')
    const otherArchive = join(cacheRoot, 'dsh-git-worktree-1100.tgz')
    writeFileSync(oldWebArchive, 'old-web')
    writeFileSync(otherArchive, 'other-profile')
    writeFileSync(webProfile, JSON.stringify({ dependencies: { 'dsh-git-worktree': `file:${oldWebArchive}` } }))
    writeFileSync(otherProfile, JSON.stringify({ dependencies: { 'dsh-git-worktree': `file:${otherArchive}` } }))
    const runner = (command: string, args: string[], options?: { cwd?: string }) => {
      if (command.includes('pnpm') && args[0] === 'pack') {
        writeFileSync(args[args.indexOf('--out') + 1]!, 'new')
      }
      if (command.includes('dsh') && args[0] === 'plugin') {
        writeFileSync(webProfile, JSON.stringify({ dependencies: { 'dsh-git-worktree': `file:${args.at(-1)}` } }))
      }
      if (command.includes('dsh') && args.includes('--dump-config')) return { stdout: '# == dsh-git-worktree\n' }
      return { stdout: '' }
    }

    installLocalSnapshot({
      projectRoot: root,
      profile: 'web',
      cacheRoot,
      now: () => 2000,
      environment: { DSH_HOME: dshHome },
      run: runner,
    })

    expect(existsSync(otherArchive)).toBe(true)
    expect(existsSync(oldWebArchive)).toBe(false)
    expect(existsSync(join(cacheRoot, 'dsh-git-worktree-2000.tgz'))).toBe(true)
  })

  test('Given the current profile references a missing managed archive When installing Then the workflow repairs the prerequisite and advances safely', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dev-missing-profile-archive-'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib', 'index.js'), 'export {}')
    writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'dsh-git-worktree', version: '0.1.2', scripts: {}, files: ['lib', 'cordis.patch.yml'],
    }))
    const cacheRoot = join(root, 'cache')
    mkdirSync(cacheRoot)
    const dshHome = join(root, '.dsh')
    const profileManifestPath = join(dshHome, 'profiles', 'web', 'package.json')
    mkdirSync(join(dshHome, 'profiles', 'web'), { recursive: true })
    const missingArchive = join(cacheRoot, 'dsh-git-worktree-1000.tgz')
    writeFileSync(profileManifestPath, JSON.stringify({
      dependencies: { 'dsh-git-worktree': `file:${missingArchive}` },
    }))
    const runner = (command: string, args: string[]) => {
      if (command.includes('pnpm') && args[0] === 'pack') {
        writeFileSync(args[args.indexOf('--out') + 1]!, 'new')
      }
      if (command.includes('dsh') && args[0] === 'plugin') {
        expect(readFileSync(missingArchive, 'utf8')).toBe('new')
        writeFileSync(profileManifestPath, JSON.stringify({
          dependencies: { 'dsh-git-worktree': `file:${args.at(-1)}` },
        }))
      }
      if (command.includes('dsh') && args.includes('--dump-config')) return { stdout: '# == dsh-git-worktree\n' }
      return { stdout: '' }
    }

    const result = installLocalSnapshot({
      projectRoot: root,
      profile: 'web',
      cacheRoot,
      now: () => 2000,
      environment: { DSH_HOME: dshHome },
      run: runner,
    })

    expect(result.archivePath).toBe(join(cacheRoot, 'dsh-git-worktree-2000.tgz'))
    expect(existsSync(missingArchive)).toBe(false)
    expect(existsSync(result.archivePath)).toBe(true)
  })

  test('Given profile installation keeps referencing the previous archive When a new add returns Then old and new snapshots are preserved and the workflow fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-dev-stale-profile-'))
    mkdirSync(join(root, 'node_modules'))
    mkdirSync(join(root, 'lib'))
    writeFileSync(join(root, 'lib', 'index.js'), 'export {}')
    writeFileSync(join(root, 'cordis.patch.yml'), '[]\n')
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      name: 'dsh-git-worktree', version: '0.1.2', scripts: {}, files: ['lib', 'cordis.patch.yml'],
    }))
    const cacheRoot = join(root, 'cache')
    mkdirSync(cacheRoot)
    const oldArchive = join(cacheRoot, 'dsh-git-worktree-1000.tgz')
    writeFileSync(oldArchive, 'old')
    const profileManifestPath = join(root, 'profile-package.json')
    writeFileSync(profileManifestPath, JSON.stringify({
      dependencies: { 'dsh-git-worktree': `file:${oldArchive}` },
    }))
    const runner = (command: string, args: string[]) => {
      if (command.includes('pnpm') && args[0] === 'pack') {
        writeFileSync(args[args.indexOf('--out') + 1]!, 'new')
      }
      if (command.includes('dsh') && args.includes('--dump-config')) {
        return { stdout: '# == dsh-git-worktree\n' }
      }
      return { stdout: '' }
    }

    expect(() => installLocalSnapshot({
      projectRoot: root,
      profile: 'web',
      cacheRoot,
      now: () => 2000,
      profileManifestPath,
      run: runner,
    })).toThrow('still references')
    expect(existsSync(oldArchive)).toBe(true)
    expect(existsSync(join(cacheRoot, 'dsh-git-worktree-2000.tgz'))).toBe(true)
  })
})
