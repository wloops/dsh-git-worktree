// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorktreeCreateRow } from '../src/client/WorktreeCreateRow.js'
import { WorktreeReviewRow } from '../src/client/WorktreeReviewRow.js'
import type { WorktreeClientServices } from '../src/client/actions.js'

afterEach(() => cleanup())

type DesktopCollaborators = {
  canOpenWorkspacePath: ReturnType<typeof vi.fn>
  openWorkspacePath: ReturnType<typeof vi.fn>
}

function services(): WorktreeClientServices & {
  opened: string[]
  commands: string[]
  desktop: DesktopCollaborators
} {
  const listeners = new Set<() => void>()
  const ids: string[] = []
  const byId: Record<string, { cwd?: string } | undefined> = {}
  const opened: string[] = []
  let workspacePath = ''
  const commands: string[] = []
  const desktop: DesktopCollaborators = {
    canOpenWorkspacePath: vi.fn(async () => ({ ok: true as const, value: true })),
    openWorkspacePath: vi.fn(async () => ({ ok: true as const, value: { opened: true as const } })),
  }
  return {
    opened,
    commands,
    desktop,
    remote: { session: desktop },
    workspaces: {
      create: vi.fn(async ({ path }) => {
        workspacePath = path
        return { workspaceId: 'workspace-target', path }
      }),
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
        byId[sessionId] = { cwd: workspacePath }
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

const createPayload = {
  kind: 'worktree_target_created',
  checkoutId: 'checkout-1',
  targetSessionId: 'target-session',
  managedRoot: '/workspace/project-worktrees/task',
  phase: 'ready',
  currentOid: '1234567890abcdef',
  sourceSessionId: 'source-session',
}

function renderCreate(client: WorktreeClientServices) {
  return render(<WorktreeCreateRow
    callId="call-path"
    toolName="worktree_create"
    block={{ callId: 'call-path', kind: 'result', content: [{ type: 'text', text: JSON.stringify(createPayload) }] }}
    services={client}
  />)
}

describe('Worktree ToolViews', () => {
  test('Create card hands the managed root to the Host desktop when available', async () => {
    const client = services()
    renderCreate(client)

    fireEvent.click(await screen.findByRole('button', { name: createPayload.managedRoot }))
    await waitFor(() => expect(client.desktop.openWorkspacePath).toHaveBeenCalledWith({
      path: createPayload.managedRoot,
    }))
  })

  test('Create card keeps the managed root as plain text without a Host desktop opener', async () => {
    const client = services()
    let resolveAvailability!: (result: { ok: true; value: boolean }) => void
    client.desktop.canOpenWorkspacePath.mockImplementation(
      () => new Promise(resolve => { resolveAvailability = resolve }),
    )
    renderCreate(client)

    await waitFor(() => expect(resolveAvailability).toBeDefined())
    await act(async () => {
      resolveAvailability({ ok: true, value: false })
      await Promise.resolve()
    })
    expect(screen.getByText(createPayload.managedRoot)).toBeTruthy()
    expect(screen.queryByRole('button', { name: createPayload.managedRoot })).toBeNull()
    expect(client.desktop.openWorkspacePath).not.toHaveBeenCalled()
  })

  test('Create card announces an open failure through the transient banner', async () => {
    const client = services()
    client.desktop.openWorkspacePath.mockResolvedValue({
      ok: false,
      error: { code: 'gateway/internal', message: 'path open failed' },
    })
    renderCreate(client)

    fireEvent.click(await screen.findByRole('button', { name: createPayload.managedRoot }))
    expect((await screen.findByRole('status')).textContent).toContain('path open failed')
  })

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

  test('Local Session target_unselected Ready errors render no Worktree card', () => {
    const client = services()
    const { container } = render(<WorktreeReviewRow
      callId="call-local-ready"
      toolName="worktree_ready_for_review"
      block={{
        callId: 'call-local-ready',
        kind: 'result',
        isError: true,
        content: [{ type: 'text', text: 'Error: 会话尚未选择 Session Target' }],
      }}
      services={client}
    />)

    expect(container.childElementCount).toBe(0)
    expect(screen.queryByText('Worktree 待验收')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('structured target_unselected Ready errors also render no Worktree card', () => {
    const client = services()
    const { container } = render(<WorktreeReviewRow
      callId="call-local-ready-structured"
      toolName="worktree_ready_for_review"
      block={{
        callId: 'call-local-ready-structured',
        kind: 'result',
        isError: true,
        error: { name: 'SessionCheckoutError', code: 'target_unselected' },
      }}
      services={client}
    />)

    expect(container.childElementCount).toBe(0)
  })

  test('non-Local Ready errors remain visible for diagnosis', () => {
    const client = services()
    render(<WorktreeReviewRow
      callId="call-review-error"
      toolName="worktree_ready_for_review"
      block={{
        callId: 'call-review-error',
        kind: 'result',
        isError: true,
        content: [{ type: 'text', text: 'Error: transport_unavailable: Host offline' }],
      }}
      services={client}
    />)

    expect(screen.getByText('Worktree 待验收')).toBeTruthy()
    expect(screen.getByText('验收信息不可用')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('transport_unavailable')
  })

  test('Review card replays logged evidence and disables mutation without the live Console adapter', () => {
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
      iteration: 2,
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

    expect(screen.getByText('第 2 轮修改已准备验收')).toBeTruthy()
    expect(screen.getByText('真实 Session Target')).toBeTruthy()
    expect(screen.getByText('1 个文件')).toBeTruthy()
    expect(screen.queryByText('src/index.ts')).toBeNull()
    expect(screen.queryByText(/连接后即可执行验收操作/)).toBeNull()
    expect(screen.queryByRole('button', { name: '预览修改' })).toBeNull()
    expect(client.commands).toEqual([])
  })
})
