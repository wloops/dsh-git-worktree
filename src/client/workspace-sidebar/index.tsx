import { useEffect, useMemo, useState, type ComponentType } from 'react'
import type { ClientContext, SessionId, SessionListState, WorkspaceId, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import { apply as applyOfficialWorkspace } from 'virtual:dsh-official-workspace-client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorktreeConsoleAdapter, WorktreeSidebarTopologyResponse } from '../../console-contract.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../review-console/status-events.js'
import { projectManagedWorkspaceSidebar } from './model.js'

const EMPTY_TOPOLOGY: WorktreeSidebarTopologyResponse = { projects: [] }

/** Ephemeral presentation metadata consumed only by the gated official Browser derivative. */
export interface ManagedWorktreeSessionDecoration {
  kind: 'managed-worktree'
  state: WorktreeSidebarTopologyResponse['projects'][number]['tasks'][number]['state']
  label: string
  originalTitle: string
}

interface OfficialWorkspaceBrowserProps extends WorkspaceBrowserProps {
  adapter: WorktreeConsoleAdapter
  OfficialBrowser: ComponentType<WorkspaceBrowserProps>
}

/**
 * Preserve the complete official Workspace Browser and change only its data
 * projection plus mutations that are unsafe for one-to-one Managed owners.
 */
export function ManagedOfficialWorkspaceBrowser({
  adapter,
  OfficialBrowser,
  ...officialProps
}: OfficialWorkspaceBrowserProps) {
  const props = officialProps as unknown as WorkspaceBrowserProps
  const workspaceState = props.useWorkspaces((state: WorkspaceListState) => state) as WorkspaceListState
  const sessionState = props.useSessions((state: SessionListState) => state) as SessionListState
  const [topology, setTopology] = useState<WorktreeSidebarTopologyResponse>(EMPTY_TOPOLOGY)
  const workspaceKey = workspaceState.items
    .map(workspace => `${workspace.workspaceId}:${workspace.sessionIds.join(',')}`)
    .join('|')
  const sessionKey = sessionState.ids.join('|')

  useEffect(() => {
    let active = true
    const refresh = (): void => {
      void adapter.sidebarTopology().then(outcome => {
        if (!active) return
        setTopology(outcome.ok ? outcome.value : EMPTY_TOPOLOGY)
      }, () => {
        if (active) setTopology(EMPTY_TOPOLOGY)
      })
    }
    refresh()
    window.addEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(WORKTREE_REVIEW_REFRESH_EVENT, refresh)
    }
  }, [adapter, sessionKey, workspaceKey])

  const projection = useMemo(() => projectManagedWorkspaceSidebar({
    workspaces: workspaceState.items,
    sessions: sessionState.byId,
    topology,
  }), [sessionState.byId, topology, workspaceState.items])

  const projectedWorkspaceState = useMemo<WorkspaceListState>(() => ({
    ...workspaceState,
    items: projection.workspaces as unknown as WorkspaceListState['items'],
  }), [projection.workspaces, workspaceState])
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
  const managedActionBlocked = (): void => {
    window.alert('Managed Worktree 与 owner Session 一对一；请通过 Worktree 验收流程继续、保存或放弃任务。')
  }

  return <OfficialBrowser
    {...props}
    useWorkspaces={useProjectedWorkspaces}
    useSessions={useProjectedSessions}
    startSession={async (workspaceId: WorkspaceId) => {
      if (protectedWorkspaceIds.has(workspaceId)) managedActionBlocked()
      else await props.startSession(workspaceId)
    }}
    renameSession={async (sessionId: SessionId, title: string) => {
      if (protectedIds.has(sessionId)) managedActionBlocked()
      else await props.renameSession(sessionId, title)
    }}
    forkSession={(sessionId: SessionId) => {
      if (protectedIds.has(sessionId)) managedActionBlocked()
      else props.forkSession(sessionId)
    }}
    archiveSession={async (sessionId: SessionId) => {
      if (protectedIds.has(sessionId)) managedActionBlocked()
      else await props.archiveSession(sessionId)
    }}
    insertSessionBefore={async (workspaceId: WorkspaceId, sessionId: SessionId, beforeSessionId?: SessionId) => {
      if (protectedIds.has(sessionId) || (beforeSessionId !== undefined && protectedIds.has(beforeSessionId))) {
        managedActionBlocked()
        return
      }
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
  const proxySlots = new Proxy(ctx.slots, {
    get(target, key, receiver) {
      if (key === 'register') {
        return (descriptor: Record<string, unknown>, component: ComponentType<any>): unknown => {
          if (descriptor.name !== 'sidebar.workspaces') return target.register(descriptor, component)
          const OfficialBrowser = component as ComponentType<WorkspaceBrowserProps>
          const Browser = (props: WorkspaceBrowserProps) => <ManagedOfficialWorkspaceBrowser
            {...props}
            adapter={adapter}
            OfficialBrowser={OfficialBrowser}
          />
          return target.register(descriptor, Browser)
        }
      }
      return Reflect.get(target, key, receiver)
    },
  })

  return new Proxy(ctx, {
    get(target, key, receiver) {
      if (key === 'slots') return proxySlots
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
): void {
  applyOfficialWorkspace(officialContextProxy(ctx, adapter) as unknown as ClientContext)
}
