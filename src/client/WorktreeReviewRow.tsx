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

export function WorktreeReviewRow({ block, sessionId, adapter, services }: Props) {
  const model = parseReviewTool(block)
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
    ? `实时 Worktree Console 不可用：${liveError}`
    : adapter && sessionId
      ? '正在连接实时 Worktree Console；历史验收证据仍可查看。'
      : '实时 Worktree Console 未连接；连接后即可执行验收操作。'

  return (
    <section className="dsh-wt-card" data-tool="worktree_ready_for_review" data-state={state} aria-label="Worktree 待验收">
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
          <strong className="dsh-wt-title">Worktree 待验收</strong>
          <span className="dsh-wt-subtitle">
            {model.lifecycle === 'running' ? '正在冻结验收快照…' : '验收信息不可用'}
          </span>
        </header>
      )}
      {model.error ? <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div> : null}
    </section>
  )
}
