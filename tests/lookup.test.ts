import { resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, test } from 'vitest'
import { createDshLookupPort, type WorkspaceLike, type WorkspaceRegistryLike } from '../src/adapters/lookup.js'

interface LiveSessionFixture {
  header?: { cwd?: unknown }
}

function workspace(id: string, path: string, sessionIds: string[] = []): WorkspaceLike {
  return { id, path, title: id, sessionIds }
}

function contextOf(
  workspaces: WorkspaceLike[],
  liveSessions: Record<string, LiveSessionFixture> = {},
): Context {
  const byId = new Map(workspaces.map(candidate => [candidate.id, candidate]))
  const registry: WorkspaceRegistryLike = {
    list: () => workspaces,
    get: id => byId.get(id),
    resolveByPath: async path => workspaces.find(candidate => candidate.path === path),
    create: async () => { throw new Error('not used') },
    delete: async () => false,
  }
  const sessions = { get: (sessionId: string) => liveSessions[sessionId] }
  return {
    get: (name: string) => name === 'workspaceRegistry'
      ? registry
      : name === 'sessions'
        ? sessions
        : undefined,
  } as unknown as Context
}

describe('DSH lookup adapter', () => {
  test('uses the authoritative Workspace session projection when the Session remains accounted', () => {
    const managedRoot = resolve('fixtures', 'managed')
    const lookup = createDshLookupPort(contextOf([
      workspace('workspace-managed', managedRoot, ['target-session']),
    ], {
      'target-session': { header: { cwd: resolve('fixtures', 'wrong') } },
    }))

    expect(lookup.getSession('target-session')).toEqual({
      id: 'target-session',
      projectId: 'workspace-managed',
    })
  })

  test('recovers a filtered live Session from its immutable cwd header after cleanup', () => {
    const managedRoot = resolve('fixtures', 'cleaned-managed')
    const lookup = createDshLookupPort(contextOf([
      workspace('workspace-cleaned', managedRoot),
    ], {
      'target-session': { header: { cwd: managedRoot } },
    }))

    expect(lookup.getSession('target-session')).toEqual({
      id: 'target-session',
      projectId: 'workspace-cleaned',
    })
  })

  test('does not recover cold, mismatched, pathless, or ambiguously matched Sessions', () => {
    const managedRoot = resolve('fixtures', 'cleaned-managed')
    const duplicateRoot = resolve('fixtures', 'duplicate-managed')
    const lookup = createDshLookupPort(contextOf([
      workspace('workspace-cleaned', managedRoot),
      workspace('workspace-duplicate-a', duplicateRoot),
      workspace('workspace-duplicate-b', duplicateRoot),
    ], {
      mismatch: { header: { cwd: resolve('fixtures', 'other') } },
      pathless: { header: {} },
      ambiguous: { header: { cwd: duplicateRoot } },
    }))

    expect(lookup.getSession('cold')).toBeUndefined()
    expect(lookup.getSession('mismatch')).toBeUndefined()
    expect(lookup.getSession('pathless')).toBeUndefined()
    expect(lookup.getSession('ambiguous')).toBeUndefined()
  })
})
