// @vitest-environment jsdom

import { createElement, type ComponentType } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest'
import { transferableAbortController } from 'node:util'

beforeEach(() => {
  const abort = transferableAbortController()
  vi.stubGlobal('AbortController', abort.constructor)
  vi.stubGlobal('AbortSignal', abort.signal.constructor)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'
import { loadOfficialBrowserClient } from './support/official-client.js'

function gatewayClient() {
  const gateway = loadOfficialBrowserClient('@deepseek-ai/dsh-api-gateway')
  const access = loadOfficialBrowserClient('@deepseek-ai/dsh-api-remote-access', specifier =>
    specifier === '@deepseek-ai/dsh-api-gateway/client' ? gateway : createRequire(import.meta.url)(specifier))
  return { gateway, access }
}

async function mountAccess(ctx: Context, access: { inject: string[]; apply(ctx: Context): void }) {
  // No owner snapshot or live access stream: official UI answers stay false.
  const slots = ctx.get('slots') as any
  slots.registerFactory = () => () => {}
  await ctx.plugin(access)
}


interface ClientHandoff {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}

function platformRequire(nodeRequire: NodeRequire, specifier: string): unknown {
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    // ESM interop copies own exports, so a get-only Proxy is insufficient.
    const names = [...readFileSync('lib/client.js', 'utf8').matchAll(/_deepseek_ai_dsh_client_ui_primitives\.([A-Za-z0-9_]+)/g)].map(match => match[1])
    return Object.fromEntries(names.map(name => [name,
      name === 'relativeTime' ? () => ({ unit: 'second', value: 1 })
        : name === 'Tooltip' || name === 'HoverCardGroup' || name === 'AnimatedRows' ? ({ children }: any) => children
        : name === 'useRowDragPreview' ? () => ({ start() {}, clear() {} })
        : name === 'HoverCard' ? ({ anchor }: any) => anchor
          : name.startsWith('Icon') ? () => createElement('i', { 'data-icon': name })
            : () => null,
    ]))
  }
  return nodeRequire(specifier)
}

function executeBundle(code: string): ClientHandoff {
  let handoff: ClientHandoff | undefined
  const browserWindow = Object.create(window)
  browserWindow.__ModuleLoader__ = { load(value: ClientHandoff) { handoff = value } }
  browserWindow.addEventListener = window.addEventListener.bind(window)
  browserWindow.removeEventListener = window.removeEventListener.bind(window)
  new Function('window', code)(browserWindow)
  if (handoff === undefined) throw new Error('bundle did not register a ModuleLoader handoff')
  return handoff
}

describe('built Client ModuleLoader artifact', () => {
  test('inlines strict Remote codecs instead of requiring packages absent from the browser module table', () => {
    const source = readFileSync(resolve('lib/client.js'), 'utf8')
    const required = [...new Set([...source.matchAll(/require\(["']([^"']+)["']\)/gu)].map(match => match[1]))]
    expect(required.toSorted()).toEqual([
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-store',
    ].toSorted())
  })

  test('Given the emitted browser script When it executes Then it registers the package id and materializable exports', () => {
    const handoff = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
    expect(handoff.id).toBe('dsh-git-worktree')
    const nodeRequire = createRequire(import.meta.url)
    const clientExports = handoff.factory(specifier => platformRequire(nodeRequire, specifier))
    expect(clientExports.apply).toBeTypeOf('function')
    expect(clientExports.inject).toEqual([
      'slots',
      'sessions',
      'workspaces',
      'locale',
      'remote',
      'layout',
      'shortcuts',
      'remoteAccess',
    ])
    expect(clientExports.inject).not.toContain('conversation')
    expect(clientExports.inject).not.toContain('connection')
    // The modern picker provider entry waits for `uiWorkspace`; requiring it at
    // entry scope would deadlock the web boot (provider cycle).
    expect(clientExports.inject).not.toContain('remote.directoryPicker')
  })

  test('restores uiWorkspace before conversation, then mounts Worktree surfaces and withdraws them with the fiber', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const { gateway, access } = gatewayClient()
    const worktree = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
      .factory(specifier => platformRequire(nodeRequire, specifier)) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const call = vi.fn(async (_url: string, method: string) => ({
      ok: true as const,
      value: method === 'gitWorktree/sidebarTopology' ? await fixture.adapter.sidebarTopology() : expected,
    }))
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', {
      rpc: { call },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    await ctx.plugin({ inject: gateway.inject, apply: gateway.apply })
    const register = vi.fn()
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn((...args: unknown[]) => { register(...args); return () => {} }),
      provideRoot() {},
      entries: () => [],
      subscribe: () => () => {},
    } as never)
    const source = <T,>(snapshot: T) => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    })
    ctx.provide('workspaces', {
      list: source({ items: [], archivedSessionIds: [], phase: 'ready' }),
    } as never)
    ctx.provide('sessions', {
      list: source({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
      clear() {},
      open() {},
      searchResultLimit: 100,
    } as never)
    ctx.provide('locale', { register: vi.fn(), bind: () => () => '' } as never)
    ctx.provide('remote.directoryPicker', {} as never)
    ctx.provide('remote.session', {} as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: vi.fn(() => () => {}) } as never)
    ctx.provide('contextMenus', { register: () => () => {}, active: source(null) } as never)

    await mountAccess(ctx, access)
    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    expect(ctx.worktreeConsole).toBeDefined()
    expect(ctx.uiWorkspace).toBeDefined()

    // uiConversation cannot activate before uiWorkspace exists. The package
    // root must therefore settle without the conversation service, while the
    // conversation-dependent Worktree surfaces remain in their child fiber.
    expect(register.mock.calls.map(call => call[0])).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
    ]))

    ctx.provide('conversation', {
      blocks: { set() {}, storeFor: () => ({ getSnapshot: () => undefined }) },
      input: { for: () => ({ setDraft() {}, addImages: () => true, removeImage() {} }) },
    } as never)
    await vi.waitFor(() => expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.any(Function),
    ))

    const descriptors = register.mock.calls.map(call => call[0])
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_ready_for_review' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status' }),
      expect.objectContaining({ name: 'conversation.input.left', id: 'worktree-pre-session' }),
    ]))
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.view', id: 'worktree' }),
    ]))
    expect(descriptors.filter(descriptor => descriptor.name === 'sidebar.workspaces')).toHaveLength(1)
    expect(descriptors.filter(descriptor => descriptor.name === 'conversation.hero.workspace')).toHaveLength(1)
    await expect(ctx.worktreeConsole.current({ sessionId: 'agent-1' })).resolves.toEqual(expected)
    expect(call).toHaveBeenCalledWith('/api', 'gitWorktree/current', { args: { agentId: 'agent-1', locale: 'zh' } }, expect.any(AbortSignal))
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeDefined()

    await fiber.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeUndefined()
    expect(document.querySelector('style[data-dsh-git-worktree]')).toBeNull()
  })

  test.each(['modern', 'modern-rc5', 'modern-022'])('boots %s whose picker provider waits for uiWorkspace, then resolves picker calls lazily', async flavor => {
    const nodeRequire = createRequire(import.meta.url)
    const { gateway, access } = gatewayClient()
    const worktree = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
      .factory(specifier => platformRequire(nodeRequire, specifier)) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const modernTopology = { ok: true, value: { projects: [{
      project: { id: 'project-local', name: 'demo' },
      tasks: [{ checkoutId: 'checkout-1', ownerSessionId: 'owner', sourceSessionId: 'local', iteration: 1, revision: 1, phase: 'ready', state: 'ready_for_review' }],
    }] } }
    // The 0.2.x directory-picker provider entry is pending on uiWorkspace, so
    // this context deliberately never provides `remote.directoryPicker` up front.
    const call = vi.fn(async (_url: string, method: string) => ({
      ok: true as const,
      value: method === 'gitWorktree/sidebarTopology'
        ? { ...modernTopology, value: { ...modernTopology.value, workspaceClientFlavor: flavor } }
        : expected,
    }))
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', {
      rpc: { call },
      registerGenerationSource: () => () => {},
      start: () => ({ stop() {} }),
    } as never)
    await ctx.plugin({ inject: gateway.inject, apply: gateway.apply })
    const register = vi.fn()
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn((...args: unknown[]) => { register(...args); return () => {} }),
      provideRoot() {},
      entries: () => [],
      subscribe: () => () => {},
    } as never)
    const source = <T,>(snapshot: T) => ({
      getSnapshot: () => snapshot,
      subscribe: () => () => {},
    })
    ctx.provide('workspaces', {
      list: source({ items: [], archivedSessionIds: [], phase: 'ready' }),
    } as never)
    ctx.provide('sessions', {
      list: source({ ids: [], byId: {}, current: undefined, phase: 'ready' }),
      clear() {},
      open() {},
      searchResultLimit: 100,
    } as never)
    ctx.provide('locale', { register: vi.fn(), bind: () => () => '' } as never)
    ctx.provide('remote.session', {} as never)
    ctx.provide('layout', { beginNavigation: () => new AbortController().signal } as never)
    ctx.provide('shortcuts', { register: vi.fn(() => () => {}) } as never)
    ctx.provide('contextMenus', { register: () => () => {}, active: source(null) } as never)

    await mountAccess(ctx, access)
    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    // Render the registered, actually bundled Browser, not a test mock or
    // exported projection helper. Only platform primitives/hooks are fixtures.
    const browser = register.mock.calls.find(call => call[0].name === 'sidebar.workspaces')!
    expect(register.mock.calls.filter(call => call[0].name === 'sidebar.workspaces')).toHaveLength(1)
    expect(Object.keys(browser[0].children)).toEqual(expect.arrayContaining([
      'sidebar.workspaces.directoryFlow',
      'sidebar.workspaces.session.row.action', 'sidebar.session.row.leading', 'sidebar.session.row.hover',
    ]))
    const summary = (id: string, title: string, cwd: string) => ({ id, title, displayTitle: title, cwd, blank: false, running: false, updatedAt: 1, retainedBy: {}, origin: 'user' })
    const sessions = { projectionsBySession: {}, ids: ['local', 'owner'], byId: {
      local: summary('local', 'Local title', '/project'), owner: summary('owner', 'Owner title', '/worktree'),
    }, phase: 'ready' }
    const workspaces = { items: [
      { workspaceId: 'project-local', title: 'demo', path: '/project', createdAt: new Date(0).toISOString(), sessionIds: ['local'] },
      { workspaceId: 'managed', title: 'internal-worktree', path: '/worktree', createdAt: new Date(0).toISOString(), sessionIds: ['owner'] },
    ], archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready', state: 'idle' }
    const select = (value: unknown) => (selector: (state: any) => unknown) => selector(value)
    const view = render(createElement(browser[1] as ComponentType<any>, {
      useWorkspaceActionRequest: select(null),
      useSessionAccess: () => true, useWorkspaceAccess: () => true, useRemoteAccess: () => true, useContextMenu: () => ({ getTriggerProps: () => ({}) }), useContextMenuTarget: select(null),
      wide: true, useSessions: select(sessions), useWorkspaces: select(workspaces),
      usePanelInfo: select({ activePanelId: null }), useSessionStatus: select(new Map()),
      useStore: select({ groupBy: 'workspace', orderBy: 'updated', groupExpansion: { 'project-local': true, managed: true }, sessionOrderByAccount: {} }),
      useDirectoryFlow: select(false), useHostInfo: select({ home: '/home' }), useShortcuts: select([]),
      useWorkspaceShortcuts: select({ searchRequest: 0, addRequested: false }),
      actions: { retainAccountKeys() {}, setGroupExpanded() {} }, renderSlot: () => null,
      t: (key: string) => key,
    }))
    await waitFor(() => expect(view.container.querySelectorAll('[data-managed-worktree="true"]')).toHaveLength(1))
    expect(view.container.textContent).toContain('Local title')
    expect(view.container.textContent).toContain('Owner title')
    expect(view.container.textContent).not.toContain('internal-worktree')
    expect(view.container.querySelectorAll('[data-row-key^="workspace:"]')).toHaveLength(1)
    const owner = view.container.querySelector('[data-managed-worktree="true"]')!
    expect(owner.querySelector('.dsh-git-worktree-sidebar-badge')?.getAttribute('data-worktree-state')).toBe('ready_for_review')
    expect(owner.closest('[class$="_groupSection"]')?.textContent).toContain('demo')

    // The emitted artifact must really select the matching source factory,
    // not simply label the rc.2 factory as rc.5. Their no-options paths differ.
    const navigation = ctx.uiWorkspace as any
    const openWorkspace = vi.spyOn(navigation, 'openWorkspace').mockResolvedValue(undefined)
    const openWorkspaceSession = vi.spyOn(navigation, 'openWorkspaceSession').mockResolvedValue(undefined)
    navigation.startSession('project-local')
    expect(flavor !== 'modern' ? openWorkspace : openWorkspaceSession).toHaveBeenCalledOnce()
    expect(flavor !== 'modern' ? openWorkspaceSession : openWorkspace).not.toHaveBeenCalled()
    view.unmount()
    openWorkspace.mockRestore()
    openWorkspaceSession.mockRestore()

    // Without the filtered inject this fiber could never settle: the entry
    // would wait for `remote.directoryPicker`, which waits for `uiWorkspace`.
    expect(ctx.uiWorkspace).toBeDefined()

    // Picker actions fail cleanly while the provider entry is still absent.
    await expect(ctx.uiWorkspace.pickDirectory()).rejects.toThrow(/not active/)

    // Once the provider entry activates below uiWorkspace, the same call path
    // reaches the real service without restarting the plugin.
    const pick = vi.fn(async () => ({ ok: true }))
    ctx.provide('remote.directoryPicker', { pick } as never)
    await ctx.uiWorkspace.pickDirectory()
    expect(pick).toHaveBeenCalledOnce()

    await fiber.dispose()
  })
})

test('Lucide is bundled as selected ESM icons while React stays a host dependency', () => {
  const source = readFileSync(resolve('lib/client.js'), 'utf8')
  expect(source).not.toMatch(/require\(["']lucide-react["']\)/)
  expect(source).not.toContain('dist/cjs/lucide-react.js')
  expect(source).not.toContain('react.development.js')
  expect(source).not.toContain('react.production.min.js')
  expect(source).toContain('lucide-')
  expect(source).toMatch(/require\(["']react["']\)/)
})
