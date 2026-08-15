import { useCallback, useId, useLayoutEffect, useRef, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleReviewSummary,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { DiffViewer } from './DiffViewer.js'
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
  target?: WorktreeConsoleTargetSummary
  inspect?: () => void
  onRefresh?: () => void | Promise<void>
  onTargetChange?: (target: WorktreeConsoleTargetSummary) => void
  unavailableMessage?: string
}

function ValidationEvidence({ review, titleId }: { review: WorktreeReviewEvidence; titleId: string }) {
  return (
    <section className="dsh-wt-review-section" aria-labelledby={titleId}>
      <div className="dsh-wt-review-section-head">
        <h3 id={titleId} className="dsh-wt-review-heading">Validation</h3>
        <span className="dsh-wt-badge" data-validation={review.validationStatus}>{review.validationStatus}</span>
      </div>
      {review.validationSummary ? <p className="dsh-wt-status">{review.validationSummary}</p> : null}
      {review.tests.length > 0 ? (
        <ul className="dsh-wt-test-list" aria-label="Validation tests">
          {review.tests.map((item, index) => (
            <li className="dsh-wt-test" key={`${item.command}-${index}`}>
              <span className="dsh-wt-test-state">{item.status}</span>
              <span className="dsh-wt-test-command">
                <code className="dsh-wt-code">{item.command}</code>
                {item.summary ? <span className="dsh-wt-test-summary">{item.summary}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="dsh-wt-status">No validation commands were recorded.</p>}
    </section>
  )
}

function reviewIsStale(
  target: WorktreeConsoleTargetSummary | undefined,
  identity: WorktreeReviewIdentity | undefined,
  review: WorktreeReviewEvidence,
): boolean {
  if (!target) return false
  if (target.state === 'working') return true
  if (target.state !== 'ready_for_review' && target.state !== 'retained') return false
  const expectedRevision = identity?.expectedRevision ?? review.revision
  return !target.review
    || target.revision !== expectedRevision
    || target.review.reviewId !== review.reviewId
}

function ChangedFiles({ files, titleId }: { files: string[]; titleId: string }) {
  return (
    <section className="dsh-wt-review-section" aria-labelledby={titleId}>
      <h3 id={titleId} className="dsh-wt-review-heading">Changed files ({files.length})</h3>
      {files.length > 0 ? (
        <ul className="dsh-wt-review-file-list" aria-label={`${files.length} changed files`}>
          {files.map((file, index) => (
            <li className="dsh-wt-review-file" title={file} key={`${file}-${index}`}>
              <code className="dsh-wt-code">{file}</code>
            </li>
          ))}
        </ul>
      ) : <p className="dsh-wt-status">No task delta.</p>}
    </section>
  )
}

export function WorktreeReviewPanel({
  review,
  adapter,
  identity,
  target,
  inspect,
  onRefresh,
  onTargetChange,
  unavailableMessage = '实时 Worktree Console 未连接；连接后刷新即可查看 Diff 并执行操作。',
}: WorktreeReviewPanelProps) {
  const panelId = useId()
  const targetKey = target ? [
    target.checkoutId,
    target.revision,
    target.state,
    target.review?.reviewId,
    target.commitOid,
    target.retention,
    target.cleanupMessage,
    target.capabilities.finalize,
    target.capabilities.discard,
    target.capabilities.setRetention,
  ].join('\u0000') : ''
  const [currentTarget, setCurrentTarget] = useState(target)
  const [invalidReason, setInvalidReason] = useState<string | null>(
    reviewIsStale(target, identity, review) ? 'Review 已过期，请刷新。' : null,
  )
  const refreshRequested = useRef(false)

  useLayoutEffect(() => {
    setCurrentTarget(target)
    refreshRequested.current = false
    setInvalidReason(reviewIsStale(target, identity, review) ? 'Review 已过期，请刷新。' : null)
  }, [identity?.expectedReviewId, identity?.expectedRevision, review.reviewId, review.revision, targetKey])

  const handleStale = useCallback((_error: WorktreeConsoleError) => {
    setInvalidReason('Review 已过期，请刷新。')
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
    && (currentTarget.state === 'ready_for_review' || currentTarget.state === 'retained')
    && !invalidReason,
  )
  return (
    <section className="dsh-wt-review-panel" aria-label="Worktree Review">
      <header className="dsh-wt-review-header">
        <div>
          <div className="dsh-wt-review-kicker">Ready for Review</div>
          <h2 className="dsh-wt-review-title">{review.summary}</h2>
        </div>
        <span className="dsh-wt-review-identity dsh-wt-code">Review {review.reviewId} · r{review.revision}</span>
      </header>

      <ValidationEvidence review={review} titleId={`${panelId}-validation`} />
      <ChangedFiles files={review.changedFiles} titleId={`${panelId}-changed-files`} />

      <section className="dsh-wt-review-section" aria-labelledby={`${panelId}-commit`}>
        <h3 id={`${panelId}-commit`} className="dsh-wt-review-heading">Suggested Commit Message</h3>
        <pre className="dsh-wt-commit dsh-wt-code">{review.suggestedCommitMessage}</pre>
      </section>

      {review.detailsMarkdown ? (
        <section className="dsh-wt-review-section" aria-labelledby={`${panelId}-details`}>
          <h3 id={`${panelId}-details`} className="dsh-wt-review-heading">Delivery details</h3>
          <pre className="dsh-wt-review-details">{review.detailsMarkdown}</pre>
        </section>
      ) : null}

      {adapter && identity ? (
        <DiffViewer adapter={adapter} identity={identity} disabled={!liveReady} onStale={handleStale} />
      ) : null}

      {invalidReason ? <div className="dsh-wt-error" role="alert">{invalidReason}</div> : null}
      <ReviewActions
        adapter={adapter}
        identity={identity}
        target={currentTarget}
        disabled={!liveReady}
        unavailableMessage={unavailableMessage}
        inspect={inspect}
        onStale={handleStale}
        onTargetChange={handleTargetChange}
      />
    </section>
  )
}
