// @vitest-environment jsdom
import { createElement, type ComponentType } from 'react'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { registerNativeWorkspaceDecorations } from '../src/client/workspace-sidebar/native.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'
import { WORKTREE_REVIEW_REFRESH_EVENT } from '../src/client/review-console/status-events.js'

afterEach(cleanup)
const topology = (state = 'ready_for_review') => ({ projects: [{ project: { id: 'project', name: 'demo' }, tasks: [{ checkoutId: 'checkout', ownerSessionId: 'owner', sourceSessionId: 'local', iteration: 1, revision: 1, phase: 'ready', state }] }] })
function fixture() {
  const seats = new Map<string, () => unknown>()
  const entries = new Map<string, ComponentType<{ sessionId: string }>>()
  const callbacks = new Set<() => void>()
  const disposers: (() => void)[] = []
  const source = { subscribe: (fn: () => void) => { callbacks.add(fn); return () => { callbacks.delete(fn) } } }
  const adapter = createWorktreeConsoleAdapterFixture().adapter
  adapter.sidebarTopology = vi.fn(async () => ({ ok: true, value: topology() as never }))
  const ctx = {
    slots: {
      inject: (name: string, callback: () => unknown) => { seats.set(name, callback) },
      register: (descriptor: { name: string }, Component: ComponentType<{ sessionId: string }>) => {
        entries.set(descriptor.name, Component)
        return () => { entries.delete(descriptor.name) }
      },
    },
    get: (name: string) => name === 'sessions' || name === 'workspaces' ? { list: source } : undefined,
    effect: (setup: () => () => void) => { disposers.push(setup()) },
  }
  registerNativeWorkspaceDecorations(ctx, adapter)
  return { adapter, seats, entries, callbacks, dispose: () => disposers.forEach(fn => fn()) }
}

describe('native official sidebar decorations without version selection', () => {
  test('waits for public seats, contributes only decorations and leaves ordinary rows empty', async () => {
    const f = fixture()
    expect([...f.seats.keys()]).toEqual(['sidebar.session.row.trailing', 'sidebar.session.row.hover'])
    expect(f.entries.size).toBe(0)
    for (const mount of f.seats.values()) mount()
    const Tag = f.entries.get('sidebar.session.row.trailing')!
    const Hover = f.entries.get('sidebar.session.row.hover')!
    const view = render(<><Tag sessionId="owner" /><Hover sessionId="owner" /><Tag sessionId="local" /></>)
    await waitFor(() => expect(screen.getAllByText('待验收')).toHaveLength(2))
    expect(view.container.querySelectorAll('[data-worktree-state]')).toHaveLength(2)
    expect(f.adapter.sidebarTopology).toHaveBeenCalledTimes(1)
    f.dispose()
    expect(f.callbacks.size).toBe(0)
  })

  test('tracks official declaration teardown and remount without taking over the Browser', async () => {
    const f = fixture()
    const mount = f.seats.get('sidebar.session.row.trailing')!
    const withdraw = mount() as () => void
    withdraw()
    expect(f.entries.size).toBe(0)
    mount()
    const Tag = f.entries.get('sidebar.session.row.trailing')!
    render(createElement(Tag, { sessionId: 'owner' }))
    await screen.findByText('待验收')
    f.dispose()
  })

  test('coalesces refreshes, ignores superseded responses and withdraws tags on failure', async () => {
    const f = fixture()
    await waitFor(() => expect(f.adapter.sidebarTopology).toHaveBeenCalledTimes(1))
    let finish!: (value: any) => void
    vi.mocked(f.adapter.sidebarTopology).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    vi.mocked(f.adapter.sidebarTopology).mockResolvedValue({ ok: true, value: topology('working') as never })
    for (const mount of f.seats.values()) mount()
    const Tag = f.entries.get('sidebar.session.row.trailing')!
    const view = render(<Tag sessionId="owner" />)
    await screen.findByText('待验收')
    act(() => {
      window.dispatchEvent(new Event(WORKTREE_REVIEW_REFRESH_EVENT))
      for (const callback of f.callbacks) callback()
      window.dispatchEvent(new Event(WORKTREE_REVIEW_REFRESH_EVENT))
    })
    expect(f.adapter.sidebarTopology).toHaveBeenCalledTimes(2)
    await act(async () => { finish({ ok: true, value: topology('discarded') }); await Promise.resolve() })
    await waitFor(() => expect(view.container.querySelector('[data-worktree-state]')?.getAttribute('data-worktree-state')).toBe('working'))
    expect(view.container.textContent).not.toContain('进行中')
    expect(view.container.textContent).not.toContain('已放弃')
    vi.mocked(f.adapter.sidebarTopology).mockRejectedValue(new Error('offline'))
    act(() => { window.dispatchEvent(new Event(WORKTREE_REVIEW_REFRESH_EVENT)) })
    await waitFor(() => expect(view.container.textContent).toBe(''))
    f.dispose()
  })

  test('does not publish a response after plugin disposal', async () => {
    const f = fixture()
    await waitFor(() => expect(f.adapter.sidebarTopology).toHaveBeenCalledTimes(1))
    let finish!: (value: any) => void
    vi.mocked(f.adapter.sidebarTopology).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    f.seats.get('sidebar.session.row.trailing')!()
    const Tag = f.entries.get('sidebar.session.row.trailing')!
    render(<Tag sessionId="owner" />)
    await screen.findByText('待验收')
    act(() => { window.dispatchEvent(new Event(WORKTREE_REVIEW_REFRESH_EVENT)) })
    f.dispose()
    await act(async () => { finish({ ok: true, value: topology('discarded') }); await Promise.resolve() })
    expect(screen.queryByText('已放弃')).toBeNull()
  })
})
