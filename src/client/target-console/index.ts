import { createElement, type ComponentType } from 'react'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'
import { TargetStatusAction } from './TargetStatusAction.js'
import { WorktreeReviewStatus } from './WorktreeReviewStatus.js'

export interface TargetConsoleContextLike {
  slots: {
    inject(name: 'conversation.session.header.actions' | 'conversation.input.dock', callback: () => unknown): void
    register(
      descriptor: Record<string, unknown>,
      component: ComponentType<any>,
    ): unknown
  }
}

/** Register the Harness-native Session Target contributions against an injected adapter seam. */
export function registerTargetConsole(
  ctx: TargetConsoleContextLike,
  adapter: WorktreeConsoleAdapter,
  services: WorktreeClientServices,
): void {
  const HeaderAction = ({ sessionId }: { sessionId: string }) =>
    createElement(TargetStatusAction, { sessionId, adapter, services })
  const ReviewStatus = ({ session }: { session: { sessionId: string } }) =>
    createElement(WorktreeReviewStatus, { session, adapter, services })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'worktree-target',
    order: 30,
    label: 'Worktree Target',
  }, HeaderAction))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'worktree-review-status',
    order: 10,
  }, ReviewStatus))
}

export { TargetStatusAction } from './TargetStatusAction.js'
export { WorktreeConsoleView } from './WorktreeConsoleView.js'
export { WorktreeManagerModal } from './WorktreeManagerModal.js'
export { WorktreeReviewStatus } from './WorktreeReviewStatus.js'
