import { createRequire } from 'node:module'
import { describe, expect, test, vi } from 'vitest'
import { decorateV022WorkspaceClient, readV022WorkspaceClient, verifyV022WorkspaceClient } from '../scripts/workspace-sidebar-upstream-022.mjs'
import { registerManagedWorkspaceSidebar } from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const source = readV022WorkspaceClient()
const require = createRequire(import.meta.url)
function exportsOf(source: string) {
  let result: any
  new Function('window', source.replace('exports.apply = apply;', 'exports.apply = apply; exports.TestService = UiWorkspaceService; exports.deriveSearchResults = deriveSearchResults; exports.registerSessionMenus = registerSessionMenus;'))({
    __ModuleLoader__: { load: (row: any) => { result = row.factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)) } },
  })
  return result
}

describe('exact 0.2.2-rc.1 source and official menu contract', () => {
  test('accepts only exact package identity, version and source bytes', () => {
    const manifest = { name: '@deepseek-ai/dsh-client-ui-workspace', version: '0.2.2-rc.1' }
    expect(verifyV022WorkspaceClient(manifest, source)).toBe(source)
    expect(() => verifyV022WorkspaceClient({ ...manifest, name: 'lookalike' }, source)).toThrow(/Unsupported/)
    expect(() => verifyV022WorkspaceClient({ ...manifest, version: '0.2.2-rc.2' }, source)).toThrow(/Unsupported/)
    expect(() => verifyV022WorkspaceClient(manifest, source + '\n')).toThrow(/hash drifted/)
    expect(() => decorateV022WorkspaceClient(source.replace('updatedAt: s.updatedAt,', 'updatedAt: 0,'))).toThrow(/stable source seam/)
    expect(() => decorateV022WorkspaceClient(source + 'updatedAt: s.updatedAt,')).toThrow(/stable source seam/)
  })

  test('keeps native search, preset/blank navigation, access and restoration logic', () => {
    const before = exportsOf(source)
    const after = exportsOf(decorateV022WorkspaceClient(source))
    for (const name of ['connectBlank', 'createInWorkspace', 'openWorkspace', 'restoreSelection', 'whenAccess']) {
      expect(before.TestService.prototype[name]).toBeTypeOf('function')
      expect(String(after.TestService.prototype[name])).toBe(String(before.TestService.prototype[name]))
    }
    expect(String(after.deriveSearchResults).replace(/\n\t+__dshGitWorktree: summary.__dshGitWorktree,/, '')).toBe(String(before.deriveSearchResults))
    expect(String(after.registerSessionMenus)).toBe(String(before.registerSessionMenus))
    expect(String(after.deriveSearchResults)).toContain('summary.id.toLowerCase().includes(q)')
    expect(decorateV022WorkspaceClient(source)).toContain('"sidebar.session.row.trailing"')
    expect(decorateV022WorkspaceClient(source)).toContain('renderSlot("sidebar.session.row.hover", { sessionId: node.id })')
  })

  test.each([false, true])('structured native menus keep safe owner actions and guard forks (ready: %s)', ready => {
    const menus = new Map<string, any>()
    const snapshot = { archivedSessionIds: [], pinnedSessionIds: [] }
    const t = (key: string) => key
    const context = {
      get: () => undefined,
      effect: (setup: () => unknown) => setup(),
      locale: { bind: () => t },
      workspaces: { list: { getSnapshot: () => snapshot } },
      remoteAccess: { source: () => ({ getSnapshot: () => true }) },
      contextMenus: { register: (descriptor: any) => { menus.set(descriptor.id, descriptor); return () => {} } },
      slots: { inject() {}, register() {} },
    }
    const actions = { pinSession: vi.fn(), unpinSession: vi.fn(), requestSessionRename: vi.fn(), forkSession: vi.fn(), copySessionId: vi.fn(), archiveSession: vi.fn(), unarchiveSession: vi.fn() }
    registerManagedWorkspaceSidebar(context as never, createWorktreeConsoleAdapterFixture().adapter, proxy => {
      const guard = proxy.get('__dshGitWorktreeManagedGuard') as any
      guard.ready = ready
      guard.sessionIds = new Set(['owner'])
      guard.workspaceIds = new Set(['managed'])
      exportsOf(decorateV022WorkspaceClient(source)).registerSessionMenus(proxy, actions)
    })
    const owner = { sessionId: 'owner', displayTitle: 'Owner' }
    for (const id of ['pin', 'rename', 'id', 'archive']) {
      const items = menus.get(`session.${id}`).resolve(owner)
      expect(items).toHaveLength(1)
      items[0].run()
    }
    expect(actions.pinSession).toHaveBeenCalledWith('owner')
    expect(actions.requestSessionRename).toHaveBeenCalledWith('owner', 'Owner')
    expect(actions.copySessionId).toHaveBeenCalledWith('owner')
    expect(actions.archiveSession).toHaveBeenCalledWith('owner')
    expect(menus.get('session.fork').resolve(owner)).toEqual([])
    expect(menus.get('session.fork').resolve({ sessionId: 'local', displayTitle: 'Local' })).toHaveLength(ready ? 1 : 0)
  })
})
