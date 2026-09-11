import { useClientTranslator } from '../i18n.js'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { WorktreeConsoleView } from './WorktreeConsoleView.js'

export interface WorktreeManagerModalProps {
  open: boolean
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  focusCheckoutId?: string | null
  onClose(): void
  onTargetChange?(): void
}

/** Session-local entry point for the source-linked Worktree management surface. */
export function WorktreeManagerModal({
  open,
  sessionId,
  adapter,
  services,
  focusCheckoutId,
  onClose,
  onTargetChange,
}: WorktreeManagerModalProps) {
  const t = useClientTranslator()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("linked.worktrees")}
      closeLabel={t("close.linked.worktrees")}
      description={t("source.target.logical.links.are.maintained.by.the")}
      className="dsh-wtc-manager-dialog"
      contentClassName="dsh-wtc-manager-content"
    >
      <WorktreeConsoleView
        embedded
        sessionId={sessionId}
        adapter={adapter}
        services={services}
        focusCheckoutId={focusCheckoutId}
        onTargetChange={onTargetChange}
      />
    </Modal>
  )
}
