import { ReviewIcon } from './review-console/ReviewIcon.js'
import { useClientTranslator } from './i18n.js'
import { useState } from 'react'
import { openIsolatedTarget, type WorktreeClientServices } from './actions.js'
import { parseCreateTool, type ToolCallViewPropsLike } from './model.js'

interface Props extends ToolCallViewPropsLike {
  services: WorktreeClientServices
}

type OpenState = 'idle' | 'opening' | 'error'

export function WorktreeCreateRow({ block, services }: Props) {
  const t = useClientTranslator()

  const model = parseCreateTool(block, t)
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
    <section className="dsh-wt-card" data-tool="worktree_create" data-state={state} aria-label={t("isolated.session.target")}>
      <header className="dsh-wt-head">
        <span className="dsh-wt-mark" aria-hidden />
        <strong className="dsh-wt-title">{t("isolated.session.target")}</strong>
        <span className="dsh-wt-subtitle">
          {model.lifecycle === 'running' ? t("creating.the.unique.worktree") : payload ? t("ready.to.open") : t("creation.failed")}
        </span>
      </header>
      {payload ? (
        <div className="dsh-wt-body">
          <div className="dsh-wt-grid">
            <span className="dsh-wt-label">{t("checkout")}</span>
            <span className="dsh-wt-value dsh-wt-code">{payload.checkoutId}</span>
            <span className="dsh-wt-label">{t("base")}</span>
            <span className="dsh-wt-value dsh-wt-code">{payload.currentOid.slice(0, 12)}</span>
            <span className="dsh-wt-label">{t("workspace")}</span>
            <button type="button" className="dsh-wt-value dsh-wt-code dsh-wt-path" onClick={() => void services.workspaces.openPath(payload.managedRoot)}>
              {payload.managedRoot}
            </button>
          </div>
          <div className="dsh-wt-actions">
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={openState === 'opening'} onClick={() => void openTarget()}>
              <ReviewIcon name="external" />{openState === 'opening' ? t("opening.2") : openState === 'error' ? t("retry.opening.isolated.session") : t("open.isolated.session")}
            </button>
            <span className="dsh-wt-status">{t("the.current.local.session.cwd.will.not.be")}</span>
          </div>
          {openError ? <div className="dsh-wt-error" role="alert">{openError}</div> : null}
        </div>
      ) : model.error ? (
        <div className="dsh-wt-body"><div className="dsh-wt-error" role="alert">{model.error}</div></div>
      ) : null}
    </section>
  )
}
