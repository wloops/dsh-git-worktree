import { WorktreeReviewPanel } from '../../src/client/review-console/WorktreeReviewPanel.js'
import { useClientTranslator } from '../../src/client/i18n.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleTargetSummary,
} from '../../src/console-contract.js'
import type { WorktreeClientServices } from '../../src/client/actions.js'
import { ReviewActions } from '../../src/client/review-console/ReviewActions.js'

export type { WorktreeReviewEvidence } from '../../src/client/review-console/WorktreeReviewPanel.js'
import type { WorktreeReviewEvidence, WorktreeReviewIdentity, WorktreeReviewPanelProps } from '../../src/client/review-console/WorktreeReviewPanel.js'

interface ReviewActionsHarnessProps extends WorktreeReviewPanelProps {
  adapter?: WorktreeConsoleAdapter | null
  services?: WorktreeClientServices
  onRefresh?: () => void | Promise<void>
  onTargetChange?: (target: WorktreeConsoleTargetSummary) => void
}

function reviewIsStale(
  target: WorktreeConsoleTargetSummary | undefined,
  identity: WorktreeReviewIdentity | undefined,
  review: WorktreeReviewEvidence,
): boolean {
  if (!target) return false
  if (target.state === 'working') return true
  if (!['ready_for_review', 'preview_active', 'preview_detached', 'cleanup_pending', 'recovery_required', 'retained'].includes(target.state)) return false
  const expectedRevision = identity?.expectedRevision ?? review.revision
  return !target.review
    || target.revision !== expectedRevision
    || target.review.reviewId !== review.reviewId
}

export function ReviewActionsHarness({
  review,
  adapter,
  services,
  identity,
  target,
  onRefresh,
  onTargetChange,
  unavailableMessage: unavailableMessageOverride,
}: ReviewActionsHarnessProps) {
  const t = useClientTranslator()
  const unavailableMessage = unavailableMessageOverride ?? t("live.worktree.console.is.disconnected.review.actions.will")

  const mounted = useRef(true)
  const actionScope = identity
    ? [identity.sessionId, identity.checkoutId, identity.expectedRevision, identity.expectedReviewId].join('\u0000')
    : ''
  const activeActionScope = useRef(actionScope)
  activeActionScope.current = actionScope
  const targetKey = target ? [
    target.checkoutId,
    target.revision,
    target.state,
    target.review?.reviewId,
    target.commitOid,
    target.retention,
    target.cleanupMessage,
    target.deliveryProof?.localHeadAfter,
    target.deliveryProof?.commitInLocalHistory,
    target.deliveryProof?.validationStatus,
    target.deliveryProof?.validationSummary,
    target.checkpoints?.length,
    target.checkpoints?.at(-1)?.checkpointId,
    target.checkpointGeneration,
    target.reviewSlot,
    target.reviewSlotHolder?.checkoutId,
    target.reviewSlotHolder?.ownerSessionId,
    target.reviewSlotHolder?.revision,
    target.reviewSlotHolder?.state,
    target.previewRecovery?.previewId,
    target.previewRecovery?.detachedAt,
    target.previewRecovery?.reason,
    target.previewRecovery?.attemptedAction,
    target.capabilities.preflight,
    target.capabilities.preview,
    target.capabilities.finalize,
    target.capabilities.finalizePreview,
    target.capabilities.rollbackPreview,
    target.capabilities.discard,
  ].join('\u0000') : ''
  const [currentTarget, setCurrentTarget] = useState(target)
  const [invalidReason, setInvalidReason] = useState<string | null>(
    reviewIsStale(target, identity, review) ? t("review.is.stale.please.refresh") : null,
  )
  const refreshRequested = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    setCurrentTarget(target)
    refreshRequested.current = false
    setInvalidReason(reviewIsStale(target, identity, review) ? t("review.is.stale.please.refresh") : null)
  }, [identity?.expectedReviewId, identity?.expectedRevision, review.reviewId, review.revision, targetKey])

  const handleStale = useCallback((_error: WorktreeConsoleError) => {
    setInvalidReason(t("review.is.stale.please.refresh"))
    if (!refreshRequested.current) {
      refreshRequested.current = true
      void onRefresh?.()
    }
  }, [onRefresh])

  const handleTargetChange = useCallback((nextTarget: WorktreeConsoleTargetSummary) => {
    setCurrentTarget(nextTarget)
    onTargetChange?.(nextTarget)
  }, [onTargetChange])

  const liveReady = Boolean(
    adapter
    && identity
    && currentTarget
    && ['ready_for_review', 'preview_active', 'preview_detached', 'cleanup_pending', 'recovery_required', 'retained', 'delivered'].includes(currentTarget.state)
    && !invalidReason,
  )
  return <>
    <WorktreeReviewPanel review={review} target={currentTarget} />
    <ReviewActions review={review} adapter={adapter ?? null} services={services} identity={identity}
      target={currentTarget} disabled={!liveReady} unavailableMessage={invalidReason ?? unavailableMessage}
      isActive={() => mounted.current} onStale={handleStale} onTargetChange={handleTargetChange} />
  </>
}
