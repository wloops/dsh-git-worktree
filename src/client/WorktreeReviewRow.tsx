import type { WorktreeClientServices } from './actions.js'
import { parseReviewTool, type ToolCallViewPropsLike } from './model.js'
import { WorktreeReviewPanel, type WorktreeReviewEvidence } from './review-console/WorktreeReviewPanel.js'

interface Props extends ToolCallViewPropsLike {
  /** Kept for the current Client registrar; live Console integration supplies an adapter in the final wiring pass. */
  services: WorktreeClientServices
}

export function WorktreeReviewRow({ block, inspect }: Props) {
  const model = parseReviewTool(block)
  const payload = model.payload
  const args = model.args
  const state = model.lifecycle === 'running' ? 'running' : model.lifecycle === 'ok' ? 'ok' : 'error'
  const review: WorktreeReviewEvidence | null = payload && args ? {
    reviewId: payload.reviewId,
    revision: payload.revision,
    iteration: 0,
    preparedAt: 0,
    summary: args.summary,
    validationStatus: args.validationStatus,
    ...(args.validationSummary ? { validationSummary: args.validationSummary } : {}),
    tests: args.tests,
    changedFiles: payload.changedFiles,
    suggestedCommitMessage: args.suggestedCommitMessage,
    ...(args.details ? { detailsMarkdown: args.details } : {}),
  } : null

  return (
    <section className="dsh-wt-card" data-tool="worktree_ready_for_review" data-state={state} aria-label="Worktree Ready for Review">
      {review ? (
        <WorktreeReviewPanel review={review} inspect={inspect} />
      ) : (
        <header className="dsh-wt-head">
          <span className="dsh-wt-mark" aria-hidden />
          <strong className="dsh-wt-title">Ready for Review</strong>
          <span className="dsh-wt-subtitle">
            {model.lifecycle === 'running' ? '正在冻结验收快照…' : '验收信息不可用'}
          </span>
        </header>
      )}
      {model.error ? <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div> : null}
    </section>
  )
}
