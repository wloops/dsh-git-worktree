// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { subscribeCurrent } from '../src/client/target-console/current-polling.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../src/client/review-console/status-events.js'

const stops: Array<() => void> = []
afterEach(() => { for (const stop of stops.splice(0)) stop(); vi.useRealTimers() })
function fixture() {
  vi.useFakeTimers()
  const base = createWorktreeConsoleAdapterFixture()
  type Outcome = Awaited<ReturnType<typeof base.adapter.current>>
  const requests: Array<{ resolve(value: Outcome): void; reject(error: unknown): void }> = []
  const current = vi.fn(() => new Promise<Outcome>((resolve, reject) => requests.push({ resolve, reject })))
  const adapter = { ...base.adapter, current }
  const watch = (listener = vi.fn(), session = 'one', language: 'en' | 'zh' = 'en') => {
    const stop = subscribeCurrent(adapter, session, language, listener)
    stops.push(stop)
    return { stop, listener }
  }
  const value = { ok: true as const, value: { target: base.target } }
  return { requests, current, adapter, watch, value }
}
async function settle() { await Promise.resolve(); await Promise.resolve() }
function refresh(sessionId = 'one') {
  window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId } }))
}

test('shares results and waits five seconds after completion, not request start', async () => {
  const f = fixture(); const a = f.watch(); const b = f.watch()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(f.current).toHaveBeenCalledTimes(1)
  f.requests[0]!.resolve(f.value); await settle()
  expect(a.listener).toHaveBeenCalledTimes(1); expect(b.listener).toHaveBeenCalledTimes(1)
  const late = f.watch(); expect(late.listener).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(4999); expect(f.current).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1); expect(f.current).toHaveBeenCalledTimes(2)
})

test('coalesces refresh bursts and discards pre-invalidation responses', async () => {
  const f = fixture(); const a = f.watch()
  for (let i = 0; i < 20; i++) refresh()
  expect(f.current).toHaveBeenCalledTimes(1)
  f.requests[0]!.resolve(f.value); await settle()
  expect(a.listener).not.toHaveBeenCalled(); expect(f.current).toHaveBeenCalledTimes(2)
  f.requests[1]!.resolve(f.value); await settle()
  expect(a.listener).toHaveBeenCalledTimes(1)
  refresh('other'); expect(f.current).toHaveBeenCalledTimes(2)
})

test('unmount/remount waits for abandoned request and never delivers it to the new mount', async () => {
  const f = fixture(); const a = f.watch(); a.stop()
  const b = f.watch()
  expect(f.current).toHaveBeenCalledTimes(1)
  f.requests[0]!.resolve(f.value); await settle()
  expect(a.listener).not.toHaveBeenCalled(); expect(b.listener).not.toHaveBeenCalled()
  expect(f.current).toHaveBeenCalledTimes(2)
  f.requests[1]!.resolve(f.value); await settle()
  expect(b.listener).toHaveBeenCalledTimes(1)
})

test('last unsubscribe stops timers and releases settled state', async () => {
  const f = fixture(); const a = f.watch(); const b = f.watch()
  a.stop(); f.requests[0]!.resolve(f.value); await settle()
  expect(b.listener).toHaveBeenCalledTimes(1)
  b.stop(); await vi.advanceTimersByTimeAsync(30_000); refresh()
  expect(f.current).toHaveBeenCalledTimes(1)
  const c = f.watch(); expect(f.current).toHaveBeenCalledTimes(2)
  expect(c.listener).not.toHaveBeenCalled()
})

test('transport failure is published and polling recovers', async () => {
  const f = fixture(); const a = f.watch()
  const error = new Error('offline')
  f.requests[0]!.reject(error); await settle()
  expect(a.listener).toHaveBeenLastCalledWith({ error })
  await vi.advanceTimersByTimeAsync(5000)
  f.requests[1]!.resolve(f.value); await settle()
  expect(a.listener).toHaveBeenLastCalledWith({ outcome: f.value })
})

test('domain errors remain outcomes and recover on explicit refresh', async () => {
  const f = fixture(); const a = f.watch()
  const outcome = { ok: false as const, error: { code: 'not_git_repository' as const, message: 'not a repository' } }
  f.requests[0]!.resolve(outcome); await settle()
  expect(a.listener).toHaveBeenLastCalledWith({ outcome })
  refresh(); expect(f.current).toHaveBeenCalledTimes(2)
  f.requests[1]!.resolve(f.value); await settle()
  expect(a.listener).toHaveBeenLastCalledWith({ outcome: f.value })
})

test('an abandoned request settles without restarting and a later mount starts fresh', async () => {
  const f = fixture(); const a = f.watch(); a.stop()
  f.requests[0]!.reject(new Error('late rejection')); await settle()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(a.listener).not.toHaveBeenCalled(); expect(f.current).toHaveBeenCalledTimes(1)
  const b = f.watch(); expect(b.listener).not.toHaveBeenCalled()
  expect(f.current).toHaveBeenCalledTimes(2)
})

test('sessions, languages and adapter instances do not share outcomes', async () => {
  const f = fixture(); const en = f.watch(); const zh = f.watch(vi.fn(), 'one', 'zh'); const other = f.watch(vi.fn(), 'two')
  const isolated = vi.fn()
  stops.push(subscribeCurrent({ ...f.adapter }, 'one', 'en', isolated))
  expect(f.current).toHaveBeenCalledTimes(4)
  en.stop()
  f.requests[0]!.resolve(f.value); await settle()
  expect(en.listener).not.toHaveBeenCalled(); expect(zh.listener).not.toHaveBeenCalled()
  expect(other.listener).not.toHaveBeenCalled(); expect(isolated).not.toHaveBeenCalled()
  f.requests[1]!.resolve(f.value); await settle()
  expect(zh.listener).toHaveBeenCalledTimes(1)
})
