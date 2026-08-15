/**
 * DSH lookup adapter: maps sessions and projects onto the harness's
 * `workspaceRegistry` service (retrieved dynamically, like the ecosystem's
 * plugins, because the published package version lags the rc.6 runtime). A
 * session's project is found by scanning workspace session accounts; a
 * project record maps to a workspace's `id`/`title`/`path`. Missing service or
 * records degrade to `undefined`, which the state machine treats as
 * recovery/orphan facts rather than failures.
 * @module dsh-git-worktree/adapters/lookup
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionCheckoutLookupPort, SessionCheckoutProjectRecord, SessionCheckoutSessionRecord } from '../ports.js'

/** Minimal structural view of the harness workspace registry (see `@deepseek-ai/dsh-workspace`). */
export interface WorkspaceLike {
  readonly id: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
}

export interface WorkspaceRegistryLike {
  list(): WorkspaceLike[]
  get(id: string): WorkspaceLike | undefined
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
  create(path: string, title?: string): Promise<WorkspaceLike>
  delete(id: string): Promise<boolean>
}

function isWorkspaceRegistryLike(value: unknown): value is WorkspaceRegistryLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkspaceRegistryLike).list === 'function'
    && typeof (value as WorkspaceRegistryLike).get === 'function'
}

/** Build the lookup port over the harness workspace registry (absent → all lookups miss). */
export function createDshLookupPort(ctx: Context): SessionCheckoutLookupPort {
  const registry = (): WorkspaceRegistryLike | undefined => {
    const candidate: unknown = ctx.get('workspaceRegistry')
    return isWorkspaceRegistryLike(candidate) ? candidate : undefined
  }

  return {
    getSession: (sessionId): SessionCheckoutSessionRecord | undefined => {
      const workspaces = registry()?.list() ?? []
      for (const workspace of workspaces) {
        if (workspace.sessionIds.includes(sessionId)) {
          return { id: sessionId, projectId: workspace.id }
        }
      }
      return undefined
    },
    getProject: (projectId): SessionCheckoutProjectRecord | undefined => {
      const workspace = registry()?.get(projectId)
      return workspace
        ? { id: workspace.id, name: workspace.title, root: workspace.path }
        : undefined
    },
  }
}
