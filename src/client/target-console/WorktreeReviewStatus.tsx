import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails, WorktreeConsoleTargetSummary } from '../../console-contract.js'
import { ReviewActions } from '../review-console/ReviewActions.js'
import { reviewEvidenceFromTarget, reviewIdentityFromTarget } from '../review-console/index.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'

export interface WorktreeReviewStatusProps {
  session: { sessionId: string }
  adapter: WorktreeConsoleAdapter
}

/** Domi-style compact delivery status above the native Harness composer. */
export function WorktreeReviewStatus({ session, adapter }: WorktreeReviewStatusProps) {
  const sessionId = session.sessionId
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const refreshing = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    if (refreshing.current) return
    refreshing.current = true
    try {
      const outcome = await adapter.current({ sessionId })
      if (!mounted.current) return
      if (outcome.ok) {
        setTarget(outcome.value.target)
        setError(null)
      } else {
        setError(outcome.error.message)
      }
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      refreshing.current = false
    }
  }, [adapter, sessionId])

  useEffect(() => {
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

  if (
    !target
    || !target.review
    || target.checkoutId === null
    || !['ready_for_review', 'preview_active', 'preview_detached', 'cleanup_pending', 'recovery_required', 'retained'].includes(target.state)
  ) return null
  const review = reviewEvidenceFromTarget(target)
  const identity = reviewIdentityFromTarget(sessionId, target)
  if (!review || !identity) return null

  const focusReview = (): void => {
    document.querySelector<HTMLElement>(`[data-worktree-review-id="${CSS.escape(review.reviewId)}"]`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  const applyTarget = (nextTarget: WorktreeConsoleTargetSummary): void => {
    setTarget(current => current ? { ...current, ...nextTarget } : current)
  }

  const detachedFromHeadDrift = target.state === 'preview_detached'
    && target.previewRecovery?.reason === 'stale_local'
  const label = target.state === 'ready_for_review'
    ? target.reviewSlot === 'waiting' ? '另一个任务正在占用 Local 验收槽位' : 'Worktree 已准备好同步到 Local 验收'
    : target.state === 'preview_active'
      ? '本轮修改正在 Local 等待验收'
      : target.state === 'preview_detached'
        ? detachedFromHeadDrift ? 'Local branch/HEAD 已变化，Preview 等待安全撤回' : 'Preview 与 Local 发生冲突，已保留恢复现场'
        : target.state === 'recovery_required'
          ? '验收操作中断，需要恢复 Preview'
          : target.state === 'cleanup_pending'
          ? 'Commit 已创建，Worktree 清理待重试'
          : '本轮已提交，运行环境暂时保留'
  const detail = target.state === 'preview_detached'
    ? detachedFromHeadDrift
      ? '同分支快进可安全重试；切分支或改写历史时不会写入。'
      : '自动撤回会重新检查冲突；无法证明安全时不会写入。'
    : `${review.changedFiles.length} 个文件 · ${review.validationStatus === 'passed' ? '自动验证通过' : '请检查验证结果'}`

  return (
    <section className="dsh-wt-review-dock" aria-label="Worktree 待验收" data-review-state={target.state}>
      <span className="dsh-wt-review-dock-icon" aria-hidden>{target.state === 'preview_detached' || target.state === 'recovery_required' ? '!' : '✓'}</span>
      <span className="dsh-wt-review-dock-copy">
        <strong>{label}</strong>
        <span>{detail}</span>
      </span>
      {error ? <span className="dsh-wt-error">{error}</span> : null}
      <ReviewActions
        review={review}
        adapter={adapter}
        identity={identity}
        target={target}
        disabled={false}
        unavailableMessage="实时 Worktree Console 未连接。"
        focusReview={focusReview}
        onStale={() => { void refresh() }}
        onTargetChange={applyTarget}
      />
    </section>
  )
}
