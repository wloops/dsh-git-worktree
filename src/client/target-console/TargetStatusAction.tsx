import { useClientLanguage, useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Menu, Modal, type MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import { openExistingSession, type WorktreeClientServices } from '../actions.js'
import { requestWorktreeReviewRefresh, WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
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
    ...(target?.managedRoot && target.capabilities.open ? [{ id: 'reveal', label: t("open.current.working.location") } satisfies MenuEntry] : []),
    ...(target && target.sourceSessionId !== sessionId
      ? [{ id: 'source', label: t("return.to.source.session") } satisfies MenuEntry]
      : []),
    ...(target ? [{ id: 'manager', label: t("manage.linked.worktrees") } satisfies MenuEntry] : []),
  ]
  const footer: MenuEntry[] = target?.capabilities.retryCleanup
    ? [{ id: 'retry_cleanup', label: pendingAction === 'retry_cleanup' ? t("processing") : t("retry.environment.cleanup"), disabled: pendingAction !== null }]
    : target?.capabilities.discard
      ? [{ id: 'discard', label: pendingAction === 'discard' ? t("processing") : t("discard.task.and.clean.up.worktree"), danger: true, disabled: pendingAction !== null }]
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
            title={t("session.target.and.linked.worktrees")}
            onClick={() => setMenuOpen(current => !current)}
          >
            <span className="dsh-wtc-target-dot" aria-hidden />
            {target?.state === 'local' || !target ? triggerLabel : <>{t("worktree.2")} <span>{stateLabel}</span></>}
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
