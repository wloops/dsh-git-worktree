import { describe, expect, test, vi } from 'vitest'
import type { WorktreeConsoleAdapter } from '../src/console-contract.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import {
  openAuthorizedWorktreeTarget,
  openExistingSession,
  openIsolatedTarget,
  prefillSessionDraft,
} from '../src/client/actions.js'

function services(
  byId: Record<string, { cwd?: string } | undefined> = {},
  projectedCwd: string | null = 'workspace-path',
): WorktreeClientServices {
  let workspacePath = ''
  const listeners = new Set<() => void>()
  return {
    workspaces: {
      create: vi.fn(async ({ path }) => {
        workspacePath = path
        return { workspaceId: 'workspace-target', path }
      }),
      openPath: vi.fn(async () => undefined),
    },
    sessions: {
      create: vi.fn(async ({ sessionId }) => {
        if (projectedCwd !== null) {
          byId[sessionId] = { cwd: projectedCwd === 'workspace-path' ? workspacePath : projectedCwd }
          for (const listener of listeners) listener()
        }
        return sessionId
      }),
      open: vi.fn(),
      list: {
        getSnapshot: vi.fn(() => ({ current: 'source-session', ids: Object.keys(byId), byId })),
        subscribe: vi.fn((listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }),
      },
      binding: vi.fn(),
    },
  }
}

describe('Worktree Client navigation', () => {
  test('opens an existing target Session without recreating its Workspace', async () => {
    const client = services({
      'target-session': { cwd: '/fixture/project-worktrees/checkout-1' },
    })

    await openIsolatedTarget(client, {
      targetSessionId: 'target-session',
      managedRoot: '/fixture/project-worktrees/checkout-1',
    })

    expect(client.workspaces.create).not.toHaveBeenCalled()
    expect(client.sessions.create).not.toHaveBeenCalled()
    expect(client.sessions.open).toHaveBeenCalledWith('target-session')
  })

  test('fails closed when an existing Session cwd differs from the Host target', async () => {
    const client = services({ 'target-session': { cwd: '/another/root' } })

    await expect(openIsolatedTarget(client, {
      targetSessionId: 'target-session',
      managedRoot: '/fixture/project-worktrees/checkout-1',
    })).rejects.toThrow(/cwd 与 Host 记录不一致/)

    expect(client.workspaces.create).not.toHaveBeenCalled()
    expect(client.sessions.open).not.toHaveBeenCalled()
  })

  test('opens only a source Session whose cwd matches the Host local root', () => {
    const client = services({ 'source-session': { cwd: '/fixture/project' } })
    expect(openExistingSession(client, 'source-session', '/fixture/project')).toBe(true)
    expect(client.sessions.open).toHaveBeenCalledWith('source-session')

    expect(openExistingSession(client, 'source-session', '/another/project')).toBe(false)
    expect(openExistingSession(client, 'missing-session', '/fixture/project')).toBe(false)
    expect(client.sessions.open).toHaveBeenCalledTimes(1)
  })

  test('opens an authorized slot holder only after inspect proves checkout, owner and cwd identity', async () => {
    const client = services({ 'holder-session': { cwd: '/fixture/holder' } })
    const inspect = vi.fn(async () => ({
      ok: true as const,
      value: {
        target: {
          project: { id: 'project-1', name: 'Project' }, checkoutId: 'checkout-holder',
          sourceSessionId: 'other-source', ownerSessionId: 'holder-session', targetSessionId: 'holder-session',
          iteration: 1, revision: 9, state: 'preview_active' as const, phase: 'ready' as const, dirty: true,
          currentOid: 'b'.repeat(40), commitOid: null, managedRoot: '/fixture/holder', sourceRoot: '/fixture/project',
          sourceOid: 'a'.repeat(40), currentBranch: null,
          capabilities: {
            create: false, open: true, inspect: true, discard: false, preflight: false, preview: false,
            resumeRevision: false, rollbackPreview: false, finalize: false, finalizePreview: false,
            setRetention: false, retryCleanup: false, beginNextIteration: false,
          },
        },
      },
    }))

    await openAuthorizedWorktreeTarget({ inspect } as unknown as WorktreeConsoleAdapter, client, 'waiting-session', {
      checkoutId: 'checkout-holder', ownerSessionId: 'holder-session',
    })

    expect(inspect).toHaveBeenCalledWith({ sessionId: 'waiting-session', checkoutId: 'checkout-holder' })
    expect(client.sessions.open).toHaveBeenCalledWith('holder-session')
  })

  test('does not navigate when the caller Session becomes inactive while inspect is in flight', async () => {
    const client = services({ 'holder-session': { cwd: '/fixture/holder' } })
    let resolveInspect!: (value: Awaited<ReturnType<WorktreeConsoleAdapter['inspect']>>) => void
    const inspect = vi.fn(async () => new Promise<Awaited<ReturnType<WorktreeConsoleAdapter['inspect']>>>(resolve => {
      resolveInspect = resolve
    }))
    let active = true
    const pending = openAuthorizedWorktreeTarget({ inspect } as unknown as WorktreeConsoleAdapter, client, 'waiting-session', {
      checkoutId: 'checkout-holder', ownerSessionId: 'holder-session',
    }, () => active)
    active = false
    const fixture = await import('./support/worktree-console.js').then(module => module.createWorktreeConsoleAdapterFixture())
    resolveInspect({ ok: true, value: { target: {
      ...fixture.target, checkoutId: 'checkout-holder', ownerSessionId: 'holder-session', targetSessionId: 'holder-session',
      managedRoot: '/fixture/holder',
    } } })

    await pending
    expect(client.sessions.open).not.toHaveBeenCalled()
  })

  test('fails closed when authorized inspect returns another owner or target identity', async () => {
    const client = services({ 'other-session': { cwd: '/fixture/holder' } })
    const fixture = await import('./support/worktree-console.js').then(module => module.createWorktreeConsoleAdapterFixture())
    fixture.adapter.inspect = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: 'checkout-holder', ownerSessionId: 'other-session', targetSessionId: 'other-session' } },
    }))

    await expect(openAuthorizedWorktreeTarget(fixture.adapter, client, 'waiting-session', {
      checkoutId: 'checkout-holder', ownerSessionId: 'holder-session',
    })).rejects.toThrow(/身份不一致/)
    expect(client.sessions.open).not.toHaveBeenCalled()
  })

  test('prefills a recovery request without sending it', () => {
    const client = services()
    const setDraft = vi.fn()
    client.sessions.binding = vi.fn(() => ({ ctx: {}, session: { command: vi.fn() } }))
    client.conversation = { input: { for: vi.fn(() => ({ setDraft, addImages: vi.fn(), removeImage: vi.fn() })) } }

    expect(prefillSessionDraft(client, 'target-session', '请重新验证并生成验收稿')).toBe(true)
    expect(setDraft).toHaveBeenCalledWith('请重新验证并生成验收稿')
    expect(client.sessions.binding('target-session')?.session.command).not.toHaveBeenCalled()
  })

  test('revalidates the projected cwd after creating a target Session', async () => {
    const mismatched = services({}, '/another/root')
    await expect(openIsolatedTarget(mismatched, {
      targetSessionId: 'target-session',
      managedRoot: '/fixture/project-worktrees/checkout-1',
    })).rejects.toThrow(/新建 Session .* cwd 与 Host 记录不一致/)
    expect(mismatched.sessions.open).not.toHaveBeenCalled()

    vi.useFakeTimers()
    try {
      const missing = services({}, null)
      const pending = openIsolatedTarget(missing, {
        targetSessionId: 'target-session',
        managedRoot: '/fixture/project-worktrees/checkout-1',
      })
      const expected = expect(pending).rejects.toThrow(/未投影新建 Session .* 的可信 cwd/)
      await vi.advanceTimersByTimeAsync(2_000)
      await expected
      expect(missing.sessions.open).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
