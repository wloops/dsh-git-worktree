import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
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

function snapshotInput(input: PreSessionDraftState): PreSessionDraftState {
  return {
    ...input,
    imageIds: [...input.imageIds],
    occurrences: [...input.occurrences],
  }
}

function confirmationDescription(input: PreSessionDraftState): string {
  const attachmentText = input.imageIds.length === 1
    ? '1 个附件'
    : `${input.imageIds.length} 个附件`
  if (input.draft.trim() !== '' && input.imageIds.length > 0) {
    return `当前输入内容和 ${attachmentText}将移动到新的 Worktree 会话。`
  }
  if (input.imageIds.length > 0) return `${attachmentText}将移动到新的 Worktree 会话。`
  if (input.draft.trim() !== '') return '当前输入内容将移动到新的 Worktree 会话。'
  return '将创建新的 Worktree 会话；当前 Local 会话不会收到消息。'
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
  const [pendingInput, setPendingInput] = useState<PreSessionDraftState | null>(null)
  const latestInput = useRef(input)
  latestInput.current = input
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
  const checked = selected || pendingInput !== null || state === 'preparing'
  const status = state === 'preparing'
    ? '正在创建…'
    : selected
      ? '已创建'
      : pendingInput !== null
        ? '待确认'
        : state === 'loading'
          ? '检查中…'
          : state === 'error'
            ? '重试'
            : 'Local'

  const beginConfirmation = async (): Promise<void> => {
    if (disabled) return
    if (retryingLookup) {
      await refreshCurrent()
      return
    }
    setError(null)
    setPendingInput(snapshotInput(input))
  }

  const cancelConfirmation = (): void => {
    if (state === 'preparing') return
    setPendingInput(null)
    setError(null)
    setState('idle')
  }

  const confirm = async (): Promise<void> => {
    const captured = pendingInput
    if (captured === null || state === 'preparing') return
    setState('preparing')
    setError(null)
    try {
      const prepared = await controller.prepare({
        sessionId,
        input: captured,
        currentInput: () => latestInput.current,
        inputActions,
      })
      setTarget(prepared)
      setPendingInput(null)
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
        aria-checked={checked}
        aria-describedby={error && pendingInput === null ? `dsh-wt-pre-session-error-${sessionId}` : undefined}
        className="dsh-wt-pre-session-switch"
        disabled={disabled}
        onClick={() => { void beginConfirmation() }}
      >
        <span className="dsh-wt-pre-session-check" aria-hidden>{checked ? '✓' : ''}</span>
        <span>Worktree</span>
        <span className="dsh-wt-pre-session-state" aria-live="polite">{status}</span>
      </button>
      {error && pendingInput === null ? (
        <span id={`dsh-wt-pre-session-error-${sessionId}`} className="dsh-wt-pre-session-error" role="alert">
          {error}
        </span>
      ) : null}
      <Modal
        open={pendingInput !== null}
        onClose={cancelConfirmation}
        title="在 Worktree 中开始？"
        closeLabel="关闭"
        description={pendingInput === null ? '' : confirmationDescription(pendingInput)}
        footer={(
          <>
            <button type="button" className="dsh-wt-button" disabled={state === 'preparing'} onClick={cancelConfirmation}>
              取消
            </button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={state === 'preparing'} onClick={() => { void confirm() }}>
              {state === 'preparing' ? '正在创建…' : '创建并切换'}
            </button>
          </>
        )}
      >
        <p className="dsh-wt-pre-session-note">Local 会话不会收到这条消息；切换后请在新会话中使用原生发送按钮。</p>
        {error ? <p className="dsh-wt-error" role="alert">{error}</p> : null}
      </Modal>
    </span>
  )
}
