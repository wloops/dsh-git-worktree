import { decorateV022WorkspaceClient, readV022WorkspaceClient } from '../scripts/workspace-sidebar-upstream-022.mjs'
// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { transferableAbortController } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { decorateRc5WorkspaceClient, readRc5WorkspaceClient } from '../scripts/workspace-sidebar-upstream-rc5.mjs'
import { decorateOfficialWorkspaceClient, readOfficialWorkspaceClient } from '../scripts/workspace-sidebar-upstream.mjs'
import { decorateNextWorkspaceClient, readNextWorkspaceClient } from '../scripts/workspace-sidebar-upstream-next.mjs'
import { decorateAlphaWorkspaceClient, readAlphaWorkspaceClient } from '../scripts/workspace-sidebar-upstream-alpha.mjs'
import { registerManagedWorkspaceSidebar } from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

/** Execute the pinned Client factory, not the lightweight Vitest virtual-module mocks. */
function officialApply(source: string): (ctx: Context) => void {
  const nodeRequire = createRequire(import.meta.url)
  let apply!: (ctx: Context) => void
  new Function('window', source)({ __ModuleLoader__: {
    load(handoff: { factory(require: (specifier: string) => unknown): { apply(ctx: Context): void } }) {
      // No UI is rendered here; the browser Host normally supplies primitives.
      apply = handoff.factory(specifier => specifier === '@deepseek-ai/dsh-client-ui-primitives'
        ? {} : nodeRequire(specifier)).apply
    },
  } })
  return apply
}

const variants = [
  { name: 'modern-022', source: () => decorateV022WorkspaceClient(readV022WorkspaceClient()) },
  { name: 'modern-rc5', source: () => decorateRc5WorkspaceClient(readRc5WorkspaceClient()) },
  { name: 'alpha', source: () => decorateAlphaWorkspaceClient(readAlphaWorkspaceClient()) },
  { name: 'next', source: () => decorateNextWorkspaceClient(readNextWorkspaceClient()) },
  { name: 'modern', source: () => decorateOfficialWorkspaceClient(readOfficialWorkspaceClient().source) },
]

interface Guard {
  ready: boolean
  sessionIds: ReadonlySet<string>
  workspaceIds: ReadonlySet<string>
}
interface WorkspaceNavigation {
  archiveSession(id: string, options?: { stopActivity: boolean }): Promise<void>
  unarchiveSession(id: string): Promise<void>
  forkSession(id: string, onCreated?: (id: string) => void, options?: { allowMigration: boolean }): Promise<unknown>
  startSession(id: string): void
  openWorkspace(id: string): Promise<void>
  openWorkspaceSession(id: string): Promise<void>
}
interface ActionInjection {
  renameSession?: (id: string, title: string) => Promise<void>
  stopAndArchiveSession?: (id: string) => Promise<void>
}

describe.each(variants)('$name official Session actions', variant => {
  test('renames and archives owners through official callbacks without requiring topology', async () => {
    // jsdom 24 lacks AbortSignal.any; use Node's real abort implementation.
    const abort = transferableAbortController()
    vi.stubGlobal('AbortController', abort.constructor)
    vi.stubGlobal('AbortSignal', abort.signal.constructor)
    const ctx = new Context()
    const descriptors: { name: string; id?: string; inject?: () => ActionInjection }[] = []
    const source = <T,>(snapshot: T) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
    const rename = vi.fn(async () => {})
    const archive = vi.fn(async () => {})
    const unarchive = vi.fn(async () => {})
    const forkFailure = new Error('ordinary fork forwarded to Host')
    const fork = vi.fn(async () => { throw forkFailure })
    ctx.provide('contextMenus', { register: () => () => {}, active: source(null) } as never)
    ctx.provide('remoteAccess', { source: () => source(true) } as never)
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) {
        const result = callback()
        if (result && typeof (result as Iterable<unknown>)[Symbol.iterator] === 'function') {
          for (const _ of result as Iterable<unknown>) { /* exhaust official registration generators */ }
        }
      },
      register(descriptor: typeof descriptors[number]) { descriptors.push(descriptor); return () => {} },
      provideRoot() {}, registerFactory: () => () => {}, entries: () => [], subscribe: () => () => {},
    } as never)
    ctx.provide('sessions', {
      list: source({ ids: [], byId: {}, phase: 'loading' }),
      fork,
      using: vi.fn(async (_id: string, _options: unknown, callback: (reference: unknown) => Promise<void>) => {
        await callback({ binding: { session: { rename } } })
        return { ok: true }
      }),
    } as never)
    ctx.provide('workspaces', {
      list: source({ items: [], archivedSessionIds: [], pinnedSessionIds: [], phase: 'loading' }),
      archiveSession: archive, unarchiveSession: unarchive,
    } as never)
    ctx.provide('locale', { register: () => () => {}, bind: () => () => '' } as never)
    ctx.provide('remote', {} as never)
    ctx.provide('remote.session', {} as never)
    ctx.provide('remote.directoryPicker', {} as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: () => () => {}, catalog: {} } as never)

    let guard!: Guard
    const apply = officialApply(variant.source())
    const fiber = ctx.plugin({ apply(child: Context) {
      registerManagedWorkspaceSidebar(child as never, createWorktreeConsoleAdapterFixture().adapter, proxy => {
        guard = proxy.get('__dshGitWorktreeManagedGuard') as unknown as Guard
        apply(proxy)
      })
    } })
    try {
      await fiber
      const navigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
      const renameDescriptor = descriptors.find(descriptor => variant.name === 'alpha'
        ? descriptor.name === 'sidebar.workspaces'
        : descriptor.id === 'workspace.session-rename')!
      const renameSession = renameDescriptor.inject!().renameSession!
      const openWorkspace = vi.spyOn(navigation, variant.name === 'modern' ? 'openWorkspaceSession' : 'openWorkspace').mockResolvedValue(undefined)
      for (const ready of [false, true]) {
        guard.ready = ready
        guard.sessionIds = new Set(['owner'])
        guard.workspaceIds = new Set(['managed-workspace'])
        await renameSession('owner', '官方新标题')
        await navigation.archiveSession('owner')
        await navigation.unarchiveSession('owner')
        await expect(navigation.forkSession('owner')).rejects.toThrow(/managed Session/)
        await expect(navigation.forkSession('ordinary')).rejects.toThrow(ready ? forkFailure.message : 'managed Session')
        navigation.startSession('managed-workspace')
        expect(openWorkspace).not.toHaveBeenCalled()
        navigation.startSession('local-workspace')
        if (ready) expect(openWorkspace.mock.calls[0]?.[0]).toBe('local-workspace')
        else expect(openWorkspace).not.toHaveBeenCalled()
      }
      expect(rename.mock.calls).toEqual([['官方新标题'], ['官方新标题']])
      const archiveArgs = variant.name === 'alpha' ? ['owner'] : ['owner', {}]
      expect(archive.mock.calls).toEqual([archiveArgs, archiveArgs])
      expect(unarchive.mock.calls).toEqual([['owner'], ['owner']])
      expect(fork).toHaveBeenCalledTimes(1)
      expect(fork).toHaveBeenCalledWith({ sessionId: 'ordinary', increaseTitle: true })
      if (variant.name.startsWith('modern')) {
        const onCreated = vi.fn()
        await expect(navigation.forkSession('ordinary', onCreated, { allowMigration: false })).rejects.toBe(forkFailure)
        expect(fork).toHaveBeenLastCalledWith({ sessionId: 'ordinary', increaseTitle: true, onCreated, allowMigration: false })
        if (variant.name !== 'modern-022') expect(descriptors.some(descriptor => descriptor.id === 'session-id')).toBe(true)
      }
      if (variant.name !== 'alpha') {
        const confirm = descriptors.find(descriptor => descriptor.id === 'workspace.session-archive')!
        await confirm.inject!().stopAndArchiveSession!('owner')
        expect(archive).toHaveBeenLastCalledWith('owner', { stopActivity: true })
      }
    } finally {
      await fiber.dispose()
    }
  })
})

describe.each(variants)('$name implicit New Session target resolution', variant => {
  test('redirects Managed targets to their project and never silently no-ops', async () => {
    // jsdom 24 lacks AbortSignal.any; use Node's real abort implementation.
    const abort = transferableAbortController()
    vi.stubGlobal('AbortController', abort.constructor)
    vi.stubGlobal('AbortSignal', abort.signal.constructor)
    const ctx = new Context()
    const descriptors: { name: string; id?: string; inject?: () => unknown }[] = []
    const source = <T,>(snapshot: T) => ({ getSnapshot: () => snapshot, subscribe: () => () => {} })
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) {
        const result = callback()
        if (result && typeof (result as Iterable<unknown>)[Symbol.iterator] === 'function') {
          for (const _ of result as Iterable<unknown>) { /* exhaust official registration generators */ }
        }
      },
      register(descriptor: typeof descriptors[number]) { descriptors.push(descriptor); return () => {} },
      provideRoot() {}, registerFactory: () => () => {}, entries: () => [], subscribe: () => () => {},
    } as never)
    ctx.provide('sessions', {
      list: source({
        ids: ['owner', 'local'],
        byId: {
          owner: { id: 'owner', updatedAt: 1, blank: false },
          local: { id: 'local', updatedAt: 2, blank: false },
        },
        phase: 'ready',
      }),
      fork: vi.fn(), using: vi.fn(), binding: () => ({}), create: vi.fn(), refreshProjections: vi.fn(async () => {}),
    } as never)
    ctx.provide('workspaces', {
      list: source({
        items: [
          { workspaceId: 'managed-workspace', sessionIds: ['owner'] },
          { workspaceId: 'project-workspace', sessionIds: ['local'] },
        ],
        archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready',
      }),
      archiveSession: vi.fn(), unarchiveSession: vi.fn(),
    } as never)
    ctx.provide('locale', { register: () => () => {}, bind: () => () => '' } as never)
    ctx.provide('remote', {} as never)
    ctx.provide('remote.session', {} as never)
    ctx.provide('remote.directoryPicker', {} as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: () => () => {}, catalog: {} } as never)
    ctx.provide('contextMenus', { register: () => () => {}, active: source(null) } as never)
    ctx.provide('remoteAccess', { source: () => source(true) } as never)

    let guard!: {
      ready: boolean
      sessionIds: Set<string>
      workspaceIds: Set<string>
      managedWorkspaceToProject: Map<string, string>
      blockWorkspace(id: string): boolean
    }
    const apply = officialApply(variant.source())
    const fiber = ctx.plugin({ apply(child: Context) {
      registerManagedWorkspaceSidebar(child as never, createWorktreeConsoleAdapterFixture().adapter, proxy => {
        guard = proxy.get('__dshGitWorktreeManagedGuard') as unknown as typeof guard
        apply(proxy)
      })
    } })
    try {
      await fiber
      const navigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation & {
        mainReference?: { sessionId: string }
        clearMain(): void
      }
      guard.ready = true
      guard.sessionIds = new Set(['owner'])
      guard.workspaceIds = new Set(['managed-workspace'])
      guard.managedWorkspaceToProject = new Map([['managed-workspace', 'project-workspace']])
      // Each generation enters session creation through its own method and
      // arity; assert the resolved Workspace identity, not the call signature.
      const openMethod = variant.name === 'modern' ? 'openWorkspaceSession' : 'openWorkspace'
      const open = vi.spyOn(navigation, openMethod as 'openWorkspace').mockResolvedValue(undefined as never)
      const clearMain = vi.spyOn(navigation, 'clearMain').mockImplementation(() => {})

      // Global New Session inside a Managed owner resolves to the original project.
      navigation.mainReference = { sessionId: 'owner' }
      navigation.startSession(undefined)
      expect(open.mock.calls[0]?.[0]).toBe('project-workspace')
      expect(open).toHaveBeenCalledTimes(1)
      expect(clearMain).not.toHaveBeenCalled()

      // A normal current Workspace keeps official behavior.
      open.mockClear()
      navigation.mainReference = { sessionId: 'local' }
      navigation.startSession(undefined)
      expect(open.mock.calls[0]?.[0]).toBe('project-workspace')
      expect(clearMain).not.toHaveBeenCalled()

      // An unverified topology opens the New Session view instead of no-op.
      open.mockClear(); clearMain.mockClear()
      guard.ready = false
      navigation.mainReference = { sessionId: 'owner' }
      navigation.startSession(undefined)
      expect(clearMain).toHaveBeenCalledOnce()
      expect(open).not.toHaveBeenCalled()

      // A Managed target without a project mapping also opens the New Session view.
      open.mockClear(); clearMain.mockClear()
      guard.ready = true
      guard.managedWorkspaceToProject = new Map()
      navigation.startSession(undefined)
      expect(clearMain).toHaveBeenCalledOnce()
      expect(open).not.toHaveBeenCalled()

      // Explicit second-session creation in a Managed Workspace stays blocked.
      open.mockClear(); clearMain.mockClear()
      navigation.startSession('managed-workspace')
      expect(open).not.toHaveBeenCalled()
      expect(clearMain).not.toHaveBeenCalled()
    } finally {
      await fiber.dispose()
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})
