// @vitest-environment jsdom
// Issue #6 regression: display observers share one bounded request.
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
  test(`${consumers} display consumer(s) share one unresolved request over 30 seconds`, async () => {
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
    expect(current).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(current).toHaveBeenCalledTimes(1)
    expect(pending).toBe(1)
    expect(peak).toBe(1)
    console.info(JSON.stringify({ consumers, elapsedMs: 30_000, requests: current.mock.calls.length, peakPending: peak }))

    // Refresh events coalesce while the shared request is pending.
    act(() => { window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId: 'polling-probe' } })) })
    expect(current).toHaveBeenCalledTimes(1)
    view.unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(current).toHaveBeenCalledTimes(1)
    expect(pending).toBe(1)
    await act(async () => { for (const finish of settle) finish() })
    expect(pending).toBe(0)
  })
}
