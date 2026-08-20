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
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="关联 Worktrees"
      closeLabel="关闭关联 Worktrees"
      description="由插件 registry 维护的 source/target 逻辑关联；DSH 仍按各自 cwd 显示独立 Workspace。"
      className="dsh-wtc-manager-dialog"
      contentClassName="dsh-wtc-manager-content"
    >
      <WorktreeConsoleView
        sessionId={sessionId}
        adapter={adapter}
        services={services}
        focusCheckoutId={focusCheckoutId}
        onTargetChange={onTargetChange}
      />
    </Modal>
  )
}
