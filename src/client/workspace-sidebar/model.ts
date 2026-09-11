import { defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import type {
  WorktreeSidebarTask,
  WorktreeSidebarTopologyResponse,
} from '../../console-contract.js'

export interface SidebarWorkspaceView {
  workspaceId: string
  title: string
  path: string
  sessionIds: readonly string[]
}

export interface SidebarSessionSummary {
  id: string
  displayTitle: string
  title?: string
  cwd?: string
  updatedAt?: number
  blank?: boolean
}

export interface ProjectedManagedTask extends WorktreeSidebarTask {
  projectId: string
  projectName: string
  label: string
}

export interface ManagedWorkspaceSidebarProjection {
  workspaces: SidebarWorkspaceView[]
  managedBySessionId: Record<string, ProjectedManagedTask | undefined>
  protectedSessionIds: ReadonlySet<string>
  protectedWorkspaceIds: ReadonlySet<string>
  relocatedSessionIds: ReadonlySet<string>
  suppressedSessionIds: ReadonlySet<string>
}

const STATE_LABELS = (t: ClientTranslator = defaultClientTranslator) => ({
  working: t("in.progress"),
  ready_for_review: t("ready.for.review"),
  preview_active: t("previewing"),
  preview_detached: t("awaiting.recovery"),
  recovery_required: t("recovery.required"),
  finalized: t("completed"),
  discarded: t("discarded"),
})

function currentTasks(topology: WorktreeSidebarTopologyResponse, t: ClientTranslator = defaultClientTranslator): ProjectedManagedTask[] {
  const byOwner = new Map<string, ProjectedManagedTask>()
  for (const project of topology.projects) {
    if (!project?.project?.id || !project.project.name || !Array.isArray(project.tasks)) continue
    for (const task of project.tasks) {
      if (!task?.checkoutId || !task.ownerSessionId || !task.sourceSessionId) continue
      const projected: ProjectedManagedTask = {
        ...task,
        projectId: project.project.id,
        projectName: project.project.name,
        label: STATE_LABELS(t)[task.state] ?? t("in.progress"),
      }
      const previous = byOwner.get(task.ownerSessionId)
      if (!previous
        || task.iteration > previous.iteration
        || (task.iteration === previous.iteration && task.revision > previous.revision)) {
        byOwner.set(task.ownerSessionId, projected)
      }
    }
  }
  return [...byOwner.values()]
}

/**
 * Merge one owner Session per Managed Checkout into the original Local project.
 * Ambiguous Workspace membership fails open: the official Workspace rows remain
 * visible rather than hiding a Session the projection cannot prove safe.
 */
export function projectManagedWorkspaceSidebar(input: {
  workspaces: readonly SidebarWorkspaceView[]
  sessions: Readonly<Record<string, SidebarSessionSummary | undefined>>
  topology: WorktreeSidebarTopologyResponse
  archivedSessionIds?: readonly string[]
  currentSessionId?: string
}, t: ClientTranslator = defaultClientTranslator): ManagedWorkspaceSidebarProjection {
  const tasks = currentTasks(input.topology, t)
  const archived = new Set(input.archivedSessionIds ?? [])
  const protectedSessionIds = new Set(tasks.map(task => task.ownerSessionId))
  const projected = input.workspaces.map(workspace => ({ ...workspace, sessionIds: [...workspace.sessionIds] }))
  const byWorkspace = new Map(projected.map(workspace => [workspace.workspaceId, workspace]))
  const hiddenWorkspaceIds = new Set<string>()
  const protectedWorkspaceIds = new Set<string>()
  const suppressedSessionIds = new Set<string>()
  const relocatedSessionIds = new Set<string>()
  const managedBySessionId: Record<string, ProjectedManagedTask | undefined> = {}

  for (const task of tasks) {
    if (input.topology.projects.some(project => project.project.id === task.projectId && project.memberships !== undefined)) continue
    const local = byWorkspace.get(task.projectId)
    const owner = input.sessions[task.ownerSessionId]
    if (!local || (!owner && !archived.has(task.ownerSessionId))) continue

    const memberships = input.workspaces.filter(workspace => workspace.sessionIds.includes(task.ownerSessionId))
    if (memberships.length === 0) {
      local.sessionIds = [...local.sessionIds, task.ownerSessionId]
      managedBySessionId[task.ownerSessionId] = task
      continue
    }
    if (memberships.length !== 1) continue
    const managed = byWorkspace.get(memberships[0]!.workspaceId)!
    if (managed.workspaceId !== local.workspaceId) protectedWorkspaceIds.add(managed.workspaceId)
    if (managed.workspaceId === local.workspaceId) {
      managedBySessionId[task.ownerSessionId] = task
      continue
    }

    // Registry ownership proves the owner's destination independently of other
    // members. A cold/unknown or ordinary Session must not block that move.
    if (!local.sessionIds.includes(task.ownerSessionId)) {
      local.sessionIds = [...local.sessionIds, task.ownerSessionId]
    }
    managed.sessionIds = managed.sessionIds.filter(sessionId => sessionId !== task.ownerSessionId)
    managedBySessionId[task.ownerSessionId] = task

    // Never infer emptiness from a missing summary or hide a selected launcher.
    // Archived membership remains durable; this is only a sidebar projection.
    const canHide = managed.sessionIds.every(sessionId => archived.has(sessionId)
      || (input.sessions[sessionId]?.blank === true && sessionId !== input.currentSessionId))
    if (canHide) {
      hiddenWorkspaceIds.add(managed.workspaceId)
      for (const sessionId of managed.sessionIds) {
        if (!archived.has(sessionId)) suppressedSessionIds.add(sessionId)
      }
    }
  }

  // Directory membership is resolved by the Host from registry roots and
  // immutable Session headers. It survives empty/filtered Workspace accounts
  // and carries ordinary historical sessions without inventing owner badges.
  const workspaceClaims = new Map<string, Set<string>>()
  const sessionClaims = new Map<string, Set<string>>()
  const claim = (map: Map<string, Set<string>>, id: string, projectId: string): void => {
    const claims = map.get(id) ?? new Set<string>()
    claims.add(projectId)
    map.set(id, claims)
  }
  const localIds = new Set(input.topology.projects.map(project => project.project.id))
  for (const project of input.topology.projects) {
    for (const id of project.memberships?.workspaceIds ?? []) claim(workspaceClaims, id, project.project.id)
    for (const id of project.memberships?.sessionIds ?? []) claim(sessionClaims, id, project.project.id)
  }
  for (const project of input.topology.projects) {
    const local = byWorkspace.get(project.project.id)
    if (!local || !project.memberships) continue
    const sources = input.workspaces.filter(workspace =>
      project.memberships!.workspaceIds.includes(workspace.workspaceId)
      && workspaceClaims.get(workspace.workspaceId)?.size === 1
      && !localIds.has(workspace.workspaceId))
    const sourceIds = new Set(sources.map(workspace => workspace.workspaceId))
    const owners = tasks.filter(task => task.projectId === project.project.id
      && (input.sessions[task.ownerSessionId] || archived.has(task.ownerSessionId)))
    const candidates = new Set([
      ...sources.flatMap(workspace => [...workspace.sessionIds]),
      ...project.memberships.sessionIds,
      ...owners.map(task => task.ownerSessionId),
    ])
    for (const sessionId of candidates) {
      if ((sessionClaims.get(sessionId)?.size ?? 0) > 1) continue
      // Preserve unrelated or ambiguous manual accounts rather than stealing them.
      if (input.workspaces.some(workspace => workspace.sessionIds.includes(sessionId)
        && workspace.workspaceId !== local.workspaceId && !sourceIds.has(workspace.workspaceId))) continue
      if (!input.workspaces.find(workspace => workspace.workspaceId === local.workspaceId)?.sessionIds.includes(sessionId)) {
        relocatedSessionIds.add(sessionId)
      }
      if (!local.sessionIds.includes(sessionId)) local.sessionIds.push(sessionId)
      suppressedSessionIds.delete(sessionId)
      for (const source of sources) {
        const projectedSource = byWorkspace.get(source.workspaceId)!
        projectedSource.sessionIds = projectedSource.sessionIds.filter(id => id !== sessionId)
      }
    }
    for (const task of owners) {
      if (local.sessionIds.includes(task.ownerSessionId) && (sessionClaims.get(task.ownerSessionId)?.size ?? 0) <= 1) {
        managedBySessionId[task.ownerSessionId] = task
      }
    }
    for (const source of sources) {
      protectedWorkspaceIds.add(source.workspaceId)
      if (byWorkspace.get(source.workspaceId)!.sessionIds.length === 0) hiddenWorkspaceIds.add(source.workspaceId)
    }
  }

  return {
    workspaces: projected.filter(workspace => !hiddenWorkspaceIds.has(workspace.workspaceId)),
    managedBySessionId,
    protectedSessionIds,
    protectedWorkspaceIds,
    relocatedSessionIds,
    suppressedSessionIds,
  }
}
