import { apply as applyV022 } from './official-workspace-client-022.mock.js'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const spies = vi.hoisted(() => ({
  register: vi.fn(),
  applyTools: vi.fn(),
  topology: vi.fn(),
  native: vi.fn(),
}))
vi.mock('../src/client/workspace-sidebar/native.js', () => ({ registerNativeWorkspaceDecorations: spies.native }))
vi.mock('../src/client/index.js', () => ({ apply: spies.applyTools, inject: ['conversation'] }))
vi.mock('../src/client/workspace-sidebar/index.js', () => ({ registerManagedWorkspaceSidebar: spies.register }))
vi.mock('../src/client/console-remote/adapter.js', () => ({
  createWorktreeConsoleRemoteAdapter: () => ({ sidebarTopology: spies.topology }),
}))

import { apply } from '../src/client/console-remote/index.js'
import { apply as applyAlpha } from './official-workspace-client-alpha.mock.js'
import { apply as applyModern } from './official-workspace-client.mock.js'
import { apply as applyRc5 } from './official-workspace-client-rc5.mock.js'
import { apply as applyNext } from './official-workspace-client-next.mock.js'

function clientContext(legacy = false) {
  const session = legacy ? { open: vi.fn() } : {}
  const ctx: any = {
    remote: { $mount: vi.fn(async () => () => {}) },
    effect: vi.fn(),
    provide: vi.fn(),
    inject: vi.fn((_inject, callback) => callback(ctx)),
    get: vi.fn((key: string) => key === 'sessions' ? session : key === 'remote.gitWorktree' ? {} : undefined),
  }
  return ctx
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('one Host-pinned Browser provider per Client startup', () => {
  test.each([
    ['legacy', true, undefined],
    ['alpha', false, applyAlpha],
    ['next', false, applyNext],
  ] as const)('%s registers exactly its own Browser', async (flavor, legacy, selected) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor } })
    const ctx = clientContext(legacy)
    await apply(ctx)
    expect(spies.register).toHaveBeenCalledTimes(1)
    expect(spies.native).not.toHaveBeenCalled()
    expect(spies.register.mock.calls[0]?.[2]).toBe(selected)
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
    expect(ctx.inject.mock.calls.map(([inject]: [string[]]) => inject)).toEqual(flavor === 'legacy'
      ? [['conversation']]
      : [flavor === 'alpha'
        ? ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout']
        : ['slots', 'sessions', 'workspaces', 'locale', 'remote', 'remote.directoryPicker', 'layout', 'shortcuts'], ['conversation']])
  })

  test.each([['modern', applyModern], ['modern-rc5', applyRc5], ['modern-022', applyV022]] as const)('%s selects its exact modern factory without the picker boot cycle', async (flavor, selected) => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: flavor } })
    const ctx = clientContext()
    await apply(ctx)
    expect(spies.register).toHaveBeenCalledTimes(1)
    expect(spies.native).not.toHaveBeenCalled()
    expect(spies.register.mock.calls[0]?.[2]).toBe(selected)
    expect(ctx.inject.mock.calls[0][0]).not.toContain('remote.directoryPicker')
    expect(spies.applyTools).toHaveBeenCalledOnce()
  })

  test('unknown Host leaves official Browser untouched', async () => {
    spies.topology.mockResolvedValue({ ok: true, value: { projects: [], workspaceClientFlavor: 'unsupported' } })
    const ctx = clientContext()
    await apply(ctx)
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.native).toHaveBeenCalledOnce()
    expect(spies.applyTools).toHaveBeenCalledTimes(1)
  })

  test('fails before registering a mismatched legacy Browser', async () => {
    spies.topology.mockResolvedValueOnce({ ok: true, value: { projects: [], workspaceClientFlavor: 'legacy' } })
    await expect(apply(clientContext())).rejects.toThrow(/sessions\.open/u)
    expect(spies.register).not.toHaveBeenCalled()
  })

  test('metadata failure leaves the official Browser alive and mounts recoverable native extensions', async () => {
    spies.topology.mockResolvedValueOnce({ ok: false, error: { code: 'unavailable' } })
    await apply(clientContext())
    expect(spies.register).not.toHaveBeenCalled()
    expect(spies.native).toHaveBeenCalledOnce()
    expect(spies.applyTools).toHaveBeenCalledOnce()
  })
})
