import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import { readHostDesktopCapability, type ClientWorkspaceDesktop } from './actions.js'

/** Successful answers (including false), in-flight reads and retries are shared per Client. */
interface Availability {
  value?: boolean
  pending?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
  attempts: number
  retryAt: number
  listeners: Set<() => void>
}
const availability = new WeakMap<ClientWorkspaceDesktop, Availability>()

function entryFor(remote: ClientWorkspaceDesktop): Availability {
  let entry = availability.get(remote)
  if (!entry) {
    entry = { attempts: 0, retryAt: 0, listeners: new Set() }
    availability.set(remote, entry)
  }
  return entry
}

function readAvailability(remote: ClientWorkspaceDesktop, entry: Availability): void {
  if (entry.value !== undefined || entry.pending || entry.timer !== undefined) return
  // Three attempts per burst. After exhaustion only a new mount/prefetch after
  // the cooldown can start another burst; no permanent polling on an offline Host.
  if (entry.attempts >= 3) {
    if (Date.now() < entry.retryAt) return
    entry.attempts = 0
  }
  if (Date.now() < entry.retryAt) {
    if (entry.listeners.size) {
      entry.timer = setTimeout(() => {
        entry.timer = undefined
        readAvailability(remote, entry)
      }, entry.retryAt - Date.now())
    }
    return
  }
  entry.attempts += 1
  entry.pending = readHostDesktopCapability({ remote }).then(value => {
    entry.pending = undefined
    if (value !== undefined) {
      entry.value = value
      for (const listener of entry.listeners) listener()
    } else {
      entry.retryAt = Date.now() + (entry.attempts >= 3 ? 30_000 : entry.attempts * 1_000)
      if (entry.attempts < 3 && entry.listeners.size) readAvailability(remote, entry)
    }
  })
}

/** Warm the shared read without owning background retry timers. */
export function prefetchHostDesktop(remote: ClientWorkspaceDesktop | undefined): void {
  if (remote !== undefined) readAvailability(remote, entryFor(remote))
}

/** undefined while pending/unavailable transport; false only for a successful no-desktop answer. */
export function useHostDesktopAvailable(remote: ClientWorkspaceDesktop | undefined): boolean | undefined {
  const [, update] = useState(0)
  useEffect(() => {
    if (remote === undefined) return
    const entry = entryFor(remote)
    const listener = () => update(value => value + 1)
    entry.listeners.add(listener)
    readAvailability(remote, entry)
    return () => {
      entry.listeners.delete(listener)
      if (!entry.listeners.size && entry.timer !== undefined) {
        clearTimeout(entry.timer)
        entry.timer = undefined
      }
    }
  }, [remote])
  // Reading by identity also prevents an old Client's true value leaking into
  // the render before a replacement Client's effect has run.
  return remote === undefined ? false : entryFor(remote).value
}

interface FailureBanner {
  seq: number
  text: string
}

/**
 * Transient failure banner owned by the gesture's control.
 * Menu rows close before the request settles, so an inline error inside the
 * menu would never be seen; the banner is announced from the control instead.
 */
export function useOpenFailureToast(): { toast: ReactNode; show(text: string): void } {
  const seq = useRef(0)
  const [banner, setBanner] = useState<FailureBanner | null>(null)
  const dismiss = useCallback(() => { setBanner(null) }, [])
  return {
    toast: banner === null
      ? null
      // A failure that names what broke needs a longer read than a one-liner.
      : <Toast key={banner.seq} text={banner.text} holdMs={5_000} onDone={dismiss} />,
    show: (text: string) => {
      seq.current += 1
      setBanner({ seq: seq.current, text })
    },
  }
}
