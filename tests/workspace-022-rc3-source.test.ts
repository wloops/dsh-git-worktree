import { createRequire } from 'node:module'
import { describe, expect, test, vi } from 'vitest'
import {
  decorateV022Rc3WorkspaceClient,
  materializeV022Rc3WorkspaceClientModule,
  readV022Rc3WorkspaceClient,
  verifyV022Rc3WorkspaceClient,
} from '../scripts/workspace-sidebar-upstream-022-rc3.mjs'

const source = readV022Rc3WorkspaceClient()
const require = createRequire(import.meta.url)

function exportsOf(text: string) {
  let result: any
  new Function('window', text.replace('exports.apply=apply;', 'exports.apply=apply;exports.TestService=UiWorkspaceService;exports.deriveSearchResults=deriveSearchResults;exports.registerSessionMenus=registerSessionMenus;exports.sessionDragOrder=sessionDragOrder;'))({
    __ModuleLoader__: { load: (row: any) => { result = row.factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)) } },
  })
  return result
}

const decorated = decorateV022Rc3WorkspaceClient(source)

describe('exact 0.2.2-rc.3 Workspace Client source', () => {
  test('requires exact source bytes and unique minified seams', () => {
    const manifest = { name: '@deepseek-ai/dsh-client-ui-workspace', version: '0.2.2-rc.3' }
    expect(verifyV022Rc3WorkspaceClient(manifest, source)).toBe(source)
    expect(() => verifyV022Rc3WorkspaceClient({ ...manifest, name: 'lookalike' }, source)).toThrow(/Unsupported/)
    expect(() => verifyV022Rc3WorkspaceClient({ ...manifest, version: '0.2.2-rc.4' }, source)).toThrow(/Unsupported/)
    expect(() => verifyV022Rc3WorkspaceClient(manifest, source + '\n')).toThrow(/hash drifted/)
    expect(() => decorateV022Rc3WorkspaceClient(source.replace('updatedAt:s.updatedAt,', 'updatedAt:0,'))).toThrow(/stable source seam/)
    expect(() => decorateV022Rc3WorkspaceClient(source + 'updatedAt:s.updatedAt,')).toThrow(/stable source seam/)
  })

  test('keeps official navigation, menus and Slots while projecting managed identity into search', () => {
    const before = exportsOf(source)
    const after = exportsOf(decorated)
    expect(after.inject).toEqual(before.inject)
    for (const name of ['connectBlank', 'createInWorkspace', 'openWorkspace', 'restoreSelection', 'whenAccess']) {
      expect(before.TestService.prototype[name]).toBeTypeOf('function')
      expect(String(after.TestService.prototype[name])).toBe(String(before.TestService.prototype[name]))
    }
    expect(String(after.registerSessionMenus)).toBe(String(before.registerSessionMenus))
    expect(String(after.deriveSearchResults).replace('__dshGitWorktree:summary.__dshGitWorktree,', '')).toBe(String(before.deriveSearchResults))
    for (const slot of ['sidebar.session.row.leading', 'sidebar.session.row.trailing', 'sidebar.session.row.hover']) {
      expect(decorated).toContain('renderSlot(`' + slot + '`,{sessionId:node.id})')
    }
    expect(decorated).toContain('renderFactorySlot(`contextMenu.button`')
  })

  test('blocks direct managed forks and starts, redirects implicit starts, and preserves preset options', async () => {
    const { TestService } = exportsOf(decorated)
    const service = {
      managedWorktreeGuard: {
        blockSession: vi.fn(() => true),
        blockWorkspace: vi.fn((id: string) => id === 'managed'),
        resolveStartTarget: vi.fn(() => 'project'),
      },
      sessions: { list: { getSnapshot: () => ({ phase: 'ready', byId: {} }) }, fork: vi.fn() },
      workspaces: { list: { getSnapshot: () => ({ phase: 'ready', items: [{ workspaceId: 'managed', sessionIds: ['owner'] }] }) } },
      mainReference: { sessionId: 'owner' },
      openWorkspace: vi.fn(async () => {}),
    }
    await expect(TestService.prototype.forkSession.call(service, 'owner')).rejects.toThrow(/through its Worktree owner/)
    expect(service.sessions.fork).not.toHaveBeenCalled()
    const options = { agentPreset: 'custom' }
    TestService.prototype.startSession.call(service, 'managed', options)
    expect(service.openWorkspace).not.toHaveBeenCalled()
    TestService.prototype.startSession.call(service, undefined, options)
    expect(service.managedWorktreeGuard.resolveStartTarget).toHaveBeenCalledWith('managed')
    expect(service.openWorkspace).toHaveBeenCalledTimes(1)
    expect(service.openWorkspace).toHaveBeenCalledWith('project', undefined, options)
  })

  test('keeps local session ordering but rejects managed drop sources and targets', () => {
    const rows = [
      { id: 'a', pinned: false },
      { id: 'b', pinned: false },
      { id: 'owner', pinned: false, __dshGitWorktree: { kind: 'managed-worktree' } },
    ]
    const order = rows.map(row => row.id)
    const { sessionDragOrder } = exportsOf(decorated)
    expect(sessionDragOrder(order, rows, { sessionId: 'a', pinned: false }, { id: 'b', half: 'after' })).toEqual(['b', 'a', 'owner'])
    expect(sessionDragOrder(order, rows, { sessionId: 'a', pinned: false }, { id: 'owner', half: 'after' })).toBeUndefined()
    expect(sessionDragOrder(order, rows, { sessionId: 'owner', pinned: false }, { id: 'a', half: 'before' })).toBeUndefined()
  })

  test('prevents remote workspace reorder for a protected source or actual insertion anchor', async () => {
    const start = decorated.indexOf('insertWorkspaceBefore:async(')
    const end = decorated.indexOf(',unarchiveSession:', start)
    const makeCallback = new Function('ctx', 'workspaces', `return ({${decorated.slice(start, end)}}).insertWorkspaceBefore`)
    let ready = false
    const guard = { blockWorkspace: (id: string) => !ready || id === 'managed' }
    const insertBefore = vi.fn(async () => {})
    const reorder = makeCallback({ get: () => guard }, { insertBefore })
    await reorder('project', 'other')
    ready = true
    await reorder('managed', 'other')
    await reorder('project', 'managed')
    expect(insertBefore).not.toHaveBeenCalled()
    await reorder('project', 'other')
    await reorder('project')
    expect(insertBefore.mock.calls).toEqual([['project', 'other'], ['project', undefined]])
  })

  test('materializes a standalone module and isolates all three native styles', () => {
    const output = materializeV022Rc3WorkspaceClientModule()
    expect(output).not.toContain('__ModuleLoader__.load')
    expect(output).toContain('export const apply = official.apply')
    expect(output.match(/tag.dataset.plugin = "dsh-git-worktree";/g)).toHaveLength(3)
    for (const filename of ['WorkspaceBrowser', 'Rows', 'WorkspacePicker']) {
      expect(output).toContain(`"dsh-git-worktree/workspace-0.2.2-rc.3/${filename}.module.css"`)
    }
    const css = (text: string) => [...text.matchAll(/const css(?:\$\d+)?=`[^`]*`;/g)].map(match => match[0])
    expect(css(source)).toHaveLength(3)
    expect(css(output)).toEqual(css(source))
  })
})
