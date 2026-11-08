import { useSyncExternalStore } from 'react'
import { GitBranch } from 'lucide-react'
import type { WorktreeConsoleAdapter, WorktreeSidebarTopologyResponse } from '../../console-contract.js'
import { ClientI18nProvider, useClientTranslator } from '../i18n.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
import { currentManagedSidebarTasks } from './model.js'

const TRAILING = 'sidebar.session.row.trailing'
const HOVER = 'sidebar.session.row.hover'
const EMPTY: WorktreeSidebarTopologyResponse = { projects: [] }

interface NativeSlots {
  inject(name: string, callback: () => unknown): unknown
  register(descriptor: { name: string; id: string; order: number }, component: (props: { sessionId: string }) => unknown): unknown
}
interface Source {
  subscribe(listener: () => void): () => void
}
export interface NativeSidebarContext {
  slots: NativeSlots
  effect(setup: () => (() => void)): unknown
  get(name: string): unknown
}

/** Ambient decorations own no Browser, Workspace membership, Session binding or mutation. */
export function registerNativeWorkspaceDecorations(ctx: NativeSidebarContext, adapter: WorktreeConsoleAdapter): void {
  const listeners = new Set<() => void>()
  let snapshot = EMPTY
  let active = true
  let requested = 0
  let running = false
  const publish = (value: WorktreeSidebarTopologyResponse): void => {
    snapshot = value
    for (const listener of listeners) listener()
  }
  // Coalesce changing list snapshots without overlapping reads. A request
  // superseded during transport cannot publish stale owner/state metadata.
  const refresh = (): void => {
    requested++
    if (running || !active) return
    running = true
    void (async () => {
      try {
        while (active) {
          const generation = requested
          let value = EMPTY
          try {
            const outcome = await adapter.sidebarTopology()
            if (outcome.ok) value = outcome.value
          } catch { /* Unavailable metadata withdraws decorations, never rows. */ }
          if (!active) return
          if (generation !== requested) continue
          publish(value)
          return
        }
      } finally { running = false }
    })()
  }
  const source = {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }

  function Decoration({ sessionId, hover = false }: { sessionId: string; hover?: boolean }) {
    const topology = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
    const t = useClientTranslator()
    const task = currentManagedSidebarTasks(topology, t).find(task => task.ownerSessionId === sessionId)
    if (!task) return null
    return <span className={hover ? 'dsh-git-worktree-native-hover' : 'dsh-git-worktree-native-tag'}
      data-worktree-state={task.state} aria-label={task.label} title={task.label}>
      <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" />
      {(hover || task.state !== 'working') && <span>{task.label}</span>}
    </span>
  }
  for (const [name, hover] of [[TRAILING, false], [HOVER, true]] as const) {
    // Public declaration-lifetime injection: a missing seat waits, unloading
    // its owner withdraws our contribution, and reactivation remounts it.
    // No DSH version, mutable ledger entry or inherited render authority.
    ctx.slots.inject(name, () => ctx.slots.register({ name, id: 'dsh-git-worktree', order: 500 },
      ({ sessionId }) => <ClientI18nProvider locale={ctx.get('locale')}><Decoration sessionId={sessionId} hover={hover} /></ClientI18nProvider>))
  }
  ctx.effect(() => {
    const disposers: (() => void)[] = []
    for (const service of ['sessions', 'workspaces']) {
      const list = (ctx.get(service) as { list?: Source } | undefined)?.list
      if (list && typeof list.subscribe === 'function') disposers.push(list.subscribe(refresh))
    }
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    refresh()
    return () => {
      active = false
      requested++
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
      for (const dispose of disposers) dispose()
      listeners.clear()
    }
  })
}
