import { ReviewIcon } from '../review-console/ReviewIcon.js'
import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../../console-contract.js'
import type { PreSessionDraftActions, PreSessionDraftState, PreparePreSessionWorktreeRequest } from './controller.js'

export interface PreSessionWorktreeToggleProps {
  sessionId: string
  session: { composerPhase: string }
  input: PreSessionDraftState
  inputActions: PreSessionDraftActions
  adapter: WorktreeConsoleAdapter
  controller: { prepare(request: PreparePreSessionWorktreeRequest): Promise<WorktreeConsoleTargetDetails> }
}

type LoadState = 'loading' | 'idle' | 'preparing' | 'error' | 'unsupported'

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function snapshotInput(input: PreSessionDraftState): PreSessionDraftState {
  return { ...input, imageIds: [...input.imageIds], occurrences: [...input.occurrences] }
}

function confirmationDescription(input: PreSessionDraftState, t: ClientTranslator = defaultClientTranslator): string {
  const attachmentText = input.imageIds.length === 1 ? t('1.attachment') : t('attachments', { p0: input.imageIds.length })
  if (input.draft.trim() !== '' && input.imageIds.length > 0) return t('the.current.input.and.will.move.to.the', { p0: attachmentText })
  if (input.imageIds.length > 0) return t('will.move.to.the.new.worktree.session', { p0: attachmentText })
  if (input.draft.trim() !== '') return t('the.current.input.will.move.to.the.new')
  return t('a.new.worktree.session.will.be.created.the')
}

/** Blank-session directory menu mounted in Harness's public composer tool row. */
export function PreSessionWorktreeToggle({ sessionId, session, input, inputActions, adapter, controller }: PreSessionWorktreeToggleProps) {
  const t = useClientTranslator()
  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{ input: PreSessionDraftState; kind: 'ready' | 'empty' | 'files'; token?: string } | null>(null)
  const latestInput = useRef(input)
  latestInput.current = input
  const blank = session.composerPhase === 'blank'
  // Invalidate at render: an old continuation must never navigate or clear
  // the newly selected Session's draft, even before effect cleanup runs.
  const scopeRef = useRef({ sessionId, adapter, blank, alive: true, busy: false })
  if (scopeRef.current.sessionId !== sessionId || scopeRef.current.adapter !== adapter || scopeRef.current.blank !== blank) {
    scopeRef.current.alive = false
    scopeRef.current = { sessionId, adapter, blank, alive: true, busy: false }
  }
  const scope = scopeRef.current
  const isCurrent = (): boolean => scope.alive && scopeRef.current === scope

  const refreshCurrent = async (): Promise<void> => {
    if (scope.busy) return
    scope.busy = true
    setState('loading')
    setError(null)
    try {
      const outcome = await adapter.current({ sessionId })
      if (!isCurrent()) return
      if (!outcome.ok) {
        setTarget(null)
        setState(outcome.error.code === 'not_git_repository' ? 'unsupported' : 'error')
        setError(outcome.error.code === 'not_git_repository' ? null : `${outcome.error.code}: ${outcome.error.message}`)
        return
      }
      setTarget(outcome.value.target)
      setState('idle')
    } catch (cause) {
      if (!isCurrent()) return
      setTarget(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  useEffect(() => {
    scope.alive = true
    setTarget(null)
    setPending(null)
    if (blank) void refreshCurrent()
    return () => { scope.alive = false }
  }, [scope])

  if (!blank || state === 'loading' || state === 'unsupported') return null
  if (target?.state === 'local' && !target.capabilities.create) return null

  const selected = target !== null && target.state !== 'local'
  const canCreate = target?.state === 'local' && target.capabilities.create
  const busy = state === 'preparing'
  const retryingLookup = state === 'error' && target === null
  const disabled = busy || selected || (!canCreate && !retryingLookup) || input.phase !== 'plain'

  const beginConfirmation = async (): Promise<void> => {
    if (disabled || scope.busy || !isCurrent()) return
    if (retryingLookup) { await refreshCurrent(); return }
    scope.busy = true
    setState('preparing')
    setError(null)
    const captured = snapshotInput(latestInput.current)
    try {
      const outcome = adapter.preflightCreate ? await adapter.preflightCreate({ sourceSessionId: sessionId }) : null
      if (!isCurrent()) return
      if (outcome && !outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
      const result = outcome?.ok ? outcome.value : { kind: 'ready' as const }
      setPending({ input: captured, kind: result.kind, token: result.kind === 'empty' ? result.confirmationToken : undefined })
      setState('idle')
    } catch (cause) {
      if (!isCurrent()) return
      setPending(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  const cancelConfirmation = (): void => {
    if (scope.busy) return
    setPending(null)
    setError(null)
    setState('idle')
  }

  const confirm = async (): Promise<void> => {
    if (pending === null || pending.kind === 'files' || scope.busy || !isCurrent()) return
    scope.busy = true
    setState('preparing')
    setError(null)
    const captured = pending
    try {
      const prepared = await controller.prepare({
        sessionId, input: captured.input, currentInput: () => latestInput.current,
        isCurrentSession: isCurrent, inputActions, initialCommitConfirmationToken: captured.token,
      })
      if (!isCurrent()) return
      setTarget(prepared)
      setPending(null)
      setState('idle')
    } catch (cause) {
      if (!isCurrent()) return
      // Tokens are single-use, including when only the client handoff failed.
      setPending(null)
      setState('error')
      setError(errorMessage(cause))
    } finally { scope.busy = false }
  }

  return (
    <span className="dsh-wt-pre-session" data-state={state}>
      <button type="button" role="switch" aria-checked={selected} aria-label={t('worktree')}
        aria-describedby={error ? `dsh-wt-pre-session-error-${sessionId}` : undefined}
        className="dsh-wt-pre-session-toggle" disabled={disabled}
        onClick={() => { void beginConfirmation() }}>
        <span className="dsh-wt-pre-session-check" aria-hidden="true">{selected ? <ReviewIcon name="confirm" /> : null}</span>
        <span>{t('worktree')}</span>
      </button>
      {error ? (
        <span id={`dsh-wt-pre-session-error-${sessionId}`} className="dsh-wt-pre-session-error" role="alert">
          {error} <button type="button" className="dsh-wt-button" disabled={busy} onClick={() => { void beginConfirmation() }}><ReviewIcon name="refresh" />{t('retry')}</button>
        </span>
      ) : null}
      <Modal className="dsh-wt-create-dialog" open={pending !== null} onClose={cancelConfirmation}
        title={pending?.kind === 'empty' ? t('pre.session.initial.title') : t('start.in.a.worktree')}
        closeLabel={t('close')}
        description={pending === null ? '' : pending.kind === 'empty' ? t('pre.session.initial.description') : pending.kind === 'files' ? t('pre.session.files.description') : confirmationDescription(pending.input, t)}
        footer={(
          <>
            <button type="button" className="dsh-wt-button" disabled={busy} onClick={cancelConfirmation}>{t('cancel')}</button>
            {pending?.kind !== 'files' ? <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={busy} onClick={() => { void confirm() }}>
              <ReviewIcon name="create" />{busy ? t('creating') : pending?.kind === 'empty' ? t('pre.session.initial.confirm') : t('create.and.switch')}
            </button> : null}
          </>
        )}>
        {pending?.kind === 'empty' ? <p className="dsh-wt-pre-session-note">{confirmationDescription(pending.input, t)}</p> : null}
        {pending?.kind !== 'files' ? <p className="dsh-wt-pre-session-note">{t('the.local.session.will.not.receive.this.message')}</p> : null}
      </Modal>
    </span>
  )
}
