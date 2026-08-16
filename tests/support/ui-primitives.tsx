import { useEffect } from 'react'
import type { ReactNode } from 'react'

/** Narrow test double for the Harness platform Modal used by Client fixtures. */
export function Modal({
  open,
  onClose,
  title,
  closeLabel = 'Close',
  description,
  children,
  footer,
}: {
  open: boolean
  onClose(): void
  title: string
  closeLabel?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [onClose, open])
  if (!open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={closeLabel} onClick={onClose}>×</button>
      {description ? <p>{description}</p> : null}
      {children}
      {footer}
    </div>
  )
}
