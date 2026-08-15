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
  creating: 'Creating…',
  working: 'Worktree',
  ready_for_review: 'Ready',
  retained: 'Retained',
  cleanup_pending: 'Cleanup',
  recovery_required: 'Recovery',
  delivered: 'Delivered',
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

  const label = state === 'loading' ? 'Loading…' : state === 'error' ? 'Unavailable' : STATE_LABELS[state]
  const expiry = state === 'retained' && target?.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString()
    : null
  const accessibleLabel = expiry === null ? `Session Target: ${label}` : `Session Target: ${label}, expires ${expiry}`
  return (
    <span
      className="dsh-wtc-target-chip"
      data-target-state={state}
      role="status"
      aria-live="polite"
      aria-label={accessibleLabel}
      title="Session Target status. Open the Worktree tab for project controls."
    >
      <span className="dsh-wtc-target-dot" aria-hidden />
      {label}
      {expiry ? <span className="dsh-wtc-target-expiry">· {expiry}</span> : null}
    </span>
  )
}
