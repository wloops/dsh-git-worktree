import { readFileSync } from 'node:fs'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { materializeOfficialWorkspaceClientModule } from '../scripts/workspace-sidebar-upstream.mjs'
import { decorateNextWorkspaceClient, materializeNextWorkspaceClientModule, readNextWorkspaceClient } from '../scripts/workspace-sidebar-upstream-next.mjs'
import { decorateAlphaWorkspaceClient, materializeAlphaWorkspaceClientModule, readAlphaWorkspaceClient } from '../scripts/workspace-sidebar-upstream-alpha.mjs'
import { apply as applyNextWorkspace } from './official-workspace-client-next.mock.js'
import { WORKTREE_STYLES } from '../src/client/styles.js'
import { registerManagedWorkspaceSidebar } from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function strictSlotLedger() {
  const declarations = new Set<string>()
  const descriptors: Record<string, unknown>[] = []
  const context = {
    effect: vi.fn((setup: () => unknown) => { setup() }),
    locale: { register: vi.fn() },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (descriptor: Record<string, unknown>) => {
        for (const name of [String(descriptor.name), ...Object.keys((descriptor.children ?? {}) as object)]) {
          if (declarations.has(name)) throw new Error(`slot ${JSON.stringify(name)} is already declared`)
          declarations.add(name)
        }
        descriptors.push(descriptor)
        return () => {}
      },
    },
  }
  return { context, declarations, descriptors }
}

describe('Managed Workspace profile ownership', () => {
  test.each([false, true])('preserves official pin/rename/archive actions and their props while protecting owner forks (topology ready: %s)', ready => {
    type ActionProps = { sessionId: string; displayTitle: string; injectedAction: (id: string) => string }
    const registered = new Map<string, ComponentType<ActionProps>>()
    const originals = new Map<string, ComponentType<ActionProps>>()
    const ctx = {
      get: (_name: string): unknown => undefined,
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (descriptor: { name: string; id: string }, component: ComponentType<ActionProps>) => {
          registered.set(`${descriptor.name}:${descriptor.id}`, component)
          return () => {}
        },
      },
    }
    registerManagedWorkspaceSidebar(ctx as never, createWorktreeConsoleAdapterFixture().adapter, proxied => {
      const guard = (proxied as unknown as { get(name: string): { ready: boolean; sessionIds: Set<string> } })
        .get('__dshGitWorktreeManagedGuard')
      guard.ready = ready
      guard.sessionIds = new Set(['managed'])
      const slots = (proxied as unknown as { slots: typeof ctx.slots }).slots
      for (const seat of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
        for (const id of ['pin', 'rename', 'fork', 'archive', 'unknown-action']) {
          const Action = ({ sessionId, displayTitle, injectedAction }: ActionProps) =>
            createElement('span', null, `${id}:${sessionId}:${displayTitle}:${injectedAction(sessionId)}`)
          originals.set(`${seat}:${id}`, Action)
          slots.register({ name: seat, id }, Action)
        }
      }
    })
    const props = (sessionId: string): ActionProps => ({
      sessionId, displayTitle: '官方标题', injectedAction: id => `injected-${id}`,
    })
    for (const seat of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
      for (const id of ['pin', 'rename', 'archive']) {
        const Component = registered.get(`${seat}:${id}`)!
        expect(Component).toBe(originals.get(`${seat}:${id}`))
        for (const sessionId of ['managed', 'ordinary']) {
          expect(renderToStaticMarkup(createElement(Component, props(sessionId))))
            .toContain(`${id}:${sessionId}:官方标题:injected-${sessionId}`)
        }
      }
      for (const id of ['fork', 'unknown-action']) {
        const Component = registered.get(`${seat}:${id}`)!
        expect(renderToStaticMarkup(createElement(Component, props('managed')))).toBe('')
        const ordinary = renderToStaticMarkup(createElement(Component, props('ordinary')))
        if (ready) expect(ordinary).toContain(`${id}:ordinary:官方标题:injected-ordinary`)
        else expect(ordinary).toBe('')
      }
    }
  })
  test('disables the original loader and publishes the gated derivative attribution', () => {
    const patch = readFileSync(resolve('cordis.patch.yml'), 'utf8')
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      dsh: { client: { inject: string[] } }
      files: string[]
    }
    expect(patch).toMatch(/- id: ui-workspace\s+name: ['"]?@deepseek-ai\/dsh-client-ui-workspace['"]?\s+disabled: !!js /u)
    expect(patch).not.toMatch(/disabled: true/u)
    expect(patch).toMatch(/- insert:\s+- id: dsh-git-worktree\s+name: dsh-git-worktree/u)
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-workspace')
    expect(manifest.files).toContain('NOTICE')
  })

  test('derives a real Branch Icon and independent status Badge without rewriting the session title', () => {
    const source = materializeOfficialWorkspaceClientModule()

    expect(source).toContain('IconBranchOutlineRegular')
    expect(source).toContain('__dshGitWorktree')
    expect(source).toContain('dsh-git-worktree-sidebar-icon')
    expect(source).toContain('dsh-git-worktree-sidebar-badge')
    expect(source).toContain('data-worktree-state')
    expect(source).toContain('dshGitWorktree.state.ready_for_review')
    expect(source).toContain('dshGitWorktree.managed')
    expect(source).toContain('worktreeDecoration.ariaLabel')
    expect(source).toContain('"data-managed-worktree": "true"')
    expect(source).toContain('className: Rows_module_css_default.hoverStatus')
    if (source.includes('sessionMenuItems')) {
      expect(source).toContain('worktreeDecoration === void 0 ? sessionMenuItems : sessionMenuItems.filter((item) => item.id !== "fork")')
      expect(source).toContain('items: visibleSessionMenuItems')
      expect(source).toContain('draggable: worktreeDecoration === void 0 && drag !== void 0')
      expect(source).toContain('!protectedManagedWorkspace && (0, react_jsx_runtime.jsx)("button"')
      expect(source).toContain('draggable: !protectedManagedWorkspace && drag !== void 0')
    } else {
      expect(source).toContain('worktreeDecoration')
      expect(source).toContain('data-managed-worktree')
    }
    expect(WORKTREE_STYLES).toContain('.dsh-git-worktree-sidebar-icon')
    expect(WORKTREE_STYLES).toContain('.dsh-git-worktree-sidebar-badge')
    expect(WORKTREE_STYLES).toContain('flex: 0 0 auto')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-warn-label)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-success-primary)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-error-primary)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-business-primary) 68%')
  })

  test('derives the hash-gated alpha Browser with protected owner rows and independent status', () => {
    const source = materializeAlphaWorkspaceClientModule()
    expect(source).toContain('!row.blank && (0, react_jsx_runtime.jsx)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,')
    expect(source).not.toContain('!row.blank && !protectedManagedSession && (0, react_jsx_runtime.jsx)("span"')
    expect(source).toContain('protectedManagedSession ? sessionMenuItems.filter((item) => item.id !== "fork") : sessionMenuItems')
    expect(source).toContain('items: visibleSessionMenuItems')
    expect(source).not.toContain('async archiveSession(sessionId) {\n\t\t\t\tif (')
    expect(source).not.toContain('renameSession: async (sessionId, title) => {\n\t\t\t\t\tif (')
    expect(source).toContain('draggable = drag !== void 0 && !row.blank && !protectedManagedSession')
    expect(source).toContain('!protectedManagedWorkspace && actions !== void 0')
    expect(source).toContain('!protectedManagedWorkspace && (0, react_jsx_runtime.jsx)("button"')
    expect(source).toContain('"data-worktree-state": node.__dshGitWorktree.state')
    expect(source).toContain('this.managedWorktreeGuard.blockSession(sessionId)')
    expect(source).toContain('this.managedWorktreeGuard.blockWorkspace(target)')
    expect(() => decorateAlphaWorkspaceClient(readAlphaWorkspaceClient().replace('function SessionNodeItem(', 'function BrokenRowItem(')))
      .toThrow(/one source seam/)
  })

  test('derives the hash-gated next Browser with managed rows protected before exposing menu seats', () => {
    const source = materializeNextWorkspaceClientModule()
    expect(source).toContain('protectedManagedSession && (0, react_jsx_runtime.jsx)("span"')
    expect(source).toContain('!row.blank && (0, react_jsx_runtime.jsxs)("span", {\n\t\t\t\t\t\t\tclassName: Rows_module_css_default.rowActions,')
    expect(source).not.toContain('!row.blank && !protectedManagedSession && (0, react_jsx_runtime.jsxs)("span"')
    expect(source).toContain('draggable = drag !== void 0 && !row.blank && !row.archived && !protectedManagedSession')
    expect(source).toContain('!protectedManagedWorkspace && actions !== void 0')
    expect(source).toContain('draggable: drag !== void 0 && !protectedManagedWorkspace')
    expect(source).toContain('...g.__dshGitWorktreeProtected === true')
    expect(source).toContain('__dshGitWorktree: s.__dshGitWorktree')
    expect(source).toContain('this.managedWorktreeGuard.blockSession(sessionId)')
    expect(source).toContain('this.managedWorktreeGuard.blockWorkspace(target)')
    expect(source).not.toContain('const renameSession = async (sessionId, title) => {\n\t\t\t\tif (')
    expect(source).not.toContain('async archiveSession(sessionId, options = {}) {\n\t\t\t\tif (')
    expect(source).toContain('onDoubleClick: row.blank ? void 0 : (e) => {')
    expect(source).not.toContain('onDoubleClick: row.blank || protectedManagedSession')
    expect(WORKTREE_STYLES).toContain('margin-inline-end: 4px')
    expect(WORKTREE_STYLES).toContain('[role="treeitem"]:hover:has(> [class$="_rowActions"]) > .dsh-git-worktree-sidebar-badge')
    expect(() => decorateNextWorkspaceClient(readNextWorkspaceClient().replace('function ProjectRowItem(', 'function BrokenRowItem(')))
      .toThrow(/one source seam/)
  })

  test('preserves the next Browser child-slot authorization tree', () => {
    const { context, declarations, descriptors } = strictSlotLedger()
    registerManagedWorkspaceSidebar(context, createWorktreeConsoleAdapterFixture().adapter, applyNextWorkspace)
    expect([...declarations]).toEqual([
      'sidebar.workspaces', 'sidebar.workspaces.directoryFlow',
      'sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action',
      'sidebar.session.row.leading', 'sidebar.session.row.hover',
      'conversation.hero.workspace', 'conversation.hero.workspace.directoryFlow',
    ])
    expect(descriptors).toHaveLength(2)
  })

  test('declares each official Workspace Slot tree exactly once', () => {
    const { context, declarations, descriptors } = strictSlotLedger()
    registerManagedWorkspaceSidebar(context, createWorktreeConsoleAdapterFixture().adapter)

    expect([...declarations]).toEqual([
      'sidebar.workspaces',
      'sidebar.workspaces.directoryFlow',
      'conversation.hero.workspace',
      'conversation.hero.workspace.directoryFlow',
    ])
    expect(descriptors).toHaveLength(2)
    expect(() => registerManagedWorkspaceSidebar(
      context,
      createWorktreeConsoleAdapterFixture().adapter,
    )).toThrow(/already declared/u)
  })
})
