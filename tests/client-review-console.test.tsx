// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorktreeReviewRow } from '../src/client/WorktreeReviewRow.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { WORKTREE_STYLES } from '../src/client/styles.js'
import { WorktreeReviewPanel, type WorktreeReviewEvidence } from '../src/client/review-console/WorktreeReviewPanel.js'
import { clearWorktreeRecovery } from '../src/client/review-console/recovery-continuation.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

afterEach(() => {
  cleanup()
  clearWorktreeRecovery('target-session')
})

function review(overrides: Partial<WorktreeReviewEvidence> = {}): WorktreeReviewEvidence {
  return {
    reviewId: 'review-1', revision: 7, iteration: 1, preparedAt: 1, summary: 'Review summary',
    validationStatus: 'passed', validationSummary: 'Focused validation passed',
    tests: [
      { command: 'pnpm test', status: 'passed', summary: 'All tests passed' },
      { command: 'pnpm run typecheck', status: 'not_run', summary: 'Not required yet' },
    ],
    changedFiles: ['src/client/review-console/WorktreeReviewPanel.tsx'],
    suggestedCommitMessage: 'feat(review): add Worktree Review UI',
    detailsMarkdown: '# Delivery\n\nNo raw HTML is rendered.',
    ...overrides,
  }
}

function identity(revision = 7) {
  return { sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: revision, expectedReviewId: 'review-1' }
}

function clientServices(byId: Record<string, { cwd?: string } | undefined> = {
  'target-session': { cwd: '/fixture/project-worktrees/checkout-1' },
}): WorktreeClientServices {
  const setDraft = vi.fn()
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  return {
    workspaces: { create: vi.fn(), openPath: vi.fn() },
    sessions: {
      create: vi.fn(), open: vi.fn(),
      list: { getSnapshot: () => ({ current: 'target-session', ids: Object.keys(byId), byId }), subscribe: () => () => undefined },
      binding: vi.fn(() => ({ ctx: {}, session: {
        sessionId: 'target-session', command: vi.fn(), prompt,
        getSnapshot: () => ({ running: false, openState: 'open' as const, removed: false }),
        subscribe: () => () => undefined,
      } })),
    },
    conversation: { input: { for: vi.fn(() => ({ setDraft, addImages: vi.fn(), removeImage: vi.fn() })) } },
  }
}

function previewTarget() {
  const fixture = createWorktreeConsoleAdapterFixture()
  return {
    fixture,
    target: {
      ...fixture.target,
      state: 'preview_active' as const,
      revision: 8,
      capabilities: {
        ...fixture.target.capabilities,
        preflight: false,
        preview: false,
        rollbackPreview: true,
        finalize: false,
        finalizePreview: true,
      },
    },
  }
}

function loggedReviewRow(adapter?: ReturnType<typeof createWorktreeConsoleAdapterFixture>['adapter']) {
  const evidence = review()
  return <WorktreeReviewRow
    callId="call-review-live"
    toolName="worktree_ready_for_review"
    sessionId="target-session"
    block={{
      callId: 'call-review-live', kind: 'result',
      call: { argsRaw: JSON.stringify({
        summary: evidence.summary, details: evidence.detailsMarkdown,
        validationStatus: evidence.validationStatus, validationSummary: evidence.validationSummary,
        tests: evidence.tests, suggestedCommitMessage: evidence.suggestedCommitMessage,
      }) },
      content: [{ type: 'text', text: JSON.stringify({
        kind: 'worktree_ready_for_review', state: 'ready_for_review', reviewId: evidence.reviewId,
        revision: evidence.revision, changedFiles: evidence.changedFiles,
      }) }],
    }}
    services={{} as WorktreeClientServices}
    adapter={adapter}
  />
}

describe('Domi-style Worktree Review', () => {
  test('验收卡菜单不被卡片裁剪，卡片向下展开而 composer dock 向上展开', () => {
    const style = document.createElement('style')
    style.textContent = WORKTREE_STYLES
    document.head.append(style)
    try {
      const rules = Array.from(style.sheet?.cssRules ?? []) as CSSStyleRule[]
      const rule = (selector: string): CSSStyleDeclaration => {
        const matched = rules.find(candidate => candidate.selectorText === selector)
        if (!matched) throw new Error(`Missing CSS rule: ${selector}`)
        return matched.style
      }

      expect(rule('.dsh-wt-card[data-tool="worktree_ready_for_review"]').overflow).toBe('visible')
      expect(rule('.dsh-wt-more-content').top).toBe('calc(100% + 6px)')
      expect(rule('.dsh-wt-more-content').bottom).toBe('auto')
      expect(rule('.dsh-wt-review-dock .dsh-wt-more-content').top).toBe('auto')
      expect(rule('.dsh-wt-review-dock .dsh-wt-more-content').bottom).toBe('calc(100% + 6px)')
    } finally {
      style.remove()
    }
  })

  test('默认只展示中文摘要，并按用户操作展开验证详情', () => {
    const evidence = review({ detailsMarkdown: '<img src=x onerror=alert(1)>\n\n**plain markdown source**' })
    const { container } = render(<WorktreeReviewPanel review={evidence} />)

    expect(screen.getByText('第 1 轮修改已准备验收')).toBeTruthy()
    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getByText('自动验证通过')).toBeTruthy()
    expect(screen.getByText('1 个文件')).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看验证详情（2 项测试）' })).toBeTruthy()
    expect(screen.queryByText('Focused validation passed')).toBeNull()
    expect(screen.queryByText('src/client/review-console/WorktreeReviewPanel.tsx')).toBeNull()
    expect(container.querySelector('img')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '查看验证详情（2 项测试）' }))
    expect(screen.getByText('Focused validation passed')).toBeTruthy()
    expect(screen.getByText('pnpm test')).toBeTruthy()
    expect(screen.getByRole('button', { name: '收起验证详情' })).toBeTruthy()
  })

  test('只显示文件数量，不恢复 Diff、Inspect 或平铺 Retention', () => {
    const files = Array.from({ length: 200 }, (_, index) => `src/generated/${index}-${'x'.repeat(80)}.ts`)
    render(<WorktreeReviewPanel review={review({ changedFiles: files })} />)
    expect(screen.getByText('200 个文件')).toBeTruthy()
    expect(screen.queryByText(files[0]!)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Show diff' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retain 24h' })).toBeNull()
  })

  test('live target 与验收身份不匹配时 fail closed', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={{ ...fixture.target, revision: 8 }} />)
    expect(screen.getByText(/验收结果已过期，请刷新/)).toBeTruthy()
    const action = screen.getByRole('button', { name: '同步到 Local 验收' }) as HTMLButtonElement
    expect(action.disabled).toBe(true)
    fireEvent.click(action)
    expect(fixture.calls).toEqual([])
  })

  test('Ready 自动只读预检，主操作写入前强制重检再创建可撤回 Local Preview', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onTargetChange = vi.fn()
    fixture.adapter.preflight = vi.fn(fixture.adapter.preflight)
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} onTargetChange={onTargetChange} />)

    await waitFor(() => expect(fixture.adapter.preflight).toHaveBeenCalledTimes(1))
    expect(screen.getByText('同步条件已确认')).toBeTruthy()
    expect(fixture.adapter.preview).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))

    await waitFor(() => expect(fixture.adapter.preflight).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(fixture.adapter.preview).toHaveBeenCalledWith(identity()))
    expect(onTargetChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'preview_active' }))
    expect(screen.getByText(/已同步为可撤回的 Local Preview/)).toBeTruthy()
  })

  test('Review 卡与 composer 表面共享同一 identity 的自动只读预检', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.preflight = vi.fn(fixture.adapter.preflight)
    render(<>
      <WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} />
      <WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} />
    </>)

    await waitFor(() => expect(screen.getAllByText('同步条件已确认')).toHaveLength(2))
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(1)
  })

  test('自动预检冲突仅在用户明确点击后恢复 Working 并通过 Session.prompt 单飞续跑', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices()
    const conflict = {
      status: 'conflict' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base' as const,
      localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'], conflictingFiles: ['x.ts'],
    }
    fixture.adapter.preflight = vi.fn(async () => ({ ok: true as const, value: { preflight: conflict } }))
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    fixture.adapter.resumeRevision = vi.fn(fixture.adapter.resumeRevision)
    const workingOutcome = await fixture.adapter.resumeRevision({
      ...identity(),
      conflictContinuation: {
        kind: 'worktree_apply_conflict',
        requestId: `preflight-conflict:checkout-1:review-1:7:${'a'.repeat(40)}`,
        checkoutId: 'checkout-1',
        reviewId: 'review-1',
        revision: 7,
        localHeadOid: 'a'.repeat(40),
        conflictingFiles: ['x.ts'],
      },
    })
    if (!workingOutcome.ok) throw new Error('expected working fixture')
    const working = workingOutcome.value
    vi.mocked(fixture.adapter.resumeRevision).mockClear()
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: {
      ...fixture.target, ...working.target, review: undefined, managedRoot: fixture.target.managedRoot, sourceRoot: fixture.target.sourceRoot,
      sourceOid: fixture.target.sourceOid, currentBranch: fixture.target.currentBranch,
    } } }))
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} services={services} identity={identity()} target={fixture.target} />)

    await waitFor(() => expect(screen.getByText('发现 1 个冲突文件')).toBeTruthy())
    expect(screen.getByText('x.ts')).toBeTruthy()
    expect(fixture.adapter.resumeRevision).not.toHaveBeenCalled()
    expect(services.sessions.binding('target-session')?.session.prompt).not.toHaveBeenCalled()

    const resolveConflict = screen.getByRole('button', { name: '让 Agent 解决冲突' })
    fireEvent.click(resolveConflict)
    fireEvent.click(resolveConflict)

    await waitFor(() => expect(fixture.adapter.resumeRevision).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(services.sessions.binding('target-session')?.session.prompt).toHaveBeenCalledTimes(1))
    expect(services.sessions.binding('target-session')?.session.prompt).toHaveBeenCalledWith([
      { type: 'text', text: expect.stringMatching(/Local HEAD.*x\.ts/s) },
    ], 'queue', expect.any(AbortSignal))
    expect(fixture.adapter.preview).not.toHaveBeenCalled()
  })

  test('Preview 写前竞态返回结构化 continuation，等待用户再次明确授权后才续跑 Agent', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices()
    fixture.adapter.preflight = vi.fn(async request => ({ ok: true as const, value: { preflight: request.expectedRevision === 9 ? {
      status: 'conflict' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 9,
      configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base' as const,
      localBranch: 'main', localHeadOid: 'c'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'], conflictingFiles: ['x.ts'],
    } : {
      status: 'ready' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base' as const,
      localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'],
    } } }))
    fixture.adapter.preview = vi.fn(async () => ({ ok: false as const, error: {
      code: 'apply_conflict' as const, message: 'race conflict', continuation: {
        kind: 'worktree_apply_conflict' as const,
        requestId: `apply-conflict:checkout-1:review-1:9:${'c'.repeat(40)}`,
        checkoutId: 'checkout-1', reviewId: 'review-1', revision: 9,
        localHeadOid: 'c'.repeat(40), conflictingFiles: ['x.ts'],
      },
    } }))
    const recoveryContinuation = {
      kind: 'worktree_apply_conflict' as const,
      requestId: `conflict-recovery:${'d'.repeat(32)}`,
      checkoutId: 'checkout-1', reviewId: 'review-1', revision: 10,
      localHeadOid: 'c'.repeat(40), conflictingFiles: ['x.ts'],
    }
    const working = { ...fixture.target, state: 'working' as const, revision: 10, review: undefined, recoveryContinuation }
    fixture.adapter.resumeRevision = vi.fn(async () => ({ ok: true as const, value: { target: working, recoveryContinuation } }))
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} services={services} identity={identity()} target={fixture.target} />)

    await waitFor(() => expect(screen.getByText('同步条件已确认')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))
    await waitFor(() => expect(screen.getByText(/实时写入校验发现冲突/)).toBeTruthy())
    expect(fixture.adapter.resumeRevision).not.toHaveBeenCalled()
    expect(services.sessions.binding('target-session')?.session.prompt).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '让 Agent 解决冲突' }))
    await waitFor(() => expect(fixture.adapter.resumeRevision).toHaveBeenCalledWith({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 9, expectedReviewId: 'review-1',
      conflictContinuation: {
        kind: 'worktree_apply_conflict',
        requestId: `apply-conflict:checkout-1:review-1:9:${'c'.repeat(40)}`,
        checkoutId: 'checkout-1', reviewId: 'review-1', revision: 9,
        localHeadOid: 'c'.repeat(40), conflictingFiles: ['x.ts'],
      },
    }))
    await waitFor(() => expect(services.sessions.binding('target-session')?.session.prompt).toHaveBeenCalledTimes(1))
  })

  test('Ready 更多菜单可手动继续修改，但正常 follow-up 不依赖该入口', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.resumeRevision = vi.fn(fixture.adapter.resumeRevision)
    const onTargetChange = vi.fn()
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} onTargetChange={onTargetChange} />)

    fireEvent.click(screen.getByLabelText('更多交付操作'))
    fireEvent.click(screen.getByRole('menuitem', { name: '继续修改' }))

    await waitFor(() => expect(fixture.adapter.resumeRevision).toHaveBeenCalledWith(identity()))
    expect(onTargetChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'working', iteration: 1 }))
    expect(screen.getByText(/已恢复编辑；请重新检查、验证并生成新的验收稿/)).toBeTruthy()
  })

  test('Ready 更多菜单提供跳过验收直接提交，并保持 Commit Message/Retention 确认', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.finalize = vi.fn(fixture.adapter.finalize)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} />)

    await waitFor(() => expect(screen.getByText('同步条件已确认')).toBeTruthy())
    fireEvent.click(screen.getByLabelText('更多交付操作'))
    fireEvent.click(screen.getByRole('menuitem', { name: '跳过验收，直接提交' }))
    expect(screen.getByRole('dialog', { name: '跳过 Local 验收，直接提交？' })).toBeTruthy()
    const message = screen.getByRole('textbox', { name: 'Commit Message' }) as HTMLTextAreaElement
    fireEvent.change(message, { target: { value: 'feat(review): direct finish' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '提交后暂时保留当前运行环境' }))
    fireEvent.change(screen.getByRole('combobox', { name: '保留时长' }), { target: { value: 'retain_3d' } })
    fireEvent.click(screen.getByRole('button', { name: '确认提交并保留环境' }))

    await waitFor(() => expect(fixture.adapter.finalize).toHaveBeenCalledWith({
      ...identity(), commitMessage: 'feat(review): direct finish', retention: 'retain_3d',
    }))
  })

  test('Preview active 主操作验收通过并提交，调用 finalizePreview 而不是 direct finish', async () => {
    const { fixture, target } = previewTarget()
    fixture.adapter.finalizePreview = vi.fn(fixture.adapter.finalizePreview)
    fixture.adapter.finalize = vi.fn(fixture.adapter.finalize)
    render(<WorktreeReviewPanel review={review({ revision: 8 })} adapter={fixture.adapter} identity={identity(8)} target={target} />)

    fireEvent.click(screen.getByRole('button', { name: '验收通过并提交' }))
    expect(screen.getByRole('dialog', { name: '验收通过并提交？' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认提交并清理' }))

    await waitFor(() => expect(fixture.adapter.finalizePreview).toHaveBeenCalledWith({
      ...identity(8), commitMessage: 'feat(review): add Worktree Review UI', retention: 'cleanup',
    }))
    expect(fixture.adapter.finalize).not.toHaveBeenCalled()
  })

  test('Preview active 更多菜单支持撤回本次预览', async () => {
    const { fixture, target } = previewTarget()
    fixture.adapter.rollbackPreview = vi.fn(fixture.adapter.rollbackPreview)
    render(<WorktreeReviewPanel review={review({ revision: 8 })} adapter={fixture.adapter} identity={identity(8)} target={target} />)

    fireEvent.click(screen.getByLabelText('更多交付操作'))
    fireEvent.click(screen.getByRole('menuitem', { name: '撤回本次预览' }))

    await waitFor(() => expect(fixture.adapter.rollbackPreview).toHaveBeenCalledWith({ ...identity(8), resumeRevision: true }))
  })

  test('Detached Preview 只按 Host proof 显示安全操作，并在点击撤回前强制重检', async () => {
    const { fixture, target: active } = previewTarget()
    const recoverySpy = vi.spyOn(fixture.adapter, 'previewRecoveryPreflight')
    const rollbackSpy = vi.spyOn(fixture.adapter, 'rollbackPreview')
    const target = {
      ...active,
      state: 'preview_detached' as const,
      previewRecovery: {
        previewId: 'preview-1', detachedAt: 123,
        reason: 'stale_local' as const, attemptedAction: 'rollback_preview' as const,
      },
    }
    render(<WorktreeReviewPanel
      review={review({ revision: 8 })}
      identity={identity(8)}
      adapter={fixture.adapter}
      services={clientServices()}
      target={target}
      onStale={() => undefined}
      onTargetChange={() => undefined}
    />)

    expect(screen.queryByRole('button', { name: '安全撤回 Preview' })).toBeNull()
    await waitFor(() => expect(screen.getByRole('button', { name: '安全撤回 Preview' })).toBeTruthy())
    expect(screen.getByText(/generation 111111111111/)).toBeTruthy()
    expect(screen.getByText(/撤回：可证明安全/)).toBeTruthy()
    expect(screen.getByText(/提交：可证明安全/)).toBeTruthy()
    expect(recoverySpy).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: '安全撤回 Preview' }))
    await waitFor(() => expect(rollbackSpy).toHaveBeenCalledTimes(1))
    expect(recoverySpy).toHaveBeenCalledTimes(2)
    expect(rollbackSpy.mock.calls[0]?.[0]).toMatchObject({
      expectedRevision: 8,
      recoveryProof: { generation: '1'.repeat(64), previewId: 'preview-1' },
    })
  })

  test('Preview active 放弃任务会显式要求先 rollback Preview', async () => {
    const { fixture, target } = previewTarget()
    fixture.adapter.discard = vi.fn(fixture.adapter.discard)
    render(<WorktreeReviewPanel review={review({ revision: 8 })} adapter={fixture.adapter} identity={identity(8)} target={target} />)

    fireEvent.click(screen.getByLabelText('更多交付操作'))
    fireEvent.click(screen.getByRole('menuitem', { name: '放弃任务' }))
    expect(screen.getByRole('dialog', { name: '放弃本轮任务？' }).textContent).toContain('先安全撤回本次 Local Preview')
    fireEvent.click(screen.getByRole('button', { name: '确认放弃任务' }))

    await waitFor(() => expect(fixture.adapter.discard).toHaveBeenCalledWith({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 8, confirmDirty: true, rollbackPreview: true,
    }))
  })

  test('Preview 遇到 stale_local 时停止写操作并刷新只读预检，不废弃 Review', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.preflight = vi.fn(fixture.adapter.preflight)
    fixture.adapter.preview = vi.fn(async () => ({ ok: false as const, error: { code: 'stale_local' as const, message: 'Local advanced' } }))
    const onRefresh = vi.fn()
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} onRefresh={onRefresh} />)

    await waitFor(() => expect(screen.getByText('同步条件已确认')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))

    await waitFor(() => expect(fixture.adapter.preflight).toHaveBeenCalledTimes(3))
    expect(fixture.adapter.preview).toHaveBeenCalledTimes(1)
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.queryByText(/验收结果已过期/)).toBeNull()
    expect(screen.getByText(/状态在写入前发生变化/)).toBeTruthy()
  })

  test('stale isolated 保持 Ready/Read Only，并通过 Session.prompt 重新生成验收结果', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices()
    fixture.adapter.preflight = vi.fn(async () => ({ ok: true as const, value: { preflight: {
      status: 'blocked' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      reason: 'stale_isolated' as const, message: 'stale review',
    } } }))
    fixture.adapter.resumeRevision = vi.fn(fixture.adapter.resumeRevision)
    let ready = fixture.target
    fixture.adapter.prepareReviewRegeneration = vi.fn(async request => {
      const recoveryContinuation = {
        kind: 'worktree_review_regeneration' as const,
        requestId: 'host-authority-regeneration-1',
        checkoutId: request.checkoutId,
        reviewId: request.expectedReviewId,
        revision: request.expectedRevision,
      }
      ready = { ...ready, recoveryContinuation }
      return { ok: true as const, value: { target: ready, recoveryContinuation } }
    })
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: ready } }))
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} services={services} identity={identity()} target={fixture.target} />)

    await waitFor(() => expect(screen.getByText('stale review')).toBeTruthy())
    expect((screen.getByRole('button', { name: '同步到 Local 验收' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新生成验收结果' }))

    await waitFor(() => expect(services.sessions.binding('target-session')?.session.prompt).toHaveBeenCalledTimes(1))
    expect(services.sessions.binding('target-session')?.session.prompt).toHaveBeenCalledWith([
      { type: 'text', text: expect.stringMatching(/严格 Read Only.*不要修改任何文件/s) },
    ], 'queue', expect.any(AbortSignal))
    expect(fixture.adapter.resumeRevision).not.toHaveBeenCalled()
    expect(fixture.adapter.preview).not.toHaveBeenCalled()
  })

  test('acceptance slot 从 waiting 释放为 available 时废弃旧 busy 预检并自动重检', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const waiting = {
      ...fixture.target,
      reviewSlot: 'waiting' as const,
      reviewSlotHolder: { checkoutId: 'checkout-holder', ownerSessionId: 'holder-session', revision: 4, state: 'preview_active' as const },
      capabilities: { ...fixture.target.capabilities, preview: false, finalize: false },
    }
    const available = {
      ...fixture.target,
      reviewSlot: 'available' as const,
      reviewSlotHolder: undefined,
    }
    fixture.adapter.preflight = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: { preflight: {
        status: 'blocked', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
        reason: 'project_acceptance_busy', message: 'busy', blocker: waiting.reviewSlotHolder,
      } } })
      .mockImplementation(fixture.adapter.preflight)
    const view = render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={waiting} />)

    await waitFor(() => expect(screen.getByText('busy')).toBeTruthy())
    view.rerender(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={available} />)

    await waitFor(() => expect(screen.getByText('同步条件已确认')).toBeTruthy())
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(2)
  })

  test('acceptance slot busy 时展示 path-free 摘要并经 inspect/cwd 验证打开占用 Session', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const services = clientServices({ 'holder-session': { cwd: '/fixture/holder' } })
    const waiting = {
      ...fixture.target,
      reviewSlot: 'waiting' as const,
      reviewSlotHolder: { checkoutId: 'checkout-holder', ownerSessionId: 'holder-session', revision: 4, state: 'preview_active' as const },
      capabilities: { ...fixture.target.capabilities, preview: false, finalize: false },
    }
    fixture.adapter.preflight = vi.fn(async () => ({ ok: true as const, value: { preflight: {
      status: 'blocked' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      reason: 'project_acceptance_busy' as const, message: 'busy', blocker: waiting.reviewSlotHolder,
    } } }))
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: {
      ...fixture.target, checkoutId: 'checkout-holder', ownerSessionId: 'holder-session', targetSessionId: 'holder-session',
      managedRoot: '/fixture/holder', capabilities: { ...fixture.target.capabilities, open: true, inspect: true, preview: false, finalize: false },
    } } }))
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} services={services} identity={identity()} target={waiting} />)

    await waitFor(() => expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent?.includes('占用任务：checkout') === true)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '打开占用任务' }))
    await waitFor(() => expect(fixture.adapter.inspect).toHaveBeenCalledWith({ sessionId: 'target-session', checkoutId: 'checkout-holder' }))
    expect(services.sessions.open).toHaveBeenCalledWith('holder-session')
  })

  test('Finalize 后展示 Commit、Local HEAD、验证与 cleanup delivery proof', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const delivered = {
      ...fixture.target,
      state: 'delivered' as const,
      phase: 'discarded' as const,
      commitOid: 'c'.repeat(40),
      deliveryProof: {
        localBranch: 'main', localHeadBefore: 'a'.repeat(40), localHeadAfter: 'c'.repeat(40),
        changedFiles: ['src/index.ts'], validationStatus: 'passed' as const,
        validationSummary: 'focused tests passed', commitInLocalHistory: true,
      },
      capabilities: { ...fixture.target.capabilities, preview: false, finalize: false },
    }
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={delivered} />)

    expect(screen.getByText('Delivery Proof')).toBeTruthy()
    expect(screen.getByText(/环境已清理/)).toBeTruthy()
    expect(screen.getByText(/focused tests passed/)).toBeTruthy()
    expect(screen.getByText(/Commit 仍在 Local 历史中/)).toBeTruthy()
  })

  test('logged ToolView 在 Remote 可用时可连续 Preview 再按最新 revision 提交', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.current = vi.fn(async () => ({ ok: true, value: { target: fixture.target } }))
    fixture.adapter.finalizePreview = vi.fn(fixture.adapter.finalizePreview)
    render(loggedReviewRow(fixture.adapter))
    await waitFor(() => expect(fixture.adapter.current).toHaveBeenCalledWith({ sessionId: 'target-session' }))
    expect((screen.getByRole('button', { name: '同步到 Local 验收' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '验收通过并提交' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '验收通过并提交' }))
    fireEvent.click(screen.getByRole('button', { name: '确认提交并清理' }))
    await waitFor(() => expect(fixture.adapter.finalizePreview).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 8 })))
    expect(screen.queryByRole('button', { name: 'Show diff' })).toBeNull()
  })

  test('logged ToolView 在 live Console 不可用时仍可回放紧凑证据', () => {
    render(loggedReviewRow())
    expect(screen.getByText('Review summary')).toBeTruthy()
    expect(screen.getByText(/连接后即可执行验收操作/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: '同步到 Local 验收' })).toBeNull()
  })
})
