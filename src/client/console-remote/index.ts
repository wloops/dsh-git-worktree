import type { Context } from '@deepseek-ai/cordis'
import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import contribution, { type GitWorktreeRemote } from '../../console-remote/remote.js'
import { apply as applyToolViews, inject as toolViewInject } from '../index.js'
import { createWorktreeConsoleRemoteAdapter } from './adapter.js'

export { createWorktreeConsoleRemoteAdapter } from './adapter.js'

export const inject = [...toolViewInject, 'remote']

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
  applyToolViews(ctx as unknown as Parameters<typeof applyToolViews>[0], adapter)
}
