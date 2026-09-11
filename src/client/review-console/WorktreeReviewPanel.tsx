import { ReviewIcon } from './ReviewIcon.js'
import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useEffect, useId, useState } from 'react'
import type {
  WorktreeConsoleReviewSummary,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'

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
  target?: WorktreeConsoleTargetSummary
  unavailableMessage?: string
}

function validationLabel(status: WorktreeReviewEvidence['validationStatus'], t: ClientTranslator = defaultClientTranslator): string {
  if (status === 'passed') return t("automated.validation.passed")
  if (status === 'failed') return t("automated.validation.failed.review.can.continue")
  if (status === 'partial') return t("validation.partially.passed")
  return t("automated.validation.not.run")
}

function testStatusLabel(status: WorktreeReviewEvidence['tests'][number]['status'], t: ClientTranslator = defaultClientTranslator): string {
  if (status === 'passed') return t("passed")
  if (status === 'failed') return t("failed")
  return t("not.run")
}

export function reviewIsStale(
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

export function WorktreeReviewPanel({ review, target, identity, unavailableMessage }: WorktreeReviewPanelProps) {
  const t = useClientTranslator()
  const panelId = useId()
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  useEffect(() => setDetailsExpanded(false), [review.reviewId, review.revision])
  const invalidReason = reviewIsStale(target, identity, review) ? t("review.is.stale.please.refresh") : null
  return (
    <section
      className="dsh-wt-review-panel"
      aria-label={t("worktree.review")}
      data-worktree-review-id={review.reviewId}
    >
      <header className="dsh-wt-review-compact-head">
        <span className="dsh-wt-review-status-icon" data-validation={review.validationStatus} aria-hidden><ReviewIcon name="check" /></span>
        <div className="dsh-wt-review-compact-copy">
          <h2 className="dsh-wt-review-title">{t("review.iteration.ready", { iteration: review.iteration })}</h2>
          <p className="dsh-wt-review-summary">{review.summary}</p>
        </div>
      </header>

      <div className="dsh-wt-review-meta">
        <span data-validation={review.validationStatus}>{validationLabel(review.validationStatus, t)}</span>
        <span>{t("count.files", { count: review.changedFiles.length })}</span>
        {(target?.checkpoints?.length ?? 0) > 0 ? (
          <span className="dsh-wt-checkpoint-summary">{t("count.saved.stages", { count: target!.checkpoints!.length })}</span>
        ) : null}
                <button
          type="button"
          className="dsh-wt-review-details-toggle"
          aria-expanded={detailsExpanded}
          aria-controls={`${panelId}-validation`}
          onClick={() => setDetailsExpanded(value => !value)}
        >
          {detailsExpanded
            ? t("hide.validation.details")
            : t("view.validation.details", { p0: review.tests.length > 0 ? t("tests", { p0: review.tests.length }) : '' })}
        </button>
      </div>

      {detailsExpanded ? (
        <div id={`${panelId}-validation`} className="dsh-wt-review-validation-details">
          <span className="dsh-wt-review-identity dsh-wt-code" title={t("review.identity", { reviewId: review.reviewId, revision: review.revision })}>
            {review.reviewId.slice(0, 8)} · r{review.revision}
          </span>
          {review.validationSummary ? <p>{review.validationSummary}</p> : null}
          {review.tests.length > 0 ? (
            <ul className="dsh-wt-test-list" aria-label={t("validation.commands")}>
              {review.tests.map((item, index) => (
                <li className="dsh-wt-test" key={`${item.command}-${index}`}>
                  <span className="dsh-wt-test-state" data-test-status={item.status}>{testStatusLabel(item.status, t)}</span>
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

      {invalidReason || unavailableMessage ? <p className="dsh-wt-review-evidence-status">{invalidReason ?? unavailableMessage}</p> : null}
    </section>
  )
}
