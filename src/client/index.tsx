/** Browser entry: dedicated ToolViews for Worktree target handoff and review. */

import type { ComponentType } from 'react'
import type { WorktreeClientServices } from './actions.js'
import type { ToolCallViewPropsLike } from './model.js'
import { WorktreeCreateRow } from './WorktreeCreateRow.js'
import { WorktreeReviewRow } from './WorktreeReviewRow.js'
import { WORKTREE_STYLES } from './styles.js'

interface ClientContextLike {
  get(name: string): unknown
  effect(setup: () => void | (() => void), label?: string): void
  slots: {
    inject(name: 'tool.call.toolview', callback: () => unknown): void
    register(
      descriptor: { name: 'tool.call.toolview'; key: string },
      component: ComponentType<ToolCallViewPropsLike>,
    ): unknown
  }
}

/** Required client services. */
export const inject = ['slots', 'workspaces', 'sessions']

function servicesOf(ctx: ClientContextLike): WorktreeClientServices {
  return {
    workspaces: ctx.get('workspaces') as WorktreeClientServices['workspaces'],
    sessions: ctx.get('sessions') as WorktreeClientServices['sessions'],
  }
}

/** Register replay-stable keyed rows and one scoped stylesheet. */
export function apply(ctx: ClientContextLike): void {
  const services = servicesOf(ctx)
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshGitWorktree = 'true'
    style.textContent = WORKTREE_STYLES
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-git-worktree: styles')

  const CreateRow = (props: ToolCallViewPropsLike) => <WorktreeCreateRow {...props} services={services} />
  const ReviewRow = (props: ToolCallViewPropsLike) => <WorktreeReviewRow {...props} services={services} />
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'worktree_create' },
    CreateRow,
  ))
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'worktree_ready_for_review' },
    ReviewRow,
  ))
}
