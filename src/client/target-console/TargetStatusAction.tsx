import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleTargetDetails,
  WorktreeConsoleTargetState,
} from '../../console-contract.js'
import { openExistingSession, type WorktreeClientServices } from '../actions.js'
import { requestWorktreeReviewRefresh, WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
import { WorktreeManagerModal } from './WorktreeManagerModal.js'

export interface TargetStatusActionProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
}

const STATE_LABELS: Record<WorktreeConsoleTargetState, string> = {
  local: 'Local',
  creating: '创建中…',
  working: '修改中',
  ready_for_review: '待验收',
  preview_active: 'Local 验收中',
  preview_detached: '预览待恢复',
  retained: '已保留',
  cleanup_pending: '清理中',
  recovery_required: '需要恢复',
  delivered: '已交付',
}

function shortOid(value: string): string {
  return value === 'unversioned' ? value : value.slice(0, 7)
}

/** Interactive Session Target capsule with source-linked management actions. */
export function TargetStatusAction({ sessionId, adapter, services }: TargetStatusActionProps) {
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'discard' | 'retry_cleanup' | null>(null)
  const mounted = useRef(true)
  const request = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    const token = ++request.current
    try {
      const outcome = await adapter.current({ sessionId })
      if (!mounted.current || token !== request.current) return
      if (outcome.ok) {
        setTarget(outcome.value.target)
        setError(null)
      } else {
        setError(outcome.error.message)
      }
    } catch (reason) {
      if (mounted.current && token === request.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (mounted.current && token === request.current) setLoading(false)
    }
  }, [adapter, sessionId])

  useEffect(() => {
    request.current += 1
    setTarget(null)
    setLoading(true)
    setMenuOpen(false)
    setManagerOpen(false)
    setCleanupConfirmOpen(false)
    setPendingAction(null)
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

  const state = target?.state ?? (loading ? 'loading' : 'error')
  const stateLabel = state === 'loading' ? '加载中…' : state === 'error' ? '不可用' : STATE_LABELS[state]
  const triggerLabel = target?.state === 'local' ? 'Local' : target ? `Worktree · ${stateLabel}` : stateLabel
  const expiry = target?.state === 'retained' && target.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString()
    : null
  const accessibleLabel = expiry === null ? `Session Target：${triggerLabel}` : `Session Target：${triggerLabel}，到期 ${expiry}`

  const reveal = (): void => {
    if (!target?.managedRoot) return
    setMenuOpen(false)
    void services.workspaces.openPath(target.managedRoot).catch(reason => {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  const openSource = (): void => {
    if (!target || target.sourceSessionId === sessionId) return
    setMenuOpen(false)
    if (target.sourceRoot === null || !openExistingSession(services, target.sourceSessionId, target.sourceRoot)) {
      setError('来源 Session 的 cwd 无法与 Host 记录的 Local root 匹配。')
    }
  }

  const retryCleanup = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.retryCleanup || pendingAction !== null) return
    setMenuOpen(false)
    setPendingAction('retry_cleanup')
    setError(null)
    try {
      const outcome = await adapter.retryCleanup({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
      })
      if (!mounted.current) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? {
        ...current,
        ...outcome.value.target,
        ...(outcome.value.target.phase === 'discarded' ? { managedRoot: null } : {}),
      } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mounted.current) setPendingAction(null)
    }
  }

  const discard = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.discard || pendingAction !== null) return
    setCleanupConfirmOpen(false)
    setPendingAction('discard')
    setError(null)
    try {
      const outcome = await adapter.discard({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        confirmDirty: true,
        ...(target.state === 'preview_active' || target.capabilities.rollbackPreview
          ? { rollbackPreview: true }
          : {}),
      })
      if (!mounted.current) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? {
        ...current,
        ...outcome.value.target,
        ...(outcome.value.target.phase === 'discarded' ? { managedRoot: null } : {}),
      } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (mounted.current) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (mounted.current) setPendingAction(null)
    }
  }

  const summary = target ? (
    <span className="dsh-wtc-menu-summary">
      <strong>{triggerLabel}</strong>
      <span>{target.project.name}</span>
      <span>来源 {shortOid(target.sourceOid)} · 当前 {shortOid(target.currentOid)} · Iteration {target.iteration}</span>
      {expiry ? <span>保留至 {expiry}</span> : null}
      {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
    </span>
  ) : error ?? triggerLabel

  const items: MenuEntry[] = [
    { id: 'summary', label: summary, disabled: true },
    { type: 'separator', id: 'summary-separator' },
    ...(target?.managedRoot && target.capabilities.open ? [{ id: 'reveal', label: '打开当前工作位置' } satisfies MenuEntry] : []),
    ...(target && target.sourceSessionId !== sessionId
      ? [{ id: 'source', label: '返回来源 Session' } satisfies MenuEntry]
      : []),
    ...(target ? [{ id: 'manager', label: '管理关联 Worktrees' } satisfies MenuEntry] : []),
  ]
  const footer: MenuEntry[] = target?.capabilities.retryCleanup
    ? [{ id: 'retry_cleanup', label: pendingAction === 'retry_cleanup' ? '处理中…' : '重试清理环境', disabled: pendingAction !== null }]
    : target?.capabilities.discard
      ? [{ id: 'discard', label: pendingAction === 'discard' ? '处理中…' : '放弃任务并清理 Worktree', danger: true, disabled: pendingAction !== null }]
      : []

  return (
    <>
      <Menu
        open={menuOpen}
        align="end"
        portal
        compact
        onClose={() => setMenuOpen(false)}
        items={items}
        footer={footer}
        onSelect={(id) => {
          if (id === 'reveal') reveal()
          if (id === 'source') openSource()
          if (id === 'manager') { setMenuOpen(false); setManagerOpen(true) }
          if (id === 'retry_cleanup') void retryCleanup()
          if (id === 'discard') { setMenuOpen(false); setCleanupConfirmOpen(true) }
        }}
        anchor={(
          <button
            type="button"
            className="dsh-wtc-target-chip"
            data-target-state={state}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={accessibleLabel}
            title="Session Target 与关联 Worktrees"
            onClick={() => setMenuOpen(current => !current)}
          >
            <span className="dsh-wtc-target-dot" aria-hidden />
            {target?.state === 'local' || !target ? triggerLabel : <>Worktree · <span>{stateLabel}</span></>}
            {expiry ? <span className="dsh-wtc-target-expiry">· {expiry}</span> : null}
            <span className="dsh-wtc-target-chevron" aria-hidden />
          </button>
        )}
      />
      <WorktreeManagerModal
        open={managerOpen}
        sessionId={sessionId}
        adapter={adapter}
        services={services}
        focusCheckoutId={target?.checkoutId}
        onClose={() => setManagerOpen(false)}
        onTargetChange={() => {
          requestWorktreeReviewRefresh(sessionId)
          void refresh()
        }}
      />
      <Modal
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        title="放弃任务并清理 Worktree？"
        closeLabel="取消清理 Worktree"
        description={target?.state === 'preview_active'
          ? 'Host 会先安全撤回 Local Preview；无法证明可无损撤回时会停止并保留恢复现场。'
          : 'Worktree 中尚未交付的修改会永久丢弃；Local Checkout 不会被静默覆盖。'}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => setCleanupConfirmOpen(false)}>取消</button>
            <button type="button" className="dsh-wtc-button dsh-wtc-danger" disabled={pendingAction !== null} onClick={() => { void discard() }}>
              确认清理 Worktree
            </button>
          </span>
        )}
      />
    </>
  )
}
