import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'
import { Config, apply } from '../src/index.js'
import { gitTimeoutMs } from '../src/adapters/git-options.js'

afterEach(() => vi.useRealTimers())
it('keeps command termination grace separate from a customized query deadline', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  let grace: number | undefined
  let finish!: (value: { exitCode: number }) => void
  const ctx = { subprocess: { spawn(spec: { signal: AbortSignal; graceMs: number }) {
    signal = spec.signal
    grace = spec.graceMs
    return { done: new Promise(resolve => { finish = resolve }), collected: {} }
  } } } as unknown as Context
  const port = createDshGitPort(ctx, { hooksPath: '/hooks', gitTimeoutMs: 40_000 })
  const pending = port.removeWorktree('/repo', '/managed')
  await vi.advanceTimersByTimeAsync(40_001)
  expect(signal?.aborted).toBe(false)
  expect(grace).toBe(1_000)
  finish({ exitCode: 0 })
  await pending
})

it('keeps ordinary, creation and removal deadlines independent', () => {
  expect(gitTimeoutMs(['status'], {})).toBe(120_000)
  expect(gitTimeoutMs(['worktree', 'add'], {})).toBe(300_000)
  expect(gitTimeoutMs(['worktree', 'remove'], {})).toBe(300_000)
  const config = { gitTimeoutMs: 45_000, worktreeAddTimeoutMs: 600_000 }
  expect(gitTimeoutMs(['status'], config)).toBe(45_000)
  expect(gitTimeoutMs(['worktree', 'add'], config)).toBe(600_000)
  expect(gitTimeoutMs(['worktree', 'remove'], config)).toBe(300_000)
  expect(Config({})).toMatchObject({ gitTimeoutMs: 120_000, worktreeAddTimeoutMs: 300_000 })
  expect(Config(config)).toMatchObject(config)
})

it.each([0, -1, NaN, Infinity, 999, 1000.5, 3_600_001, '300000'])('rejects invalid timeout %s before mounting or touching state', async value => {
  for (const key of ['gitTimeoutMs', 'worktreeAddTimeoutMs']) {
    const config = { [key]: value } as { gitTimeoutMs?: number; worktreeAddTimeoutMs?: number }
    expect(() => createDshGitPort({} as Context, { hooksPath: '/hooks', ...config })).toThrow(RangeError)
    await expect(apply({} as Context, config)).rejects.toThrow(RangeError)
  }
})
