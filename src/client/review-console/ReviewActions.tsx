import { useEffect, useId, useRef, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { worktreeConsoleErrorMeta } from '../../console-contract.js'
import type { WorktreeRetentionMode } from '../../types.js'
import type { WorktreeReviewIdentity } from './WorktreeReviewPanel.js'

interface ReviewActionsProps {
  adapter?: WorktreeConsoleAdapter | null
  identity?: WorktreeReviewIdentity
  target?: WorktreeConsoleTargetSummary
  disabled: boolean
  unavailableMessage: string
  inspect?: () => void
  onStale: (error: WorktreeConsoleError) => void
  onTargetChange: (target: WorktreeConsoleTargetSummary) => void
}

type Mutation = 'finalize' | 'discard' | 'retention'

const RETENTIONS: Array<{ value: Exclude<WorktreeRetentionMode, 'cleanup'>; label: string }> = [
  { value: 'retain_24h', label: 'Retain 24h' },
  { value: 'retain_3d', label: 'Retain 3d' },
  { value: 'retain_manual', label: 'Manual retention' },
]

function isStale(error: WorktreeConsoleError): boolean {
  return error.code === 'stale_target' || error.code === 'stale_isolated' || error.code === 'stale_local'
}

export function ReviewActions({
  adapter,
  identity,
  target,
  disabled,
  unavailableMessage,
  inspect,
  onStale,
  onTargetChange,
}: ReviewActionsProps) {
  const dialogId = useId()
  const [submitting, setSubmitting] = useState<Mutation | null>(null)
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<WorktreeConsoleError | null>(null)
  const mutationLock = useRef(false)
  const confirmButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (confirmingDiscard) confirmButton.current?.focus()
  }, [confirmingDiscard])

  const begin = (mutation: Mutation): boolean => {
    if (disabled || !adapter || !identity || !target || mutationLock.current) return false
    mutationLock.current = true
    setSubmitting(mutation)
    setMessage(null)
    setError(null)
    return true
  }

  const finishError = (nextError: WorktreeConsoleError): void => {
    setError(nextError)
    if (isStale(nextError)) onStale(nextError)
    mutationLock.current = false
    setSubmitting(null)
  }

  const finalize = async (retention: WorktreeRetentionMode): Promise<void> => {
    if (!begin('finalize') || !adapter || !identity) return
    const outcome = await adapter.finalize({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
      expectedReviewId: identity.expectedReviewId,
      retention,
    })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    onTargetChange(outcome.value.target)
    setMessage(`Finalized with ${retention} at revision ${outcome.value.target.revision}.`)
    mutationLock.current = false
    setSubmitting(null)
  }

  const discard = async (): Promise<void> => {
    if (!begin('discard') || !adapter || !identity) return
    setConfirmingDiscard(false)
    const outcome = await adapter.discard({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
      confirmDirty: true,
    })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    onTargetChange(outcome.value.target)
    setMessage(`Discarded at revision ${outcome.value.target.revision}.`)
    mutationLock.current = false
    setSubmitting(null)
  }

  const setRetention = async (retention: Exclude<WorktreeRetentionMode, 'cleanup'>): Promise<void> => {
    if (!begin('retention') || !adapter || !identity || !target) return
    const outcome = await adapter.setRetention({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: target.revision,
      retention,
    })
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    onTargetChange(outcome.value.target)
    setMessage(`Retention updated to ${retention} at revision ${outcome.value.target.revision}.`)
    mutationLock.current = false
    setSubmitting(null)
  }

  const live = Boolean(adapter && identity && target)
  const allDisabled = disabled || submitting !== null || !live
  const canFinalize = target?.state === 'ready_for_review' && target.capabilities.finalize
  const canDiscard = target?.state === 'ready_for_review' && target.capabilities.discard
  const canSetRetention = target?.state === 'retained' && target.capabilities.setRetention
  const terminal = target && target.state !== 'ready_for_review' && target.state !== 'retained'

  return (
    <section className="dsh-wt-review-section" aria-label="Review actions">
      {!live ? <p className="dsh-wt-status">{unavailableMessage}</p> : null}
      {target?.state === 'retained' ? (
        <div className="dsh-wt-retained-summary">
          <strong>Retained target</strong>
          <span>Commit: <code className="dsh-wt-code">{target.commitOid ?? 'none'}</code></span>
          <span>Cleanup: {target.cleanupMessage ?? target.retention ?? 'scheduled'}</span>
        </div>
      ) : null}
      {terminal ? (
        <p className="dsh-wt-status">Target state: {target.state}. Server revision: {target.revision}.</p>
      ) : (
        <div className="dsh-wt-actions">
          <button
            type="button"
            className="dsh-wt-button dsh-wt-primary"
            disabled={allDisabled || !canFinalize}
            onClick={() => void finalize('cleanup')}
          >
            {submitting === 'finalize' ? 'Finalizing…' : 'Finalize cleanup'}
          </button>
          {RETENTIONS.map(({ value, label }) => (
            <button
              type="button"
              className="dsh-wt-button"
              disabled={allDisabled || (!canFinalize && !canSetRetention)}
              onClick={() => void (canSetRetention ? setRetention(value) : finalize(value))}
              key={value}
            >
              {submitting === 'retention' || submitting === 'finalize' ? 'Submitting…' : label}
            </button>
          ))}
          <button
            type="button"
            className="dsh-wt-button dsh-wt-danger"
            disabled={allDisabled || !canDiscard}
            onClick={() => setConfirmingDiscard(true)}
          >
            Discard
          </button>
          {inspect ? <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={inspect}>Inspect</button> : null}
        </div>
      )}

      {confirmingDiscard ? (
        <div
          className="dsh-wt-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={`${dialogId}-title`}
          aria-describedby={`${dialogId}-description`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setConfirmingDiscard(false)
          }}
        >
          <strong id={`${dialogId}-title`}>Discard Worktree changes?</strong>
          <p id={`${dialogId}-description`}>This will not commit the Worktree changes to Local. The dirty isolated checkout will be discarded.</p>
          <div className="dsh-wt-actions">
            <button ref={confirmButton} type="button" className="dsh-wt-button dsh-wt-danger" onClick={() => void discard()}>Confirm dirty discard</button>
            <button type="button" className="dsh-wt-button" onClick={() => setConfirmingDiscard(false)}>Cancel</button>
          </div>
        </div>
      ) : null}

      <div className="dsh-wt-action-status" aria-live="polite">
        {submitting ? 'A Worktree mutation is submitting. All mutation controls are disabled.' : message}
      </div>
      {error && !isStale(error) ? (
        <div className="dsh-wt-error" role="alert">
          {error.message} ({worktreeConsoleErrorMeta(error.code).category}; recovery: {worktreeConsoleErrorMeta(error.code).recovery})
        </div>
      ) : null}
    </section>
  )
}
