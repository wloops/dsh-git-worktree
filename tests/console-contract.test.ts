import { describe, expect, test } from 'vitest'
import {
  consoleStateFromDomain,
  worktreeConsoleErrorMeta,
  type WorktreeConsoleFinalizeRequest,
  type WorktreeConsoleProjectionSource,
} from '../src/console-contract.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function source(overrides: Partial<WorktreeConsoleProjectionSource> = {}): WorktreeConsoleProjectionSource {
  return {
    kind: 'isolated',
    phase: 'ready',
    deliveryState: 'working',
    ...overrides,
  }
}

describe('Worktree Console shared contract', () => {
  test('projects one stable Console state from Local, lifecycle phase, and delivery facts', () => {
    expect(consoleStateFromDomain(source({ kind: 'local', deliveryState: undefined }))).toBe('local')
    expect(consoleStateFromDomain(source({ phase: 'preparing' }))).toBe('creating')
    expect(consoleStateFromDomain(source({ deliveryState: 'working' }))).toBe('working')
    expect(consoleStateFromDomain(source({ deliveryState: 'ready_for_review' }))).toBe('ready_for_review')
    expect(consoleStateFromDomain(source({ deliveryState: 'retained' }))).toBe('retained')
    expect(consoleStateFromDomain(source({ deliveryState: 'finalized' }))).toBe('cleanup_pending')
    expect(consoleStateFromDomain(source({ deliveryState: 'delivered' }))).toBe('delivered')
    expect(consoleStateFromDomain(source({
      phase: 'recovery_required',
      deliveryState: 'ready_for_review',
    }))).toBe('recovery_required')
  })

  test('maps stable domain and transport errors to one client recovery policy', () => {
    expect(worktreeConsoleErrorMeta('not_owner')).toEqual({
      category: 'permission',
      recovery: 'none',
      retryable: false,
    })
    expect(worktreeConsoleErrorMeta('stale_target')).toEqual({
      category: 'stale',
      recovery: 'refresh',
      retryable: true,
    })
    expect(worktreeConsoleErrorMeta('dirty_confirmation_required')).toEqual({
      category: 'confirmation',
      recovery: 'confirm_dirty',
      retryable: true,
    })
    expect(worktreeConsoleErrorMeta('transport_unavailable')).toEqual({
      category: 'unavailable',
      recovery: 'retry',
      retryable: true,
    })
  })

  test('provides one reusable adapter fixture that records exact review-bound mutations', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request: WorktreeConsoleFinalizeRequest = {
      sessionId: 'target-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      expectedReviewId: 'review-1',
      commitMessage: 'fix: exact reviewed message',
      retention: 'cleanup',
    }

    const current = await fixture.adapter.current({ sessionId: 'target-session' })
    const finalized = await fixture.adapter.finalize(request)

    expect(current).toMatchObject({ ok: true, value: { target: { state: 'ready_for_review' } } })
    expect(finalized).toMatchObject({ ok: true, value: { target: { state: 'delivered' } } })
    expect(fixture.calls).toEqual([
      { method: 'current', request: { sessionId: 'target-session' } },
      { method: 'finalize', request },
    ])
  })
})
