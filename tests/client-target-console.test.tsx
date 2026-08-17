// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ComponentType } from 'react'
import type { WorktreeConsoleTargetDetails } from '../src/console-contract.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { apply as applyClient, WORKTREE_CONSOLE_ADAPTER_SERVICE } from '../src/client/index.js'
import { apply as applyRemoteClient } from '../src/client/console-remote/index.js'
import { registerTargetConsole, type TargetConsoleContextLike } from '../src/client/target-console/index.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../src/client/review-console/status-events.js'
import { TargetStatusAction } from '../src/client/target-console/TargetStatusAction.js'
import { WorktreeConsoleView } from '../src/client/target-console/WorktreeConsoleView.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

interface SlotEntry {
  descriptor: Record<string, unknown>
  component: ComponentType<any>
  dispose: () => void
}

class SlotsDouble implements TargetConsoleContextLike['slots'] {
  readonly entries: SlotEntry[] = []
  private readonly injectedDisposers: Array<() => void> = []

  inject(_name: 'conversation.session.header.actions' | 'conversation.view' | 'conversation.input.dock', callback: () => unknown): void {
    const dispose = callback()
    if (typeof dispose === 'function') this.injectedDisposers.push(dispose as () => void)
  }

  register(
    descriptor: Record<string, unknown>,
    component: ComponentType<any>,
  ): unknown {
    const entry = {
      descriptor,
      component,
      dispose: () => {
        const index = this.entries.indexOf(entry)
        if (index >= 0) this.entries.splice(index, 1)
      },
    }
    this.entries.push(entry)
    return entry.dispose
  }

  dispose(): void {
    for (const dispose of this.injectedDisposers.splice(0)) dispose()
  }
}

function localTarget(): WorktreeConsoleTargetDetails {
  return {
    project: { id: 'project-1', name: 'Fixture Project' },
    checkoutId: null,
    sourceSessionId: 'source-session',
    ownerSessionId: 'source-session',
    targetSessionId: null,
    iteration: 0,
    revision: 1,
    state: 'local',
    phase: 'local',
    dirty: false,
    currentOid: 'a'.repeat(40),
    commitOid: null,
    managedRoot: null,
    sourceOid: 'a'.repeat(40),
    currentBranch: 'main',
    capabilities: {
      create: true,
      open: false,
      inspect: false,
      discard: false,
      preflight: false,
      preview: false,
      rollbackPreview: false,
      finalize: false,
      finalizePreview: false,
      setRetention: false,
      retryCleanup: false,
      beginNextIteration: false,
    },
  }
}

function clientServices(): WorktreeClientServices {
  return {
    workspaces: {
      create: vi.fn(async ({ path }) => ({ workspaceId: 'workspace-target', path })),
      openPath: vi.fn(async () => undefined),
    },
    sessions: {
      create: vi.fn(async ({ sessionId }) => sessionId),
      open: vi.fn(),
      list: {
        getSnapshot: vi.fn(() => ({ current: 'source-session', ids: ['source-session'], byId: { 'source-session': {} } })),
        subscribe: vi.fn(() => () => undefined),
      },
      binding: vi.fn(),
    },
  }
}

function summaryOf(target: WorktreeConsoleTargetDetails) {
  const { managedRoot: _root, sourceOid: _source, currentBranch: _branch, ...summary } = target
  return summary
}

function renderConsole(
  adapter: ReturnType<typeof createWorktreeConsoleAdapterFixture>['adapter'],
  services: WorktreeClientServices = clientServices(),
  sessionId = 'source-session',
) {
  return render(<WorktreeConsoleView sessionId={sessionId} adapter={adapter} services={services} />)
}

afterEach(() => cleanup())

describe('Harness-native Session Target slots', () => {
  test.each([
    ['local', 'Local'],
    ['working', 'Worktree'],
    ['ready_for_review', '待验收'],
    ['preview_active', 'Local 验收中'],
    ['preview_detached', '预览待恢复'],
    ['recovery_required', '需要恢复'],
  ] as const)('projects the server %s state in the Header capsule', async (state, label) => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.current = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, state, phase: state === 'recovery_required' ? 'recovery_required' : 'ready' } },
    }))
    render(<TargetStatusAction sessionId="target-session" adapter={fixture.adapter} />)
    await waitFor(() => expect(screen.getByText(label)).toBeTruthy())
  })

  test('registers the exact Header action, reads props.sessionId, and disposes it', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.current = vi.fn(async request => ({ ok: true, value: { target: localTarget() } }))
    const slots = new SlotsDouble()

    registerTargetConsole({ slots }, fixture.adapter, clientServices())

    const entry = slots.entries.find(candidate => candidate.descriptor.name === 'conversation.session.header.actions')
    expect(entry?.descriptor).toMatchObject({
      name: 'conversation.session.header.actions',
      id: 'worktree-target',
    })

    const Header = entry!.component
    render(<Header sessionId="session-from-slot-props" />)
    expect(screen.getByText('加载中…')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('Local')).toBeTruthy())
    const status = screen.getByRole('status', { name: 'Session Target：Local' })
    expect(status.tagName).toBe('SPAN')
    expect(status.getAttribute('title')).toBe('Session Target 状态')
    expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'session-from-slot-props' })

    slots.dispose()
    expect(slots.entries.some(candidate => candidate.descriptor.id === 'worktree-target')).toBe(false)
  })

  test('在 input dock 注册 Domi 式待验收状态条，并只显示一个主操作与更多菜单', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const slots = new SlotsDouble()

    registerTargetConsole({ slots }, fixture.adapter, clientServices())

    const entry = slots.entries.find(candidate => candidate.descriptor.name === 'conversation.input.dock')
    expect(entry?.descriptor).toMatchObject({
      name: 'conversation.input.dock',
      id: 'worktree-review-status',
    })
    const Dock = entry!.component
    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByText('Worktree 已准备好同步到 Local 验收')).toBeTruthy())
    expect(screen.getByRole('button', { name: '同步到 Local 验收' })).toBeTruthy()
    expect(screen.getByLabelText('更多交付操作')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show diff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))
    await waitFor(() => expect(screen.getByText('本轮修改正在 Local 等待验收')).toBeTruthy())
    expect(fixture.calls).toContainEqual({ method: 'preflight', request: {
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    } })
    expect(fixture.calls).toContainEqual({ method: 'preview', request: {
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    } })
  })

  test('Host revision 在 Preview 操作外部变化时清除旧操作提示，避免 recovery 状态继续显示过期 preflight 文案', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const slots = new SlotsDouble()
    registerTargetConsole({ slots }, fixture.adapter, clientServices())
    const Dock = slots.entries.find(candidate => candidate.descriptor.id === 'worktree-review-status')!.component
    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByRole('button', { name: '同步到 Local 验收' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))
    await waitFor(() => expect(screen.getByText('已同步为可撤回的 Local Preview；请在 Local 中验收。')).toBeTruthy())
    const detached = {
      ...fixture.target,
      state: 'preview_detached' as const,
      phase: 'ready' as const,
      revision: 9,
      previewRecovery: { reason: 'stale_local' as const, attemptedAction: 'rollback_preview' as const },
      capabilities: { ...fixture.target.capabilities, discard: false, preflight: false, preview: false, rollbackPreview: true, finalize: false, finalizePreview: false },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: detached } }))

    window.dispatchEvent(new CustomEvent(WORKTREE_REVIEW_REFRESH_EVENT, { detail: { sessionId: 'target-session' } }))

    await waitFor(() => expect(screen.getByText('Local branch/HEAD 已变化，Preview 等待安全撤回')).toBeTruthy())
    expect(screen.queryByText('已同步为可撤回的 Local Preview；请在 Local 中验收。')).toBeNull()
    expect(screen.queryByText('同步预检通过，正在创建可撤回的 Local Preview。')).toBeNull()
  })

  test('Preview 因 Local HEAD 变化 detached 后 dock 解释同分支快进恢复并提供安全重试', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const detached = {
      ...fixture.target,
      state: 'preview_detached' as const,
      phase: 'ready' as const,
      revision: 9,
      previewRecovery: { reason: 'stale_local' as const, attemptedAction: 'rollback_preview' as const },
      capabilities: { ...fixture.target.capabilities, discard: false, preflight: false, preview: false, rollbackPreview: true, finalize: false, finalizePreview: false },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: detached } }))
    const slots = new SlotsDouble()
    registerTargetConsole({ slots }, fixture.adapter, clientServices())
    const Dock = slots.entries.find(candidate => candidate.descriptor.id === 'worktree-review-status')!.component

    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByText('Local branch/HEAD 已变化，Preview 等待安全撤回')).toBeTruthy())
    expect(screen.getByText('同分支快进可安全重试；切分支或改写历史时不会写入。')).toBeTruthy()
    expect((screen.getByRole('button', { name: '安全重试撤回' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('Preview 内容冲突 detached 后 dock 明确保留现场并只提供重新检查撤回', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const detached = {
      ...fixture.target,
      state: 'preview_detached' as const,
      phase: 'ready' as const,
      revision: 10,
      previewRecovery: { reason: 'preview_modified' as const, attemptedAction: 'rollback_preview' as const },
      capabilities: { ...fixture.target.capabilities, discard: false, preflight: false, preview: false, rollbackPreview: true, finalize: false, finalizePreview: false },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: detached } }))
    const slots = new SlotsDouble()
    registerTargetConsole({ slots }, fixture.adapter, clientServices())
    const Dock = slots.entries.find(candidate => candidate.descriptor.id === 'worktree-review-status')!.component

    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByText('Preview 与 Local 发生冲突，已保留恢复现场')).toBeTruthy())
    expect(screen.getByText('自动撤回会重新检查冲突；无法证明安全时不会写入。')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新检查撤回' })).toBeTruthy()
  })

  test('已清理 delivered Session 在原 composer dock 开始下一轮并保持同一 Session', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const { review: _review, reviewSlot: _slot, ...withoutReview } = fixture.target
    const delivered = {
      ...withoutReview,
      state: 'delivered' as const,
      phase: 'discarded' as const,
      iteration: 1,
      revision: 9,
      dirty: false,
      commitOid: 'c'.repeat(40),
      capabilities: {
        ...fixture.target.capabilities,
        open: false,
        discard: false,
        preflight: false,
        preview: false,
        finalize: false,
        beginNextIteration: true,
      },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: delivered } }))
    const slots = new SlotsDouble()
    registerTargetConsole({ slots }, fixture.adapter, clientServices())
    const Dock = slots.entries.find(candidate => candidate.descriptor.id === 'worktree-review-status')!.component

    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByText('本轮已交付，可在原会话继续下一轮修改')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '开始下一轮修改' }))
    await waitFor(() => expect(fixture.calls).toContainEqual({
      method: 'beginNextIteration',
      request: { sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 9 },
    }))
    await waitFor(() => expect(screen.queryByText('本轮已交付，可在原会话继续下一轮修改')).toBeNull())
  })

  test('Preview rollback 中断后 dock 保持可见并提供恢复入口', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const recovery = {
      ...fixture.target,
      state: 'recovery_required' as const,
      phase: 'recovery_required' as const,
      revision: 9,
      capabilities: { ...fixture.target.capabilities, discard: false, preflight: false, preview: false, rollbackPreview: true, finalize: false, finalizePreview: false },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: recovery } }))
    const slots = new SlotsDouble()
    registerTargetConsole({ slots }, fixture.adapter, clientServices())
    const Dock = slots.entries.find(candidate => candidate.descriptor.id === 'worktree-review-status')!.component

    render(<Dock session={{ sessionId: 'target-session' }} input={{}} />)

    await waitFor(() => expect(screen.getByText('验收操作中断，需要恢复 Preview')).toBeTruthy())
    expect((screen.getByRole('button', { name: '重新尝试撤回' }) as HTMLButtonElement).disabled).toBe(false)
  })

  test('暂不注册 conversation.view，同时保留 Header 状态胶囊和验收 dock', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const slots = new SlotsDouble()

    registerTargetConsole({ slots }, fixture.adapter, clientServices())

    expect(slots.entries.some(candidate => candidate.descriptor.name === 'conversation.view')).toBe(false)
    expect(slots.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptor: expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }) }),
      expect.objectContaining({ descriptor: expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status' }) }),
    ]))
  })
})

describe('Worktree Console loading and inspection', () => {
  test('renders explicit empty and stable error states', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    const view = renderConsole(fixture.adapter)
    expect(await screen.findByText('这个项目还没有受管 Worktree。')).toBeTruthy()
    view.unmount()

    const failed = createWorktreeConsoleAdapterFixture()
    failed.adapter.list = vi.fn(async () => ({
      ok: false,
      error: { code: 'project_mismatch', message: 'The target belongs to another project.' },
    }))
    renderConsole(failed.adapter)
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('project_mismatch'))
    expect(screen.getByRole('alert').textContent).toContain('当前 Session')
  })

  test('shows managedRoot only after an explicit authorized inspect', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const inspect = fixture.adapter.inspect
    fixture.adapter.inspect = vi.fn(request => inspect(request))
    renderConsole(fixture.adapter)

    expect(screen.queryByText(fixture.target.managedRoot!)).toBeNull()
    fireEvent.click(await screen.findByRole('button', { name: '检查 checkout-1' }))
    await waitFor(() => expect(screen.getByText(fixture.target.managedRoot!)).toBeTruthy())
    expect(fixture.adapter.inspect).toHaveBeenCalledWith({ sessionId: 'source-session', checkoutId: 'checkout-1' })
  })

  test('ignores a late initial response after unmount', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    let resolveCurrent!: (value: Awaited<ReturnType<typeof fixture.adapter.current>>) => void
    let resolveList!: (value: Awaited<ReturnType<typeof fixture.adapter.list>>) => void
    fixture.adapter.current = vi.fn(async () => new Promise(resolve => { resolveCurrent = resolve }))
    fixture.adapter.list = vi.fn(async () => new Promise(resolve => { resolveList = resolve }))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = renderConsole(fixture.adapter)
    view.unmount()

    resolveCurrent({ ok: true, value: { target: fixture.target } })
    resolveList({ ok: true, value: { project: fixture.target.project, worktrees: [summaryOf(fixture.target)] } })
    await Promise.resolve()
    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test('shows retention/recovery facts and suppresses Create in recovery even if a capability is forged', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const recovery = {
      ...fixture.target,
      state: 'recovery_required' as const,
      phase: 'recovery_required' as const,
      retention: 'retain_24h' as const,
      expiresAt: Date.UTC(2026, 7, 17, 12, 0, 0),
      cleanupMessage: 'Manual recovery is required.',
      capabilities: { ...fixture.target.capabilities, create: true, finalize: true },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: recovery } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: recovery.project, worktrees: [summaryOf(recovery)] } }))
    renderConsole(fixture.adapter)

    await screen.findByText('Manual recovery is required.')
    expect(screen.getByText(/保留 24 小时/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '创建 Worktree' })).toBeNull()
  })
})

describe('Worktree Console Create/Open', () => {
  test('creates once, registers the exact Host targetSessionId, and opens only that target', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    let resolveCreate!: (value: Awaited<ReturnType<typeof fixture.adapter.create>>) => void
    fixture.adapter.create = vi.fn(async () => new Promise(resolve => { resolveCreate = resolve }))
    const services = clientServices()
    renderConsole(fixture.adapter, services)

    const create = await screen.findByRole('button', { name: '创建 Worktree' })
    fireEvent.click(create)
    fireEvent.click(create)
    expect(fixture.adapter.create).toHaveBeenCalledTimes(1)
    expect(fixture.adapter.create).toHaveBeenCalledWith({ sourceSessionId: 'source-session' })

    resolveCreate({
      ok: true,
      value: {
        target: fixture.target,
        targetSessionId: 'target-session',
        managedRoot: '/fixture/project-worktrees/checkout-1',
      },
    })

    await waitFor(() => expect(services.sessions.open).toHaveBeenCalledWith('target-session'))
    expect(services.workspaces.create).toHaveBeenCalledWith({ path: '/fixture/project-worktrees/checkout-1' })
    expect(services.sessions.create).toHaveBeenCalledWith({
      workspaceId: 'workspace-target',
      sessionId: 'target-session',
    })
    expect(services.sessions.open).not.toHaveBeenCalledWith('source-session')
  })

  test('invalidates Session A responses when the same view switches to Session B', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const localA = localTarget()
    const localB = {
      ...localTarget(),
      sourceSessionId: 'session-b',
      ownerSessionId: 'session-b',
    }
    fixture.adapter.current = vi.fn(async ({ sessionId }) => ({
      ok: true,
      value: { target: sessionId === 'session-b' ? localB : localA },
    }))
    fixture.adapter.list = vi.fn(async ({ sessionId }) => ({
      ok: true,
      value: {
        project: localA.project,
        worktrees: sessionId === 'session-b' ? [] : [],
      },
    }))
    let resolveCreate!: (value: Awaited<ReturnType<typeof fixture.adapter.create>>) => void
    fixture.adapter.create = vi.fn(async () => new Promise(resolve => { resolveCreate = resolve }))
    const services = clientServices()
    const view = renderConsole(fixture.adapter, services)

    fireEvent.click(await screen.findByRole('button', { name: '创建 Worktree' }))
    view.rerender(<WorktreeConsoleView sessionId="session-b" adapter={fixture.adapter} services={services} />)
    await waitFor(() => expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'session-b' }))
    resolveCreate({
      ok: true,
      value: {
        target: fixture.target,
        targetSessionId: 'target-session',
        managedRoot: fixture.target.managedRoot!,
      },
    })
    await Promise.resolve()
    await Promise.resolve()

    expect(services.workspaces.create).not.toHaveBeenCalled()
    expect(services.sessions.open).not.toHaveBeenCalled()
    expect(screen.queryByText(fixture.target.managedRoot!)).toBeNull()
  })

  test('does not navigate when the Console unmounts during the Harness open sequence', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    const services = clientServices()
    let resolveWorkspace!: (value: { workspaceId: string; path: string }) => void
    services.workspaces.create = vi.fn(async () => new Promise(resolve => { resolveWorkspace = resolve }))
    const view = renderConsole(fixture.adapter, services)

    fireEvent.click(await screen.findByRole('button', { name: '创建 Worktree' }))
    await waitFor(() => expect(services.workspaces.create).toHaveBeenCalled())
    view.unmount()
    resolveWorkspace({ workspaceId: 'workspace-target', path: fixture.target.managedRoot! })
    await Promise.resolve()
    await Promise.resolve()

    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.sessions.open).not.toHaveBeenCalled()
  })

  test('rejects a Create response that aliases the source Session as its target', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    fixture.adapter.create = vi.fn(async () => ({
      ok: true,
      value: {
        target: {
          ...fixture.target,
          sourceSessionId: 'source-session',
          ownerSessionId: 'source-session',
          targetSessionId: 'source-session',
        },
        targetSessionId: 'source-session',
        managedRoot: fixture.target.managedRoot!,
      },
    }))
    const services = clientServices()
    renderConsole(fixture.adapter, services)

    fireEvent.click(await screen.findByRole('button', { name: '创建 Worktree' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('source Session'))
    expect(services.workspaces.create).not.toHaveBeenCalled()
    expect(services.sessions.open).not.toHaveBeenCalled()
  })

  test('fails closed when Workspace registration resolves to a different path', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    const services = clientServices()
    services.workspaces.create = vi.fn(async () => ({ workspaceId: 'wrong-workspace', path: '/another/project' }))
    renderConsole(fixture.adapter, services)

    fireEvent.click(await screen.findByRole('button', { name: '创建 Worktree' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('工作目录与 Host 记录不一致'))
    expect(services.sessions.create).not.toHaveBeenCalled()
    expect(services.sessions.open).not.toHaveBeenCalled()
  })

  test('fails closed when Harness returns an unexpected Session ID', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const local = localTarget()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: local } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: local.project, worktrees: [] } }))
    const services = clientServices()
    services.sessions.create = vi.fn(async () => 'unexpected-session')
    renderConsole(fixture.adapter, services)

    fireEvent.click(await screen.findByRole('button', { name: '创建 Worktree' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('非预期 Session'))
    expect(services.sessions.open).not.toHaveBeenCalled()
  })

  test('does not Open when inspect revokes the latest server capability', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.inspect = vi.fn(async () => ({
      ok: true,
      value: { target: { ...fixture.target, capabilities: { ...fixture.target.capabilities, open: false } } },
    }))
    const services = clientServices()
    renderConsole(fixture.adapter, services)

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '打开 checkout-1' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('不允许打开该 Worktree'))
    expect(services.workspaces.create).not.toHaveBeenCalled()
    expect(services.sessions.open).not.toHaveBeenCalled()
  })

  test('inspects a path-free list row before opening its authorized managedRoot', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const inspect = fixture.adapter.inspect
    fixture.adapter.inspect = vi.fn(request => inspect(request))
    const services = clientServices()
    renderConsole(fixture.adapter, services)

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '打开 checkout-1' }))

    await waitFor(() => expect(fixture.adapter.inspect).toHaveBeenCalledWith({
      sessionId: 'source-session',
      checkoutId: 'checkout-1',
    }))
    expect(services.workspaces.create).toHaveBeenCalledWith({ path: fixture.target.managedRoot! })
    expect(services.sessions.open).toHaveBeenCalledWith('target-session')
  })
})

describe('Client entry integration', () => {
  test('mounts the official Remote adapter under the same service name consumed by the Target registrar', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices()
    const descriptors: Record<string, unknown>[] = []
    const provided = new Map<string, unknown>()
    const disposers: Array<() => void> = []
    const remote = {
      gitWorktree: fixture.adapter,
      $mount: vi.fn(async () => () => undefined),
    }
    const slots = {
      inject: (_name: string, callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
      },
      register: (descriptor: Record<string, unknown>) => {
        descriptors.push(descriptor)
        return () => {
          const index = descriptors.indexOf(descriptor)
          if (index >= 0) descriptors.splice(index, 1)
        }
      },
    }
    const context = {
      slots,
      remote,
      get: (name: string) => {
        if (name === 'workspaces') return services.workspaces
        if (name === 'sessions') return services.sessions
        if (name === 'remote.gitWorktree') return remote.gitWorktree
        return provided.get(name)
      },
      provide: (name: string, value: unknown) => { provided.set(name, value) },
      effect: (setup: () => void | (() => void)) => {
        const dispose = setup()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    }

    await applyRemoteClient(context as never)

    expect(provided.get('worktreeConsole')).toBeDefined()
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status' }),
      expect.objectContaining({ name: 'conversation.input.left', id: 'worktree-pre-session' }),
    ]))
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.view', id: 'worktree' }),
    ]))
    for (const dispose of disposers.reverse()) dispose()
  })

  test('keeps the main-flow ToolViews and Target status slots while hiding the Worktree view tab', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices()
    const descriptors: Record<string, unknown>[] = []
    const disposers: Array<() => void> = []
    const slots = {
      inject: (_name: string, callback: () => unknown) => {
        const dispose = callback()
        if (typeof dispose === 'function') disposers.push(dispose as () => void)
      },
      register: (descriptor: Record<string, unknown>) => {
        descriptors.push(descriptor)
        return () => {
          const index = descriptors.indexOf(descriptor)
          if (index >= 0) descriptors.splice(index, 1)
        }
      },
    }
    const context = {
      slots,
      get: (name: string) => {
        if (name === 'workspaces') return services.workspaces
        if (name === 'sessions') return services.sessions
        if (name === WORKTREE_CONSOLE_ADAPTER_SERVICE) return fixture.adapter
        return undefined
      },
      effect: (setup: () => void | (() => void)) => {
        const dispose = setup()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
    }

    applyClient(context as Parameters<typeof applyClient>[0])

    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_ready_for_review' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status', order: 10 }),
      expect.objectContaining({ name: 'conversation.input.left', id: 'worktree-pre-session', order: 40 }),
    ]))
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.view', id: 'worktree' }),
    ]))
    for (const dispose of disposers.reverse()) dispose()
    expect(descriptors).toHaveLength(0)
  })
})

describe('Worktree Console Review integration', () => {
  test('opens the shared compact Chinese Review panel without exposing Diff or Inspect inside the card', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    renderConsole(fixture.adapter, clientServices(), 'target-session')

    fireEvent.click(await screen.findByRole('button', { name: '验收 checkout-1' }))
    expect(screen.getByRole('region', { name: 'Worktree 验收' })).toBeTruthy()
    expect(screen.getByText('第 1 轮修改已准备验收')).toBeTruthy()
    expect(screen.getByRole('button', { name: '同步到 Local 验收' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Show diff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull()
    expect(fixture.calls.some(call => call.method === 'reviewDiff')).toBe(false)
  })
})

describe('Worktree Console guarded mutations', () => {
  test('requires keyboard-accessible confirmation before dirty Discard and sends revision CAS fields', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const discard = fixture.adapter.discard
    fixture.adapter.discard = vi.fn(request => discard(request))
    renderConsole(fixture.adapter)

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '放弃 checkout-1' }))
    expect(fixture.adapter.discard).not.toHaveBeenCalled()

    const dialog = screen.getByRole('alertdialog', { name: '放弃有修改的 Worktree？' })
    const confirm = within(dialog).getByRole('button', { name: '确认放弃修改' })
    await waitFor(() => expect(document.activeElement).toBe(confirm))
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()

    fireEvent.click(within(row).getByRole('button', { name: '放弃 checkout-1' }))
    fireEvent.click(screen.getByRole('button', { name: '确认放弃修改' }))
    await waitFor(() => expect(fixture.adapter.discard).toHaveBeenCalledWith({
      sessionId: 'source-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
      confirmDirty: true,
    }))
  })

  test('Console 放弃 active Preview 时明确请求 Host 先安全 rollback', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const preview = {
      ...fixture.target,
      state: 'preview_active' as const,
      revision: 8,
      capabilities: { ...fixture.target.capabilities, preflight: false, preview: false, rollbackPreview: true, finalize: false, finalizePreview: true },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: preview } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: preview.project, worktrees: [summaryOf(preview)] } }))
    fixture.adapter.discard = vi.fn(async () => ({ ok: true, value: { target: { ...summaryOf(preview), state: 'delivered', phase: 'discarded' } } }))
    renderConsole(fixture.adapter, clientServices(), 'target-session')

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '放弃 checkout-1' }))
    expect(screen.getByRole('alertdialog').textContent).toContain('只有撤回成功后才会删除 Worktree')
    fireEvent.click(screen.getByRole('button', { name: '确认放弃修改' }))

    await waitFor(() => expect(fixture.adapter.discard).toHaveBeenCalledWith({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 8, confirmDirty: true, rollbackPreview: true,
    }))
  })

  test('uses the mutation response revision instead of incrementing it optimistically', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const clean = { ...fixture.target, dirty: false }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: clean } }))
    let listCalls = 0
    fixture.adapter.list = vi.fn(async () => {
      listCalls++
      if (listCalls > 1) return new Promise<never>(() => undefined)
      return { ok: true as const, value: { project: clean.project, worktrees: [summaryOf(clean)] } }
    })
    fixture.adapter.discard = vi.fn(async () => ({
      ok: true,
      value: {
        target: {
          ...summaryOf(clean),
          revision: 12,
          state: 'delivered' as const,
          phase: 'discarded' as const,
          capabilities: { ...clean.capabilities, open: false, discard: false },
        },
      },
    }))
    renderConsole(fixture.adapter)

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '放弃 checkout-1' }))
    await waitFor(() => expect(within(row).getByText('r12')).toBeTruthy())
    expect(within(row).queryByText('r8')).toBeNull()
  })

  test('refreshes a stale target without replaying the destructive action', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const clean = { ...fixture.target, dirty: false }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: clean } }))
    fixture.adapter.list = vi.fn(async () => ({
      ok: true,
      value: { project: clean.project, worktrees: [{ ...summaryOf(clean), revision: 8 }] },
    }))
    fixture.adapter.discard = vi.fn(async () => ({
      ok: false,
      error: { code: 'stale_target', message: 'Target revision changed.' },
    }))
    renderConsole(fixture.adapter)

    const row = await screen.findByRole('listitem')
    fireEvent.click(within(row).getByRole('button', { name: '放弃 checkout-1' }))

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('stale_target'))
    await waitFor(() => expect(fixture.adapter.list).toHaveBeenCalledTimes(2))
    expect(fixture.adapter.discard).toHaveBeenCalledTimes(1)
  })

  test('retries cleanup only when the server capability allows it', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const cleanupTarget = {
      ...fixture.target,
      state: 'cleanup_pending' as const,
      phase: 'finalized' as const,
      dirty: false,
      capabilities: {
        ...fixture.target.capabilities,
        open: false,
        discard: false,
        finalize: false,
        retryCleanup: true,
      },
    }
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: cleanupTarget } }))
    fixture.adapter.list = vi.fn(async () => ({ ok: true, value: { project: cleanupTarget.project, worktrees: [summaryOf(cleanupTarget)] } }))
    fixture.adapter.retryCleanup = vi.fn(async () => ({
      ok: true,
      value: { target: { ...summaryOf(cleanupTarget), revision: 9, state: 'delivered', phase: 'discarded', capabilities: { ...cleanupTarget.capabilities, retryCleanup: false } } },
    }))
    renderConsole(fixture.adapter)

    fireEvent.click(await screen.findByRole('button', { name: '重试清理 checkout-1' }))
    await waitFor(() => expect(fixture.adapter.retryCleanup).toHaveBeenCalledWith({
      sessionId: 'source-session',
      checkoutId: 'checkout-1',
      expectedRevision: 7,
    }))
  })
})
