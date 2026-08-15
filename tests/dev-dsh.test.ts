import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { describe, expect, test, vi } from 'vitest'

import {
  createDefaultOptions,
  createDshLaunch,
  ensureDevFixture,
  executable,
  installLocalSnapshot,
  parseDevDshArgs,
  runProcess,
} from '../scripts/dev-dsh-lib.mjs'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

describe('local DSH development workflow', () => {
  test('Given no options When parsing the run command Then safe reusable defaults are selected', () => {
    const root = join('G:', 'plugin')
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
    const root = join('G:', 'plugin')
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
      harnessRoot: join('G:', 'DeepSeek', 'deepseek-harness'),
    })
  })

  test('Given a Harness source checkout When planning launch Then DSH keeps the fixture as process cwd', () => {
    const harnessRoot = mkdtempSync(join(tmpdir(), 'dsh-harness-source-'))
    mkdirSync(join(harnessRoot, 'apps', 'cli', 'src'), { recursive: true })
    writeFileSync(join(harnessRoot, 'package.json'), '{"private":true}')
    writeFileSync(join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts'), '')
    const launch = createDshLaunch({
      projectRoot: join('G:', 'plugin'),
      harnessRoot,
      workspaceRoot: join('C:', 'fixture'),
      profile: 'web',
      port: 4091,
    })

    expect([launch.command, ...launch.args]).toEqual([
      expect.stringContaining('pnpm'),
      '--dir', harnessRoot,
      'exec', 'node', '--import', 'tsx/esm',
      join('G:', 'plugin', 'scripts', 'dsh-source-runner.mjs'),
      join('C:', 'fixture'),
      join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts'),
      '--profile', 'web', '--port', '4091',
    ])
    expect(launch.cwd).toBe(join('G:', 'plugin'))
  })

  test('Given a platform command shim When executing it Then arguments are forwarded without a shell error', () => {
    expect(runProcess(executable('pnpm'), ['--version'], { capture: true }).stdout).toMatch(/^\d+\.\d+\.\d+/)
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
    const calls: Array<{ command: string; args: string[] }> = []
    let stagedManifest: { version?: string; scripts?: Record<string, string> } | undefined
    const runner = vi.fn((command: string, args: string[], options?: { cwd?: string }) => {
      calls.push({ command, args })
      if (command.includes('pnpm') && args[0] === 'pack') {
        stagedManifest = JSON.parse(readFileSync(join(options!.cwd!, 'package.json'), 'utf8'))
        const outIndex = args.indexOf('--out')
        writeFileSync(args[outIndex + 1]!, 'tarball')
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
})
