import { useState } from 'react'
import { openIsolatedTarget, type WorktreeClientServices } from './actions.js'
import { parseCreateTool, type ToolCallViewPropsLike } from './model.js'

interface Props extends ToolCallViewPropsLike {
  services: WorktreeClientServices
}

type OpenState = 'idle' | 'opening' | 'error'

export function WorktreeCreateRow({ block, services }: Props) {
  const model = parseCreateTool(block)
  const [openState, setOpenState] = useState<OpenState>('idle')
  const [openError, setOpenError] = useState<string | null>(null)
  const payload = model.payload
  const state = model.lifecycle === 'running' ? 'running' : model.lifecycle === 'ok' ? 'ok' : 'error'

  const openTarget = async (): Promise<void> => {
    if (!payload || openState === 'opening') return
    setOpenState('opening')
    setOpenError(null)
    try {
      await openIsolatedTarget(services, payload)
    } catch (error) {
      setOpenState('error')
      setOpenError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <section className="dsh-wt-card" data-tool="worktree_create" data-state={state} aria-label="Isolated Session Target">
      <header className="dsh-wt-head">
        <span className="dsh-wt-mark" aria-hidden />
        <strong className="dsh-wt-title">Isolated Session Target</strong>
        <span className="dsh-wt-subtitle">
          {model.lifecycle === 'running' ? '正在创建唯一 Worktree…' : payload ? '已就绪，等待打开' : '创建失败'}
        </span>
      </header>
      {payload ? (
        <div className="dsh-wt-body">
          <div className="dsh-wt-grid">
            <span className="dsh-wt-label">Checkout</span>
            <span className="dsh-wt-value dsh-wt-code">{payload.checkoutId}</span>
            <span className="dsh-wt-label">Base</span>
            <span className="dsh-wt-value dsh-wt-code">{payload.currentOid.slice(0, 12)}</span>
            <span className="dsh-wt-label">Workspace</span>
            <button type="button" className="dsh-wt-value dsh-wt-code dsh-wt-path" onClick={() => void services.workspaces.openPath(payload.managedRoot)}>
              {payload.managedRoot}
            </button>
          </div>
          <div className="dsh-wt-actions">
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={openState === 'opening'} onClick={() => void openTarget()}>
              {openState === 'opening' ? '正在打开…' : openState === 'error' ? '重试打开隔离会话' : '打开隔离会话'}
            </button>
            <span className="dsh-wt-status">当前 Local Session 不会改绑 cwd。</span>
          </div>
          {openError ? <div className="dsh-wt-error" role="alert">{openError}</div> : null}
        </div>
      ) : model.error ? (
        <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div>
      ) : null}
    </section>
  )
}
