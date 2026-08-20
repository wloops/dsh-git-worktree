import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'

function shortOid(value: string): string {
  return value.slice(0, 8)
}

function validationLabel(status: NonNullable<WorktreeConsoleTargetSummary['deliveryProof']>['validationStatus']): string {
  if (status === 'passed') return '验证通过'
  if (status === 'failed') return '验证失败'
  if (status === 'partial') return '部分验证'
  if (status === 'not_run') return '未运行验证'
  return '无验证摘要'
}

export function DeliveryProof({ target, compact = false }: { target: WorktreeConsoleTargetSummary; compact?: boolean }) {
  const proof = target.deliveryProof
  if (!proof) return null
  const lifecycle = target.state === 'delivered'
    ? '环境已清理'
    : target.state === 'retained'
      ? `环境已保留${target.expiresAt ? `至 ${new Date(target.expiresAt).toLocaleString()}` : ''}`
      : target.state === 'cleanup_pending'
        ? 'Commit 已创建，环境清理待完成'
        : '交付证据已记录'
  if (compact) {
    return (
      <span className="dsh-wt-delivery-proof dsh-wt-delivery-proof-compact">
        Commit {target.commitOid ? shortOid(target.commitOid) : '无新增 Commit'} · {proof.localBranch ?? 'detached'}@{shortOid(proof.localHeadAfter)} · {proof.changedFiles.length} 个文件 · {lifecycle}
      </span>
    )
  }
  return (
    <section className="dsh-wt-delivery-proof" aria-label="交付证明">
      <header><strong>Delivery Proof</strong><span>{lifecycle}</span></header>
      <dl>
        <div><dt>Commit</dt><dd><code>{target.commitOid ?? '无新增 Commit'}</code></dd></div>
        <div><dt>Local</dt><dd>{proof.localBranch ?? 'detached'} · <code>{shortOid(proof.localHeadBefore)}</code> → <code>{shortOid(proof.localHeadAfter)}</code></dd></div>
        <div><dt>文件</dt><dd>{proof.changedFiles.length} 个</dd></div>
        <div><dt>验证</dt><dd>{validationLabel(proof.validationStatus)}{proof.validationSummary ? ` · ${proof.validationSummary}` : ''}</dd></div>
        <div><dt>Local 历史</dt><dd>{proof.commitInLocalHistory === true ? 'Commit 仍在 Local 历史中' : proof.commitInLocalHistory === false ? 'Commit 已不在当前 Local 历史中' : '当前无法确认'}</dd></div>
      </dl>
    </section>
  )
}
