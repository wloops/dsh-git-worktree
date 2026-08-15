// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorktreeCreateRow } from '../src/client/WorktreeCreateRow.js'
import { WorktreeReviewRow } from '../src/client/WorktreeReviewRow.js'
import type { WorktreeClientServices } from '../src/client/actions.js'

afterEach(() => cleanup())

function services(): WorktreeClientServices & { opened: string[]; commands: string[] } {
  const listeners = new Set<() => void>()
  const ids: string[] = []
  const byId: Record<string, unknown> = {}
  const opened: string[] = []
  const commands: string[] = []
  return {
    opened,
    commands,
    workspaces: {
      create: vi.fn(async ({ path }) => ({ workspaceId: 'workspace-target', path })),
      openPath: vi.fn(async () => undefined),
    },
    sessions: {
      list: {
        getSnapshot: () => ({ current: 'target-session', ids, byId }),
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
      create: vi.fn(async ({ sessionId }) => {
        ids.push(sessionId)
        byId[sessionId] = { sessionId }
        for (const listener of listeners) listener()
        return sessionId
      }),
      open: (sessionId) => { opened.push(sessionId) },
      binding: () => ({
        session: {
          command: async (line) => {
            commands.push(line)
            return { ok: true as const, value: { matched: true } }
          },
        },
      }),
    },
  }
}

describe('Worktree ToolViews', () => {
  test('Create card registers the managed root and opens the exact reserved Session', async () => {
    const client = services()
    const payload = {
      kind: 'worktree_target_created',
      checkoutId: 'checkout-1',
      targetSessionId: 'target-session',
      managedRoot: '/workspace/project-worktrees/task',
      phase: 'ready',
      currentOid: '1234567890abcdef',
      sourceSessionId: 'source-session',
    }
    render(<WorktreeCreateRow
      callId="call-1"
      toolName="worktree_create"
      block={{ callId: 'call-1', kind: 'result', content: [{ type: 'text', text: JSON.stringify(payload) }] }}
      services={client}
    />)

    fireEvent.click(screen.getByRole('button', { name: '打开隔离会话' }))
    await waitFor(() => expect(client.opened).toEqual(['target-session']))
    expect(client.workspaces.create).toHaveBeenCalledWith({ path: payload.managedRoot })
    expect(client.sessions.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-target',
      sessionId: 'target-session',
    })
  })

  test('Review card sends finalize only as an explicit user command', async () => {
    const client = services()
    const args = {
      summary: '真实 Session Target',
      validationStatus: 'passed',
      validationSummary: 'focused tests passed',
      tests: [{ command: 'pnpm test', status: 'passed' }],
      suggestedCommitMessage: 'fix: bind real target session',
    }
    const payload = {
      kind: 'worktree_ready_for_review',
      state: 'ready_for_review',
      reviewId: 'review-1',
      revision: 4,
      changedFiles: ['src/index.ts'],
    }
    render(<WorktreeReviewRow
      callId="call-2"
      toolName="worktree_ready_for_review"
      block={{
        callId: 'call-2',
        kind: 'result',
        call: { argsRaw: JSON.stringify(args) },
        content: [{ type: 'text', text: JSON.stringify(payload) }],
      }}
      services={client}
    />)

    expect(screen.getByText('真实 Session Target')).toBeTruthy()
    expect(screen.getByText('src/index.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提交并清理' }))
    await waitFor(() => expect(client.commands).toEqual(['/worktree finalize review-1 4 cleanup']))
  })
})
