import { useClientLanguage, useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
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
import {
  openAuthorizedWorktreeTarget,
  openIsolatedTarget,
  type WorktreeClientServices,
} from '../actions.js'

export interface WorktreeConsoleViewProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  focusCheckoutId?: string | null
  onTargetChange?(): void
}

const STATE_LABELS = (t: ClientTranslator = defaultClientTranslator) => ({
  local: 'Local',
  creating: t("creating.2"),
  working: t("editing"),
  ready_for_review: t("ready.for.review"),
  preview_active: t("reviewing.in.local"),
  preview_detached: t("preview.awaiting.recovery"),
  retained: t("retained"),
  cleanup_pending: t("cleanup.pending"),
  recovery_required: t("recovery.required"),
  delivered: t("delivered"),
})

interface ConsoleSnapshot {
  sessionId: string
  current: WorktreeConsoleTargetDetails
  list: WorktreeConsoleListResponse
}

function errorText(error: WorktreeConsoleError, t: ClientTranslator = defaultClientTranslator): string {
  const meta = worktreeConsoleErrorMeta(error.code)
  const next = {
    refresh: t("refresh.to.read.the.latest.host.state"),
    confirm_dirty: t("explicitly.confirm.the.dirty.worktree.and.retry"),
    open_recovery: t("read.recovery.information.before.trying.again"),
    retry: t("retry.after.the.temporary.failure.clears"),
    none: t("the.current.session.is.not.authorized.to.perform"),
  }[meta.recovery]
  return `${error.code}: ${error.message} ${next}`
}

function retentionLabel(retention: NonNullable<WorktreeConsoleTargetSummary['retention']>, t: ClientTranslator = defaultClientTranslator): string {
  if (retention === 'retain_24h') return t("retain.for.24.hours")
  if (retention === 'retain_3d') return t("retain.for.3.days")
  return t("manual.cleanup")
}

function TargetState({ target }: { target: WorktreeConsoleTargetSummary }) {
  const t = useClientTranslator()

  return (
    <span className="dsh-wtc-state" data-target-state={target.state}>
      <span className="dsh-wtc-state-dot" aria-hidden />
      {STATE_LABELS(t)[target.state]}
    </span>
  )
}

const ATTENTION_RANK: Record<WorktreeConsoleTargetState, number> = {
  recovery_required: 0,
  preview_detached: 1,
  cleanup_pending: 2,
  ready_for_review: 3,
  preview_active: 4,
  retained: 5,
  working: 6,
  creating: 7,
  delivered: 8,
  local: 9,
}

/** Source-linked Worktree management surface backed only by WorktreeConsoleAdapter. */
export function WorktreeConsoleView({
  sessionId,
  adapter,
  services,
  focusCheckoutId,
  onTargetChange,
}: WorktreeConsoleViewProps) {
  const t = useClientTranslator()
  const language = useClientLanguage()

  const mounted = useRef(true)
  const request = useRef(0)
  const sessionGeneration = useRef(0)
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<WorktreeConsoleTargetSummary | null>(null)
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
        setError(errorText(current.error, t))
        return
      }
      if (!list.ok) {
        setError(errorText(list.error, t))
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
    onTargetChange?.()
  }

  const mutationError = (code: WorktreeConsoleErrorCode, message: string, generation: number): void => {
    if (!isActive(generation)) return
    setError(errorText({ code, message }, t))
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
        setError(errorText(outcome.error, t))
        return
      }
      const { target, targetSessionId, managedRoot } = outcome.value
      if (target.sourceSessionId !== sessionId) {
        throw new Error(t("host.returned.a.target.belonging.to.another.source"))
      }
      if (targetSessionId === sessionId) {
        throw new Error(t("host.incorrectly.returned.the.source.session.as.the"))
      }
      if (
        target.checkoutId === null
        || target.targetSessionId !== targetSessionId
        || target.ownerSessionId !== targetSessionId
        || target.managedRoot !== managedRoot
        || target.project.id !== sourceProjectId
        || !target.capabilities.open
      ) {
        throw new Error(t("the.target.session.identity.returned.by.host.does"))
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
              const { managedRoot: _root, sourceRoot: _sourceRoot, sourceOid: _source, currentBranch: _branch, ...summary } = target
              return summary
            })(),
          ],
        },
      })
      onTargetChange?.()
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
        ...(target.state === 'preview_active' || target.capabilities.rollbackPreview ? { rollbackPreview: true } : {}),
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
      await openAuthorizedWorktreeTarget(adapter, services, sessionId, {
        checkoutId: target.checkoutId,
        ownerSessionId: target.ownerSessionId,
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

  const orderedWorktrees = visibleSnapshot === null
    ? []
    : [...visibleSnapshot.list.worktrees].sort((left, right) => {
        const focusedLeft = left.checkoutId === focusCheckoutId ? 0 : 1
        const focusedRight = right.checkoutId === focusCheckoutId ? 0 : 1
        if (focusedLeft !== focusedRight) return focusedLeft - focusedRight
        const rank = ATTENTION_RANK[left.state] - ATTENTION_RANK[right.state]
        return rank !== 0 ? rank : right.iteration - left.iteration
      })

  if (loading && visibleSnapshot === null) {
    return <div className="dsh-wtc-loading" role="status" aria-live="polite">{t("loading.worktree.console")}</div>
  }

  return (
    <section className="dsh-wtc-console" aria-label={t("worktree.console")}>
      <header className="dsh-wtc-console-head">
        <div>
          <span className="dsh-wtc-kicker">{t("session.target")}</span>
          <h2>{t("linked.worktrees")}</h2>
        </div>
        <button type="button" className="dsh-wtc-button" disabled={loading} onClick={() => { void refresh() }}>
          {loading ? t("refreshing") : t("refresh")}
        </button>
      </header>
      {error ? <div className="dsh-wtc-error" role="alert">{error}</div> : null}
      {visibleSnapshot ? (
        <>
          <section className="dsh-wtc-current" aria-label={t("current.target")}>
            <div>
              <span className="dsh-wtc-label">{t("current.target")}</span>
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
                  {pendingAction === 'create' ? t("creating.2") : t("create.worktree")}
                </button>
              ) : null}
            </div>
          </section>
          <section className="dsh-wtc-list-section" aria-label={t("linked.worktrees")}>
            <div className="dsh-wtc-section-head">
              <div>
                <span className="dsh-wtc-label">{t("logical.links")}</span>
                <h3>{visibleSnapshot.list.project.name}</h3>
              </div>
              <span className="dsh-wtc-count">{visibleSnapshot.list.worktrees.length}</span>
            </div>
            {visibleSnapshot.list.worktrees.length === 0 ? (
              <div className="dsh-wtc-empty">{t("this.project.has.no.managed.worktrees.yet")}</div>
            ) : (
              <ul className="dsh-wtc-list">
                {orderedWorktrees.map(target => (
                  <li
                    className="dsh-wtc-row"
                    data-current-target={target.checkoutId === visibleSnapshot.current.checkoutId || undefined}
                    key={target.checkoutId ?? `local:${target.sourceSessionId}`}
                  >
                    <div className="dsh-wtc-row-main">
                      <div className="dsh-wtc-row-title">
                        <TargetState target={target} />
                        <span className="dsh-wtc-row-id">{target.checkoutId ?? 'Local source'}</span>
                        {target.checkoutId === visibleSnapshot.current.checkoutId ? <span className="dsh-wtc-relation">{t("current.2")}</span> : null}
                        {sessionId === target.sourceSessionId && sessionId !== target.ownerSessionId ? <span className="dsh-wtc-relation">{t("source")}</span> : null}
                        {sessionId !== target.sourceSessionId && sessionId !== target.ownerSessionId ? <span className="dsh-wtc-relation">{t("linked.task")}</span> : null}
                      </div>
                      <div className="dsh-wtc-facts">
                        <span>{t("iteration")} {t("count.iterations", { count: target.iteration })}</span>
                        {target.dirty ? <span>{t("uncommitted.changes")}</span> : <span>{t("clean")}</span>}
                        {(target.checkpoints?.length ?? 0) > 0 ? <span>{t("saved")} {target.checkpoints!.length} {t("undelivered.stages")}</span> : null}
                        {target.retention ? <span>{t("retention")}{retentionLabel(target.retention, t)}</span> : null}
                        {target.expiresAt ? <span>{t("expires")}{new Date(target.expiresAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN')}</span> : null}
                        {target.cleanupMessage ? <span className="dsh-wtc-recovery-message">{target.cleanupMessage}</span> : null}
                      </div>
                    </div>
                    <div className="dsh-wtc-row-actions">
                      <span className="dsh-wtc-revision">r{target.revision}</span>
                      {target.capabilities.open && target.capabilities.inspect && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={t("open", { p0: target.checkoutId })}
                          disabled={pendingAction !== null}
                          onClick={() => { void openListedTarget(target) }}
                        >
                          {pendingAction === `open:${target.checkoutId}` ? t("opening") : t("open.2")}
                        </button>
                      ) : null}
                      {target.capabilities.discard && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button dsh-wtc-danger"
                          aria-label={t("discard", { p0: target.checkoutId })}
                          disabled={pendingAction !== null}
                          onClick={() => {
                            if (target.dirty) setConfirmTarget(target)
                            else void discardTarget(target, false)
                          }}
                        >
                          {pendingAction === `discard:${target.checkoutId}` ? t("discarding.2") : t("discard.2")}
                        </button>
                      ) : null}
                      {target.capabilities.retryCleanup && target.checkoutId !== null ? (
                        <button
                          type="button"
                          className="dsh-wtc-button"
                          aria-label={t("retry.cleanup", { p0: target.checkoutId })}
                          disabled={pendingAction !== null}
                          onClick={() => { void retryCleanup(target) }}
                        >
                          {pendingAction === `cleanup:${target.checkoutId}` ? t("retrying") : t("retry.cleanup.2")}
                        </button>
                      ) : null}
                    </div>
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
          aria-label={t("discard.modified.worktree")}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            setConfirmTarget(null)
          }}
        >
          <strong>{t("discard.modified.worktree")}</strong>
          <p>
            {sessionId === confirmTarget.sourceSessionId && sessionId !== confirmTarget.ownerSessionId
              ? t("local.source.will.discard.reserved.target.and.all", { p0: String(confirmTarget.checkoutId) })
              : confirmTarget.state === 'preview_active' || confirmTarget.capabilities.rollbackPreview
                ? t("first.safely.roll.back.the.local.preview.of", { p0: String(confirmTarget.checkoutId) })
                : t("the.current.session.will.discard.worktree.and.all", { p0: String(confirmTarget.checkoutId) })}
          </p>
          <div className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => { setConfirmTarget(null) }}>{t("cancel")}</button>
            <button
              ref={confirmButton}
              type="button"
              className="dsh-wtc-button dsh-wtc-danger"
              onClick={() => { void discardTarget(confirmTarget, true) }}
            >
              {t("confirm.discard.changes")} </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
