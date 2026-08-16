import type { ComponentType } from 'react'
import type { WorktreeConsoleAdapter } from '../../console-contract.js'
import type { PreSessionWorktreeServices } from '../actions.js'
import { createPreSessionWorktreeController } from './controller.js'
import {
  PreSessionWorktreeToggle,
  type PreSessionWorktreeToggleProps,
} from './PreSessionWorktreeToggle.js'

export type PreSessionSlotProps = Omit<PreSessionWorktreeToggleProps, 'adapter' | 'controller'>

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
  const Entry = (props: PreSessionSlotProps) => (
    <PreSessionWorktreeToggle
      {...props}
      adapter={adapter}
      controller={controller}
    />
  )
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
