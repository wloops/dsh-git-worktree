import { ReviewIcon } from './ReviewIcon.js'
import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeApplyPreflightView } from '../../types.js'
import type { PreflightSnapshot } from './preflight-cache.js'

function shortOid(value: string): string {
  return value.slice(0, 8)
}

function statusLabel(preflight: WorktreeApplyPreflightView, t: ClientTranslator = defaultClientTranslator): string {
  switch (preflight.status) {
    case 'ready': return t("sync.conditions.confirmed")
    case 'local_advanced': return t("local.advanced.safe.to.merge")
    case 'already_in_local': return t("this.iteration.is.already.in.local")
    case 'conflict': return t("found.conflicting.files", { p0: preflight.conflictingFiles.length })
    case 'blocked': return preflight.message
  }
}

export function PreflightStatus({
  snapshot,
  target,
  compact = false,
  onRefresh,
  onRecovery,
  onOpenHolder,
  busy,
}: {
  snapshot: PreflightSnapshot
  target?: WorktreeConsoleTargetSummary
  compact?: boolean
  onRefresh(): void
  onRecovery(preflight: WorktreeApplyPreflightView): void
  onOpenHolder(): void
  busy: boolean
}) {
  const t = useClientTranslator()

  if (snapshot.status === 'idle') return null
  if (snapshot.status === 'loading') {
    return <div className="dsh-wt-preflight" data-preflight="loading">{t("running.read.only.sync.preflight.local.will.not")}</div>
  }
  if (snapshot.status === 'error') {
    return (
      <div className="dsh-wt-preflight" data-preflight="error">
        <span>{t("preflight.failed")}{snapshot.error.message}</span>
        <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onRefresh}><ReviewIcon name="refresh" />{t("check.again")}</button>
      </div>
    )
  }

  const preflight = snapshot.preflight
  const blocked = preflight.status === 'blocked'
  const staleIsolated = blocked && preflight.reason === 'stale_isolated' && preflight.reviewId !== null
  const holder = blocked && preflight.reason === 'project_acceptance_busy'
    ? preflight.blocker ?? target?.reviewSlotHolder
    : undefined
  return (
    <div className="dsh-wt-preflight" data-preflight={preflight.status}>
      <div className="dsh-wt-preflight-head">
        <strong>{statusLabel(preflight, t)}</strong>
        <span>{t("read.only.check.local.unchanged")}</span>
      </div>
      {!compact && preflight.status !== 'blocked' ? (
        <dl className="dsh-wt-preflight-facts">
          <div><dt>{t("local")}</dt><dd>{preflight.localBranch ?? 'detached'} · <code>{shortOid(preflight.localHeadOid)}</code></dd></div>
          <div><dt>{t("worktree")}</dt><dd><code>{shortOid(preflight.isolatedHeadOid)}</code></dd></div>
          <div><dt>{t("effective.base")}</dt><dd><code>{shortOid(preflight.effectiveBaseOid)}</code></dd></div>
          <div><dt>{t("changes")}</dt><dd>{t("count.files", { count: preflight.changedFiles.length })}</dd></div>
        </dl>
      ) : null}
      {!compact && preflight.status === 'conflict' && preflight.conflictingFiles.length > 0 ? (
        <ul className="dsh-wt-conflict-list" aria-label={t("conflicting.files")}>
          {preflight.conflictingFiles.map(path => <li key={path}><code>{path}</code></li>)}
        </ul>
      ) : null}
      {holder ? <p>{t("holding.task")}{holder.checkoutId.slice(0, 8)} {t("session")} {holder.ownerSessionId.slice(0, 8)} · {{
        preview_active: t('previewing'), preview_detached: t('awaiting.recovery'),
        finalized: t('completed'), retained: t('retained'), working: t('in.progress'),
        ready_for_review: t('ready.for.review'), delivered: t('delivered'),
      }[holder.state]}</p> : null}
      {preflight.status === 'conflict' || blocked ? (
        <div className="dsh-wt-recovery-actions">
          <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onRefresh}><ReviewIcon name="refresh" />{t("check.again")}</button>
          {preflight.status === 'conflict' ? (
            <button type="button" className="dsh-wt-inline-action" disabled={busy || !target?.capabilities.resumeRevision} onClick={() => onRecovery(preflight)}>
              <ReviewIcon name="warning" />{t("ask.agent.to.resolve.conflicts")} </button>
          ) : staleIsolated ? (
            <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={() => onRecovery(preflight)}>
              <ReviewIcon name="refresh" />{t("regenerate.review")} </button>
          ) : null}
          {holder ? (
            <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onOpenHolder}><ReviewIcon name="external" />{t("open.holding.task")}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
