/** Dynamic replay-stable model context for the current Worktree Session Target. */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-system-prompt'
import type { SessionCheckoutModule } from './index.js'

interface ContextAgent {
  session?: { id?: unknown }
}

/** Register a per-assembly snapshot without performing Git or filesystem I/O. */
export function registerSessionTargetContext(ctx: Context, module: SessionCheckoutModule): void {
  ctx.inject(['systemPrompt'], (scope: Context) => {
    scope.systemPrompt.context({
      name: 'git-worktree:session-target',
      order: 118,
      text: (context) => {
        const sessionId = (context.agent as ContextAgent | undefined)?.session?.id
        return typeof sessionId === 'string' ? module.runtimeContext(sessionId) : ''
      },
    })
  })
}
