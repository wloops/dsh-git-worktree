import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'
const roots: string[] = []
afterEach(async () => { vi.useRealTimers(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
it.each([true, false, 'reject', 'successful-child'] as const)('waits for the entire tree before handling a timed-out partial checkout (quiescence=%s)', async quiescence => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-create-timer-'))
  roots.push(root)
  const repo = join(root, 'repo'), target = join(root, 'target')
  await mkdir(repo)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null' }
  const git = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, env, encoding: 'utf8' })
  git(repo, ['init', '-b', 'main'])
  await writeFile(join(repo, 'one'), 'one\n'); await writeFile(join(repo, 'two'), 'two\n')
  git(repo, ['add', '.']); git(repo, ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'base'])
  const oid = git(repo, ['rev-parse', 'HEAD']).stdout.trim()
  let started!: () => void, waited!: () => void, release!: (value: boolean) => void
  const checkoutStarted = new Promise<void>(resolve => { started = resolve })
  const waitingForTree = new Promise<void>(resolve => { waited = resolve })
  let signal!: AbortSignal
  let cleanupCalls = 0, terminated = 0, treeWaits = 0
  const ctx = { subprocess: { spawn(spec: { argv: string[]; cwd: string; signal: AbortSignal }) {
    const args = spec.argv.slice(1)
    if (args.includes(quiescence === 'successful-child' ? 'read-tree' : 'checkout-index')) {
      git(spec.cwd, ['checkout-index', 'one'])
      signal = spec.signal
      const done = quiescence === 'successful-child' ? Promise.resolve({ exitCode: 0 })
        : new Promise(resolve => signal.addEventListener('abort', () => resolve({ exitCode: -1 }), { once: true }))
      started()
      return { done, terminate() { terminated++ }, waitForExit(waitSignal: AbortSignal) {
        treeWaits++
        if (quiescence === 'successful-child') {
          if (treeWaits === 1) return new Promise<boolean>(resolve => waitSignal.addEventListener('abort', () => resolve(false), { once: true }))
          waited(); return Promise.resolve(false)
        }
        waited()
        if (quiescence === 'reject') return Promise.reject(new Error('lost tree observer'))
        return new Promise<boolean>(resolve => { release = resolve })
      }, collected: {} }
    }
    if (args.includes('remove') || args.includes('move')) cleanupCalls++
    const result = git(spec.cwd, args)
    return { done: Promise.resolve({ exitCode: result.status }), terminate() {}, waitForExit: async () => true, collected: {
      stdout: { readFrom: () => ({ text: result.stdout }) }, stderr: { readFrom: () => ({ text: result.stderr }) },
    } }
  } } } as unknown as Context
  vi.useFakeTimers()
  const port = createDshGitPort(ctx, { hooksPath: join(root, 'hooks') })
  let settled = false
  const pending = port.createDetachedWorktree(repo, target, oid).catch(error => { settled = true; return error })
  await checkoutStarted
  await vi.advanceTimersByTimeAsync(30_001)
  expect(signal.aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(270_000)
  await waitingForTree
  expect(signal.aborted).toBe(true)
  expect(terminated).toBe(1)
  expect(cleanupCalls).toBe(0)
  if (typeof quiescence === 'boolean') { expect(settled).toBe(false); release(quiescence) }
  const error = await pending
  expect(error.rolledBack).toBe(quiescence === true)
  expect(existsSync(target)).toBe(quiescence !== true)
  if (quiescence !== true) expect(cleanupCalls).toBe(0)
})
