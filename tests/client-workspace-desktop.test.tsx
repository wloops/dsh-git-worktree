// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { prefetchHostDesktop, useHostDesktopAvailable } from '../src/client/workspace-desktop.js'
import type { ClientWorkspaceDesktop } from '../src/client/actions.js'

function Probe({ remote, id = 'probe' }: { remote?: ClientWorkspaceDesktop; id?: string }) {
  const value = useHostDesktopAvailable(remote)
  return <span data-testid={id}>{String(value)}</span>
}
async function flush() { await act(async () => { await Promise.resolve() }) }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }
afterEach(() => { cleanup(); vi.useRealTimers() })

test.each(['remote', 'throw', 'missing'] as const)('recovers from initial %s failure without caching false', async kind => {
  vi.useFakeTimers()
  const read = vi.fn().mockResolvedValue({ ok: true, value: true })
  if (kind === 'remote') read.mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
  if (kind === 'throw') read.mockRejectedValueOnce(new Error('offline'))
  const remote: ClientWorkspaceDesktop = kind === 'missing' ? {} : { session: { canOpenWorkspacePath: read } }
  prefetchHostDesktop(remote)
  render(<Probe remote={remote} />)
  await flush()
  expect(screen.getByTestId('probe').textContent).toBe('undefined')
  if (kind === 'missing') remote.session = { canOpenWorkspacePath: read }
  await advance(1_000)
  expect(screen.getByTestId('probe').textContent).toBe('true')
  expect(read).toHaveBeenCalledTimes(kind === 'missing' ? 1 : 2)
})

test('prefetch, concurrent controls and retry share one in-flight request', async () => {
  vi.useFakeTimers()
  let resolve!: (value: { ok: true; value: boolean }) => void
  const read = vi.fn().mockResolvedValueOnce({ ok: false, error: { code: 'gateway/internal', message: 'offline' } })
    .mockImplementation(() => new Promise(done => { resolve = done }))
  const remote = { session: { canOpenWorkspacePath: read } }
  prefetchHostDesktop(remote)
  render(<><Probe remote={remote} id="a" /><Probe remote={remote} id="b" /></>)
  await flush()
  expect(read).toHaveBeenCalledTimes(1)
  await advance(1_000)
  prefetchHostDesktop(remote)
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => resolve({ ok: true, value: true }))
  expect(screen.getByTestId('a').textContent).toBe('true')
  expect(screen.getByTestId('b').textContent).toBe('true')
})

test.each([false, true])('successful %s is cached across remount and prefetch', async value => {
  vi.useFakeTimers()
  const read = vi.fn().mockResolvedValue({ ok: true, value })
  const remote = { session: { canOpenWorkspacePath: read } }
  const view = render(<Probe remote={remote} />)
  await flush()
  expect(screen.getByTestId('probe').textContent).toBe(String(value))
  view.unmount()
  prefetchHostDesktop(remote)
  render(<Probe remote={remote} />)
  await advance(100_000)
  expect(read).toHaveBeenCalledTimes(1)
})

test('offline retries stop after three attempts and cooldown prevents remount storms', async () => {
  vi.useFakeTimers()
  const read = vi.fn().mockRejectedValue(new Error('offline'))
  const remote = { session: { canOpenWorkspacePath: read } }
  const view = render(<Probe remote={remote} />)
  await flush()
  await advance(3_000)
  expect(read).toHaveBeenCalledTimes(3)
  view.unmount()
  const next = render(<Probe remote={remote} />)
  prefetchHostDesktop(remote)
  await flush()
  expect(read).toHaveBeenCalledTimes(3)
  await advance(100_000)
  expect(read).toHaveBeenCalledTimes(3)
  next.unmount()
  read.mockResolvedValue({ ok: true, value: true })
  render(<Probe remote={remote} />)
  await flush()
  expect(read).toHaveBeenCalledTimes(4)
  expect(screen.getByTestId('probe').textContent).toBe('true')
})

test('last unmount clears retry timer; a pending failure after unmount cannot schedule more', async () => {
  vi.useFakeTimers()
  const read = vi.fn().mockRejectedValue(new Error('offline'))
  const remote = { session: { canOpenWorkspacePath: read } }
  const first = render(<Probe remote={remote} />)
  const second = render(<Probe remote={remote} id="second" />)
  await flush()
  expect(vi.getTimerCount()).toBe(1)
  first.unmount()
  expect(vi.getTimerCount()).toBe(1)
  second.unmount()
  expect(vi.getTimerCount()).toBe(0)
  await advance(100_000)
  expect(read).toHaveBeenCalledTimes(1)
  let reject!: (error: Error) => void
  read.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
  const third = render(<Probe remote={remote} />)
  third.unmount()
  await act(async () => reject(new Error('offline')))
  expect(vi.getTimerCount()).toBe(0)
})

test('switching Client identity never exposes the previous capability or late answer', async () => {
  const old = { session: { canOpenWorkspacePath: vi.fn().mockResolvedValue({ ok: true, value: true }) } }
  const next = { session: { canOpenWorkspacePath: vi.fn().mockResolvedValue({ ok: true, value: false }) } }
  const view = render(<Probe remote={old} />)
  await flush()
  expect(screen.getByTestId('probe').textContent).toBe('true')
  view.rerender(<Probe remote={next} />)
  expect(screen.getByTestId('probe').textContent).toBe('undefined')
  await flush()
  expect(screen.getByTestId('probe').textContent).toBe('false')
})
