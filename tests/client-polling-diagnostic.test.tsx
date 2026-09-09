// @vitest-environment jsdom
// Issue #6 characterization only: these counts describe the current problem,
// not a desired polling contract. Replace with bounded-concurrency assertions
// when the display polling fix is implemented.
import { afterEach, expect, test, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { TargetStatusAction } from '../src/client/target-console/TargetStatusAction.js'
import { WorktreeReviewStatus } from '../src/client/target-console/WorktreeReviewStatus.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../src/client/review-console/status-events.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function services(): WorktreeClientServices {
  return {
    workspaces: { create: vi.fn(), openPath: vi.fn() },
    sessions: {
      create: vi.fn(), open: vi.fn(), binding: vi.fn(),
      list: {
        getSnapshot: () => ({ current: 'polling-probe', ids: ['polling-probe'], byId: {} }),
        subscribe: () => () => {},
      },
    },
  }
}

afterEach(() => { cleanup(); vi.useRealTimers() })

for (const consumers of [1, 2]) {
  test(`${consumers} display consumer(s) accumulate unresolved requests over 30 seconds`, async () => {
    vi.useFakeTimers()
    const fixture = createWorktreeConsoleAdapterFixture()
    let pending = 0
    let peak = 0
    const settle: Array<() => void> = []
    const current = vi.fn(() => {
      pending++
      peak = Math.max(peak, pending)
      return new Promise<Awaited<ReturnType<typeof fixture.adapter.current>>>(resolve => {
        settle.push(() => {
          pending--
          resolve({ ok: true, value: { target: fixture.target } })
        })
      })
    })
    const adapter = { ...fixture.adapter, current }
    const runtime = services()
    const view = render(<>
      <TargetStatusAction sessionId="polling-probe" adapter={adapter} services={runtime} />
      {consumers === 2 && <WorktreeReviewStatus session={{ sessionId: 'polling-probe' }} adapter={adapter} services={runtime} />}
    </>)
    expect(current).toHaveBeenCalledTimes(consumers)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(current).toHaveBeenCalledTimes(consumers * 7)
    expect(pending).toBe(consumers * 7)
    expect(peak).toBe(consumers * 7)
    console.info(JSON.stringify({ consumers, elapsedMs: 30_000, requests: current.mock.calls.length, peakPending: peak }))

    // Event-driven refreshes also start new requests while all polls are pending.
    act(() => { window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId: 'polling-probe' } })) })
    expect(current).toHaveBeenCalledTimes(consumers * 8)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(current).toHaveBeenCalledTimes(consumers * 8)
    expect(pending).toBe(consumers * 8)
    await act(async () => { for (const finish of settle) finish() })
    expect(pending).toBe(0)
  })
}
