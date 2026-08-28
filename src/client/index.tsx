/** Browser entry: dedicated ToolViews for Worktree target handoff and review. */

import type { ComponentType } from 'react'
import type { WorktreeConsoleAdapter } from '../console-contract.js'
import type { PreSessionWorktreeServices } from './actions.js'
import type { ToolCallViewPropsLike } from './model.js'
import { WorktreeCreateRow } from './WorktreeCreateRow.js'
import { WorktreeReviewRow } from './WorktreeReviewRow.js'
import { WORKTREE_STYLES } from './styles.js'
import { registerPreSessionWorktree, type PreSessionSlotContextLike } from './pre-session/index.js'
import { registerTargetConsole, type TargetConsoleContextLike } from './target-console/index.js'
import { TARGET_CONSOLE_STYLES } from './target-console/target-console.styles.js'
import { registerManagedWorkspaceSidebar } from './workspace-sidebar/index.js'

export { registerTargetConsole } from './target-console/index.js'

export const WORKTREE_CONSOLE_ADAPTER_SERVICE = 'worktreeConsole'

interface ClientContextLike {
  get(name: string): unknown
  effect(setup: () => void | (() => void), label?: string): void
  slots: {
    inject(
      name: 'tool.call.toolview' | 'conversation.session.header.actions' | 'conversation.input.dock' | 'conversation.input.left' | 'sidebar.workspaces',
      callback: () => unknown,
    ): void
    register(
      descriptor: Record<string, unknown>,
      component: ComponentType<any>,
    ): unknown
  }
}

/** Required client services. */
export const inject = ['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale']

function servicesOf(ctx: ClientContextLike): PreSessionWorktreeServices {
  return {
    workspaces: ctx.get('workspaces') as PreSessionWorktreeServices['workspaces'],
    sessions: ctx.get('sessions') as PreSessionWorktreeServices['sessions'],
    conversation: ctx.get('conversation') as PreSessionWorktreeServices['conversation'],
  }
}

/** Register replay-stable keyed rows and one scoped stylesheet. */
export function apply(ctx: ClientContextLike, adapterOverride?: WorktreeConsoleAdapter): void {
  const services = servicesOf(ctx)
  // A service provided by this same plugin fiber is not visible through ctx.get
  // until the provider effect settles. The package-owned Remote entry passes
  // the just-created adapter explicitly; direct consumers may still inject it.
  const adapter = adapterOverride
    ?? ctx.get(WORKTREE_CONSOLE_ADAPTER_SERVICE) as WorktreeConsoleAdapter | undefined
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshGitWorktree = 'true'
    style.textContent = `${WORKTREE_STYLES}\n${TARGET_CONSOLE_STYLES}`
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-git-worktree: styles')

  const CreateRow = (props: ToolCallViewPropsLike) => <WorktreeCreateRow {...props} services={services} />
  const ReviewRow = (props: ToolCallViewPropsLike) => <WorktreeReviewRow {...props} services={services} adapter={adapter} />
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'worktree_create' },
    CreateRow,
  ))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'worktree_ready_for_review' },
    ReviewRow,
  ))

  // Backend integration provides this optional normalized adapter service.
  if (adapter !== undefined) {
    registerTargetConsole(
      { slots: ctx.slots as TargetConsoleContextLike['slots'] },
      adapter,
      services,
    )
    registerPreSessionWorktree(
      { slots: ctx.slots as PreSessionSlotContextLike['slots'] },
      adapter,
      services,
    )
    registerManagedWorkspaceSidebar(ctx as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0], adapter)
  }
}
