import { readClientLanguage } from '../i18n.js'
import { createTranslator } from '../../i18n/core.js'
import { transportMessages } from '../../i18n/transport-messages.js'
import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import contribution, { type GitWorktreeRemote } from '../../console-remote/remote.js'
import { apply as applyToolViews, inject as toolViewInject } from '../index.js'
import { registerManagedWorkspaceSidebar } from '../workspace-sidebar/index.js'
import { inject as officialWorkspaceInject } from 'virtual:dsh-official-workspace-client'
import { apply as applyNextWorkspace, inject as nextWorkspaceInject } from 'virtual:dsh-official-workspace-client-next'
import { apply as applyAlphaWorkspace, inject as alphaWorkspaceInject } from 'virtual:dsh-official-workspace-client-alpha'
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
  const getLanguage = () => readClientLanguage(ctx.get('locale'))
  if (remote === undefined) throw new Error(createTranslator(transportMessages, getLanguage())('mountFailed'))
  const adapter = createWorktreeConsoleRemoteAdapter(remote, getLanguage)
  ctx.provide('worktreeConsole', adapter)

  const mountTools = (workspaceCtx: Context): void => {
    // Conversation-dependent views are below their UI Workspace provider;
    // a sibling fiber could not safely assume the navigation service exists.
    workspaceCtx.inject(toolViewInject, child => {
      applyToolViews(child as unknown as Parameters<typeof applyToolViews>[0], adapter)
    })
  }

  // All three official Browser generations declare the same top-level Slot.
  // Pick exactly one based on the Host-resolved package version, not timing of
  // Client services (shortcuts is absent in alpha and late to start in rc.2).
  const topology = await adapter.sidebarTopology()
  if (!topology.ok) throw new Error('Could not identify the installed Host Workspace generation.')
  const flavor = topology.value.workspaceClientFlavor
  if (flavor === 'legacy') {
    if (typeof (ctx.get('sessions') as { open?: unknown }).open !== 'function') {
      throw new Error('Legacy Workspace Browser requires sessions.open().')
    }
    registerManagedWorkspaceSidebar(
      ctx as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0], adapter,
    )
    mountTools(ctx)
  } else if (flavor === 'alpha' || flavor === 'next') {
    const [required, applyWorkspace] = flavor === 'alpha'
      ? [alphaWorkspaceInject, applyAlphaWorkspace] as const
      : [nextWorkspaceInject, applyNextWorkspace] as const
    ctx.inject(required, child => {
      registerManagedWorkspaceSidebar(
        child as unknown as Parameters<typeof registerManagedWorkspaceSidebar>[0],
        adapter,
        applyWorkspace,
      )
      mountTools(child)
    })
  } else {
    // Host lifecycle leaves the official provider enabled in this case.
    mountTools(ctx)
  }
}
