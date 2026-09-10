import { validationLabel } from '../review-console/WorktreeReviewPanel.js'
import { useClientTranslator } from '../i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails, WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { ReviewActions } from '../review-console/ReviewActions.js'
import {
  restoreWorktreeRecovery,
  retryWorktreeRecovery,
  useWorktreeRecoverySnapshot,
} from '../review-console/recovery-continuation.js'
import { reviewEvidenceFromTarget, reviewIdentityFromTarget } from '../review-console/index.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'

export interface WorktreeReviewStatusProps {
  session: { sessionId: string }
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
}

/** Domi-style compact delivery status above the native Harness composer. */
export function WorktreeReviewStatus({ session, adapter, services }: WorktreeReviewStatusProps) {
  const t = useClientTranslator()

  const sessionId = session.sessionId
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recovery = useWorktreeRecoverySnapshot(sessionId)
  const mounted = useRef(true)
  const requestToken = useRef(0)
  const sessionGeneration = useRef(0)
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const token = ++requestToken.current
    try {
      const outcome = await adapter.current({ sessionId })
      if (!mounted.current || currentSessionId.current !== sessionId || token !== requestToken.current) return
      if (outcome.ok) {
        setTarget(current => current?.checkoutId === outcome.value.target.checkoutId && current.revision > outcome.value.target.revision
          ? current : outcome.value.target)
        setError(null)
      } else {
        setError(outcome.error.message)
      }
    } catch (reason) {
      if (mounted.current && currentSessionId.current === sessionId && token === requestToken.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
  }, [adapter, sessionId])

  useEffect(() => {
    restoreWorktreeRecovery({ sessionId, adapter, services })
  }, [adapter, services, sessionId])

  useEffect(() => {
    sessionGeneration.current += 1
    requestToken.current += 1
    setTarget(null)
    setError(null)
    void refresh()
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId === sessionId) void refresh()
    }
    const timer = window.setInterval(() => { void refresh() }, 5_000)
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, listener)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, listener)
    }
  }, [refresh, sessionId])

  const standaloneRecovery = recovery
    && target?.checkoutId === recovery.request.checkoutId
    && (target.state === 'working' || !target.review)
    ? recovery
    : null
  if (standaloneRecovery) {
    return (
      <section className="dsh-wt-review-dock" aria-label={t("worktree.recovery.continuation")} data-recovery-status={standaloneRecovery.status}>
        <span className="dsh-wt-review-dock-icon" aria-hidden>!</span>
        <span className="dsh-wt-review-dock-copy">
          <strong>{standaloneRecovery.request.kind === 'worktree_apply_conflict' ? t("worktree.conflict.recovery") : t("read.only.review.regeneration")}</strong>
          <span>
            {standaloneRecovery.status === 'queued' ? t("request.durably.queued.waiting.for.the.exact.owner") : null}
            {standaloneRecovery.status === 'sending' ? t("sending.the.recovery.request.through.the.official.harness") : null}
            {standaloneRecovery.status === 'sent' ? t("recovery.request.handed.to.agent") : null}
            {standaloneRecovery.status === 'cancelled' ? t("session.checkout.changed.the.old.recovery.request.was") : null}
            {standaloneRecovery.status === 'failed' ? t("recovery.request.failed.2", { p0: standaloneRecovery.error ?? '' }) : null}
          </span>
        </span>
        {standaloneRecovery.status === 'failed' ? (
          <button type="button" className="dsh-wt-button" onClick={() => retryWorktreeRecovery(sessionId)}>{t("resend")}</button>
        ) : null}
      </section>
    )
  }

  if (
    !target
    || !target.review
    || target.checkoutId === null
    || !['ready_for_review', 'preview_active', 'preview_detached', 'cleanup_pending', 'recovery_required', 'retained'].includes(target.state)
  ) return null
  const review = reviewEvidenceFromTarget(target)
  const identity = reviewIdentityFromTarget(sessionId, target)
  if (!review || !identity) return null
  const actionGeneration = sessionGeneration.current

  const focusReview = (): void => {
    document.querySelector<HTMLElement>(`[data-worktree-review-id="${CSS.escape(review.reviewId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const applyTarget = (nextTarget: WorktreeConsoleTargetSummary): void => {
    setTarget(current => current && current.checkoutId === nextTarget.checkoutId && current.revision <= nextTarget.revision
      ? { ...current, ...nextTarget } : current)
  }

  const detachedFromHeadDrift = target.state === 'preview_detached'
    && target.previewRecovery?.reason === 'stale_local'
  const label = target.state === 'ready_for_review'
    ? target.reviewSlot === 'waiting' ? t("another.task.is.holding.the.local.review.slot") : t("changes.are.ready.for.your.preview")
    : target.state === 'preview_active'
      ? t("previewing.these.changes.save.after.confirmation")
      : target.state === 'preview_detached'
        ? detachedFromHeadDrift ? t("the.project.has.new.changes.preview.is.waiting") : t("preview.conflicts.with.local.recovery.state.was.preserved")
        : target.state === 'recovery_required'
          ? t("preview.needs.recovery.safety.records.were.preserved")
          : target.state === 'cleanup_pending'
          ? t("changes.saved.worktree.cleanup.needs.a.retry")
          : t("changes.saved.environment.temporarily.retained")
  const detail = target.state === 'preview_detached'
    ? detachedFromHeadDrift
      ? t("same.branch.fast.forward.can.be.safely.retried")
      : t("automatic.rollback.will.recheck.conflicts.no.writes.if")
    : t("files.5", { p0: review.changedFiles.length, p1: validationLabel(review.validationStatus, t) })

  return (
    <section className="dsh-wt-review-dock" aria-label={t("worktree.ready.for.review")} data-review-state={target.state}>
      <span className="dsh-wt-review-dock-icon" aria-hidden>{target.state === 'preview_detached' || target.state === 'recovery_required' ? '!' : '✓'}</span>
      {error ? <span className="dsh-wt-error">{error}</span> : null}
      <ReviewActions
        key={`${sessionId}:${target.checkoutId}`}
        renderStatus={operation => (
          <span className="dsh-wt-review-dock-copy" role="status" aria-live="polite" aria-atomic="true">
            <strong>{operation === 'preview' ? t("preparing.local.preview")
              : operation === 'rollback' ? t("withdrawing.local.preview")
                : operation === 'finish' || operation === 'finalize_preview' ? t("saving.reviewed.changes")
                  : operation ? t("processing.worktree.please.wait") : label}</strong>
            <span>{detail}</span>
          </span>
        )}
        review={review}
        adapter={adapter}
        services={services}
        identity={identity}
        target={target}
        disabled={false}
        unavailableMessage={t("live.worktree.console.is.disconnected")}
        focusReview={focusReview}
        isActive={() => mounted.current && currentSessionId.current === sessionId && sessionGeneration.current === actionGeneration}
        onStale={() => { void refresh() }}
        onTargetChange={applyTarget}
      />
    </section>
  )
}
