// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DeferredWorktreeToggle } from '../src/client/pre-session/DeferredWorktreeToggle.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'
import type { PreSessionWorktreeServices } from '../src/client/actions.js'

afterEach(cleanup)

test('selecting Worktree keeps native Session/draft and only updates durable intent', async () => {
  const adapter = createWorktreeConsoleAdapterFixture().adapter
  const deferredWorktree = vi.fn(async (request: { requested?: boolean }) => ({ ok: true as const, value: {
    supported: true, requested: request.requested ?? false, locked: false, phase: 'idle' as const,
  } }))
  adapter.deferredWorktree = deferredWorktree
  let block: { reason: string } | undefined
  const services = { conversation: { blocks: {
    storeFor: () => ({ getSnapshot: () => block }), set: (_id: string, next: typeof block) => { block = next },
  } } } as unknown as PreSessionWorktreeServices
  render(<DeferredWorktreeToggle sessionId="same-session" blank adapter={adapter} services={services} legacy={<span>legacy</span>} />)
  const checkbox = await screen.findByRole('checkbox', { name: 'Worktree' })
  fireEvent.click(checkbox)
  await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(true))
  expect(deferredWorktree).toHaveBeenLastCalledWith({ sessionId: 'same-session', requested: true })
  expect(block).toBeUndefined()
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('unsupported Hosts retain the existing confirmation flow', async () => {
  const adapter = createWorktreeConsoleAdapterFixture().adapter
  adapter.deferredWorktree = vi.fn(async () => ({ ok: true, value: { supported: false, requested: false, locked: false, phase: 'idle' } }))
  render(<DeferredWorktreeToggle sessionId="legacy-session" blank adapter={adapter} services={{} as PreSessionWorktreeServices} legacy={<button>legacy-create</button>} />)
  expect(await screen.findByText('legacy-create')).toBeTruthy()
})

test('a stale read cannot reselect Worktree after a successful cancellation', async () => {
  const adapter = createWorktreeConsoleAdapterFixture().adapter
  let settle: ((value: any) => void) | undefined
  let calls = 0
  adapter.deferredWorktree = vi.fn(async request => {
    if (request.requested !== undefined) return { ok: true, value: { supported: true, requested: request.requested, locked: false, phase: 'idle' } }
    calls++
    if (calls === 2) return await new Promise(resolve => { settle = resolve })
    return { ok: true, value: { supported: true, requested: true, locked: false, phase: 'idle' } }
  })
  let block: { reason: string } | undefined
  const services = { conversation: { blocks: {
    storeFor: () => ({ getSnapshot: () => block }), set: (_id: string, next: typeof block) => { block = next },
  } } } as unknown as PreSessionWorktreeServices
  render(<DeferredWorktreeToggle sessionId="race-session" blank adapter={adapter} services={services} legacy={null} />)
  const checkbox = await screen.findByRole('checkbox')
  await waitFor(() => expect(settle).toBeTypeOf('function'), { timeout: 2500 })
  fireEvent.click(checkbox)
  await waitFor(() => expect((checkbox as HTMLInputElement).checked).toBe(false))
  settle!({ ok: true, value: { supported: true, requested: true, locked: false, phase: 'idle' } })
  await new Promise(resolve => setTimeout(resolve, 10))
  expect((checkbox as HTMLInputElement).checked).toBe(false)
  expect(block).toBeUndefined()
})
