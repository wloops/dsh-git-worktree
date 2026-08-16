import { useLayoutEffect, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleTargetDetails,
  WorktreeConsoleTargetState,
} from '../../console-contract.js'

export interface TargetStatusActionProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
}

const STATE_LABELS: Record<WorktreeConsoleTargetState, string> = {
  local: 'Local',
  creating: '创建中…',
  working: 'Worktree',
  ready_for_review: '待验收',
  preview_active: 'Local 验收中',
  preview_detached: '预览待恢复',
  retained: '已保留',
  cleanup_pending: '清理中',
  recovery_required: '需要恢复',
  delivered: '已交付',
}

/** Read-only Session Target capsule. The Harness header slot exposes no public view-switch action. */
export function TargetStatusAction({ sessionId, adapter }: TargetStatusActionProps) {
  const [state, setState] = useState<WorktreeConsoleTargetState | 'loading' | 'error'>('loading')
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)

  useLayoutEffect(() => {
    let active = true
    setState('loading')
    setTarget(null)
    void adapter.current({ sessionId }).then((outcome) => {
      if (!active) return
      if (outcome.ok) {
        setTarget(outcome.value.target)
        setState(outcome.value.target.state)
      } else {
        setState('error')
      }
    }, () => {
      if (active) setState('error')
    })
    return () => { active = false }
  }, [adapter, sessionId])

  const label = state === 'loading' ? '加载中…' : state === 'error' ? '不可用' : STATE_LABELS[state]
  const expiry = state === 'retained' && target?.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString()
    : null
  const accessibleLabel = expiry === null ? `Session Target：${label}` : `Session Target：${label}，到期 ${expiry}`
  return (
    <span
      className="dsh-wtc-target-chip"
      data-target-state={state}
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      title="Session Target 状态；高级管理请打开 Worktree 标签页。"
    >
      <span className="dsh-wtc-target-dot" aria-hidden />
      {label}
      {expiry ? <span className="dsh-wtc-target-expiry">· {expiry}</span> : null}
    </span>
  )
}
