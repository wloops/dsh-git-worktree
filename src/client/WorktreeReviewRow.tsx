import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from './i18n.js'
import { useEffect, useState } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetSummary } from '../console-contract.js'
import type { WorktreeClientServices } from './actions.js'
import { parseReviewTool, type ToolCallViewPropsLike } from './model.js'
import { requestWorktreeReviewRefresh, WORKTREE_REVIEW_REFRESH_EVENT } from './review-console/status-events.js'
import {
  WorktreeReviewPanel,
  type WorktreeReviewEvidence,
  type WorktreeReviewIdentity,
} from './review-console/WorktreeReviewPanel.js'

interface Props extends ToolCallViewPropsLike {
  /** Kept for the current Client registrar and historical ToolView compatibility. */
  services: WorktreeClientServices
  /** Optional live Remote seam; logged evidence remains replayable without it. */
  adapter?: WorktreeConsoleAdapter
}

function isLocalTargetUnselected(error: string | null, t: ClientTranslator = defaultClientTranslator): boolean {
  if (error === null) return false
  return /(?:^|\b)target_unselected(?:\b|$)/iu.test(error)
    || error.includes(t("no.session.target.has.been.selected"))
}

export function WorktreeReviewRow({ block, sessionId, adapter, services }: Props) {
  const t = useClientTranslator()

  const model = parseReviewTool(block, t)
  const payload = model.payload
  const args = model.args
  const state = model.lifecycle === 'running' ? 'running' : model.lifecycle === 'ok' ? 'ok' : 'error'
  const [liveTarget, setLiveTarget] = useState<WorktreeConsoleTargetSummary | undefined>()
  const [liveError, setLiveError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const review: WorktreeReviewEvidence | null = payload && args ? {
    reviewId: payload.reviewId,
    revision: payload.revision,
    iteration: payload.iteration,
    preparedAt: 0,
    summary: args.summary,
    validationStatus: args.validationStatus,
    ...(args.validationSummary ? { validationSummary: args.validationSummary } : {}),
    tests: args.tests,
    changedFiles: payload.changedFiles,
    suggestedCommitMessage: args.suggestedCommitMessage,
    ...(args.details ? { detailsMarkdown: args.details } : {}),
  } : null

  useEffect(() => {
    if (payload && sessionId) requestWorktreeReviewRefresh(sessionId)
  }, [payload?.reviewId, payload?.revision, sessionId])

  useEffect(() => {
    if (!sessionId) return
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail
      if (detail?.sessionId === sessionId) setRefreshNonce(value => value + 1)
    }
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, listener)
    return () => window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, listener)
  }, [sessionId])

  useEffect(() => {
    setLiveTarget(undefined)
    setLiveError(null)
  }, [adapter, payload?.reviewId, payload?.revision, sessionId])

  useEffect(() => {
    if (!adapter || !sessionId || !payload) return
    let active = true
    void adapter.current({ sessionId }).then(outcome => {
      if (!active) return
      if (outcome.ok) {
        setLiveTarget(current => current
          && current.checkoutId === outcome.value.target.checkoutId
          && current.revision > outcome.value.target.revision
          ? current
          : outcome.value.target)
        setLiveError(null)
      } else {
        setLiveError(`${outcome.error.code}: ${outcome.error.message}`)
      }
    }, reason => {
      if (active) setLiveError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { active = false }
  }, [adapter, payload?.reviewId, payload?.revision, refreshNonce, sessionId])

  if (model.lifecycle === 'error' && isLocalTargetUnselected(model.error, t)) return null

  const identity: WorktreeReviewIdentity | undefined = payload
    && sessionId
    && liveTarget?.checkoutId
    ? {
        sessionId,
        checkoutId: liveTarget.checkoutId,
        expectedRevision: liveTarget.review?.reviewId === payload.reviewId ? liveTarget.revision : payload.revision,
        expectedReviewId: payload.reviewId,
      }
    : undefined
  const unavailableMessage = liveError
    ? t("live.worktree.console.unavailable", { p0: liveError })
    : adapter && sessionId
      ? t("connecting.to.live.worktree.console.historical.review.evidence")
      : t("live.worktree.console.is.disconnected.review.actions.will")

  return (
    <section className="dsh-wt-card" data-tool="worktree_ready_for_review" data-state={state} aria-label={t("worktree.ready.for.review")}>
      {review ? (
        <WorktreeReviewPanel
          review={review}
          adapter={adapter}
          services={services}
          identity={identity}
          target={liveTarget}
          unavailableMessage={unavailableMessage}
          onRefresh={() => setRefreshNonce(value => value + 1)}
          onTargetChange={setLiveTarget}
        />
      ) : (
        <header className="dsh-wt-head">
          <span className="dsh-wt-mark" aria-hidden />
          <strong className="dsh-wt-title">{t("worktree.ready.for.review")}</strong>
          <span className="dsh-wt-subtitle">
            {model.lifecycle === 'running' ? t("freezing.the.review.snapshot") : t("review.information.unavailable")}
          </span>
        </header>
      )}
      {model.error ? <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div> : null}
    </section>
  )
}
