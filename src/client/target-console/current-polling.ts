import type { WorktreeConsoleAdapter, WorktreeConsoleCurrentResponse, WorktreeConsoleOutcome } from '../../console-contract.js'
import type { Language } from '../../i18n/core.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'

type Result = { outcome: WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse> } | { error: unknown }
type Listener = (result: Result) => void
const clients = new WeakMap<WorktreeConsoleAdapter, Map<string, Poll>>()
const DELAY = 5_000

/** Display-only observation. Never used to authorize a mutation or Git cleanup. */
class Poll {
  listeners = new Set<Listener>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private dirty = false
  private generation = 0
  private last: Result | undefined

  constructor(private adapter: WorktreeConsoleAdapter, private sessionId: string, private release: () => void) {}

  private onRefresh = (event: Event): void => {
    if ((event as CustomEvent<{ sessionId?: string }>).detail?.sessionId === this.sessionId) this.invalidate()
  }

  subscribe(listener: Listener): () => void {
    const first = this.listeners.size === 0
    this.listeners.add(listener)
    if (first) {
      this.generation++
      window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, this.onRefresh)
      // A detached request is allowed to settle, but cannot seed a new mount.
      this.invalidate()
    } else if (this.last) {
      listener(this.last)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size) return
      this.generation++
      this.last = undefined
      this.dirty = false
      clearTimeout(this.timer)
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, this.onRefresh)
      if (!this.running) this.release()
    }
  }

  private invalidate(): void {
    this.generation++
    this.last = undefined
    clearTimeout(this.timer)
    this.dirty = true
    if (!this.running) void this.run()
  }

  private async run(): Promise<void> {
    if (!this.listeners.size) return
    this.running = true
    this.dirty = false
    const generation = this.generation
    let result: Result
    try { result = { outcome: await this.adapter.current({ sessionId: this.sessionId }) } }
    catch (error) { result = { error } }
    if (generation === this.generation && this.listeners.size) {
      this.last = result
      for (const listener of [...this.listeners]) listener(result)
    }
    this.running = false
    if (!this.listeners.size) { this.release(); return }
    if (this.dirty) { void this.run(); return }
    this.timer = setTimeout(() => { void this.run() }, DELAY)
  }
}

/** Adapter identity isolates Client instances; language isolates translated results. */
export function subscribeCurrent(
  adapter: WorktreeConsoleAdapter, sessionId: string, language: Language, listener: Listener,
): () => void {
  let sessions = clients.get(adapter)
  if (!sessions) { sessions = new Map(); clients.set(adapter, sessions) }
  const key = JSON.stringify([sessionId, language])
  let poll = sessions.get(key)
  if (!poll) {
    const owner = sessions
    poll = new Poll(adapter, sessionId, () => { if (owner.get(key) === poll) owner.delete(key) })
    sessions.set(key, poll)
  }
  return poll.subscribe(listener)
}
