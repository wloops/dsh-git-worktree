import type {
  WorktreeSidebarTask,
  WorktreeSidebarTaskState,
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
  suppressedSessionIds: ReadonlySet<string>
}

const STATE_LABELS: Record<WorktreeSidebarTaskState, string> = {
  working: '进行中',
  ready_for_review: '待验收',
  preview_active: '预览中',
  preview_detached: '待恢复',
  recovery_required: '需要恢复',
  finalized: '已完成',
  discarded: '已放弃',
}

function currentTasks(topology: WorktreeSidebarTopologyResponse): ProjectedManagedTask[] {
  const byOwner = new Map<string, ProjectedManagedTask>()
  for (const project of topology.projects) {
    if (!project?.project?.id || !project.project.name || !Array.isArray(project.tasks)) continue
    for (const task of project.tasks) {
      if (!task?.checkoutId || !task.ownerSessionId || !task.sourceSessionId) continue
      const projected: ProjectedManagedTask = {
        ...task,
        projectId: project.project.id,
        projectName: project.project.name,
        label: STATE_LABELS[task.state] ?? '进行中',
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
}): ManagedWorkspaceSidebarProjection {
  const tasks = currentTasks(input.topology)
  const protectedSessionIds = new Set(tasks.map(task => task.ownerSessionId))
  const projected = input.workspaces.map(workspace => ({ ...workspace, sessionIds: [...workspace.sessionIds] }))
  const byWorkspace = new Map(projected.map(workspace => [workspace.workspaceId, workspace]))
  const hiddenWorkspaceIds = new Set<string>()
  const protectedWorkspaceIds = new Set<string>()
  const suppressedSessionIds = new Set<string>()
  const managedBySessionId: Record<string, ProjectedManagedTask | undefined> = {}

  for (const task of tasks) {
    const local = byWorkspace.get(task.projectId)
    const owner = input.sessions[task.ownerSessionId]
    if (!local || !owner) continue

    const memberships = projected.filter(workspace => workspace.sessionIds.includes(task.ownerSessionId))
    if (memberships.length === 0) {
      local.sessionIds = [...local.sessionIds, task.ownerSessionId]
      managedBySessionId[task.ownerSessionId] = task
      continue
    }
    if (memberships.length !== 1) continue
    const managed = memberships[0]!
    if (managed.workspaceId !== local.workspaceId) protectedWorkspaceIds.add(managed.workspaceId)
    if (managed.workspaceId === local.workspaceId) {
      managedBySessionId[task.ownerSessionId] = task
      continue
    }

    const visibleMembers = managed.sessionIds.filter(sessionId => input.sessions[sessionId] !== undefined)
    const extraMembers = visibleMembers.filter(sessionId => sessionId !== task.ownerSessionId)
    if (extraMembers.some(sessionId => input.sessions[sessionId]?.blank !== true)) continue
    for (const sessionId of extraMembers) suppressedSessionIds.add(sessionId)

    if (!local.sessionIds.includes(task.ownerSessionId)) {
      local.sessionIds = [...local.sessionIds, task.ownerSessionId]
    }
    hiddenWorkspaceIds.add(managed.workspaceId)
    managedBySessionId[task.ownerSessionId] = task
  }

  return {
    workspaces: projected.filter(workspace => !hiddenWorkspaceIds.has(workspace.workspaceId)),
    managedBySessionId,
    protectedSessionIds,
    protectedWorkspaceIds,
    suppressedSessionIds,
  }
}
