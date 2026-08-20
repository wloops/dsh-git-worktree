import { useEffect } from 'react'
import type { ReactNode } from 'react'

export type MenuEntry =
  | { id: string; label: ReactNode; disabled?: boolean; danger?: boolean }
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; text: string }

/** Narrow controlled Menu test double for Header action fixtures. */
export function Menu({ open, anchor, items, footer, onSelect, onClose }: {
  open: boolean
  anchor: ReactNode
  items: readonly MenuEntry[]
  footer?: readonly MenuEntry[]
  onSelect(id: string): void
  onClose(): void
}) {
  useEffect(() => {
    if (!open) return
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', listener)
    return () => { document.removeEventListener('keydown', listener) }
  }, [onClose, open])
  const renderEntry = (entry: MenuEntry) => 'type' in entry
    ? entry.type === 'separator'
      ? <hr key={entry.id} />
      : <span key={entry.id}>{entry.text}</span>
    : (
        <button key={entry.id} type="button" disabled={entry.disabled} onClick={() => onSelect(entry.id)}>
          {entry.label}
        </button>
      )
  return <span>{anchor}{open ? <div role="menu">{items.map(renderEntry)}{footer?.map(renderEntry)}</div> : null}</span>
}

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
