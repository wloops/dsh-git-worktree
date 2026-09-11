import { subscribeCurrent } from './current-polling.js'
import { ReviewIcon } from '../review-console/ReviewIcon.js'
import { useClientLanguage, useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import { openExistingSession, type WorktreeClientServices } from '../actions.js'
import { requestWorktreeReviewRefresh } from '../review-console/status-events.js'
import { WorktreeManagerModal } from './WorktreeManagerModal.js'

export interface TargetStatusActionProps {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
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

function shortOid(value: string): string {
  return value === 'unversioned' ? value : value.slice(0, 7)
}

/** Interactive Session Target capsule with source-linked management actions. */
export function TargetStatusAction({ sessionId, adapter, services }: TargetStatusActionProps) {
  const t = useClientTranslator()
  const language = useClientLanguage()

  const [target, setTarget] = useState<WorktreeConsoleTargetDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [managerOpen, setManagerOpen] = useState(false)
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [pendingAction, setPendingAction] = useState<'discard' | 'retry_cleanup' | 'begin_next_iteration' | null>(null)
  const actionScope = useRef(0)
  const activeSession = useRef(sessionId)
  if (activeSession.current !== sessionId) {
    activeSession.current = sessionId
    actionScope.current += 1
  }
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    requestWorktreeReviewRefresh(sessionId)
  }, [sessionId])

  useEffect(() => {
    setTarget(null)
    setLoading(true)
    setError(null)
    setMenuOpen(false)
    setManagerOpen(false)
    setCleanupConfirmOpen(false)
    setPendingAction(null)
    return subscribeCurrent(adapter, sessionId, language, result => {
      if ('error' in result) {
        setError(result.error instanceof Error ? result.error.message : String(result.error))
      } else if (result.outcome.ok) {
        setTarget(result.outcome.value.target)
        setError(null)
      } else {
        setError(result.outcome.error.message)
      }
      setLoading(false)
    })
  }, [adapter, language, sessionId])

  const state = target?.state ?? (loading ? 'loading' : 'error')
  const stateLabel = state === 'loading' ? t("loading") : state === 'error' ? t("unavailable") : STATE_LABELS(t)[state]
  const triggerLabel = target?.state === 'local' ? 'Local' : target ? `Worktree · ${stateLabel}` : stateLabel
  const expiry = target?.state === 'retained' && target.expiresAt
    ? new Date(target.expiresAt).toLocaleDateString(language === 'en' ? 'en-US' : 'zh-CN')
    : null
  const accessibleLabel = expiry === null ? t("session.target.label", { target: triggerLabel }) : t("session.target.expires", { p0: triggerLabel, p1: expiry })

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
      setError(t("the.source.session.cwd.cannot.be.matched.to"))
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

  const beginNextIteration = async (): Promise<void> => {
    if (!target?.checkoutId || !target.capabilities.beginNextIteration || pendingAction !== null) return
    const scope = actionScope.current
    const active = () => mounted.current && scope === actionScope.current
    setMenuOpen(false)
    setPendingAction('begin_next_iteration')
    setError(null)
    try {
      const outcome = await adapter.beginNextIteration({ sessionId, checkoutId: target.checkoutId, expectedRevision: target.revision })
      if (!active()) return
      if (!outcome.ok) {
        setError(outcome.error.message)
        if (outcome.error.code === 'stale_target') void refresh()
        return
      }
      setTarget(current => current ? { ...current, ...outcome.value.target } : current)
      requestWorktreeReviewRefresh(sessionId)
    } catch (reason) {
      if (active()) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (active()) setPendingAction(null)
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
      <span>{t("source")} {shortOid(target.sourceOid)} {t("current")} {shortOid(target.currentOid)} {t("iteration.2")} {target.iteration}</span>
      {expiry ? <span>{t("retained.until")} {expiry}</span> : null}
      {error ? <span className="dsh-wtc-menu-error">{error}</span> : null}
    </span>
  ) : error ?? triggerLabel

  const items: MenuEntry[] = [
    { id: 'summary', label: summary, disabled: true },
    { type: 'separator', id: 'summary-separator' },
    ...(target?.managedRoot && target.capabilities.open ? [{ id: 'reveal', icon: <ReviewIcon name="folder" />, label: t("open.current.working.location") } satisfies MenuEntry] : []),
    ...(target && target.sourceSessionId !== sessionId
      ? [{ id: 'source', icon: <ReviewIcon name="external" />, label: t("return.to.source.session") } satisfies MenuEntry]
      : []),
    ...(target?.capabilities.beginNextIteration ? [{ id: 'begin_next_iteration', icon: <ReviewIcon name="create" />, label: pendingAction === 'begin_next_iteration' ? t("creating") : t("start.next.iteration"), disabled: pendingAction !== null } satisfies MenuEntry] : []),
    ...(target ? [{ id: 'manager', icon: <ReviewIcon name="manager" />, label: t("manage.linked.worktrees") } satisfies MenuEntry] : []),
  ]
  const footer: MenuEntry[] = target?.capabilities.retryCleanup
    ? [{ id: 'retry_cleanup', icon: <ReviewIcon name="refresh" />, label: pendingAction === 'retry_cleanup' ? t("processing") : t("retry.environment.cleanup"), disabled: pendingAction !== null }]
    : target?.capabilities.discard
      ? [{ id: 'discard', icon: <ReviewIcon name="discard" />, label: pendingAction === 'discard' ? t("processing") : t("discard.task.and.clean.up.worktree"), danger: true, disabled: pendingAction !== null }]
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
          if (id === 'begin_next_iteration') void beginNextIteration()
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
            title={t("session.target.and.linked.worktrees")}
            onClick={() => setMenuOpen(current => !current)}
          >
            <ReviewIcon name={target?.state === 'local' ? 'local' : 'branch'} className="dsh-wtc-target-kind" />
            {target?.state === 'local' || !target ? triggerLabel : <>{t("worktree.2")} <span>{stateLabel}</span></>}
            {expiry ? <span className="dsh-wtc-target-expiry">· {expiry}</span> : null}
            <ReviewIcon name="down" className="dsh-wtc-target-chevron" />
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
        }}
      />
      <Modal
        open={cleanupConfirmOpen}
        onClose={() => setCleanupConfirmOpen(false)}
        title={t("discard.task.and.clean.up.worktree.2")}
        closeLabel={t("cancel.worktree.cleanup")}
        description={target?.state === 'preview_active'
          ? t("host.will.safely.roll.back.local.preview.first")
          : t("undelivered.worktree.changes.will.be.permanently.discarded.local.2")}
        footer={(
          <span className="dsh-wtc-confirm-actions">
            <button type="button" className="dsh-wtc-button" onClick={() => setCleanupConfirmOpen(false)}>{t("cancel")}</button>
            <button type="button" className="dsh-wtc-button dsh-wtc-danger" disabled={pendingAction !== null} onClick={() => { void discard() }}>
              {t("confirm.worktree.cleanup")} </button>
          </span>
        )}
      />
    </>
  )
}
