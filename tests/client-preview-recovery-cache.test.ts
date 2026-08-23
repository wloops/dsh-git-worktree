import { describe, expect, test, vi } from 'vitest'
import {
  invalidatePreviewRecoveryPreflight,
  readPreviewRecoveryPreflight,
} from '../src/client/review-console/preview-recovery-cache.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const identity = {
  sessionId: 'target-session',
  checkoutId: 'checkout-1',
  expectedRevision: 8,
  expectedReviewId: 'review-1',
  expectedPreviewId: 'preview-1',
}

function assessed(generation: string) {
  return {
    ok: true as const,
    value: { preflight: {
      status: 'assessed' as const,
      localModified: false as const,
      proof: {
        sessionId: identity.sessionId,
        checkoutId: identity.checkoutId,
        reviewId: identity.expectedReviewId,
        previewId: identity.expectedPreviewId,
        revision: identity.expectedRevision,
        generation,
        receiptFingerprint: '2'.repeat(64),
        localFingerprint: '3'.repeat(64),
        localHeadOid: 'a'.repeat(40),
        localHeadRef: 'refs/heads/main',
        localHeadTreeOid: 'b'.repeat(40),
        localIndexTreeOid: 'c'.repeat(40),
        localWorkingTreeOid: 'd'.repeat(40),
        rollback: { status: 'safe' as const, targetTreeOid: 'e'.repeat(40) },
        finalize: {
          status: 'safe' as const,
          taskTreeOid: 'f'.repeat(40),
          finalIndexTreeOid: '1'.repeat(40),
          expectedWorkingTreeOid: 'd'.repeat(40),
          commitRequired: true,
        },
      },
    } },
  }
}

describe('Preview recovery preflight cache', () => {
  test('is identity-keyed and single-flight', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    let resolveRequest!: (value: ReturnType<typeof assessed>) => void
    fixture.adapter.previewRecoveryPreflight = vi.fn(() => new Promise(resolve => { resolveRequest = resolve }))

    const first = readPreviewRecoveryPreflight(fixture.adapter, identity)
    const second = readPreviewRecoveryPreflight(fixture.adapter, identity)
    expect(fixture.adapter.previewRecoveryPreflight).toHaveBeenCalledTimes(1)
    resolveRequest(assessed('1'.repeat(64)))
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { status: 'success', preflight: { proof: { generation: '1'.repeat(64) } } },
      { status: 'success', preflight: { proof: { generation: '1'.repeat(64) } } },
    ])
  })

  test('caches automatic errors and explicit invalidation permits a fresh generation', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.previewRecoveryPreflight = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'transport_unavailable', message: 'offline' } })
      .mockResolvedValueOnce(assessed('4'.repeat(64)))

    await expect(readPreviewRecoveryPreflight(fixture.adapter, identity)).resolves.toMatchObject({ status: 'error' })
    await expect(readPreviewRecoveryPreflight(fixture.adapter, identity)).resolves.toMatchObject({ status: 'error' })
    expect(fixture.adapter.previewRecoveryPreflight).toHaveBeenCalledTimes(1)
    invalidatePreviewRecoveryPreflight(fixture.adapter, identity)
    await expect(readPreviewRecoveryPreflight(fixture.adapter, identity)).resolves.toMatchObject({
      status: 'success', preflight: { proof: { generation: '4'.repeat(64) } },
    })
    expect(fixture.adapter.previewRecoveryPreflight).toHaveBeenCalledTimes(2)
  })
})
