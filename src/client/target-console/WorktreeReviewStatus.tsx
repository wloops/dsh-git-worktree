import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails, WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { DeliveryProof } from '../review-console/DeliveryProof.js'
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
  const sessionId = session.sessionId
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [startingIteration, setStartingIteration] = useState(false)
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
        setTarget(outcome.value.target)
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
      <section className="dsh-wt-review-dock" aria-label="Worktree 恢复续跑" data-recovery-status={standaloneRecovery.status}>
        <span className="dsh-wt-review-dock-icon" aria-hidden>!</span>
        <span className="dsh-wt-review-dock-copy">
          <strong>{standaloneRecovery.request.kind === 'worktree_apply_conflict' ? 'Worktree 冲突恢复续跑' : '只读验收再生成'}</strong>
          <span>
            {standaloneRecovery.status === 'queued' ? '请求已持久排队，等待精确 owner Session 加载完成且停止 streaming。' : null}
            {standaloneRecovery.status === 'sending' ? '正在通过 Harness 官方 Session API 发送恢复请求…' : null}
            {standaloneRecovery.status === 'sent' ? '恢复请求已交给 Agent。' : null}
            {standaloneRecovery.status === 'cancelled' ? 'Session/checkout 已切换，旧恢复请求已取消。' : null}
            {standaloneRecovery.status === 'failed' ? `恢复请求发送失败：${standaloneRecovery.error}` : null}
          </span>
        </span>
        {standaloneRecovery.status === 'failed' ? (
          <button type="button" className="dsh-wt-button" onClick={() => retryWorktreeRecovery(sessionId)}>重新发送</button>
        ) : null}
      </section>
    )
  }

  if (target?.state === 'delivered' && target.checkoutId !== null && target.capabilities.beginNextIteration) {
    const beginNextIteration = async (): Promise<void> => {
      if (startingIteration) return
      const generation = sessionGeneration.current
      setStartingIteration(true)
      setError(null)
      try {
        const outcome = await adapter.beginNextIteration({
          sessionId,
          checkoutId: target.checkoutId!,
          expectedRevision: target.revision,
        })
        if (!mounted.current || currentSessionId.current !== sessionId || generation !== sessionGeneration.current) return
        if (!outcome.ok) {
          setError(outcome.error.message)
          if (outcome.error.code === 'stale_target') void refresh()
          return
        }
        setTarget(current => current ? { ...current, ...outcome.value.target } : current)
      } catch (reason) {
        if (mounted.current && currentSessionId.current === sessionId && generation === sessionGeneration.current) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      } finally {
        if (mounted.current && currentSessionId.current === sessionId && generation === sessionGeneration.current) setStartingIteration(false)
      }
    }
    return (
      <section className="dsh-wt-review-dock" aria-label="Worktree 下一轮" data-review-state="delivered">
        <span className="dsh-wt-review-dock-icon" aria-hidden>✓</span>
        <span className="dsh-wt-review-dock-copy">
          <strong>本轮已交付，可在原会话继续下一轮修改</strong>
          <span>将安全重建已清理的 Worktree 路径，并保留当前对话。</span>
          <DeliveryProof target={target} compact />
        </span>
        {error ? <span className="dsh-wt-error">{error}</span> : null}
        <button
          type="button"
          className="dsh-wt-button dsh-wt-primary"
          disabled={startingIteration}
          onClick={() => { void beginNextIteration() }}
        >
          {startingIteration ? '正在创建…' : '开始下一轮修改'}
        </button>
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
    setTarget(current => current ? { ...current, ...nextTarget } : current)
  }

  const detachedFromHeadDrift = target.state === 'preview_detached'
    && target.previewRecovery?.reason === 'stale_local'
  const label = target.state === 'ready_for_review'
    ? target.reviewSlot === 'waiting' ? '另一个任务正在占用 Local 验收槽位' : '修改已完成，等待你预览确认'
    : target.state === 'preview_active'
      ? '正在预览本次修改，确认后即可保存'
      : target.state === 'preview_detached'
        ? detachedFromHeadDrift ? '当前项目已有新变化，预览等待安全恢复' : '预览与 Local 发生冲突，已保留恢复现场'
        : target.state === 'recovery_required'
          ? '预览需要恢复，安全记录已保留'
          : target.state === 'cleanup_pending'
          ? '修改已保存，Worktree 清理待重试'
          : '修改已保存，运行环境暂时保留'
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
        services={services}
        identity={identity}
        target={target}
        disabled={false}
        unavailableMessage="实时 Worktree Console 未连接。"
        focusReview={focusReview}
        isActive={() => mounted.current && currentSessionId.current === sessionId && sessionGeneration.current === actionGeneration}
        onStale={() => { void refresh() }}
        onTargetChange={applyTarget}
      />
    </section>
  )
}
