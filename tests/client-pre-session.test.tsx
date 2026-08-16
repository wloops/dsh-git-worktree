// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../src/console-contract.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { createPreSessionWorktreeController } from '../src/client/pre-session/controller.js'
import { PreSessionWorktreeToggle } from '../src/client/pre-session/PreSessionWorktreeToggle.js'
import { registerPreSessionWorktree } from '../src/client/pre-session/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'


function isolatedTarget(): WorktreeConsoleTargetDetails {
  const fixture = createWorktreeConsoleAdapterFixture().target
  return {
    ...fixture,
    checkoutId: 'checkout-pre-session',
    sourceSessionId: 'source-session',
    ownerSessionId: 'target-session',
    targetSessionId: 'target-session',
    revision: 2,
    state: 'working',
    phase: 'ready',
    managedRoot: '/repo-worktrees/pre-session',
    capabilities: {
      ...fixture.capabilities,
      create: false,
      open: true,
      discard: true,
    },
  }
}

function successFixture() {
  const events: string[] = []
  const target = isolatedTarget()
  const adapter = createWorktreeConsoleAdapterFixture().adapter
  adapter.create = vi.fn(async request => {
    events.push(`remote:create:${request.sourceSessionId}`)
    return {
      ok: true,
      value: {
        target,
        targetSessionId: 'target-session',
        managedRoot: target.managedRoot!,
      },
    }
  })

  const sourceCtx = { id: 'source-context' }
  const targetCtx = { id: 'target-context' }
  let targetBinding: ReturnType<WorktreeClientServices['sessions']['binding']>
  const targetInput = {
    setDraft: vi.fn((draft: string) => { events.push(`target:draft:${draft}`) }),
    addImages: vi.fn((ids: readonly string[]) => {
      events.push(`target:images:${ids.join(',')}`)
      return true
    }),
    removeImage: vi.fn(),
  }
  const services = {
    workspaces: {
      create: vi.fn(async ({ path }: { path: string }) => {
        events.push(`workspace:create:${path}`)
        return { workspaceId: 'workspace-target', path }
      }),
      openPath: vi.fn(async () => undefined),
      archiveSession: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    },
    sessions: {
      create: vi.fn(async ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) => {
        events.push(`session:create:${workspaceId}:${sessionId}`)
        targetBinding = { ctx: targetCtx, session: { command: vi.fn() } }
        return sessionId
      }),
      open: vi.fn((sessionId: string) => { events.push(`session:open:${sessionId}`) }),
      list: {
        getSnapshot: vi.fn(() => ({ current: 'source-session', ids: ['source-session'], byId: { 'source-session': {} } })),
        subscribe: vi.fn(() => () => undefined),
      },
      binding: vi.fn((sessionId: string) => sessionId === 'source-session'
        ? { ctx: sourceCtx, session: { command: vi.fn() } }
        : targetBinding),
    },
    conversation: {
      blocks: {
        set: vi.fn((sessionId: string, block: { reason: string } | undefined) => {
          events.push(block === undefined ? `block:clear:${sessionId}` : `block:set:${sessionId}`)
        }),
        storeFor: vi.fn(() => ({ getSnapshot: () => undefined })),
      },
      input: {
        for: vi.fn((ctx: unknown) => {
          expect(ctx).toBe(targetCtx)
          return targetInput
        }),
      },
    },
  } as unknown as WorktreeClientServices

  const sourceActions = {
    setDraft: vi.fn((draft: string) => { events.push(`source:draft:${draft}`) }),
    addImages: vi.fn(() => true),
    removeImage: vi.fn((id: string) => { events.push(`source:remove:${id}`) }),
    pruneImages: vi.fn(),
    submit: vi.fn(),
  }

  return { adapter: adapter as WorktreeConsoleAdapter, events, services, sourceActions, target, targetInput }
}

afterEach(() => cleanup())

describe('Pre-session Worktree preparation', () => {
  test('moves a blank Local draft into the Host-allocated target before opening it', async () => {
    const fixture = successFixture()
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    const result = await controller.prepare({
      sessionId: 'source-session',
      input: {
        draft: 'implement the isolated task',
        imageIds: ['image-1'],
        occurrences: [],
        phase: 'plain',
      },
      inputActions: fixture.sourceActions,
    })

    expect(result).toEqual(fixture.target)
    expect(fixture.events).toEqual([
      'block:set:source-session',
      'remote:create:source-session',
      'workspace:create:/repo-worktrees/pre-session',
      'session:create:workspace-target:target-session',
      'target:draft:implement the isolated task',
      'target:images:image-1',
      'session:open:target-session',
      'source:draft:',
      'source:remove:image-1',
      'block:clear:source-session',
    ])
    expect(fixture.sourceActions.submit).not.toHaveBeenCalled()
  })

  test('keeps the source draft untouched and never creates Harness objects when Host create fails', async () => {
    const fixture = successFixture()
    fixture.adapter.create = vi.fn(async () => ({
      ok: false,
      error: { code: 'not_git_repository', message: 'Workspace is not a Git repository.' },
    }))
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'keep me', imageIds: [], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).rejects.toThrow(/not_git_repository/)

    expect(fixture.services.workspaces.create).not.toHaveBeenCalled()
    expect(fixture.services.sessions.create).not.toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
    expect(fixture.events).toEqual(['block:set:source-session', 'block:clear:source-session'])
  })

  test('discards a reservation through the source caller when Session creation fails', async () => {
    const fixture = successFixture()
    fixture.services.sessions.create = vi.fn(async () => {
      fixture.events.push('session:create:failed')
      throw new Error('session create failed')
    })
    fixture.adapter.discard = vi.fn(async request => {
      fixture.events.push(`remote:discard:${request.sessionId}`)
      return request.sessionId === 'source-session'
        ? { ok: true, value: { target: { ...fixture.target, state: 'delivered', phase: 'discarded' } } }
        : { ok: false, error: { code: 'session_not_found', message: 'Target Session does not exist.' } }
    })
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'keep me', imageIds: [], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).rejects.toThrow(/session create failed/)

    expect(fixture.adapter.discard).toHaveBeenCalledTimes(2)
    expect(fixture.services.workspaces.delete).toHaveBeenCalledWith('workspace-target')
    expect(fixture.services.workspaces.archiveSession).toHaveBeenCalledWith('target-session')
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
    expect(fixture.services.sessions.open).not.toHaveBeenCalled()
    expect(fixture.events).toEqual([
      'block:set:source-session',
      'remote:create:source-session',
      'workspace:create:/repo-worktrees/pre-session',
      'session:create:failed',
      'remote:discard:target-session',
      'remote:discard:source-session',
      'block:clear:source-session',
    ])
  })

  test('archives the target Session only after target-owner Discard succeeds', async () => {
    const fixture = successFixture()
    fixture.targetInput.addImages = vi.fn(() => false)
    fixture.adapter.discard = vi.fn(async request => request.sessionId === 'target-session'
      ? { ok: true, value: { target: { ...fixture.target, state: 'delivered', phase: 'discarded' } } }
      : { ok: false, error: { code: 'not_owner', message: 'not owner' } })
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'keep me', imageIds: ['image-1'], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).rejects.toThrow(/拒绝接收草稿附件/)

    expect(fixture.adapter.discard).toHaveBeenCalledTimes(1)
    expect(fixture.adapter.discard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'target-session' }))
    expect(fixture.services.workspaces.archiveSession).toHaveBeenCalledWith('target-session')
    expect(fixture.services.workspaces.delete).toHaveBeenCalledWith('workspace-target')
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
    expect(fixture.services.sessions.open).not.toHaveBeenCalled()
  })

  test('keeps a recoverable target visible when both caller-scoped Discard attempts fail', async () => {
    const fixture = successFixture()
    fixture.services.sessions.create = vi.fn(async () => { throw new Error('session create failed') })
    fixture.adapter.discard = vi.fn(async () => ({
      ok: false,
      error: { code: 'transport_unavailable', message: 'offline' },
    }))
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'keep me', imageIds: [], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).rejects.toMatchObject({ recoveryRequired: true })

    expect(fixture.services.workspaces.archiveSession).not.toHaveBeenCalled()
    expect(fixture.services.workspaces.delete).not.toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
  })

  test('rolls back the target instead of clearing a Local draft changed after confirmation', async () => {
    const fixture = successFixture()
    let current = {
      draft: 'confirmed draft', imageIds: ['image-1'], occurrences: [], phase: 'plain', draftRev: 7,
    }
    const createSession = fixture.services.sessions.create
    fixture.services.sessions.create = vi.fn(async (request) => {
      const result = await createSession(request)
      current = { ...current, draft: 'newer Local edit', draftRev: 8 }
      return result
    })
    fixture.adapter.discard = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, state: 'delivered', phase: 'discarded' } },
    }))
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'confirmed draft', imageIds: ['image-1'], occurrences: [], phase: 'plain', draftRev: 7 },
      currentInput: () => current,
      inputActions: fixture.sourceActions,
    })).rejects.toThrow(/发生了变化/)

    expect(fixture.services.sessions.open).not.toHaveBeenCalled()
    expect(fixture.targetInput.setDraft).not.toHaveBeenCalled()
    expect(fixture.targetInput.addImages).not.toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
    expect(fixture.sourceActions.removeImage).not.toHaveBeenCalled()
    expect(fixture.adapter.discard).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'target-session' }))
  })

  test('coalesces repeated Worktree clicks for the same blank Session', async () => {
    const fixture = successFixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const create = fixture.adapter.create
    fixture.adapter.create = vi.fn(async request => {
      await gate
      return create(request)
    })
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)
    const request = {
      sessionId: 'source-session',
      input: { draft: 'one transaction', imageIds: [], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    }

    const first = controller.prepare(request)
    const second = controller.prepare(request)
    release()
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
    expect(fixture.adapter.create).toHaveBeenCalledTimes(1)
    expect(fixture.services.sessions.create).toHaveBeenCalledTimes(1)
  })

  test('fails closed before Host creation when the draft contains unresolved reference chips', async () => {
    const fixture = successFixture()
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: '\uFFFC inspect this', imageIds: [], occurrences: [{ occurrenceId: 1 }], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).rejects.toThrow(/引用/)

    expect(fixture.adapter.create).not.toHaveBeenCalled()
    expect(fixture.services.conversation.blocks.set).not.toHaveBeenCalled()
  })
})

describe('Pre-session Worktree switch', () => {
  const inputActions = {
    setDraft: vi.fn(), addImages: vi.fn(() => true), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn(),
  }

  test('registers in Harness public conversation.input.left with a stable id', () => {
    const fixture = successFixture()
    const entries: Array<{ descriptor: Record<string, unknown>; component: unknown }> = []
    const slots = {
      inject: vi.fn((_name: string, callback: () => unknown) => { callback() }),
      register: vi.fn((descriptor: Record<string, unknown>, component: unknown) => {
        entries.push({ descriptor, component })
        return () => undefined
      }),
    }

    registerPreSessionWorktree({ slots }, fixture.adapter, fixture.services)

    expect(slots.inject).toHaveBeenCalledWith('conversation.input.left', expect.any(Function))
    expect(entries[0]?.descriptor).toMatchObject({
      name: 'conversation.input.left',
      id: 'worktree-pre-session',
      order: 40,
    })
  })

  test('shows an accessible unchecked switch only for a blank Local Session', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    const controller = { prepare: vi.fn() }
    const view = render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: '', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={controller}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(false))

    view.rerender(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'active' }}
      input={{ draft: '', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={controller}
    />)
    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
  })

  test('opens one confirmation dialog from the existing switch and creates only after confirmation', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    let resolve!: (target: WorktreeConsoleTargetDetails) => void
    const prepare = vi.fn(async () => new Promise<WorktreeConsoleTargetDetails>(done => { resolve = done }))
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: 'draft', imageIds: ['image-1'], occurrences: [], phase: 'plain', draftRev: 3 }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare }}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    fireEvent.click(toggle)
    expect(screen.getByRole('dialog', { name: '在 Worktree 中开始？' })).toBeTruthy()
    expect(screen.getByText('当前输入内容和 1 个附件将移动到新的 Worktree 会话。')).toBeTruthy()
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(prepare).not.toHaveBeenCalled()

    const confirm = screen.getByRole('button', { name: '创建并切换' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect((toggle as HTMLButtonElement).disabled).toBe(true))
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({ draft: 'draft', imageIds: ['image-1'], draftRev: 3 }),
    }))

    resolve(fixture.target)
    await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'))
    expect(screen.queryByRole('dialog', { name: '在 Worktree 中开始？' })).toBeNull()
    expect(screen.getByText('已创建')).toBeTruthy()
  })

  test('cancels the confirmation without creating or mutating the Local draft', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    const prepare = vi.fn()
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: 'keep this', imageIds: ['image-1'], occurrences: [], phase: 'plain', draftRev: 4 }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare }}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))

    expect(screen.queryByRole('dialog', { name: '在 Worktree 中开始？' })).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(prepare).not.toHaveBeenCalled()
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    expect(inputActions.removeImage).not.toHaveBeenCalled()
  })

  test('rechecks Host availability without creating when the initial current lookup fails', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'transport_unavailable', message: 'offline' } })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          target: {
            ...fixture.target,
            checkoutId: null,
            targetSessionId: null,
            ownerSessionId: 'source-session',
            state: 'local',
            phase: 'local',
            managedRoot: null,
            capabilities: { ...fixture.target.capabilities, create: true },
          },
        },
      })
    const prepare = vi.fn()
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: 'draft', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare }}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('offline'))
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy())
    expect(fixture.adapter.current).toHaveBeenCalledTimes(2)
    expect(prepare).not.toHaveBeenCalled()
  })

  test('keeps the switch retryable and exposes a live alert when preparation fails', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    const prepare = vi.fn(async () => { throw new Error('session create failed') })
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: 'draft', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare }}
    />)

    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('session create failed'))
    expect((toggle as HTMLButtonElement).disabled).toBe(false)
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('dialog', { name: '在 Worktree 中开始？' })).toBeTruthy()
  })
})
