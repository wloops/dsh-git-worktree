import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import contribution, { type GitWorktreeRemote } from '../../console-remote/remote.js'
import { apply as applyToolViews, inject as toolViewInject } from '../index.js'
import { registerManagedWorkspaceSidebar } from '../workspace-sidebar/index.js'
import { inject as officialWorkspaceInject } from 'virtual:dsh-official-workspace-client'
import { createWorktreeConsoleRemoteAdapter } from './adapter.js'

export { createWorktreeConsoleRemoteAdapter } from './adapter.js'

/**
 * Activate on the same prerequisites as the official Workspace Client. The
 * conversation-dependent Worktree surfaces run in a child fiber below so the
 * Workspace service can break the uiConversation -> uiWorkspace boot edge.
 */
export const inject = [...officialWorkspaceInject]

interface ConsoleClientContext extends Context {
  remote: ClientRemote & { gitWorktree: GitWorktreeRemote }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    worktreeConsole: WorktreeConsoleAdapter
  }
}

/** Mount the package-owned strict Remote contribution in this Client fiber. */
export async function apply(ctx: ConsoleClientContext): Promise<void> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  ctx.effect(() => disposeRemote)
  const remote = ctx.get('remote.gitWorktree') as GitWorktreeRemote | undefined
  if (remote === undefined) throw new Error('Worktree Console Remote namespace 挂载失败')
  const adapter = createWorktreeConsoleRemoteAdapter(remote)
  ctx.provide('worktreeConsole', adapter)

  // The official ui-workspace row is disabled by cordis.patch.yml. Restore its
  // service and Slot declarations before uiConversation becomes available.
  registerManagedWorkspaceSidebar(
    ctx as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0],
    adapter,
  )

  // The remaining Worktree views consume conversation/connection. Keeping
  // them in a child fiber prevents those services from blocking uiWorkspace.
  ctx.inject(toolViewInject, child => {
    applyToolViews(child as unknown as Parameters<typeof applyToolViews>[0], adapter)
  })
}
