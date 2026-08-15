/** Browser-side orchestration over Harness Workspace and Session runtime faces. */

import type { WorktreeCreatePayload } from './model.js'

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ClientSessions {
  list: SnapshotStore<{
    current?: string
    ids: string[]
    byId: Record<string, unknown>
  }>
  /** Harness resolves only after the new Session is projected into list/binding. */
  create(input: { workspaceId: string; sessionId: string }): Promise<string>
  open(sessionId: string): void
  binding(sessionId: string): {
    session: {
      command(line: string): Promise<
        | { ok: true; value: { matched: boolean } }
        | { ok: false; error: { code: string; message: string } }
      >
    }
  } | undefined
}

export interface ClientWorkspaces {
  create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
  openPath(path: string): Promise<void>
}

export interface WorktreeClientServices {
  sessions: ClientSessions
  workspaces: ClientWorkspaces
}

/** Idempotently register the managed root, create the preallocated Session, and navigate. */
export async function openIsolatedTarget(
  services: WorktreeClientServices,
  payload: WorktreeCreatePayload,
): Promise<void> {
  const workspace = await services.workspaces.create({ path: payload.managedRoot })
  const sessionId = await services.sessions.create({
    workspaceId: workspace.workspaceId,
    sessionId: payload.targetSessionId,
  })
  if (sessionId !== payload.targetSessionId) {
    throw new Error(`Harness created unexpected Session ${sessionId}; expected ${payload.targetSessionId}.`)
  }
  services.sessions.open(sessionId)
}

/** Submit an exact review-card acceptance as an explicit user command. */
export async function finalizeCurrentSession(
  services: Pick<WorktreeClientServices, 'sessions'>,
  reviewId: string,
  revision: number,
  retention: 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual',
): Promise<void> {
  const sessionId = services.sessions.list.getSnapshot().current
  if (!sessionId) throw new Error('No current Session is selected.')
  const binding = services.sessions.binding(sessionId)
  if (!binding) throw new Error('Current Session is not ready.')
  const result = await binding.session.command(`/worktree finalize ${reviewId} ${revision} ${retention}`)
  if (!result.ok) throw new Error(`Finalize command failed: ${result.error.code}: ${result.error.message}`)
  if (!result.value.matched) throw new Error('The Host did not match the /worktree command.')
}
