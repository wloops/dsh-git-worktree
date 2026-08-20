declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  export type MenuEntry =
    | { id: string; label: ReactNode; disabled?: boolean; danger?: boolean }
    | { type: 'separator'; id: string }
    | { type: 'label'; id: string; text: string }

  export const Menu: ComponentType<{
    open: boolean
    anchor: ReactNode
    items: readonly MenuEntry[]
    footer?: readonly MenuEntry[]
    onSelect(id: string): void
    onClose(): void
    align?: 'start' | 'end'
    side?: 'bottom' | 'top' | 'right'
    portal?: boolean
    compact?: boolean
    className?: string
  }>

  export const Modal: ComponentType<{
    open: boolean
    onClose(): void
    title: string
    closeLabel?: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
    className?: string
    contentClassName?: string
    headless?: boolean
  }>
}
