declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType, ReactNode } from 'react'

  export const Modal: ComponentType<{
    open: boolean
    onClose(): void
    title: string
    closeLabel?: string
    description?: string
    children?: ReactNode
    footer?: ReactNode
  }>
}
