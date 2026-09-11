// @vitest-environment jsdom

import { ClientI18nProvider } from '../src/client/i18n.js'
import { WORKTREE_STYLES } from '../src/client/styles.js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../src/console-contract.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { createPreSessionWorktreeController } from '../src/client/pre-session/controller.js'
import { PreSessionWorktreeToggle } from '../src/client/pre-session/PreSessionWorktreeToggle.js'
import { registerPreSessionWorktree } from '../src/client/pre-session/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'


test('keeps the Worktree switch lightweight and uses Harness theme feedback', () => {
  const rule = (selector: string) => WORKTREE_STYLES.slice(WORKTREE_STYLES.indexOf(`${selector} {`)).split('}')[0]
  const trigger = rule('.dsh-wt-pre-session-toggle')
  expect(trigger).toContain('border:none')
  expect(trigger).toContain('background:transparent')
  expect(trigger).toContain('height:28px')
  expect(trigger).toContain('font-size:13px')
  expect(trigger).toContain('font-weight:500')
  expect(trigger).toContain('--dsw-alias-label-secondary')
  expect(rule('.dsh-wt-pre-session-toggle:hover:not(:disabled)')).toContain('--dsw-alias-interactive-bg-hover')
  expect(rule('.dsh-wt-pre-session-toggle:focus-visible')).toContain('--dsw-alias-border-l3')
  expect(rule('.dsh-wt-pre-session-toggle[aria-checked="true"]')).toContain('--dsw-alias-label-primary')
})

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
  let workspacePath = ''
  const byId: Record<string, { cwd?: string } | undefined> = { 'source-session': { cwd: '/repo' } }
  const listeners = new Set<() => void>()
  const services = {
    workspaces: {
      create: vi.fn(async ({ path }: { path: string }) => {
        events.push(`workspace:create:${path}`)
        workspacePath = path
        return { workspaceId: 'workspace-target', path }
      }),
      openPath: vi.fn(async () => undefined),
      archiveSession: vi.fn(async (sessionId: string) => { events.push(`session:archive:${sessionId}`) }),
      delete: vi.fn(async () => undefined),
    },
    sessions: {
      create: vi.fn(async ({ workspaceId, sessionId }: { workspaceId: string; sessionId: string }) => {
        events.push(`session:create:${workspaceId}:${sessionId}`)
        targetBinding = { ctx: targetCtx, session: { command: vi.fn() } }
        byId[sessionId] = { cwd: workspacePath }
        for (const listener of listeners) listener()
        return sessionId
      }),
      open: vi.fn((sessionId: string) => { events.push(`session:open:${sessionId}`) }),
      list: {
        getSnapshot: vi.fn(() => ({ current: 'source-session', ids: Object.keys(byId), byId })),
        subscribe: vi.fn((listener: () => void) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }),
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
      'session:archive:source-session',
      'block:clear:source-session',
    ])
    expect(fixture.sourceActions.submit).not.toHaveBeenCalled()
  })

  test('keeps the migrated target usable when retiring the empty source launcher fails', async () => {
    const fixture = successFixture()
    fixture.services.workspaces.archiveSession = vi.fn(async (sessionId: string) => {
      fixture.events.push(`session:archive-failed:${sessionId}`)
      throw new Error('archive unavailable')
    })
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)

    await expect(controller.prepare({
      sessionId: 'source-session',
      input: { draft: 'keep the target', imageIds: [], occurrences: [], phase: 'plain' },
      inputActions: fixture.sourceActions,
    })).resolves.toEqual(fixture.target)

    expect(fixture.services.sessions.open).toHaveBeenCalledWith('target-session')
    expect(fixture.sourceActions.setDraft).toHaveBeenCalledWith('')
    expect(fixture.events.some(event => event.startsWith('remote:discard:'))).toBe(false)
    expect(fixture.services.workspaces.delete).not.toHaveBeenCalled()
    expect(fixture.events).toContain('session:archive-failed:source-session')
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
      'session:archive:target-session',
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

describe('Pre-session directory menu', () => {
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

  test.each(['zh', 'en'] as const)('renders the registered entry from rc.1 standard hooks without legacy snapshot props (%s)', async (language) => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, state: 'local', capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    let Entry: any
    registerPreSessionWorktree({ slots: {
      inject: (_name, callback) => { callback() },
      register: (_descriptor, component) => { Entry = component },
    } }, fixture.adapter, fixture.services)
    const session = { blank: true, running: false, awaitingFirstTurn: false, promptAttempted: false }
    const conversation = { activeTargets: new Set<string>() }
    const input = { draft: 'keep draft', phase: 'plain', imageIds: [], occurrences: [], draftRev: 1 }
    const props = {
      sessionId: 'source-session', inputActions,
      useSession: (select: any) => select(session),
      useConversation: (select: any) => select(conversation),
      useInput: (select: any) => select(input),
    }
    const renderEntry = () => <ClientI18nProvider language={language}>{createElement(Entry, props)}</ClientI18nProvider>
    const view = render(renderEntry())
    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    expect(toggle).toBeTruthy()
    fireEvent.click(toggle)

    expect(await screen.findByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: language === 'en' ? 'Cancel' : '取消' }))
    expect(inputActions.setDraft).not.toHaveBeenCalled()
    input.phase = 'submitting'
    view.rerender(renderEntry())
    expect(screen.getByRole('switch', { name: 'Worktree' }).getAttribute('disabled')).not.toBeNull()
    input.phase = 'plain'
    conversation.activeTargets.add('chat')
    view.rerender(renderEntry())
    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
    conversation.activeTargets.clear()
    session.promptAttempted = true
    view.rerender(renderEntry())
    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
    session.promptAttempted = false
    session.blank = false
    view.rerender(renderEntry())
    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
    session.blank = true
    session.running = true
    view.rerender(renderEntry())
    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
  })

  test.each([{ ids: [] }, { ids: ['image-1', 'file-2'] }])('migrates current Harness attachmentIds through the registered entry: $ids', async ({ ids }) => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, state: 'local', capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    const targetInput = {
      draft: '',
      ids: [] as string[],
      setDraft(text: string) { this.draft = text },
      addAttachments(values: readonly string[]) { this.ids.push(...values); return true },
      removeAttachment: vi.fn(),
    }
    fixture.services.conversation.input.for = () => targetInput
    const source = { setDraft: vi.fn(), addAttachments: vi.fn(() => true), removeAttachment: vi.fn() }
    let Entry: any
    registerPreSessionWorktree({ slots: {
      inject: (_name, callback) => { callback() },
      register: (_descriptor, component) => { Entry = component },
    } }, fixture.adapter, fixture.services)
    render(createElement(Entry, {
      sessionId: 'source-session', inputActions: source,
      useSession: (select: any) => select({ blank: true }),
      useConversation: (select: any) => select({ activeTargets: new Set() }),
      useInput: (select: any) => select({ draft: ids.length ? 'move attachments' : '', attachmentIds: ids, occurrences: [], phase: 'plain', draftRev: 1 }),
    }))
    fireEvent.click(await screen.findByRole('switch', { name: 'Worktree' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(fixture.adapter.create).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
    await waitFor(() => expect(fixture.services.sessions.open).toHaveBeenCalledWith('target-session'))
    expect(targetInput.ids).toEqual(ids)
    expect(targetInput.draft).toBe(ids.length ? 'move attachments' : '')
    expect(source.setDraft).toHaveBeenCalledWith('')
    expect(source.removeAttachment.mock.calls).toEqual(ids.map(id => [id]))
  })

  test('recovers from a snapshot failure and allows retry after input is corrected', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, state: 'local', capabilities: { ...fixture.target.capabilities, create: true } } },
    }))
    const input = { draft: '', imageIds: undefined as unknown as string[], occurrences: [], phase: 'plain' }
    const props = { sessionId: 'source-session', session: { composerPhase: 'blank' }, input, inputActions, adapter: fixture.adapter, controller: { prepare: vi.fn() } }
    const view = render(<PreSessionWorktreeToggle {...props} />)
    fireEvent.click(await screen.findByRole('switch', { name: 'Worktree' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false)
    expect(fixture.adapter.create).not.toHaveBeenCalled()
    input.imageIds = []
    view.rerender(<PreSessionWorktreeToggle {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('shows an accessible Local directory menu only for a blank Local Session', async () => {
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

  test('waits for repository detection before showing the directory menu', async () => {
    const fixture = successFixture()
    let resolveCurrent!: (outcome: Awaited<ReturnType<WorktreeConsoleAdapter['current']>>) => void
    fixture.adapter.current = vi.fn(async () => new Promise(done => { resolveCurrent = done }))
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: '', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare: vi.fn() }}
    />)

    expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
    resolveCurrent({
      ok: true,
      value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
    })
    expect(await screen.findByRole('switch', { name: 'Worktree' })).toBeTruthy()
  })

  test('hides the directory menu when the Session workspace is not a Git repository', async () => {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: false,
      error: { code: 'not_git_repository' as const, message: '当前 Session 项目不是可用的 Git Worktree' },
    }))
    const prepare = vi.fn()
    render(<PreSessionWorktreeToggle
      sessionId="source-session"
      session={{ composerPhase: 'blank' }}
      input={{ draft: '', imageIds: [], occurrences: [], phase: 'plain' }}
      inputActions={inputActions}
      adapter={fixture.adapter}
      controller={{ prepare }}
    />)

    await waitFor(() => {
      expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'source-session' })
      expect(screen.queryByRole('switch', { name: 'Worktree' })).toBeNull()
      expect(screen.queryByRole('alert')).toBeNull()
    })
    expect(prepare).not.toHaveBeenCalled()
  })

  test('opens one confirmation dialog from the menu and creates only after confirmation', async () => {
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
    expect(toggle.getAttribute('aria-checked')).toBe('false')
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
    expect(toggle.textContent).toBe('Worktree')
    expect(toggle.querySelector('.lucide-check')).toBeTruthy()
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

    await waitFor(() => expect(screen.getByRole('switch', { name: 'Worktree' }).getAttribute('aria-checked')).toBe('false'))
    expect(fixture.adapter.current).toHaveBeenCalledTimes(2)
    expect(prepare).not.toHaveBeenCalled()
  })

  test('keeps the directory menu retryable and exposes a live alert when preparation fails', async () => {
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
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

test('English pre-session confirmation uses localized copy without modifying the draft', async () => {
  const fixture = successFixture()
  fixture.adapter.current = vi.fn(async () => ({
    ok: true,
    value: { target: { ...fixture.target, checkoutId: null, targetSessionId: null, ownerSessionId: 'source-session', state: 'local', phase: 'local', managedRoot: null, capabilities: { ...fixture.target.capabilities, create: true } } },
  }))
  const prepare = vi.fn(async () => fixture.target)
  const props = {
    sessionId: 'source-session', session: { composerPhase: 'blank' as const },
    input: { draft: '用户输入 unchanged', imageIds: ['附件-id'], occurrences: [], phase: 'plain' as const },
    inputActions: { setDraft: vi.fn(), addImages: vi.fn(() => true), removeImage: vi.fn() }, adapter: fixture.adapter, controller: { prepare },
  }
  const view = render(<ClientI18nProvider language="en"><PreSessionWorktreeToggle {...props} /></ClientI18nProvider>)
  const toggle = await screen.findByRole('switch', { name: 'Worktree' })
  fireEvent.click(toggle)

  expect(screen.getByRole('dialog', { name: 'Start in a Worktree?' })).toBeTruthy()
  expect(screen.getByText('The current input and 1 attachment will move to the new Worktree session.')).toBeTruthy()
  view.rerender(<ClientI18nProvider language="zh"><PreSessionWorktreeToggle {...props} /></ClientI18nProvider>)
  expect(screen.getByRole('dialog', { name: '在 Worktree 中开始？' })).toBeTruthy()
  expect(prepare).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '创建并切换' }))
  await waitFor(() => expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ input: expect.objectContaining({ draft: '用户输入 unchanged', imageIds: ['附件-id'] }) })))
})

describe('Worktree switch preflight and session ownership', () => {
  function localFixture() {
    const fixture = successFixture()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: {
      ...fixture.target, state: 'local', capabilities: { ...fixture.target.capabilities, create: true },
    } } }))
    const props = {
      sessionId: 'source-session', session: { composerPhase: 'blank' },
      input: { draft: 'preserve me', imageIds: ['image-1'], occurrences: [], phase: 'plain', draftRev: 1 },
      inputActions: fixture.sourceActions, adapter: fixture.adapter,
      controller: { prepare: vi.fn(async () => fixture.target) },
    }
    return { ...fixture, props }
  }

  async function chooseWorktree() {
    fireEvent.click(await screen.findByRole('switch', { name: 'Worktree' }))

  }

  test('is a focusable native button switch without Local label, and cancellation restores unchecked state', async () => {
    const fixture = localFixture()
    fixture.adapter.preflightCreate = vi.fn(async () => ({ ok: true, value: { kind: 'ready' } }))
    render(<PreSessionWorktreeToggle {...fixture.props} />)
    const toggle = await screen.findByRole('switch', { name: 'Worktree' })
    expect(toggle.tagName).toBe('BUTTON')
    expect(toggle.getAttribute('type')).toBe('button')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    toggle.focus()
    expect(document.activeElement).toBe(toggle)
    expect(screen.queryByText(/^(Local|本地|本地目录)$/)).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(toggle)
    await screen.findByRole('dialog')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(fixture.props.controller.prepare).not.toHaveBeenCalled()
  })

  test.each(['zh', 'en'] as const)('requires explicit consent for an empty initial commit (%s)', async language => {
    const fixture = localFixture()
    fixture.adapter.preflightCreate = vi.fn(async () => ({ ok: true, value: { kind: 'empty', confirmationToken: 'token-1' } }))
    render(<ClientI18nProvider language={language}><PreSessionWorktreeToggle {...fixture.props} /></ClientI18nProvider>)
    fireEvent.click(await screen.findByRole('switch', { name: 'Worktree' }))
    expect(await screen.findByRole('dialog', { name: language === 'zh' ? '需要创建初始版本' : 'An initial version is required' })).toBeTruthy()
    expect(screen.getByText(language === 'zh' ? /不会提交你现有的文件/ : /Your existing files will not be committed/)).toBeTruthy()
    expect(fixture.props.controller.prepare).not.toHaveBeenCalled()
    const button = screen.getByRole('button', { name: language === 'zh' ? '创建并继续' : 'Create and continue' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(fixture.props.controller.prepare).toHaveBeenCalledTimes(1))
    expect(fixture.props.controller.prepare).toHaveBeenCalledWith(expect.objectContaining({ initialCommitConfirmationToken: 'token-1' }))
  })

  test('cancels an initial commit without writing, and blocks repositories with files', async () => {
    const fixture = localFixture()
    fixture.adapter.preflightCreate = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { kind: 'empty', confirmationToken: 'cancelled' } })
      .mockResolvedValueOnce({ ok: true, value: { kind: 'files' } })
    render(<PreSessionWorktreeToggle {...fixture.props} />)
    await chooseWorktree()
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('switch', { name: 'Worktree' })).toBeTruthy()
    await chooseWorktree()
    await screen.findByRole('dialog')
    expect(screen.getByText(/当前未提交的文件不会带入独立工作目录/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /创建并/ })).toBeNull()
    expect(fixture.props.controller.prepare).not.toHaveBeenCalled()
    expect(fixture.adapter.create).not.toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
  })

  test('clears consumed tokens after failure and requires fresh preflight and consent on retry', async () => {
    const fixture = localFixture()
    fixture.adapter.preflightCreate = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { kind: 'empty', confirmationToken: 'first' } })
      .mockResolvedValueOnce({ ok: true, value: { kind: 'empty', confirmationToken: 'second' } })
    fixture.props.controller.prepare = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce(fixture.target)
    render(<PreSessionWorktreeToggle {...fixture.props} />)
    await chooseWorktree()
    fireEvent.click(await screen.findByRole('button', { name: '创建并继续' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Worktree' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByRole('dialog')
    expect(fixture.adapter.preflightCreate).toHaveBeenCalledTimes(2)
    expect(fixture.props.controller.prepare).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '创建并继续' }))
    await waitFor(() => expect(fixture.props.controller.prepare).toHaveBeenCalledTimes(2))
    expect(fixture.props.controller.prepare).toHaveBeenNthCalledWith(2, expect.objectContaining({ initialCommitConfirmationToken: 'second' }))
  })

  test('coalesces preflight clicks and ignores a result after switching Sessions', async () => {
    const fixture = localFixture()
    let release!: (value: any) => void
    fixture.adapter.preflightCreate = vi.fn(() => new Promise(resolve => { release = resolve }))
    const view = render(<PreSessionWorktreeToggle {...fixture.props} />)
    const option = await screen.findByRole('switch', { name: 'Worktree' })
    fireEvent.click(option)
    fireEvent.click(option)
    expect(fixture.adapter.preflightCreate).toHaveBeenCalledTimes(1)
    view.rerender(<PreSessionWorktreeToggle {...fixture.props} sessionId="other-session" />)
    await screen.findByRole('switch', { name: 'Worktree' })
    release({ ok: true, value: { kind: 'empty', confirmationToken: 'stale' } })
    await waitFor(() => expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'other-session' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fixture.props.controller.prepare).not.toHaveBeenCalled()
  })

  test.each(['clean', 'failed', 'thrown'] as const)('reports the persisted initial commit when client setup fails (rollback: %s)', async rollback => {
    const fixture = successFixture()
    fixture.adapter.createWithInitialCommit = vi.fn(async () => ({ ok: true, value: {
      target: fixture.target, targetSessionId: 'target-session', managedRoot: fixture.target.managedRoot!,
    } }))
    fixture.services.workspaces.create = vi.fn(async () => { throw new Error('workspace unavailable') })
    fixture.adapter.discard = vi.fn(async () => {
      if (rollback === 'thrown') throw new Error('transport failed')
      if (rollback === 'failed') return { ok: false, error: { code: 'transport_unavailable', message: 'offline' } }
      return { ok: true, value: { target: fixture.target } }
    })
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)
    await expect(controller.prepare({
      sessionId: 'source-session', initialCommitConfirmationToken: 'confirmed',
      input: { draft: 'keep me', imageIds: ['image-1'], occurrences: [], phase: 'plain' }, inputActions: fixture.sourceActions,
    })).rejects.toThrow(/初始提交已创建并保留在本地仓库.*workspace unavailable/)
    expect(fixture.adapter.createWithInitialCommit).toHaveBeenCalledWith({ sourceSessionId: 'source-session', confirmationToken: 'confirmed' })
    expect(fixture.adapter.create).not.toHaveBeenCalled()
    expect(fixture.adapter.discard).toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
  })

  test('session switch during real controller preparation rolls back without opening or clearing either draft', async () => {
    const fixture = localFixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const createSession = fixture.services.sessions.create
    fixture.services.sessions.create = vi.fn(async request => { await gate; return createSession(request) })
    fixture.adapter.discard = vi.fn(async () => ({ ok: true, value: { target: fixture.target } }))
    const controller = createPreSessionWorktreeController(fixture.adapter, fixture.services)
    const view = render(<PreSessionWorktreeToggle {...fixture.props} controller={controller} />)
    await chooseWorktree()
    fireEvent.click(await screen.findByRole('button', { name: '创建并切换' }))
    await waitFor(() => expect(fixture.services.sessions.create).toHaveBeenCalledTimes(1))
    view.rerender(<PreSessionWorktreeToggle {...fixture.props} controller={controller} sessionId="other-session" />)
    await screen.findByRole('switch', { name: 'Worktree' })
    release()
    await waitFor(() => expect(fixture.adapter.discard).toHaveBeenCalled())
    expect(fixture.services.sessions.open).not.toHaveBeenCalled()
    expect(fixture.sourceActions.setDraft).not.toHaveBeenCalled()
    expect(fixture.sourceActions.removeImage).not.toHaveBeenCalled()
    expect(fixture.targetInput.setDraft).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('switch', { name: 'Worktree' })).toBeTruthy()
  })
})
