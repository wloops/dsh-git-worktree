import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  worktreeConsoleErrorMeta,
  type WorktreeConsoleAdapter,
  type WorktreeConsoleError,
  type WorktreeConsoleErrorCode,
  type WorktreeConsoleListResponse,
  type WorktreeConsoleMutationResponse,
  type WorktreeConsoleTargetDetails,
  type WorktreeConsoleTargetState,
  type WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { openIsolatedTarget, type WorktreeClientServices } from '../actions.js'

export interface WorktreeConsoleViewProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
}

const STATE_LABELS: Record<WorktreeConsoleTargetState, string> = {
  local: 'Local',
  creating: 'Creating…',
  working: 'Working',
  ready_for_review: 'Ready',
  retained: 'Retained',
  cleanup_pending: 'Cleanup',
  recovery_required: 'Recovery',
  delivered: 'Delivered',
}

interface ConsoleSnapshot {
  sessionId: string
  current: WorktreeConsoleTargetDetails
  list: WorktreeConsoleListResponse
}

function errorText(error: WorktreeConsoleError): string {
  const meta = worktreeConsoleErrorMeta(error.code)
  const next = {
    refresh: 'Refresh to read the latest server state.',
    confirm_dirty: 'Confirm the dirty target before retrying.',
    open_recovery: 'Open the recovery diagnostics before another mutation.',
    retry: 'Retry after the transient failure.',
    none: 'This action cannot be completed from the current Session.',
  }[meta.recovery]
  return `[${meta.category}] ${error.code}: ${error.message} ${next}`
}

function TargetState({ target }: { target: WorktreeConsoleTargetSummary }) {
  return (
    <span className="dsh-wtc-state" data-target-state={target.state}>
      <span className="dsh-wtc-state-dot" aria-hidden />
      {STATE_LABELS[target.state]}
    </span>
  )
}

/** Project-scoped Worktree management surface backed only by WorktreeConsoleAdapter. */
export function WorktreeConsoleView({ sessionId, adapter, services }: WorktreeConsoleViewProps) {
  const mounted = useRef(true)
  const request = useRef(0)
  const sessionGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<WorktreeConsoleTargetSummary | null>(null)
  const [inspected, setInspected] = useState<Record<string, WorktreeConsoleTargetDetails>>({})
  const confirmButton = useRef<HTMLButtonElement>(null)
  const visibleSnapshot = snapshot?.sessionId === sessionId ? snapshot : null

  useLayoutEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useLayoutEffect(() => {
    sessionGeneration.current += 1
    request.current += 1
    setSnapshot(null)
    setInspected({})
    setConfirmTarget(null)
    setPendingAction(null)
    setError(null)
    setLoading(true)
  }, [sessionId])

  const isActive = (generation: number): boolean =>
    mounted.current && sessionGeneration.current === generation

  const refresh = useCallback(async (clearError = true): Promise<void> => {
    const generation = sessionGeneration.current
    const token = ++request.current
    setLoading(true)
    if (clearError) setError(null)
    try {
      const [current, list] = await Promise.all([
        adapter.current({ sessionId }),
        adapter.list({ sessionId }),
      ])
      if (!isActive(generation) || token !== request.current) return
      if (!current.ok) {
        setError(errorText(current.error))
        return
      }
      if (!list.ok) {
        setError(errorText(list.error))
        return
      }
      setSnapshot({ sessionId, current: current.value.target, list: list.value })
    } catch (reason) {
      if (isActive(generation) && token === request.current) {
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (isActive(generation) && token === request.current) setLoading(false)
    }
  }, [adapter, sessionId])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (confirmTarget !== null) confirmButton.current?.focus()
  }, [confirmTarget])

  const applyMutation = (response: WorktreeConsoleMutationResponse, generation: number): void => {
    if (!isActive(generation)) return
    setSnapshot(current => {
      if (current === null || current.sessionId !== sessionId) return current
      const target = response.target
      const nextCurrent = current.current.checkoutId === target.checkoutId
        ? { ...current.current, ...target }
        : current.current
      return {
        sessionId,
        current: nextCurrent,
        list: {
          ...current.list,
          worktrees: current.list.worktrees.map(row => row.checkoutId === target.checkoutId ? target : row),
        },
      }
    })
  }

  const mutationError = (code: WorktreeConsoleErrorCode, message: string, generation: number): void => {
    if (!isActive(generation)) return
    setError(errorText({ code, message }))
    if (code === 'stale_target' || code === 'stale_local' || code === 'stale_isolated') {
      void refresh(false)
    }
  }

  const createTarget = async (): Promise<void> => {
    if (pendingAction !== null || visibleSnapshot?.current.capabilities.create !== true) return
    const generation = sessionGeneration.current
    const sourceProjectId = visibleSnapshot.current.project.id
    setPendingAction('create')
    setError(null)
    try {
      const outcome = await adapter.create({ sourceSessionId: sessionId })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        setError(errorText(outcome.error))
        return
      }
      const { target, targetSessionId, managedRoot } = outcome.value
      if (target.sourceSessionId !== sessionId) {
        throw new Error('Host returned a target for a different source Session.')
      }
      if (targetSessionId === sessionId) {
        throw new Error('Host returned the source Session as the isolated target Session.')
      }
      if (
        target.checkoutId === null
        || target.targetSessionId !== targetSessionId
        || target.ownerSessionId !== targetSessionId
        || target.managedRoot !== managedRoot
        || target.project.id !== sourceProjectId
        || !target.capabilities.open
      ) {
        throw new Error('Host returned inconsistent target Session identity.')
      }
      await openIsolatedTarget(services, { targetSessionId, managedRoot }, () => isActive(generation))
      if (!isActive(generation)) return
      setSnapshot(current => current === null || current.sessionId !== sessionId ? current : {
        sessionId,
        current: target,
        list: {
          ...current.list,
          worktrees: [
            ...current.list.worktrees.filter(row => row.checkoutId !== target.checkoutId),
            (() => {
              const { managedRoot: _root, sourceOid: _source, currentBranch: _branch, ...summary } = target
              return summary
            })(),
          ],
        },
      })
      void refresh()
    } catch (reason) {
      if (isActive(generation)) {
        setError(reason instanceof Error ? reason.message : String(reason))
        void refresh(false)
      }
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const discardTarget = async (target: WorktreeConsoleTargetSummary, confirmDirty: boolean): Promise<void> => {
    if (pendingAction !== null || target.checkoutId === null || !target.capabilities.discard) return
    const generation = sessionGeneration.current
    setConfirmTarget(null)
    setPendingAction(`discard:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.discard({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        confirmDirty,
      })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      applyMutation(outcome.value, generation)
      void refresh()
    } catch (reason) {
      if (isActive(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const retryCleanup = async (target: WorktreeConsoleTargetSummary): Promise<void> => {
    if (pendingAction !== null || target.checkoutId === null || !target.capabilities.retryCleanup) return
    const generation = sessionGeneration.current
    setPendingAction(`cleanup:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.retryCleanup({
        sessionId,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
      })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      applyMutation(outcome.value, generation)
      void refresh()
    } catch (reason) {
      if (isActive(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const inspectTarget = async (target: WorktreeConsoleTargetSummary): Promise<void> => {
    if (pendingAction !== null || target.checkoutId === null || !target.capabilities.inspect) return
    const generation = sessionGeneration.current
    setPendingAction(`inspect:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.inspect({ sessionId, checkoutId: target.checkoutId })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      if (outcome.value.target.checkoutId !== target.checkoutId) {
        throw new Error('Inspect returned a different checkout identity.')
      }
      setInspected(current => ({ ...current, [target.checkoutId!]: outcome.value.target }))
    } catch (reason) {
      if (isActive(generation)) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  const openListedTarget = async (target: WorktreeConsoleTargetSummary): Promise<void> => {
    if (
      pendingAction !== null
      || target.checkoutId === null
      || !target.capabilities.open
      || !target.capabilities.inspect
    ) return
    const generation = sessionGeneration.current
    setPendingAction(`open:${target.checkoutId}`)
    setError(null)
    try {
      const outcome = await adapter.inspect({ sessionId, checkoutId: target.checkoutId })
      if (!isActive(generation)) return
      if (!outcome.ok) {
        mutationError(outcome.error.code, outcome.error.message, generation)
        return
      }
      const detail = outcome.value.target
      if (!detail.capabilities.open) {
        throw new Error('The latest server state no longer allows Open.')
      }
      if (
        detail.checkoutId !== target.checkoutId
        || detail.project.id !== target.project.id
        || detail.sourceSessionId !== target.sourceSessionId
        || detail.ownerSessionId !== target.ownerSessionId
        || detail.targetSessionId !== target.targetSessionId
        || detail.targetSessionId !== detail.ownerSessionId
      ) {
        throw new Error('Inspect returned inconsistent target identity.')
      }
      if (detail.managedRoot === null || detail.targetSessionId === null) {
        throw new Error('Authorized target path or Session identity is unavailable.')
      }
      await openIsolatedTarget(services, {
        managedRoot: detail.managedRoot,
        targetSessionId: detail.targetSessionId,
      }, () => isActive(generation))
    } catch (reason) {
      if (isActive(generation)) {
        setError(reason instanceof Error ? reason.message : String(reason))
        void refresh(false)
      }
    } finally {
      if (isActive(generation)) setPendingAction(null)
    }
  }

  if (loading && visibleSnapshot === null) {
    return <div className="dsh-wtc-loading" role="status" aria-live="polite">Loading Worktree Console…</div>
  }

  return (
    <section className="dsh-wtc-console" aria-label="Worktree Console">
      <header className="dsh-wtc-console-head">
        <div>
          <span className="dsh-wtc-kicker">SESSION TARGET</span>
          <h2>Worktree Console</h2>
        </div>
        <button type="button" className="dsh-wtc-button" disabled={loading} onClick={() => { void refresh() }}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>
      {error ? <div className="dsh-wtc-error" role="alert">{error}</div> : null}
      {visibleSnapshot ? (
        <>
          <section className="dsh-wtc-current" aria-label="Current target">
            <div>
              <span className="dsh-wtc-label">Current target</span>
              <strong>{visibleSnapshot.current.project.name}</strong>
            </div>
            <div className="dsh-wtc-current-actions">
              <TargetState target={visibleSnapshot.current} />
              {visibleSnapshot.current.state !== 'recovery_required' && visibleSnapshot.current.capabilities.create ? (
                <button
                  type="button"
                  className="dsh-wtc-button dsh-wtc-primary"
                  disabled={pendingAction !== null}
                  onClick={() => { void createTarget() }}
                >
                  {pendingAction === 'create' ? 'Creating…' : 'Create Worktree'}
                </button>
              ) : null}
            </div>
          </section>
          <section className="dsh-wtc-list-section" aria-label="Project worktrees">
            <div className="dsh-wtc-section-head">
              <div>
                <span className="dsh-wtc-label">Project</span>
                <h3>{visibleSnapshot.list.project.name}</h3>
              </div>
              <span className="dsh-wtc-count">{visibleSnapshot.list.worktrees.length}</span>
            </div>
            {visibleSnapshot.list.worktrees.length === 0 ? (
              <div className="dsh-wtc-empty">No managed Worktrees in this project.</div>
            ) : (
              <ul className="dsh-wtc-list">
                {visibleSnapshot.list.worktrees.map(target => (
                  <li className="dsh-wtc-row" key={target.checkoutId ?? `local:${target.sourceSessionId}`}>
                    <div className="dsh-wtc-row-main">
                      <div className="dsh-wtc-row-title">
                        <TargetState target={target} />
                        <span className="dsh-wtc-row-id">{target.checkoutId ?? 'Local source'}</span>
                      </div>
                      <div className="dsh-wtc-facts">
                        <span>Iteration {target.iteration}</span>
                        {target.dirty ? <span>Dirty changes</span> : <span>Clean</span>}
                        {target.retention ? <span>Retention: {target.retention}</span> : null}
                        {target.expiresAt ? <span>Expires: {new Date(target.expiresAt).toLocaleString()}</span> : null}
                        {target.cleanupMessage ? <span className="dsh-wtc-recovery-message">{target.cleanupMessage}</span> : null}
                      </div>
                    </div>
                    <div className="dsh-wtc-row-actions">
                      <span className="dsh-wtc-revision">r{target.revision}</span>
                      {target.capabilities.inspect && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={`Inspect ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => { void inspectTarget(target) }}
                        >
                          {pendingAction === `inspect:${target.checkoutId}` ? 'Inspecting…' : 'Inspect'}
                        </button>
                      ) : null}
                      {target.capabilities.open && target.capabilities.inspect && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={`Open ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => { void openListedTarget(target) }}
                        >
                          {pendingAction === `open:${target.checkoutId}` ? 'Opening…' : 'Open'}
                        </button>
                      ) : null}
                      {target.capabilities.discard && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button dsh-wtc-danger"
                          aria-label={`Discard ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => {
                            if (target.dirty) setConfirmTarget(target)
                            else void discardTarget(target, false)
                          }}
                        >
                          {pendingAction === `discard:${target.checkoutId}` ? 'Discarding…' : 'Discard'}
                        </button>
                      ) : null}
                      {target.capabilities.retryCleanup && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={`Retry cleanup ${target.checkoutId}`}
                          disabled={pendingAction !== null}
                          onClick={() => { void retryCleanup(target) }}
                        >
                          {pendingAction === `cleanup:${target.checkoutId}` ? 'Retrying…' : 'Retry cleanup'}
                        </button>
                      ) : null}
                    </div>
                    {target.checkoutId !== null && inspected[target.checkoutId] ? (
                      <div className="dsh-wtc-inspect" aria-label={`Inspection ${target.checkoutId}`}>
                        <span className="dsh-wtc-label">Authorized managed root</span>
                        <code>{inspected[target.checkoutId]!.managedRoot ?? 'Unavailable'}</code>
                        <span className="dsh-wtc-label">Branch</span>
                        <code>{inspected[target.checkoutId]!.currentBranch ?? 'detached'}</code>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
      {confirmTarget !== null ? (
        <div
          className="dsh-wtc-confirm"
          role="alertdialog"
          aria-modal="true"
          aria-label="Discard dirty Worktree?"
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setConfirmTarget(null)
          }}
        >
          <strong>Discard dirty Worktree?</strong>
          <p>
            {sessionId === confirmTarget.sourceSessionId && sessionId !== confirmTarget.ownerSessionId
              ? `The Local source is discarding reserved target ${confirmTarget.checkoutId} and all uncommitted changes.`
              : `This Session is discarding its Worktree ${confirmTarget.checkoutId} and all uncommitted changes.`}
          </p>
          <div className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => { setConfirmTarget(null) }}>Cancel discard</button>
            <button
              ref={confirmButton}
              type="button"
              className="dsh-wtc-button dsh-wtc-danger"
              onClick={() => { void discardTarget(confirmTarget, true) }}
            >
              Confirm dirty discard
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
