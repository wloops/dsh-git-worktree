// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ClientI18nProvider, clientTranslator, readClientLanguage, useClientTranslator, translatorForServices } from '../src/client/i18n.js'
import { clientMessages } from '../src/i18n/client-messages.js'
import { WorktreeCreateRow } from '../src/client/WorktreeCreateRow.js'
import { WorktreeReviewPanel } from '../src/client/review-console/WorktreeReviewPanel.js'
import { parseCreateTool, parseReviewTool } from '../src/client/model.js'
import { finalizeCurrentSession, type WorktreeClientServices } from '../src/client/actions.js'
import { apply } from '../src/client/index.js'
import { buildWorktreeRecoveryPrompt } from '../src/client/review-console/recovery-continuation.js'
import { projectManagedWorkspaceSidebar } from '../src/client/workspace-sidebar/model.js'
import type { WorktreeReviewEvidence } from '../src/types.js'

afterEach(cleanup)

function localeFace(active: unknown) {
  let snapshot = { active, revision: 0 }
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: vi.fn((listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }),
    change(active: unknown) { snapshot = { active, revision: snapshot.revision + 1 }; for (const listener of listeners) listener() },
    listeners,
  }
}

const evidence: WorktreeReviewEvidence = {
  reviewId: 'review-原始', revision: 2, iteration: 3,
  changedFiles: ['中文文件.ts'], summary: '用户摘要 user summary',
  suggestedCommitMessage: '用户 commit title', validationStatus: 'passed', validationSummary: '用户验证结果', tests: [], preparedAt: 1, detailsMarkdown: '用户详情',
}

function Counter() {
  const t = useClientTranslator()
  const [count, setCount] = useState(0)
  return <button onClick={() => setCount(count + 1)}>{t('count.files', { count })}</button>
}

describe('Client instance locale', () => {
  test('reads LocaleFace snapshot.active, not a guessed language property', () => {
    expect(readClientLanguage(localeFace('en-US'))).toBe('en')
    expect(readClientLanguage(localeFace('EN'))).toBe('en')
    for (const source of [undefined, null, 'en', { language: 'en' }, { getSnapshot: () => ({ active: 'en' }) }, localeFace('fr'), localeFace(undefined)]) {
      expect(readClientLanguage(source)).toBe('zh')
    }
    expect(readClientLanguage({ getSnapshot() { throw new Error('offline') }, subscribe() {} })).toBe('zh')
  })

  test('subscribes, switches without resetting local UI state, and unsubscribes', () => {
    const locale = localeFace('zh-CN')
    const mounted = render(<ClientI18nProvider locale={locale}><Counter /></ClientI18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: '0 个文件' }))
    act(() => locale.change('en-US'))
    expect(screen.getByRole('button', { name: '1 files' })).toBeTruthy()
    act(() => locale.change('ja-JP'))
    expect(screen.getByRole('button', { name: '1 个文件' })).toBeTruthy()
    expect(locale.subscribe).toHaveBeenCalledTimes(1)
    mounted.unmount()
    expect(locale.listeners.size).toBe(0)
  })

  test('two mounted clients never share mutable language', () => {
    const en = localeFace('en')
    render(<><ClientI18nProvider locale={en}><Counter /></ClientI18nProvider><ClientI18nProvider language="zh"><Counter /></ClientI18nProvider></>)
    expect(screen.getByText('0 files')).toBeTruthy()
    expect(screen.getByText('0 个文件')).toBeTruthy()
    act(() => en.change('zh'))
    expect(screen.getAllByText('0 个文件')).toHaveLength(2)
  })

  test('all catalog entries have matching interpolation parameters and English copy', () => {
    const parameters = (text: string) => [...text.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort()
    for (const entry of Object.values(clientMessages)) {
      expect(entry.zh.length).toBeGreaterThan(0)
      expect(entry.en.length).toBeGreaterThan(0)
      expect(parameters(entry.en)).toEqual(parameters(entry.zh))
      expect(entry.en).not.toMatch(/[\u3400-\u9fff]/)
    }
    expect(clientTranslator('en')('session.target.label', { target: '用户分支 {name}' })).toBe('Session Target: 用户分支 {name}')
  })

  test('tool states and parser fallback diagnostics use the active translator', () => {
    render(<ClientI18nProvider language="en"><WorktreeCreateRow services={{} as WorktreeClientServices} block={{}} /></ClientI18nProvider>)
    expect(screen.getByText('Creating the unique Worktree…')).toBeTruthy()
    expect(parseCreateTool({ kind: 'tool-result', content: [{ type: 'text', text: '{}' }] }, clientTranslator('en')).error).toBe('Malformed Worktree create result.')
    expect(parseReviewTool({ kind: 'tool-result', isError: true }, clientTranslator('en')).error).toBe('Ready for Review failed.')
    expect(parseCreateTool({ kind: 'tool-result', isError: true, content: [{ type: 'text', text: 'Host 用户原文' }] }, clientTranslator('en')).error).toBe('Host 用户原文')
  })

  test('review headings, validation, aria and unavailable feedback switch while user data stays untouched', () => {
    const locale = localeFace('zh')
    render(<ClientI18nProvider locale={locale}><WorktreeReviewPanel review={evidence} /></ClientI18nProvider>)
    act(() => locale.change('en'))
    expect(screen.getByRole('region', { name: 'Worktree review' })).toBeTruthy()
    expect(screen.getByText('Iteration 3 is ready for review')).toBeTruthy()
    expect(screen.getByText('用户摘要 user summary')).toBeTruthy()
    expect(screen.queryByTitle('Review review-原始 · r2')).toBeNull()
    expect(screen.getByText('Automated validation passed')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Preview changes' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View validation and version details' }))
    expect(screen.getByText('用户验证结果')).toBeTruthy()
    act(() => locale.change('zh'))
    expect(screen.getByRole('button', { name: '收起验证与版本详情' }).getAttribute('aria-expanded')).toBe('true')
  })

  test('imperative actions read the locale at each invocation', async () => {
    const locale = localeFace('en')
    const services = { locale, sessions: { list: { getSnapshot: () => ({ current: null }) } } } as unknown as WorktreeClientServices
    await expect(finalizeCurrentSession(services, 'review', 1, 'cleanup')).rejects.toThrow('No Session is currently selected.')
    locale.change('zh')
    await expect(finalizeCurrentSession(services, 'review', 1, 'cleanup')).rejects.toThrow('当前没有选中的 Session。')
    expect(translatorForServices({ locale })('cancel')).toBe('取消')
  })

  test('entry-point registrations provide the actual locale face', () => {
    const locale = localeFace('en')
    const registrations = new Map<string, any>()
    const ctx = {
      get: (key: string) => key === 'locale' ? locale : undefined,
      effect: vi.fn(),
      slots: { inject: (_: string, callback: () => unknown) => callback(), register: (descriptor: Record<string, unknown>, component: any) => { registrations.set(String(descriptor.key), component) } },
    }
    apply(ctx)
    const Row = registrations.get('worktree_create')
    render(<Row block={{}} />)
    expect(screen.getByText('Creating the unique Worktree…')).toBeTruthy()
    act(() => locale.change('zh'))
    expect(screen.getByText('正在创建唯一 Worktree…')).toBeTruthy()
  })

  test('sidebar projection translates only plugin badges, preserving names and cwd', () => {
    const projection = projectManagedWorkspaceSidebar({
      workspaces: [{ workspaceId: 'project', title: '项目', path: '/中文路径', sessionIds: ['owner'] }],
      sessions: { owner: { id: 'owner', displayTitle: '用户标题', cwd: '/中文路径' } },
      topology: { projects: [{ project: { id: 'project', name: '项目' }, tasks: [{ checkoutId: 'checkout', revision: 2, phase: 'ready', sourceSessionId: 'source', ownerSessionId: 'owner', iteration: 2, state: 'ready_for_review' }] }] },
    }, clientTranslator('en'))
    expect(projection.managedBySessionId['owner']?.label).toBe('Ready for review')
    expect(projection.workspaces[0]?.path).toBe('/中文路径')
  })
})

test('English recovery prompts preserve exact IDs, hashes and JSON-encoded paths', () => {
  const request = {
    kind: 'worktree_apply_conflict' as const, sessionId: 'owner', requestId: 'request',
    checkoutId: 'checkout-中文', reviewId: 'review-原始', revision: 8,
    localHeadOid: 'a'.repeat(40), conflictingFiles: ['路径/文件.ts', 'a"b.ts'],
  }
  const prompt = buildWorktreeRecoveryPrompt(request, clientTranslator('en'))
  expect(prompt).toContain('Resolve conflicts only in the current managed Worktree.')
  expect(prompt).toContain('checkout-中文')
  expect(prompt).toContain('review-原始')
  expect(prompt).toContain(request.localHeadOid)
  for (const path of request.conflictingFiles) expect(prompt).toContain(JSON.stringify(path))
  expect(prompt).toContain('Do not call ApplyWorktree or FinishWorktree.')
  const readOnly = buildWorktreeRecoveryPrompt({ ...request, kind: 'worktree_review_regeneration' }, clientTranslator('en'))
  expect(readOnly).toContain('Remain strictly Read Only')
  expect(readOnly).toContain('do not modify any files or write directly to Local')
})
