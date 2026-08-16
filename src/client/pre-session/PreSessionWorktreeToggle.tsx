import { useCallback, useEffect, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import type {
  PreSessionDraftActions,
  PreSessionDraftState,
  PreparePreSessionWorktreeRequest,
} from './controller.js'

export interface PreSessionWorktreeToggleProps {
  sessionId: string
  session: { composerPhase: string }
  input: PreSessionDraftState
  inputActions: PreSessionDraftActions
  adapter: WorktreeConsoleAdapter
  controller: { prepare(request: PreparePreSessionWorktreeRequest): Promise<WorktreeConsoleTargetDetails> }
}

type LoadState = 'loading' | 'idle' | 'preparing' | 'error'

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

/** Blank-session Worktree switch mounted in Harness's public composer tool row. */
export function PreSessionWorktreeToggle({
  sessionId,
  session,
  input,
  inputActions,
  adapter,
  controller,
}: PreSessionWorktreeToggleProps) {
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const blank = session.composerPhase === 'blank'

  const refreshCurrent = useCallback(async (): Promise<void> => {
    setState('loading')
    setError(null)
    const outcome = await adapter.current({ sessionId })
    if (!outcome.ok) {
      setTarget(null)
      setState('error')
      setError(`${outcome.error.code}: ${outcome.error.message}`)
      return
    }
    setTarget(outcome.value.target)
    setState('idle')
  }, [adapter, sessionId])

  useEffect(() => {
    if (!blank) return
    let active = true
    void adapter.current({ sessionId }).then((outcome) => {
      if (!active) return
      if (!outcome.ok) {
        setTarget(null)
        setState('error')
        setError(`${outcome.error.code}: ${outcome.error.message}`)
        return
      }
      setTarget(outcome.value.target)
      setState('idle')
      setError(null)
    })
    return () => { active = false }
  }, [adapter, blank, sessionId])

  if (!blank) return null

  const selected = target?.state !== undefined && target.state !== 'local'
  const canCreate = target?.state === 'local' && target.capabilities.create
  const busy = state === 'loading' || state === 'preparing'
  const retryingLookup = state === 'error' && target === null
  const disabled = busy || selected || (!canCreate && !retryingLookup) || input.phase !== 'plain'
  const status = state === 'preparing'
    ? '正在创建…'
    : selected
      ? '已创建'
      : state === 'loading'
        ? '检查中…'
        : state === 'error'
          ? '重试'
          : 'Local'

  const prepare = async (): Promise<void> => {
    if (disabled) return
    if (retryingLookup) {
      await refreshCurrent()
      return
    }
    setState('preparing')
    setError(null)
    try {
      const prepared = await controller.prepare({ sessionId, input, inputActions })
      setTarget(prepared)
      setState('idle')
    } catch (cause) {
      setState('error')
      setError(errorMessage(cause))
    }
  }

  return (
    <span className="dsh-wt-pre-session" data-state={state}>
      <button
        type="button"
        role="switch"
        aria-label="Worktree"
        aria-checked={selected}
        aria-describedby={error ? `dsh-wt-pre-session-error-${sessionId}` : undefined}
        className="dsh-wt-pre-session-switch"
        disabled={disabled}
        onClick={() => { void prepare() }}
      >
        <span className="dsh-wt-pre-session-check" aria-hidden>{selected ? '✓' : ''}</span>
        <span>Worktree</span>
        <span className="dsh-wt-pre-session-state" aria-live="polite">{status}</span>
      </button>
      {error ? (
        <span id={`dsh-wt-pre-session-error-${sessionId}`} className="dsh-wt-pre-session-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
