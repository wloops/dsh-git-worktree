import { describe, expect, test, vi } from 'vitest'
import {
  invalidateReviewPreflight,
  readReviewPreflight,
} from '../src/client/review-console/preflight-cache.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const identity = {
  sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
}

describe('Review preflight cache lifecycle', () => {
  test('explicit invalidation discards a cached busy result when the acceptance slot becomes available', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.preflight = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { preflight: {
        status: 'blocked', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
        reason: 'project_acceptance_busy', message: 'busy',
      } } })
      .mockResolvedValueOnce({ ok: true, value: { preflight: {
        status: 'ready', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
        configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base',
        localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'],
      } } })

    await expect(readReviewPreflight(fixture.adapter, identity)).resolves.toMatchObject({
      status: 'success', preflight: { status: 'blocked', reason: 'project_acceptance_busy' },
    })
    invalidateReviewPreflight(fixture.adapter, identity)
    await expect(readReviewPreflight(fixture.adapter, identity)).resolves.toMatchObject({
      status: 'success', preflight: { status: 'ready' },
    })
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(2)
  })

  test('an automatic error remains cached until the user explicitly forces a retry', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.preflight = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'transport_unavailable', message: 'offline' } })
      .mockResolvedValueOnce({ ok: true, value: { preflight: {
        status: 'ready', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
        configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base',
        localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'],
      } } })

    await expect(readReviewPreflight(fixture.adapter, identity)).resolves.toMatchObject({ status: 'error' })
    await expect(readReviewPreflight(fixture.adapter, identity)).resolves.toMatchObject({ status: 'error' })
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(1)
    await expect(readReviewPreflight(fixture.adapter, identity, true)).resolves.toMatchObject({ status: 'success' })
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(2)
  })
})
