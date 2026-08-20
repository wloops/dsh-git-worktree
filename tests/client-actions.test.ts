import { describe, expect, test, vi } from 'vitest'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { openExistingSession, openIsolatedTarget } from '../src/client/actions.js'

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
