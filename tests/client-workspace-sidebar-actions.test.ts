// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { transferableAbortController } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, test, vi } from 'vitest'

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
  forkSession(id: string): Promise<unknown>
  startSession(id: string): void
  openWorkspace(id: string): Promise<void>
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
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) {
        const result = callback()
        if (result && typeof (result as Iterable<unknown>)[Symbol.iterator] === 'function') {
          for (const _ of result as Iterable<unknown>) { /* exhaust official registration generators */ }
        }
      },
      register(descriptor: typeof descriptors[number]) { descriptors.push(descriptor); return () => {} },
      provideRoot() {}, entries: () => [], subscribe: () => () => {},
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
      const openWorkspace = vi.spyOn(navigation, 'openWorkspace').mockResolvedValue(undefined)
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
        if (ready) expect(openWorkspace).toHaveBeenCalledWith('local-workspace')
        else expect(openWorkspace).not.toHaveBeenCalled()
      }
      expect(rename.mock.calls).toEqual([['官方新标题'], ['官方新标题']])
      const archiveArgs = variant.name === 'alpha' ? ['owner'] : ['owner', {}]
      expect(archive.mock.calls).toEqual([archiveArgs, archiveArgs])
      expect(unarchive.mock.calls).toEqual([['owner'], ['owner']])
      expect(fork).toHaveBeenCalledTimes(1)
      expect(fork).toHaveBeenCalledWith({ sessionId: 'ordinary', increaseTitle: true })
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
