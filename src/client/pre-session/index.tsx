import type { ComponentType } from 'react'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { PreSessionWorktreeServices } from '../actions.js'
import { createPreSessionWorktreeController } from './controller.js'
import { PreSessionWorktreeToggle } from './PreSessionWorktreeToggle.js'
import { adaptHarnessInputActions, readHarnessInput, type HarnessInputActions, type HarnessInputState } from './harness-input.js'

/** rc.1 input.left has no owner snapshot props; snapshots come from standard hooks. */
export interface PreSessionSlotProps {
  sessionId: string
  useSession: SnapshotSelectorHook<SessionSnapshot>
  useConversation: SnapshotSelectorHook<{ readonly activeTargets: ReadonlySet<string> }>
  useInput: SnapshotSelectorHook<HarnessInputState>
  inputActions: HarnessInputActions
}

export interface PreSessionSlotContextLike {
  slots: {
    inject(name: 'conversation.input.left', callback: () => unknown): void
    register(
      descriptor: Record<string, unknown>,
      component: ComponentType<PreSessionSlotProps>,
    ): unknown
  }
}

/** Register the blank-session switch in Harness's public composer tool row. */
export function registerPreSessionWorktree(
  ctx: PreSessionSlotContextLike,
  adapter: WorktreeConsoleAdapter,
  services: PreSessionWorktreeServices,
): void {
  const controller = createPreSessionWorktreeController(adapter, services)
  const Entry = ({ sessionId, useSession, useConversation, useInput, inputActions }: PreSessionSlotProps) => {
    // Match Harness's conversationPhase: a pending first turn is not a blank
    // launcher, and any active Conversation target makes this an existing session.
    const sessionPhase = useSession(session => (!session.blank && !session.awaitingFirstTurn) || session.running
      ? 'active' : session.promptAttempted ? 'engaging' : 'blank')
    const hasActiveTarget = useConversation(conversation => conversation.activeTargets.size > 0)
    const input = readHarnessInput(useInput(snapshot => snapshot))
    return <PreSessionWorktreeToggle
      sessionId={sessionId}
      session={{ composerPhase: hasActiveTarget ? 'active' : sessionPhase }}
      input={input}
      inputActions={adaptHarnessInputActions(inputActions)}
      adapter={adapter}
      controller={controller}
    />
  }
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register(
    {
      name: 'conversation.input.left',
      id: 'worktree-pre-session',
      order: 40,
    },
    Entry,
  ))
}

export { PreSessionWorktreeController, PreSessionWorktreeError, createPreSessionWorktreeController } from './controller.js'
export { PreSessionWorktreeToggle } from './PreSessionWorktreeToggle.js'
