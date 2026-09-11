import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, readFile, rename, realpath } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'

const roots: string[] = []
function testEnvironment(overrides: Record<string, string | undefined> = {}) {
  const env = { ...process.env, ...overrides, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  for (const key of Object.keys(env)) {
    if (env[key] === undefined || /^GIT_(AUTHOR_|COMMITTER_|DIR$|WORK_TREE$|INDEX_FILE$)/.test(key)) delete env[key]
  }
  return env
}
function git(cwd: string, args: string[], input?: string) {
  return spawnSync('git', args, { cwd, input, encoding: 'utf8', env: testEnvironment() })
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-unborn-'))
  roots.push(root)
  const repo = join(root, 'repo')
  await mkdir(repo)
  git(repo, ['init', '-b', 'main'])
  const hooks: { beforeCommand?: (args: string[]) => void } = {}
  const ctx = { subprocess: { spawn(options: { argv: string[]; cwd: string; stdio: { stdin: string }; env?: Record<string, string | undefined> }) {
    hooks.beforeCommand?.(options.argv)
    const child = spawn('git', options.argv.slice(1), { cwd: options.cwd,
      env: testEnvironment(options.env),
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', data => { stdout += data })
    child.stderr.on('data', data => { stderr += data })
    if (options.stdio.stdin !== 'pipe') child.stdin.end()
    return { done: new Promise(resolve => child.on('close', exitCode => resolve({ exitCode }))), stdin: child.stdin, collected: {
      stdout: { readFrom: () => ({ text: stdout }) },
      stderr: { readFrom: () => ({ text: stderr }) },
    } }
  } } } as unknown as Context
  return { root, repo, hooks, port: createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') }) }
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('reads fresh Git identity paths together for subdirectories and detached worktrees', async () => {
  const { root, repo, hooks, port } = await fixture()
  git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'base'])
  const managed = join(root, '工作 tree')
  expect(git(repo, ['worktree', 'add', '--detach', managed, 'HEAD']).status).toBe(0)
  const nested = join(managed, '子 directory')
  await mkdir(nested)
  const calls: string[][] = []
  hooks.beforeCommand = args => { calls.push(args) }
  const snapshot = await port.inspect(nested)
  expect(snapshot).toMatchObject({ root: await realpath(managed), commonDir: await realpath(join(repo, '.git')), branch: null, headRef: 'HEAD' })
  expect(snapshot?.gitDir).not.toBe(snapshot?.commonDir)
  expect(calls.filter(args => args.includes('--git-common-dir'))).toHaveLength(1)
  expect(calls.find(args => args.includes('--git-common-dir'))).toContain('--absolute-git-dir')
  calls.length = 0
  await port.inspect(nested)
  expect(calls.some(args => args.includes('--git-common-dir'))).toBe(true)
})

it.skipIf(process.platform === 'win32')('falls back to single identity reads for a repository path containing a newline', async () => {
  const { root, hooks, port } = await fixture()
  const repo = join(root, 'line\nbreak')
  await mkdir(repo)
  expect(git(repo, ['init', '-b', 'main']).status).toBe(0)
  const calls: string[][] = []
  hooks.beforeCommand = args => { calls.push(args) }
  expect(await port.inspect(repo)).toMatchObject({ root: await realpath(repo), commonDir: await realpath(join(repo, '.git')), gitDir: await realpath(join(repo, '.git')) })
  expect(calls.filter(args => args.includes('--git-common-dir'))).toHaveLength(2)
})

describe('production Git adapter: unborn repositories', () => {
  it('recognizes git init without requiring HEAD or writing a commit', async () => {
    const { repo, port } = await fixture()
    expect(await port.inspect(repo)).toMatchObject({ headOid: 'unborn', headRef: 'refs/heads/main' })
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
  })
  it('only initializes an explicitly revalidated empty snapshot, then creates a worktree', async () => {
    const { root, repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const before = await port.preflightInitialCommit!(repo)
    expect(before.kind).toBe('empty')
    const oid = await port.initializeEmptyRepository!(repo, before.fingerprint)
    expect(git(repo, ['ls-tree', '-r', oid]).stdout).toBe('')
    await port.createDetachedWorktree(repo, join(root, 'worktree'), oid)
    expect(git(join(root, 'worktree'), ['rev-parse', 'HEAD']).stdout.trim()).toBe(oid)
  })

  it.each(['untracked', 'staged', 'ignored', 'staged-but-deleted'])('protects %s files and the index without a commit', async kind => {
    const { repo, port } = await fixture()
    await writeFile(join(repo, 'project.txt'), 'keep exactly')
    if (kind.startsWith('staged')) git(repo, ['add', 'project.txt'])
    if (kind === 'staged-but-deleted') await rm(join(repo, 'project.txt'))
    if (kind === 'ignored') await writeFile(join(repo, '.git', 'info', 'exclude'), 'project.txt')
    const indexBefore = await readFile(join(repo, '.git', 'index')).catch(() => null)
    const state = await port.preflightInitialCommit!(repo)
    expect(state.kind).toBe('files')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(await readFile(join(repo, '.git', 'index')).catch(() => null)).toEqual(indexBefore)
    if (kind !== 'staged-but-deleted') expect(await readFile(join(repo, 'project.txt'), 'utf8')).toBe('keep exactly')
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
  })
  it('reports missing identity and allows a fresh confirmed retry after user configuration', async () => {
    const { repo, port } = await fixture()
    const state = await port.preflightInitialCommit!(repo)
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toThrow(/user.name/)
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const retry = await port.preflightInitialCommit!(repo)
    await port.initializeEmptyRepository!(repo, retry.fingerprint)
    expect(git(repo, ['show', '-s', '--format=%an <%ae>']).stdout.trim()).toBe('Test User <test@example.test>')
    expect((await port.preflightInitialCommit!(repo)).kind).toBe('ready')
  })
  it('rejects files arriving after confirmation and files arriving under the prepared ref lock', async () => {
    const { repo, port, hooks } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    await writeFile(join(repo, 'late.txt'), 'keep')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    await rm(join(repo, 'late.txt'))
    const retry = await port.preflightInitialCommit!(repo)
    hooks.beforeCommand = args => {
      if (args.includes('update-ref')) writeFileSync(join(repo, 'late.txt'), 'keep')
    }
    await expect(port.initializeEmptyRepository!(repo, retry.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    expect(await readFile(join(repo, 'late.txt'), 'utf8')).toBe('keep')
  })
  it('rejects changed repository identity even at the same path', async () => {
    const { root, repo, port } = await fixture()
    const state = await port.preflightInitialCommit!(repo)
    await rename(repo, join(root, 'old'))
    await mkdir(repo)
    git(repo, ['init', '-b', 'main'])
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
  })
  it('serializes competing initializations and preserves a racing existing commit', async () => {
    const { repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    const outcomes = await Promise.allSettled([
      port.initializeEmptyRepository!(repo, state.fingerprint),
      port.initializeEmptyRepository!(repo, state.fingerprint),
    ])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(git(repo, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1')
    const head = git(repo, ['rev-parse', 'HEAD']).stdout
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['rev-parse', 'HEAD']).stdout).toBe(head)
  })
  it('distinguishes non-Git folders and broken refs from an unborn repository', async () => {
    const { root, repo, port } = await fixture()
    expect(await port.inspect(root)).toBeNull()
    await mkdir(join(repo, '.git', 'refs', 'heads'), { recursive: true })
    await writeFile(join(repo, '.git', 'refs', 'heads', 'main'), 'f'.repeat(40))
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })

  it('runs the real host/module flow: cancellation is read-only, normal creation cannot initialize, confirmed creation succeeds', async () => {
    const { root, repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const dependencies = createNodeSessionCheckoutDependencies({ configDir: join(root, 'config'), lookup: {
      getSession: id => id === 'source' ? { id, projectId: 'project' } : undefined,
      getProject: id => id === 'project' ? { id, name: 'Project', root: repo } : undefined,
      getUnboundTargetPolicy: () => 'unselected',
    } })
    dependencies.git = port
    const module = createSessionCheckoutModule(dependencies)
    const control = createWorktreeConsoleControlPlane({ module, ...dependencies, createTargetSessionId: () => 'target' })
    expect(await control.current('source')).toMatchObject({ ok: true, value: { target: { state: 'local', capabilities: { create: true } } } })
    const proof = await control.preflightCreate('source')
    if (!proof.ok || proof.value.kind !== 'empty') throw new Error('expected empty confirmation')
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    expect(await control.create('source')).toMatchObject({ ok: false, error: { code: 'operation_not_allowed' } })
    expect(git(repo, ['rev-parse', '--verify', 'HEAD']).status).not.toBe(0)
    const created = await control.createWithInitialCommit('source', proof.value.confirmationToken)
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error.message)
    expect(git(created.value.managedRoot, ['rev-parse', 'HEAD']).stdout).toBe(git(repo, ['rev-parse', 'HEAD']).stdout)
    expect(git(repo, ['ls-files', '--stage']).stdout).toBe('')
    expect(git(repo, ['ls-tree', '-r', 'HEAD']).stdout).toBe('')
    expect(await control.preflightCreate('source')).toEqual({ ok: true, value: { kind: 'ready' } })
  })

  it('rejects invalid Git metadata rather than presenting it as an empty or non-Git directory', async () => {
    const { repo, port } = await fixture()
    await writeFile(join(repo, '.git', 'HEAD'), 'not-a-valid-head')
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })
  it('aborts prepared publication if HEAD or host authorization changes', async () => {
    const { repo, port, hooks } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    hooks.beforeCommand = args => {
      if (args.includes('update-ref')) git(repo, ['symbolic-ref', 'HEAD', 'refs/heads/other'])
    }
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'stale_local' })
    expect(git(repo, ['show-ref']).stdout).toBe('')
    hooks.beforeCommand = undefined
    const retry = await port.preflightInitialCommit!(repo)
    let checks = 0
    await expect(port.initializeEmptyRepository!(repo, retry.fingerprint, async () => {
      checks++
      if (checks === 2) throw new Error('authorization changed')
    })).rejects.toThrow()
    expect(checks).toBe(2)
    expect(git(repo, ['show-ref']).stdout).toBe('')
  })
  it('keeps an external index lock intact and permits a later retry', async () => {
    const { repo, port } = await fixture()
    git(repo, ['config', 'user.name', 'Test User'])
    git(repo, ['config', 'user.email', 'test@example.test'])
    const state = await port.preflightInitialCommit!(repo)
    await writeFile(join(repo, '.git', 'index.lock'), 'owned by another process')
    await expect(port.initializeEmptyRepository!(repo, state.fingerprint)).rejects.toMatchObject({ code: 'operation_not_allowed' })
    expect(await readFile(join(repo, '.git', 'index.lock'), 'utf8')).toBe('owned by another process')
    await rm(join(repo, '.git', 'index.lock'))
    const retry = await port.preflightInitialCommit!(repo)
    await port.initializeEmptyRepository!(repo, retry.fingerprint)
    expect(git(repo, ['rev-list', '--count', 'HEAD']).stdout.trim()).toBe('1')
  })

  it('does not classify permission failures as non-Git or unborn', async () => {
    const { repo } = await fixture()
    const ctx = { subprocess: { spawn() { return {
      done: Promise.resolve({ exitCode: 128 }),
      collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'fatal: unable to access .git/config: Permission denied' }) } },
    } } } } as unknown as Context
    const port = createDshGitPort(ctx, { hooksPath: join(repo, '.git', 'no-hooks') })
    await expect(port.inspect(repo)).rejects.toMatchObject({ code: 'git_operation_failed' })
  })

})
