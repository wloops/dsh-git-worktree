import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeApplyPreflightView } from '../../types.js'
import type { PreflightSnapshot } from './preflight-cache.js'

function shortOid(value: string): string {
  return value.slice(0, 8)
}

function statusLabel(preflight: WorktreeApplyPreflightView): string {
  switch (preflight.status) {
    case 'ready': return '同步条件已确认'
    case 'local_advanced': return 'Local 已前进，可安全合并'
    case 'already_in_local': return '本轮内容已在 Local'
    case 'conflict': return `发现 ${preflight.conflictingFiles.length} 个冲突文件`
    case 'blocked': return preflight.message
  }
}

export function PreflightStatus({
  snapshot,
  target,
  compact = false,
  onRefresh,
  onResume,
  onOpenHolder,
  busy,
}: {
  snapshot: PreflightSnapshot
  target?: WorktreeConsoleTargetSummary
  compact?: boolean
  onRefresh(): void
  onResume(): void
  onOpenHolder(): void
  busy: boolean
}) {
  if (snapshot.status === 'idle') return null
  if (snapshot.status === 'loading') {
    return <div className="dsh-wt-preflight" data-preflight="loading">正在执行只读同步预检… Local 不会被修改。</div>
  }
  if (snapshot.status === 'error') {
    return (
      <div className="dsh-wt-preflight" data-preflight="error">
        <span>预检失败：{snapshot.error.message}</span>
        <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onRefresh}>重新检查</button>
      </div>
    )
  }

  const preflight = snapshot.preflight
  const blocked = preflight.status === 'blocked'
  const stale = blocked && (preflight.reason === 'stale_isolated' || preflight.reason === 'stale_target')
  const holder = blocked && preflight.reason === 'project_acceptance_busy'
    ? preflight.blocker ?? target?.reviewSlotHolder
    : undefined
  return (
    <div className="dsh-wt-preflight" data-preflight={preflight.status}>
      <div className="dsh-wt-preflight-head">
        <strong>{statusLabel(preflight)}</strong>
        <span>只读检查 · Local 未修改</span>
      </div>
      {!compact && preflight.status !== 'blocked' ? (
        <dl className="dsh-wt-preflight-facts">
          <div><dt>Local</dt><dd>{preflight.localBranch ?? 'detached'} · <code>{shortOid(preflight.localHeadOid)}</code></dd></div>
          <div><dt>Worktree</dt><dd><code>{shortOid(preflight.isolatedHeadOid)}</code></dd></div>
          <div><dt>Effective base</dt><dd><code>{shortOid(preflight.effectiveBaseOid)}</code></dd></div>
          <div><dt>变更</dt><dd>{preflight.changedFiles.length} 个文件</dd></div>
        </dl>
      ) : null}
      {!compact && preflight.status === 'conflict' && preflight.conflictingFiles.length > 0 ? (
        <ul className="dsh-wt-conflict-list" aria-label="冲突文件">
          {preflight.conflictingFiles.map(path => <li key={path}><code>{path}</code></li>)}
        </ul>
      ) : null}
      {holder ? <p>占用任务：{holder.checkoutId.slice(0, 8)} · Session {holder.ownerSessionId.slice(0, 8)} · {holder.state}</p> : null}
      {preflight.status === 'conflict' || blocked ? (
        <div className="dsh-wt-recovery-actions">
          <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onRefresh}>重新检查</button>
          {stale || preflight.status === 'conflict' ? (
            <button type="button" className="dsh-wt-inline-action" disabled={busy || !target?.capabilities.resumeRevision} onClick={onResume}>
              返回 Worktree 重新生成验收稿
            </button>
          ) : null}
          {holder ? (
            <button type="button" className="dsh-wt-inline-action" disabled={busy} onClick={onOpenHolder}>打开占用任务</button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
