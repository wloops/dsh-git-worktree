// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WorktreeReviewRow } from '../src/client/WorktreeReviewRow.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import { WorktreeReviewPanel, type WorktreeReviewEvidence } from '../src/client/review-console/WorktreeReviewPanel.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

afterEach(() => cleanup())

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

  test('Ready 主操作先只读预检，再创建可撤回 Local Preview', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onTargetChange = vi.fn()
    fixture.adapter.preflight = vi.fn(fixture.adapter.preflight)
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} onTargetChange={onTargetChange} />)

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))

    await waitFor(() => expect(fixture.adapter.preflight).toHaveBeenCalledWith(identity()))
    await waitFor(() => expect(fixture.adapter.preview).toHaveBeenCalledWith(identity()))
    expect(onTargetChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'preview_active' }))
    expect(screen.getByText(/已同步为可撤回的 Local Preview/)).toBeTruthy()
  })

  test('预检冲突时 Local 未修改且不会自动调用 Preview', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.preflight = vi.fn(async () => ({ ok: true as const, value: { preflight: {
      status: 'conflict' as const, localModified: false as const, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      configuredBaseOid: 'a'.repeat(40), effectiveBaseOid: 'a'.repeat(40), baseStrategy: 'recorded_base' as const,
      localBranch: 'main', localHeadOid: 'a'.repeat(40), isolatedHeadOid: 'b'.repeat(40), changedFiles: ['x.ts'], conflictingFiles: ['x.ts'],
    } } }))
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} />)

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))

    await waitFor(() => expect(screen.getAllByText(/同步预检发现 1 个冲突文件；Local 未修改/)).toHaveLength(2))
    expect(fixture.adapter.preview).not.toHaveBeenCalled()
  })

  test('Ready 更多菜单提供跳过验收直接提交，并保持 Commit Message/Retention 确认', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    fixture.adapter.finalize = vi.fn(fixture.adapter.finalize)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} />)

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

  test('stale review 只失效并刷新一次，不自动重放 Preview', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const onRefresh = vi.fn(async () => undefined)
    fixture.adapter.preflight = vi.fn(async () => ({ ok: false as const, error: { code: 'stale_isolated', message: 'stale review' } }))
    fixture.adapter.preview = vi.fn(fixture.adapter.preview)
    render(<WorktreeReviewPanel review={review()} adapter={fixture.adapter} identity={identity()} target={fixture.target} onRefresh={onRefresh} />)

    fireEvent.click(screen.getByRole('button', { name: '同步到 Local 验收' }))

    await waitFor(() => expect(screen.getByText(/验收结果已过期，请刷新/)).toBeTruthy())
    expect(fixture.adapter.preflight).toHaveBeenCalledTimes(1)
    expect(fixture.adapter.preview).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(1)
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
