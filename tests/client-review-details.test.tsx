// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { ClientI18nProvider } from '../src/client/i18n.js'
import { ReviewDetailsModal } from '../src/client/review-console/ReviewDetailsModal.js'
import { WorktreeReviewStatus } from '../src/client/target-console/WorktreeReviewStatus.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'
import type { WorktreeClientServices } from '../src/client/actions.js'

afterEach(cleanup)
const services = {} as WorktreeClientServices

test('只读详情不显示 diff 或交付按钮，关闭后返回入口焦点', () => {
  const { target } = createWorktreeConsoleAdapterFixture()
  function Harness() {
    const [open, setOpen] = useState(false)
    return <><button onClick={() => setOpen(true)}>查看详情</button><ReviewDetailsModal open={open} onClose={() => setOpen(false)} target={target} /></>
  }
  render(<Harness />)
  const trigger = screen.getByRole('button', { name: '查看详情' })
  trigger.focus(); fireEvent.click(trigger)
  const dialog = screen.getByRole('dialog', { name: '验收详情' })
  expect(within(dialog).getByText('Fixture review')).toBeTruthy()
  expect(within(dialog).getByText('pnpm test')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: /预览|保存|撤回/ })).toBeNull()
  expect(dialog.querySelector('pre')).toBeNull()
  expect(dialog.querySelectorAll('svg.lucide').length).toBeGreaterThan(3)
  expect(dialog.querySelector('.lucide-x')).toBeTruthy()
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭验收详情' }))
  fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
  expect(document.activeElement?.tagName).toBe('SUMMARY')
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '关闭验收详情' }))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test.each(['passed', 'failed', 'partial', 'not_run'] as const)('保留真实验证状态 %s 与空记录', status => {
  const { target } = createWorktreeConsoleAdapterFixture()
  target.review = { ...target.review!, validationStatus: status, tests: [] }
  const { container } = render(<ReviewDetailsModal open onClose={() => {}} target={target} />)
  expect(container.querySelector(`[data-validation="${status}"]`)).toBeTruthy()
  expect(screen.getByText('未提供验证记录。')).toBeTruthy()
})

test('预览、恢复、冲突及语言切换均来自当前数据', async () => {
  const { target, adapter } = createWorktreeConsoleAdapterFixture()
  const response = await adapter.preflight({ sessionId: 'target-session', checkoutId: target.checkoutId!, expectedRevision: target.revision, expectedReviewId: target.review!.reviewId })
  if (!response.ok || response.value.preflight.status === 'blocked') throw new Error('Expected ready preflight')
  const preflight = response.value.preflight
  const view = render(<ReviewDetailsModal open onClose={() => {}} target={{ ...target, state: 'preview_active' }} />)
  expect(screen.getByText('正在本地预览，尚未保存。')).toBeTruthy()
  view.rerender(<ReviewDetailsModal open onClose={() => {}} target={{ ...target, state: 'preview_detached' }} />)
  expect(screen.getByText('需要恢复')).toBeTruthy()
  expect(screen.queryByText('正在本地预览，尚未保存。')).toBeNull()
  view.rerender(<ReviewDetailsModal open onClose={() => {}} target={target} preflight={{ ...preflight, status: 'conflict', localModified: false, conflictingFiles: target.review!.changedFiles }} />)
  expect(screen.getByText('预览受阻')).toBeTruthy()
  expect(screen.getAllByText('冲突').length).toBeGreaterThan(0)
  view.rerender(<ClientI18nProvider language="en"><ReviewDetailsModal open onClose={() => {}} target={target} /></ClientI18nProvider>)
  expect(screen.getByRole('dialog', { name: 'Review details' })).toBeTruthy()
  expect(screen.getByText('Fixture review')).toBeTruthy()
})

test('无需展开工具记录即可打开详情，换会话后关闭，读取详情不调用写操作或 diff', async () => {
  const fixture = createWorktreeConsoleAdapterFixture()
  const view = render(<WorktreeReviewStatus session={{ sessionId: 'target-session' }} adapter={fixture.adapter} services={services} />)
  fireEvent.click(await screen.findByRole('button', { name: '查看详情' }))
  expect(screen.getByRole('dialog', { name: '验收详情' })).toBeTruthy()
  expect(fixture.calls.every(call => ['current', 'preflight', 'previewRecoveryPreflight'].includes(call.method))).toBe(true)
  view.rerender(<WorktreeReviewStatus session={{ sessionId: 'another-session' }} adapter={fixture.adapter} services={services} />)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('更多及预览操作使用 Lucide，长文本 Modal 使用独立可滚动布局', async () => {
  const fixture = createWorktreeConsoleAdapterFixture()
  fixture.target.review!.summary = '很长的验收标题'.repeat(30)
  fixture.target.review!.changedFiles = ['src/' + 'long-path/'.repeat(30) + 'file.ts']
  render(<WorktreeReviewStatus session={{ sessionId: 'target-session' }} adapter={fixture.adapter} services={services} />)
  expect((await screen.findByRole('button', { name: '预览修改' })).querySelector('.lucide-eye')).toBeTruthy()
  expect(document.querySelector('.dsh-wt-more-trigger .lucide-ellipsis')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }))
  const dialog = screen.getByRole('dialog', { name: '验收详情' })
  expect(dialog.querySelector('.dsh-wt-details-header .lucide-x')).toBeTruthy()
  expect(dialog.querySelector('.dsh-wt-details-body')).toBeTruthy()
  expect(within(dialog).getByText(fixture.target.review!.changedFiles[0]!)).toBeTruthy()
})
