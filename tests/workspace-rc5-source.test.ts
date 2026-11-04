import { createRequire } from 'node:module'
import { describe, expect, test, vi } from 'vitest'
import { decorateOfficialWorkspaceClient, readOfficialWorkspaceClient } from '../scripts/workspace-sidebar-upstream.mjs'
import { decorateRc5WorkspaceClient, readRc5WorkspaceClient, verifyRc5WorkspaceClient } from '../scripts/workspace-sidebar-upstream-rc5.mjs'

function navigation(source: string) {
  const require = createRequire(import.meta.url)
  let prototype: any
  new Function('window', source.replace('exports.apply = apply;', 'exports.apply = apply; exports.TestService = UiWorkspaceService;'))({
    __ModuleLoader__: { load: (row: any) => {
      prototype = row.factory((id: string) => id === '@deepseek-ai/dsh-client-ui-primitives' ? {} : require(id)).TestService.prototype
    } },
  })
  return prototype
}

const rc2 = readOfficialWorkspaceClient().source
const rc5 = readRc5WorkspaceClient()
const prototype = navigation(decorateRc5WorkspaceClient(rc5))

describe('exact rc.5 provenance and navigation semantics', () => {
  test('rejects wrong package identity/version and any source drift', () => {
    const manifest = { name: '@deepseek-ai/dsh-client-ui-workspace', version: '0.2.1-rc.5' }
    expect(verifyRc5WorkspaceClient(manifest, rc5)).toBe(rc5)
    expect(() => verifyRc5WorkspaceClient({ ...manifest, version: '0.2.1-rc.2' }, rc5)).toThrow(/Unsupported/)
    expect(() => verifyRc5WorkspaceClient({ ...manifest, name: 'lookalike' }, rc5)).toThrow(/Unsupported/)
    expect(() => verifyRc5WorkspaceClient(manifest, rc2)).toThrow(/hash drifted/)
    expect(() => verifyRc5WorkspaceClient(manifest, rc5 + '\n')).toThrow(/hash drifted/)
  })

  test('shares only decoration seams, preserving each generation\'s official method bodies', () => {
    for (const [source, decorate] of [[rc2, decorateOfficialWorkspaceClient], [rc5, decorateRc5WorkspaceClient]] as const) {
      const before = navigation(source)
      const after = navigation(decorate(source))
      for (const method of ['connectBlank', 'createInWorkspace']) {
        expect(String(after[method])).toBe(String(before[method]))
      }
      // startSession changes only by the mandatory managed-owner guard.
      expect(String(after.startSession).replace(/\s*if \(target !== void 0 && this.managedWorktreeGuard.blockWorkspace\(target\)\) return;/, ''))
        .toBe(String(before.startSession))
    }
    expect(String(navigation(rc2).connectBlank)).not.toBe(String(prototype.connectBlank))
    const seam = '\t\t\tasync forkSession(sessionId, onCreated, options) {\n\t\t\t\treturn this.sessions.fork({'
    expect(() => decorateRc5WorkspaceClient(rc5.replace(seam, ''))).toThrow(/one stable source seam/)
    expect(() => decorateRc5WorkspaceClient(rc5 + seam)).toThrow(/one stable source seam/)
  })

  test('connectWorkspace reuses/coalesces a blank even with no requested preset', async () => {
    const workspace = { workspaceId: 'w', path: '/project', sessionIds: [] }
    const createInWorkspace = vi.fn(async () => 'reused')
    const self = { workspaces: { list: { getSnapshot: () => ({ items: [workspace] }) } }, connecting: new Map(), createInWorkspace, connectBlank: prototype.connectBlank }
    const first = prototype.connectWorkspace.call(self, 'w')
    const second = prototype.connectWorkspace.call(self, 'w')
    await expect(first).resolves.toBe('reused')
    await expect(second).resolves.toBe('reused')
    expect(createInWorkspace).toHaveBeenCalledOnce()
    expect(createInWorkspace).toHaveBeenCalledWith(workspace, {})
  })

  test('requested presets skip mismatching member blanks and archived blanks', () => {
    const summary = (preset?: string) => ({ blank: true, cwd: '/project', projectionValues: { agentPreset: preset } })
    const createNamed = vi.fn(() => 'created')
    const self = {
      workspaces: { list: { getSnapshot: () => ({ archivedSessionIds: ['archived'] }) } },
      sessions: { list: { getSnapshot: () => ({ ids: ['archived', 'other', 'matching'], byId: { archived: summary('wanted'), other: summary('other'), matching: summary('wanted') } }) } },
      createNamed,
    }
    prototype.createInWorkspace.call(self, { workspaceId: 'w', path: '/project', sessionIds: ['archived', 'other', 'matching'] }, { agentPreset: 'wanted' })
    expect(createNamed.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ sessionId: 'matching', agentPreset: 'wanted' }))
    createNamed.mockClear()
    prototype.createInWorkspace.call(self, { workspaceId: 'w', path: '/project', sessionIds: ['other', 'matching'] }, {})
    expect(createNamed.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ sessionId: 'other' }))
  })

  test('startSession uses rc.5 openWorkspace and whenDraftExists=replace without prompt', async () => {
    const prepareDraft = vi.fn()
    const binding = {}
    const openWorkspace = vi.fn(async (_id: string, onCreated?: (id: string) => void) => onCreated?.('blank'))
    const blockWorkspace = vi.fn(() => false)
    const self = {
      managedWorktreeGuard: { blockWorkspace },
      workspaces: { list: { getSnapshot: () => ({ items: [] }) } },
      sessions: { list: { getSnapshot: () => ({ ids: [], byId: {} }) }, binding: () => binding },
      openWorkspace, prepareDraft,
    }
    prototype.startSession.call(self, 'local')
    expect(openWorkspace).toHaveBeenLastCalledWith('local', undefined, {})
    prototype.startSession.call(self, 'local', { whenDraftExists: 'replace' })
    expect(prepareDraft).toHaveBeenCalledWith(binding, { whenDraftExists: 'replace' })
    blockWorkspace.mockReturnValue(true)
    openWorkspace.mockClear()
    prototype.startSession.call(self, 'managed')
    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
