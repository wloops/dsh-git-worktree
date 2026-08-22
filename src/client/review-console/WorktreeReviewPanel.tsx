import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleReviewSummary,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { ReviewActions } from './ReviewActions.js'

export interface WorktreeReviewEvidence extends WorktreeConsoleReviewSummary {
  detailsMarkdown?: string
}

export interface WorktreeReviewIdentity {
  sessionId: string
  checkoutId: string
  expectedRevision: number
  expectedReviewId: string
}

export interface WorktreeReviewPanelProps {
  review: WorktreeReviewEvidence
  identity?: WorktreeReviewIdentity
  adapter?: WorktreeConsoleAdapter | null
  services?: WorktreeClientServices
  target?: WorktreeConsoleTargetSummary
  onRefresh?: () => void | Promise<void>
  onTargetChange?: (target: WorktreeConsoleTargetSummary) => void
  unavailableMessage?: string
}

function validationLabel(status: WorktreeReviewEvidence['validationStatus']): string {
  if (status === 'passed') return '自动验证通过'
  if (status === 'failed') return '自动验证失败，仍可继续验收'
  if (status === 'partial') return '部分验证通过'
  return '未运行自动验证'
}

function testStatusLabel(status: WorktreeReviewEvidence['tests'][number]['status']): string {
  if (status === 'passed') return '通过'
  if (status === 'failed') return '失败'
  return '未运行'
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

export function WorktreeReviewPanel({
  review,
  adapter,
  services,
  identity,
  target,
  onRefresh,
  onTargetChange,
  unavailableMessage = '实时 Worktree Console 未连接；连接后即可执行验收操作。',
}: WorktreeReviewPanelProps) {
  const panelId = useId()
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
    target.reviewSlot,
    target.reviewSlotHolder?.checkoutId,
    target.reviewSlotHolder?.ownerSessionId,
    target.reviewSlotHolder?.state,
    target.capabilities.preflight,
    target.capabilities.preview,
    target.capabilities.finalize,
    target.capabilities.discard,
  ].join('\u0000') : ''
  const [currentTarget, setCurrentTarget] = useState(target)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [invalidReason, setInvalidReason] = useState<string | null>(
    reviewIsStale(target, identity, review) ? '验收结果已过期，请刷新。' : null,
  )
  const refreshRequested = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    setCurrentTarget(target)
    refreshRequested.current = false
    setInvalidReason(reviewIsStale(target, identity, review) ? '验收结果已过期，请刷新。' : null)
  }, [identity?.expectedReviewId, identity?.expectedRevision, review.reviewId, review.revision, targetKey])

  const handleStale = useCallback((_error: WorktreeConsoleError) => {
    setInvalidReason('验收结果已过期，请刷新。')
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
  const hasValidationDetails = Boolean(review.validationSummary || review.tests.length > 0)

  return (
    <section
      className="dsh-wt-review-panel"
      aria-label="Worktree 验收"
      data-worktree-review-id={review.reviewId}
    >
      <header className="dsh-wt-review-compact-head">
        <span className="dsh-wt-review-status-icon" data-validation={review.validationStatus} aria-hidden>✓</span>
        <div className="dsh-wt-review-compact-copy">
          <h2 className="dsh-wt-review-title">第 {review.iteration} 轮修改已准备验收</h2>
          <p className="dsh-wt-review-summary">{review.summary}</p>
        </div>
        <span className="dsh-wt-review-identity dsh-wt-code" title={`Review ${review.reviewId} · r${review.revision}`}>
          {review.reviewId.slice(0, 8)} · r{review.revision}
        </span>
      </header>

      <div className="dsh-wt-review-meta">
        <span data-validation={review.validationStatus}>{validationLabel(review.validationStatus)}</span>
        <span>{review.changedFiles.length} 个文件</span>
        {hasValidationDetails ? (
          <button
            type="button"
            className="dsh-wt-review-details-toggle"
            aria-expanded={detailsExpanded}
            aria-controls={`${panelId}-validation`}
            onClick={() => setDetailsExpanded(value => !value)}
          >
            {detailsExpanded
              ? '收起验证详情'
              : `查看验证详情${review.tests.length > 0 ? `（${review.tests.length} 项测试）` : ''}`}
          </button>
        ) : null}
      </div>

      {detailsExpanded ? (
        <div id={`${panelId}-validation`} className="dsh-wt-review-validation-details">
          {review.validationSummary ? <p>{review.validationSummary}</p> : null}
          {review.tests.length > 0 ? (
            <ul className="dsh-wt-test-list" aria-label="验证命令">
              {review.tests.map((item, index) => (
                <li className="dsh-wt-test" key={`${item.command}-${index}`}>
                  <span className="dsh-wt-test-state" data-test-status={item.status}>{testStatusLabel(item.status)}</span>
                  <span className="dsh-wt-test-command">
                    <code className="dsh-wt-code">{item.command}</code>
                    {item.summary ? <span className="dsh-wt-test-summary">{item.summary}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {invalidReason ? <div className="dsh-wt-error" role="alert">{invalidReason}</div> : null}
      <ReviewActions
        review={review}
        adapter={adapter}
        services={services}
        identity={identity}
        target={currentTarget}
        disabled={!liveReady}
        unavailableMessage={unavailableMessage}
        isActive={() => mounted.current && activeActionScope.current === actionScope}
        onStale={handleStale}
        onTargetChange={handleTargetChange}
      />
    </section>
  )
}
