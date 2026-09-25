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
  test('keeps safe pin actions but hides unsafe menu and hover actions on managed Sessions', () => {
    const registered = new Map<string, ComponentType<{ sessionId: string }>>()
    const ctx = {
      get: (_name: string): unknown => undefined,
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (descriptor: { name: string; id: string }, component: ComponentType<{ sessionId: string }>) => {
          registered.set(`${descriptor.name}:${descriptor.id}`, component)
          return () => {}
        },
      },
    }
    registerManagedWorkspaceSidebar(ctx as never, createWorktreeConsoleAdapterFixture().adapter, proxied => {
      const guard = (proxied as unknown as { get(name: string): { ready: boolean; sessionIds: Set<string> } })
        .get('__dshGitWorktreeManagedGuard')
      guard.ready = true
      guard.sessionIds = new Set(['managed'])
      const slots = (proxied as unknown as { slots: typeof ctx.slots }).slots
      for (const seat of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
        for (const id of ['pin', 'rename', 'fork', 'archive']) {
          slots.register({ name: seat, id }, ({ sessionId }) => createElement('span', null, `${id}:${sessionId}`))
        }
      }
    })
    for (const seat of ['sidebar.workspaces.session.menu.item', 'sidebar.workspaces.session.row.action']) {
      for (const id of ['rename', 'fork', 'archive']) {
        const Component = registered.get(`${seat}:${id}`)!
        expect(renderToStaticMarkup(createElement(Component, { sessionId: 'managed' }))).toBe('')
        expect(renderToStaticMarkup(createElement(Component, { sessionId: 'ordinary' }))).toContain(`${id}:ordinary`)
      }
      const Pin = registered.get(`${seat}:pin`)!
      expect(renderToStaticMarkup(createElement(Pin, { sessionId: 'managed' }))).toContain('pin:managed')
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

    expect(source).toContain('IconBranchOutline16')
    expect(source).toContain('__dshGitWorktree')
    expect(source).toContain('dsh-git-worktree-sidebar-icon')
    expect(source).toContain('dsh-git-worktree-sidebar-badge')
    expect(source).toContain('data-worktree-state')
    expect(source).toContain('dshGitWorktree.state.ready_for_review')
    expect(source).toContain('dshGitWorktree.managed')
    expect(source).toContain('worktreeDecoration.ariaLabel')
    expect(source).toContain('"data-managed-worktree": "true"')
    expect(source).toContain('className: Rows_module_css_default.hoverStatus')
    expect(source).toContain('worktreeDecoration === void 0 ? sessionMenuItems : sessionMenuItems.filter((item) => item.id !== "fork")')
    expect(source).toContain('items: visibleSessionMenuItems')
    expect(source).toContain('draggable: worktreeDecoration === void 0 && drag !== void 0')
    expect(source).toContain('!protectedManagedWorkspace && (0, react_jsx_runtime.jsx)("button"')
    expect(source).toContain('draggable: !protectedManagedWorkspace && drag !== void 0')
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
    expect(source).toContain('!row.blank && !protectedManagedSession && (0, react_jsx_runtime.jsx)("span"')
    expect(source).toContain('draggable = drag !== void 0 && !row.blank && !protectedManagedSession')
    expect(source).toContain('!protectedManagedWorkspace && actions !== void 0')
    expect(source).toContain('!protectedManagedWorkspace && (0, react_jsx_runtime.jsx)("button"')
    expect(source).toContain('"data-worktree-state": node.__dshGitWorktree.state')
    expect(source).toContain('this.ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)')
    expect(source).toContain('this.ctx.get("__dshGitWorktreeManagedGuard").blockWorkspace(target)')
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
    expect(source).toContain('this.ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)')
    expect(source).toContain('this.ctx.get("__dshGitWorktreeManagedGuard").blockWorkspace(target)')
    expect(source).toContain('ctx.get("__dshGitWorktreeManagedGuard").blockSession(sessionId)')
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
