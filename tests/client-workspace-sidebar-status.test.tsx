// @vitest-environment jsdom
import { createRequire } from 'node:module'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { decorateOfficialWorkspaceClient, readOfficialWorkspaceClient } from '../scripts/workspace-sidebar-upstream.mjs'
import { decorateAlphaWorkspaceClient, readAlphaWorkspaceClient } from '../scripts/workspace-sidebar-upstream-alpha.mjs'
import { decorateNextWorkspaceClient, readNextWorkspaceClient } from '../scripts/workspace-sidebar-upstream-next.mjs'

const labels = {
  working: '进行中', ready_for_review: '待验收', preview_active: '预览中',
  preview_detached: '待恢复', recovery_required: '需要恢复', finalized: '已完成', discarded: '已放弃',
}
type TaskState = keyof typeof labels

// Render the actual pinned row, with only Host primitives substituted. The
// test-only export does not change the shipped factory's public API.
function loadRow(source: string): ComponentType<Record<string, unknown>> {
  const nodeRequire = createRequire(import.meta.url)
  const primitives = new Proxy({}, {
    get(_target, name: string) {
      if (name === 'HoverCard') return ({ anchor, content }: { anchor: ReactNode; content: ReactNode }) =>
        createElement('section', null, anchor, createElement('aside', { 'data-hover-content': true }, content))
      if (name === 'Menu') return ({ anchor }: { anchor: ReactNode }) => anchor
      if (name === 'StateDot') return ({ state }: { state: string }) => createElement('i', { 'data-official-state': state })
      return () => createElement('i', { 'data-icon': name })
    },
  })
  let Row!: ComponentType<Record<string, unknown>>
  const exportSeam = '\t\texports.apply = apply;'
  expect(source.split(exportSeam)).toHaveLength(2)
  new Function('window', source.replace(exportSeam, `${exportSeam}\n\t\texports.TestRow = SessionNodeItem;`))({
    __ModuleLoader__: {
      load(handoff: { factory(require: (name: string) => unknown): { TestRow: typeof Row } }) {
        Row = handoff.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives'
          ? primitives : nodeRequire(name)).TestRow
      },
    },
  })
  return Row
}

const variants = [
  { name: 'alpha', source: () => decorateAlphaWorkspaceClient(readAlphaWorkspaceClient()) },
  { name: 'next', source: () => decorateNextWorkspaceClient(readNextWorkspaceClient()) },
  { name: 'modern', source: () => decorateOfficialWorkspaceClient(readOfficialWorkspaceClient().source) },
]

function renderRow(Row: ComponentType<Record<string, unknown>>, state?: TaskState, running = false) {
  const node = {
    id: 'session-1', title: '原有会话标题', blank: false, archived: false,
    running, runningSubagentCount: 0, updatedAt: 1000, completed: false,
    ...(state ? { __dshGitWorktree: { kind: 'managed-worktree', state, label: labels[state] } } : {}),
  }
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(createElement(Row, {
    node, now: 2000, onOpen: () => {}, renderSlot: () => null,
    t: (key: string) => key.startsWith('dshGitWorktree.state.')
      ? labels[key.slice('dshGitWorktree.state.'.length) as TaskState] : key,
  }))
  return { row: container.querySelector('[role="treeitem"]')!, container }
}

describe.each(variants)('$name sidebar Worktree state presentation', variant => {
  const Row = loadRow(variant.source())
  test.each([false, true])('hides the working badge but keeps identity and native runtime status (running: %s)', running => {
    const { row, container } = renderRow(Row, 'working', running)
    expect(row.querySelector('.dsh-git-worktree-sidebar-badge')).toBeNull()
    expect(row.querySelector('[data-icon^="IconBranchOutline"]')).not.toBeNull()
    expect(row.textContent).toContain('原有会话标题')
    expect(row.textContent).not.toContain('进行中')
    const ordinary = renderRow(Row, undefined, running)
    expect(row.querySelector('[data-official-state]')?.getAttribute('data-official-state'))
      .toBe(ordinary.row.querySelector('[data-official-state]')?.getAttribute('data-official-state'))
    if (running) expect(row.querySelector('[data-official-state]')).not.toBeNull()
    // Older derivatives already expose the full task state on the branch's
    // native tooltip; modern exposes it in the official row hover card.
    if (variant.name === 'modern') expect(container.querySelector('[data-hover-content]')?.textContent).toContain('进行中')
    else expect(row.querySelector('[title="进行中"]')).not.toBeNull()
  })
  test.each(Object.keys(labels).filter(state => state !== 'working') as TaskState[])('keeps the %s badge unchanged', state => {
    const { row } = renderRow(Row, state)
    const badge = row.querySelector('.dsh-git-worktree-sidebar-badge')!
    expect(badge?.getAttribute('data-worktree-state')).toBe(state)
    expect(badge?.textContent).toBe(labels[state])
  })
  test('does not decorate an ordinary Session', () => {
    const { row } = renderRow(Row)
    expect(row.querySelector('.dsh-git-worktree-sidebar-badge')).toBeNull()
    expect(row.querySelector('[data-icon^="IconBranchOutline"]')).toBeNull()
    expect(row.textContent).toContain('原有会话标题')
  })
})
