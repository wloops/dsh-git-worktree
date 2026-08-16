import { useEffect, useId, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { worktreeConsoleErrorMeta } from '../../console-contract.js'
import type { WorktreeApplyPreflightView, WorktreeRetentionMode } from '../../types.js'
import type { WorktreeReviewEvidence, WorktreeReviewIdentity } from './WorktreeReviewPanel.js'
import { requestWorktreeReviewRefresh } from './status-events.js'

interface ReviewActionsProps {
  review: WorktreeReviewEvidence
  adapter?: WorktreeConsoleAdapter | null
  identity?: WorktreeReviewIdentity
  target?: WorktreeConsoleTargetSummary
  disabled: boolean
  unavailableMessage: string
  focusReview?: () => void
  onStale: (error: WorktreeConsoleError) => void
  onTargetChange: (target: WorktreeConsoleTargetSummary) => void
}

type Mutation = 'preview' | 'rollback' | 'finish' | 'finalize_preview' | 'discard' | 'retry_cleanup'
type CommitMode = 'finish' | 'finalize_preview'

function isStale(error: WorktreeConsoleError): boolean {
  return error.code === 'stale_target' || error.code === 'stale_isolated' || error.code === 'stale_local'
}

function preflightMessage(preflight: WorktreeApplyPreflightView): string {
  if (preflight.status === 'ready') return '同步预检通过，正在创建可撤回的 Local Preview。'
  if (preflight.status === 'local_advanced') return 'Local 已前进，但预检确认可以安全合并。'
  if (preflight.status === 'already_in_local') return '本轮内容已在 Local 中；同步将是安全空操作。'
  if (preflight.status === 'conflict') return `同步预检发现 ${preflight.conflictingFiles.length} 个冲突文件；Local 未修改。`
  if (preflight.status === 'blocked') return `同步暂时阻塞：${preflight.message}`
  return '同步预检完成；Local 未修改。'
}

export function ReviewActions({
  review,
  adapter,
  identity,
  target,
  disabled,
  unavailableMessage,
  focusReview,
  onStale,
  onTargetChange,
}: ReviewActionsProps) {
  const formId = useId()
  const [submitting, setSubmitting] = useState<Mutation | null>(null)
  const [commitMode, setCommitMode] = useState<CommitMode | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState(review.suggestedCommitMessage)
  const [retainEnvironment, setRetainEnvironment] = useState(false)
  const [retention, setRetention] = useState<Exclude<WorktreeRetentionMode, 'cleanup'>>('retain_24h')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<WorktreeConsoleError | null>(null)
  const [preflight, setPreflight] = useState<WorktreeApplyPreflightView | null>(null)
  const mutationLock = useRef(false)
  const observedTargetRevision = useRef(target?.revision)

  useEffect(() => {
    setCommitMessage(review.suggestedCommitMessage)
    setRetainEnvironment(false)
    setRetention('retain_24h')
    setPreflight(null)
  }, [review.reviewId, review.suggestedCommitMessage])

  useEffect(() => {
    const revision = target?.revision
    if (revision === undefined || revision === observedTargetRevision.current) return
    observedTargetRevision.current = revision
    if (submitting !== null) return
    setMessage(null)
    setError(null)
    setPreflight(null)
  }, [submitting, target?.revision])

  const begin = (mutation: Mutation): boolean => {
    if (disabled || !adapter || !identity || !target || mutationLock.current) return false
    mutationLock.current = true
    setSubmitting(mutation)
    setMessage(null)
    setError(null)
    return true
  }

  const finish = (): void => {
    mutationLock.current = false
    setSubmitting(null)
  }

  const finishError = (nextError: WorktreeConsoleError): void => {
    setError(nextError)
    if (isStale(nextError)) onStale(nextError)
    finish()
  }

  const applyTarget = (nextTarget: WorktreeConsoleTargetSummary): void => {
    observedTargetRevision.current = nextTarget.revision
    onTargetChange(nextTarget)
    if (identity) requestWorktreeReviewRefresh(identity.sessionId)
  }

  const previewLocal = async (): Promise<void> => {
    if (!begin('preview') || !adapter || !identity) return
    const inspected = await adapter.preflight(identity)
    if (!inspected.ok) {
      finishError(inspected.error)
      return
    }
    setPreflight(inspected.value.preflight)
    setMessage(preflightMessage(inspected.value.preflight))
    if (inspected.value.preflight.status === 'conflict' || inspected.value.preflight.status === 'blocked') {
      finish()
      return
    }
    const outcome = await adapter.preview(identity)
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage('已同步为可撤回的 Local Preview；请在 Local 中验收。')
    finish()
  }

  const rollbackPreview = async (resumeRevision = false): Promise<void> => {
    if (!begin('rollback') || !adapter || !identity) return
    const outcome = await adapter.rollbackPreview({ ...identity, resumeRevision })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(outcome.value.target.state === 'preview_detached'
      ? outcome.value.target.previewRecovery?.reason === 'stale_local'
        ? 'Local branch/HEAD 已变化；同分支安全快进可重试撤回，其他历史变化不会被覆盖。'
        : 'Preview 与 Local 存在冲突；恢复证据和 Worktree 已保留。'
      : resumeRevision ? '已撤回 Local Preview，可以继续修改 Worktree。' : '已撤回 Local Preview，验收卡仍可再次同步。')
    finish()
  }

  const submitCommit = async (): Promise<void> => {
    const value = commitMessage.trim()
    const mode = commitMode
    if (!mode || !value || value.length > 500 || !begin(mode) || !adapter || !identity) return
    const selectedRetention: WorktreeRetentionMode = retainEnvironment ? retention : 'cleanup'
    const request = { ...identity, commitMessage: value, retention: selectedRetention }
    const outcome = mode === 'finalize_preview'
      ? await adapter.finalizePreview(request)
      : await adapter.finalize(request)
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    if (outcome.value.target.state === 'preview_detached') {
      setMessage('Local 已变化，无法可靠提交；Preview 恢复证据和 Worktree 已保留。')
    } else {
      setMessage(selectedRetention === 'cleanup' ? '已提交到 Local，并开始清理 Worktree。' : '已提交到 Local，并保留当前运行环境。')
    }
    setCommitMode(null)
    finish()
  }

  const discard = async (): Promise<void> => {
    if (!begin('discard') || !adapter || !identity || !target) return
    const outcome = await adapter.discard({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
      confirmDirty: true,
      ...(target.state === 'preview_active' || target.capabilities.rollbackPreview ? { rollbackPreview: true } : {}),
    })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(outcome.value.target.state === 'preview_detached'
      ? 'Local 已变化，无法无损撤回；未删除 Worktree。'
      : '已放弃本轮 Worktree 修改，Local 未受影响。')
    setDiscardOpen(false)
    finish()
  }

  const retryCleanup = async (): Promise<void> => {
    if (!begin('retry_cleanup') || !adapter || !identity) return
    const outcome = await adapter.retryCleanup({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
    })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(outcome.value.target.state === 'delivered' ? 'Worktree 环境已清理。' : '清理仍未完成，已保留恢复信息。')
    finish()
  }

  const live = Boolean(adapter && identity && target)
  const allDisabled = disabled || submitting !== null || !live
  const ready = target?.state === 'ready_for_review'
  const previewActive = target?.state === 'preview_active'
  const previewRecovery = target?.state === 'preview_detached'
    || target?.state === 'recovery_required' && target.capabilities.rollbackPreview
  const safeFastForwardRecovery = target?.state === 'preview_detached'
    && target.previewRecovery?.reason === 'stale_local'
  const cleanupPending = target?.state === 'cleanup_pending'
  const terminal = target?.state === 'retained' || target?.state === 'delivered'
  const canDiscard = Boolean(target?.capabilities.discard)

  const closeCommit = (): void => {
    if (submitting === null) setCommitMode(null)
  }
  const closeDiscard = (): void => {
    if (submitting === null) setDiscardOpen(false)
  }

  const primary = ready ? (
    <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={allDisabled || !target.capabilities.preview} onClick={() => { void previewLocal() }}>
      {submitting === 'preview' ? '同步中…' : '同步到 Local 验收'}
    </button>
  ) : previewActive ? (
    <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={allDisabled || !target.capabilities.finalizePreview} onClick={() => setCommitMode('finalize_preview')}>
      验收通过并提交
    </button>
  ) : previewRecovery ? (
    <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.rollbackPreview} onClick={() => { void rollbackPreview(true) }}>
      {submitting === 'rollback' ? '处理中…' : safeFastForwardRecovery ? '安全重试撤回' : target?.state === 'preview_detached' ? '重新检查撤回' : '重新尝试撤回'}
    </button>
  ) : cleanupPending ? (
    <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.retryCleanup} onClick={() => { void retryCleanup() }}>
      {submitting === 'retry_cleanup' ? '清理中…' : '重试清理环境'}
    </button>
  ) : null

  return (
    <section className="dsh-wt-review-actions" aria-label="验收操作">
      {!live ? <p className="dsh-wt-status">{unavailableMessage}</p> : null}
      {terminal ? (
        <p className="dsh-wt-status">
          {target.state === 'retained'
            ? `本轮已提交，运行环境暂时保留${target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : ''}`
            : `本轮已交付${target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : ''}`}
        </p>
      ) : (
        <div className="dsh-wt-actions">
          {primary}
          <details className="dsh-wt-more-menu">
            <summary className="dsh-wt-more-trigger" aria-label="更多交付操作">•••</summary>
            <div className="dsh-wt-more-content" role="menu">
              {focusReview ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" onClick={(event) => {
                  focusReview()
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}>查看验收卡</button>
              ) : null}
              {ready ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.finalize} onClick={(event) => {
                  setCommitMode('finish')
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}>跳过验收，直接提交</button>
              ) : null}
              {previewActive || previewRecovery ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.rollbackPreview} onClick={(event) => {
                  void rollbackPreview(true)
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}>撤回本次预览</button>
              ) : null}
              {canDiscard ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item dsh-wt-danger-text" disabled={allDisabled} onClick={(event) => {
                  setDiscardOpen(true)
                  event.currentTarget.closest('details')?.removeAttribute('open')
                }}>放弃任务</button>
              ) : null}
            </div>
          </details>
        </div>
      )}

      <Modal
        open={commitMode !== null}
        onClose={closeCommit}
        title={commitMode === 'finalize_preview' ? '验收通过并提交？' : '跳过 Local 验收，直接提交？'}
        closeLabel="关闭提交确认"
        description={commitMode === 'finalize_preview'
          ? '只会提交当前可撤回 Preview 对应的任务增量；Local 中无关修改不会进入该 Commit。'
          : '将跳过 Local Preview 验收并直接提交本轮 Worktree 增量。'}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeCommit}>取消</button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null || !commitMessage.trim() || commitMessage.trim().length > 500} onClick={() => { void submitCommit() }}>
              {submitting === 'finish' || submitting === 'finalize_preview'
                ? '正在提交…'
                : retainEnvironment ? '确认提交并保留环境' : '确认提交并清理'}
            </button>
          </div>
        )}
      >
        <div className="dsh-wt-commit-dialog">
          <label htmlFor={`${formId}-message`}>Commit Message</label>
          <textarea id={`${formId}-message`} aria-label="Commit Message" rows={6} maxLength={500} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} />
          <div className="dsh-wt-character-count">{commitMessage.length}/500</div>
          <label className="dsh-wt-retention-check">
            <input type="checkbox" checked={retainEnvironment} onChange={event => setRetainEnvironment(event.target.checked)} />
            <span>提交后暂时保留当前运行环境</span>
          </label>
          {retainEnvironment ? (
            <label className="dsh-wt-retention-select">
              <span>保留时长</span>
              <select aria-label="保留时长" value={retention} onChange={event => setRetention(event.target.value as Exclude<WorktreeRetentionMode, 'cleanup'>)}>
                <option value="retain_24h">保留 24 小时</option>
                <option value="retain_3d">保留 3 天</option>
                <option value="retain_manual">手动清理</option>
              </select>
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={discardOpen}
        onClose={closeDiscard}
        title="放弃本轮任务？"
        closeLabel="关闭放弃确认"
        description={previewActive
          ? '会先安全撤回本次 Local Preview，再清理 Worktree；无法无损撤回时会停止，不会覆盖 Local 修改。'
          : 'Worktree 中尚未交付的修改将被永久丢弃，Local 不受影响。'}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeDiscard}>取消</button>
            <button type="button" className="dsh-wt-button dsh-wt-danger" disabled={submitting !== null} onClick={() => { void discard() }}>
              {submitting === 'discard' ? '正在放弃…' : '确认放弃任务'}
            </button>
          </div>
        )}
      />

      {preflight ? <div className="dsh-wt-preflight" data-preflight={preflight.status}>{preflightMessage(preflight)}</div> : null}
      <div className="dsh-wt-action-status" aria-live="polite">
        {submitting ? '正在处理 Worktree，请稍候…' : message}
      </div>
      {error && !isStale(error) ? (
        <div className="dsh-wt-error" role="alert">
          {error.message}（{worktreeConsoleErrorMeta(error.code).category}；恢复方式：{worktreeConsoleErrorMeta(error.code).recovery}）
        </div>
      ) : null}
    </section>
  )
}
