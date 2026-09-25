import { ClientI18nProvider, useClientTranslator } from '../i18n.js'
import { useEffect, useLayoutEffect, useMemo, useState, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { apply as applyOfficialWorkspace } from 'virtual:dsh-official-workspace-client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorktreeConsoleAdapter, WorktreeSidebarTopologyResponse } from '../../console-contract.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
import { selectedSessionId } from '../actions.js'
import { projectManagedWorkspaceSidebar } from './model.js'

const EMPTY_TOPOLOGY: WorktreeSidebarTopologyResponse = { projects: [] }

/** Ephemeral presentation metadata consumed only by the gated official Browser derivative. */
export interface ManagedWorktreeSessionDecoration {
  kind: 'managed-worktree'
  state: WorktreeSidebarTopologyResponse['projects'][number]['tasks'][number]['state']
  label: string
  originalTitle: string
}

interface ManagedWorkspaceGuard {
  ready: boolean
  sessionIds: ReadonlySet<string>
  workspaceIds: ReadonlySet<string>
  blockSession(id: string): boolean
  blockWorkspace(id: string): boolean
}

interface OfficialWorkspaceBrowserProps extends WorkspaceBrowserProps {
  adapter: WorktreeConsoleAdapter
  OfficialBrowser: ComponentType<WorkspaceBrowserProps>
  guard?: ManagedWorkspaceGuard
}

/**
 * Preserve the complete official Workspace Browser and change only its data
 * projection plus mutations that are unsafe for one-to-one Managed owners.
 */
export function ManagedOfficialWorkspaceBrowser({
  adapter,
  OfficialBrowser,
  guard,
  ...officialProps
}: OfficialWorkspaceBrowserProps) {
  const t = useClientTranslator()
  const props = officialProps as unknown as WorkspaceBrowserProps
  const workspaceState = props.useWorkspaces((state: WorkspaceListState) => state) as WorkspaceListState
  const sessionState = props.useSessions((state: SessionListState) => state) as SessionListState
  const [topology, setTopology] = useState<WorktreeSidebarTopologyResponse>(EMPTY_TOPOLOGY)
  const [topologyVerified, setTopologyVerified] = useState(false)
  const workspaceKey = workspaceState.items
    .map(workspace => `${workspace.workspaceId}:${workspace.sessionIds.join(',')}`)
    .join('|')
  const sessionKey = sessionState.ids.join('|')

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      if (guard) guard.ready = false
      void adapter.sidebarTopology().then(outcome => {
        if (!active) return
        setTopology(outcome.ok ? outcome.value : EMPTY_TOPOLOGY)
        setTopologyVerified(outcome.ok)
      }, () => {
        if (active) {
          setTopology(EMPTY_TOPOLOGY)
          setTopologyVerified(false)
        }
      })
    }
    refresh()
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    return () => {
      active = false
      if (guard) guard.ready = false
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    }
  }, [adapter, guard, sessionKey, workspaceKey])

  const projection = useMemo(() => projectManagedWorkspaceSidebar({
    workspaces: workspaceState.items,
    sessions: sessionState.byId,
    topology,
    archivedSessionIds: workspaceState.archivedSessionIds,
    currentSessionId: selectedSessionId(sessionState),
  }, t), [sessionState.byId, sessionState.current, topology, workspaceState.items, workspaceState.archivedSessionIds, t])

  useLayoutEffect(() => {
    if (!guard) return
    guard.sessionIds = projection.protectedSessionIds
    guard.workspaceIds = projection.protectedWorkspaceIds
    guard.ready = topologyVerified
    return () => { guard.ready = false }
  }, [guard, projection, topologyVerified])

  const projectedWorkspaceState = useMemo<WorkspaceListState>(() => ({
    ...workspaceState,
    items: projection.workspaces.map(workspace => projection.protectedWorkspaceIds.has(workspace.workspaceId)
      ? { ...workspace, __dshGitWorktreeProtected: true }
      : workspace) as unknown as WorkspaceListState['items'],
  }), [projection.protectedWorkspaceIds, projection.workspaces, workspaceState])
  const projectedSessionState = useMemo<SessionListState>(() => {
    const byId = { ...sessionState.byId }
    for (const sessionId of projection.suppressedSessionIds) delete byId[sessionId as keyof typeof byId]
    for (const [sessionId, task] of Object.entries(projection.managedBySessionId)) {
      const summary = byId[sessionId as keyof typeof byId]
      if (!summary || !task) continue
      byId[sessionId as keyof typeof byId] = {
        ...summary,
        // Keep the canonical title untouched. The official derivative renders
        // this metadata as a fixed icon/badge before the truncating title.
        __dshGitWorktree: {
          kind: 'managed-worktree',
          state: task.state,
          label: task.label,
          originalTitle: summary.displayTitle,
        } satisfies ManagedWorktreeSessionDecoration,
      } as typeof summary
    }
    return {
      ...sessionState,
      ids: sessionState.ids.filter(sessionId => !projection.suppressedSessionIds.has(sessionId)),
      byId,
    }
  }, [projection.managedBySessionId, projection.suppressedSessionIds, sessionState])

  const useProjectedWorkspaces = (<T,>(selector: (state: WorkspaceListState) => T): T =>
    selector(projectedWorkspaceState)) as WorkspaceBrowserProps['useWorkspaces']
  const useProjectedSessions = (<T,>(selector: (state: SessionListState) => T): T =>
    selector(projectedSessionState)) as WorkspaceBrowserProps['useSessions']
  const protectedIds = projection.protectedSessionIds
  const protectedWorkspaceIds = projection.protectedWorkspaceIds

  return <OfficialBrowser
    {...props}
    useWorkspaces={useProjectedWorkspaces}
    useSessions={useProjectedSessions}
    startSession={async (workspaceId: WorkspaceId) => {
      if (protectedWorkspaceIds.has(workspaceId)) return
      await props.startSession(workspaceId)
    }}
    forkSession={(sessionId: SessionId) => {
      if (protectedIds.has(sessionId)) return
      props.forkSession(sessionId)
    }}
    insertSessionBefore={async (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => {
      if (
        protectedWorkspaceIds.has(workspaceId)
        || protectedIds.has(sessionId)
        || projection.relocatedSessionIds.has(sessionId)
        || (beforeSessionId !== undefined && (protectedIds.has(beforeSessionId) || projection.relocatedSessionIds.has(beforeSessionId)))
      ) return
      await props.insertSessionBefore(workspaceId, sessionId, beforeSessionId)
    }}
  />
}

interface SidebarRegistrationContext {
  slots: {
    inject(name: string, callback: () => unknown): void
    register(descriptor: Record<string, unknown>, component: ComponentType<any>): unknown
  }
  [key: string]: unknown
}

function officialContextProxy(
  ctx: SidebarRegistrationContext,
  adapter: WorktreeConsoleAdapter,
): SidebarRegistrationContext {
  // Service-level guards also cover the newer official shortcut/menu seats,
  // which call uiWorkspace directly rather than invoking Browser props.
  const guard: ManagedWorkspaceGuard = {
    ready: false,
    sessionIds: new Set(),
    workspaceIds: new Set(),
    blockSession(id) { return !this.ready || this.sessionIds.has(id) },
    blockWorkspace(id) { return !this.ready || this.workspaceIds.has(id) },
  }
  const proxySlots = new Proxy(ctx.slots, {
    get(target, key, receiver) {
      if (key === 'register') {
        return (descriptor: Record<string, unknown>, component: ComponentType<any>): unknown => {
          if (
            (descriptor.name === 'sidebar.workspaces.session.menu.item'
              || descriptor.name === 'sidebar.workspaces.session.row.action')
            && descriptor.id !== 'pin'
          ) {
            // The only owner-safe built-in row action is pin. Third-party actions
            // remain available on ordinary Sessions, but never on a managed owner.
            const Action = component
            const GuardedAction = (props: { sessionId?: string }) =>
              typeof props.sessionId === 'string' && !guard.blockSession(props.sessionId)
                ? <Action {...props} />
                : null
            return target.register(descriptor, GuardedAction)
          }
          if (descriptor.name !== 'sidebar.workspaces') return target.register(descriptor, component)
          const OfficialBrowser = component as ComponentType<WorkspaceBrowserProps>
          const Browser = (props: WorkspaceBrowserProps) => <ClientI18nProvider locale={typeof ctx.get === 'function' ? ctx.get('locale') : undefined}><ManagedOfficialWorkspaceBrowser
            {...props}
            adapter={adapter}
            OfficialBrowser={OfficialBrowser}
            guard={guard}
          /></ClientI18nProvider>
          return target.register(descriptor, Browser)
        }
      }
      return Reflect.get(target, key, receiver)
    },
  })

  return new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'slots') return proxySlots
      if (key === 'get' && typeof target.get === 'function') {
        return (name: string) => name === '__dshGitWorktreeManagedGuard'
          ? guard
          : (target.get as (service: string) => unknown).call(target, name)
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

/**
 * Apply the version- and hash-gated official Workspace Client exactly once,
 * replacing only its Browser component while preserving its declaration tree,
 * locale, picker, stores, and directory-flow authorization.
 */
export function registerManagedWorkspaceSidebar(
  ctx: SidebarRegistrationContext,
  adapter: WorktreeConsoleAdapter,
  applyWorkspace: (ctx: Context) => void = applyOfficialWorkspace,
): void {
  applyWorkspace(officialContextProxy(ctx, adapter) as unknown as Context)
}
