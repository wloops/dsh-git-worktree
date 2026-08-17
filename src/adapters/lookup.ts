/**
 * DSH lookup adapter: maps sessions and projects onto the harness's
 * `workspaceRegistry` service (retrieved dynamically, like the ecosystem's
 * plugins, because the published package version lags the rc.6 runtime). A
 * session's project is found by scanning workspace session accounts; when a
 * cleaned immutable cwd makes Harness filter a still-live Session from that
 * projection, the immutable live header may restore the exact mapping. A
 * project record maps to a workspace's `id`/`title`/`path`. Missing service or
 * records degrade to `undefined`, which the state machine treats as
 * recovery/orphan facts rather than failures.
 * @module dsh-git-worktree/adapters/lookup
 */

import { resolve } from 'node:path'
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

interface LiveSessionLike {
  readonly header?: { readonly cwd?: unknown }
}

interface SessionStoreLike {
  get(sessionId: string): LiveSessionLike | undefined
}

function isWorkspaceRegistryLike(value: unknown): value is WorkspaceRegistryLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as WorkspaceRegistryLike).list === 'function'
    && typeof (value as WorkspaceRegistryLike).get === 'function'
}

function isSessionStoreLike(value: unknown): value is SessionStoreLike {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as SessionStoreLike).get === 'function'
}

function sameResolvedPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left)
  const normalizedRight = resolve(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** Build the lookup port over Harness workspace and live-session projections. */
export function createDshLookupPort(ctx: Context): SessionCheckoutLookupPort {
  const registry = (): WorkspaceRegistryLike | undefined => {
    const candidate: unknown = ctx.get('workspaceRegistry')
    return isWorkspaceRegistryLike(candidate) ? candidate : undefined
  }
  const sessions = (): SessionStoreLike | undefined => {
    const candidate: unknown = ctx.get('sessions')
    return isSessionStoreLike(candidate) ? candidate : undefined
  }

  return {
    getSession: (sessionId): SessionCheckoutSessionRecord | undefined => {
      const workspaces = registry()?.list() ?? []
      for (const workspace of workspaces) {
        if (workspace.sessionIds.includes(sessionId)) {
          return { id: sessionId, projectId: workspace.id }
        }
      }

      // Harness filters Workspace.sessionIds when an immutable cwd no longer
      // resolves. A cleaned delivered Session can still be live and retain that
      // exact cwd in its header, so recover only this authenticated live case.
      const liveCwd = sessions()?.get(sessionId)?.header?.cwd
      if (typeof liveCwd !== 'string') return undefined
      const matches = workspaces.filter(workspace => sameResolvedPath(workspace.path, liveCwd))
      return matches.length === 1
        ? { id: sessionId, projectId: matches[0]!.id }
        : undefined
    },
    getProject: (projectId): SessionCheckoutProjectRecord | undefined => {
      const workspace = registry()?.get(projectId)
      return workspace
        ? { id: workspace.id, name: workspace.title, root: workspace.path }
        : undefined
    },
  }
}
