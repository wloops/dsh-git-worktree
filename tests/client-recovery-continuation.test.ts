// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from 'vitest'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../src/console-contract.js'
import type { WorktreeClientServices } from '../src/client/actions.js'
import {
  buildWorktreeRecoveryPrompt,
  clearWorktreeRecovery,
  detachWorktreeRecoveryRuntime,
  enqueueWorktreeRecovery,
  getWorktreeRecoverySnapshot,
  restoreWorktreeRecovery,
  retryWorktreeRecovery,
  type WorktreeRecoveryRequest,
} from '../src/client/review-console/recovery-continuation.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function runtime(
  target: WorktreeConsoleTargetDetails,
  initial: { running?: boolean; openState?: 'cold' | 'loading' | 'open' | 'error'; removed?: boolean } = {},
) {
  let sessionSnapshot = {
    running: initial.running ?? false,
    openState: initial.openState ?? 'open',
    removed: initial.removed ?? false,
  }
  const sessionListeners = new Set<() => void>()
  const listListeners = new Set<() => void>()
  let currentSessionId = target.ownerSessionId
  const prompt = vi.fn(async () => ({ ok: true as const, value: { accepted: true as const } }))
  const services: WorktreeClientServices = {
    workspaces: { create: vi.fn(), openPath: vi.fn() },
    sessions: {
      create: vi.fn(), open: vi.fn(),
      list: {
        getSnapshot: () => ({
          current: currentSessionId,
          ids: [target.ownerSessionId],
          byId: { [target.ownerSessionId]: { cwd: target.managedRoot! } },
        }),
        subscribe: listener => {
          listListeners.add(listener)
          return () => { listListeners.delete(listener) }
        },
      },
      binding: vi.fn(() => ({
        ctx: {},
        session: {
          sessionId: target.ownerSessionId,
          command: vi.fn(),
          prompt,
          getSnapshot: () => sessionSnapshot,
          subscribe: (listener: () => void) => {
            sessionListeners.add(listener)
            return () => { sessionListeners.delete(listener) }
          },
        },
      })),
    },
  }
  return {
    services,
    prompt,
    setSessionSnapshot(next: Partial<typeof sessionSnapshot>) {
      sessionSnapshot = { ...sessionSnapshot, ...next }
      for (const listener of sessionListeners) listener()
    },
    setCurrentSession(sessionId: string) {
      currentSessionId = sessionId
      for (const listener of listListeners) listener()
    },
  }
}

function conflictRequest(revision = 8, suffix = 'default'): WorktreeRecoveryRequest {
  return {
    kind: 'worktree_apply_conflict',
    sessionId: 'target-session',
    requestId: `conflict:checkout-1:review-1:7:local:${suffix}`,
    checkoutId: 'checkout-1',
    reviewId: 'review-1',
    revision,
    localHeadOid: 'a'.repeat(40),
    conflictingFiles: ['src/index.ts'],
  }
}

function authorizedTarget(target: WorktreeConsoleTargetDetails, request: WorktreeRecoveryRequest): WorktreeConsoleTargetDetails {
  return {
    ...target,
    recoveryContinuation: request.kind === 'worktree_apply_conflict'
      ? {
          kind: request.kind,
          requestId: request.requestId,
          checkoutId: request.checkoutId,
          reviewId: request.reviewId,
          revision: request.revision,
          localHeadOid: request.localHeadOid,
          conflictingFiles: [...request.conflictingFiles],
        }
      : {
          kind: request.kind,
          requestId: request.requestId,
          checkoutId: request.checkoutId,
          reviewId: request.reviewId,
          revision: request.revision,
        },
  }
}

function regenerationRequest(): WorktreeRecoveryRequest {
  return {
    kind: 'worktree_review_regeneration',
    sessionId: 'target-session',
    requestId: 'regenerate:checkout-1:review-1:7',
    checkoutId: 'checkout-1',
    reviewId: 'review-1',
    revision: 7,
  }
}

afterEach(() => {
  clearWorktreeRecovery('target-session')
  localStorage.clear()
})

describe('Worktree recovery continuation', () => {
  test('explicit conflict continuation waits for an idle open owner Session and sends exactly once', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'single-flight')
    const working = authorizedTarget({
      ...fixture.target,
      state: 'working' as const,
      revision: 8,
      review: undefined,
      capabilities: { ...fixture.target.capabilities, preflight: false, preview: false, resumeRevision: false, finalize: false },
    }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working, { running: true })

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'queued' }))
    expect(client.prompt).not.toHaveBeenCalled()

    client.setSessionSnapshot({ running: false })
    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledTimes(1))
    expect(client.prompt).toHaveBeenCalledWith([
      { type: 'text', text: expect.stringMatching(/managed Worktree.*Local HEAD.*src\/index\.ts/s) },
    ], 'queue', expect.any(AbortSignal))
    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sent', request })
  })

  test('fails closed when the exact checkout/revision/kind no longer matches Host authority', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const client = runtime(fixture.target)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: fixture.target } }))

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request: conflictRequest(8, 'mismatch'), isActive: () => true })

    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'cancelled' }))
    expect(localStorage.getItem('dsh-git-worktree:recovery:v1:target-session')).toBeNull()
    expect(client.prompt).not.toHaveBeenCalled()
  })

  test('cancels a deferred request when its active Harness Session changes', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'cancelled')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working, { running: true })

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    client.setCurrentSession('another-session')
    client.setSessionSnapshot({ running: false })

    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'cancelled' }))
    expect(client.prompt).not.toHaveBeenCalled()
  })

  test('cancels a deferred continuation when its React action scope becomes inactive', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'inactive-scope')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working, { running: true })
    let active = true

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => active })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'queued' }))
    active = false
    client.setSessionSnapshot({ running: false })

    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'cancelled' }))
    expect(client.prompt).not.toHaveBeenCalled()
  })

  test('aborts a sending continuation when its React action scope becomes inactive', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'inactive-sending')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working)
    let active = true
    let promptSignal: AbortSignal | undefined
    client.prompt.mockImplementation(async (_content, _mode, signal) => new Promise(resolve => {
      promptSignal = signal
      signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'cancelled', message: 'aborted' } } as never), { once: true })
    }))

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => active })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sending' }))
    active = false

    await vi.waitFor(() => expect(promptSignal?.aborted).toBe(true))
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'cancelled' }))
  })

  test('aborts a sending continuation when the active Harness Session switches', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'switch')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working)
    let promptSignal: AbortSignal | undefined
    client.prompt.mockImplementation(async (_content, _mode, signal) => new Promise(resolve => {
      promptSignal = signal
      signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'cancelled', message: 'aborted' } } as never), { once: true })
    }))

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sending' }))
    client.setCurrentSession('another-session')

    await vi.waitFor(() => expect(promptSignal?.aborted).toBe(true))
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'cancelled' }))
  })

  test('retains a failed send for an explicit retry without repeating Host mutation', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'retry')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    fixture.adapter.resumeRevision = vi.fn(fixture.adapter.resumeRevision)
    const client = runtime(working)
    client.prompt.mockResolvedValueOnce({ ok: false, error: { code: 'agent-busy', message: 'busy', details: {} } } as never)
      .mockResolvedValueOnce({ ok: true, value: { accepted: true } })

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'failed', error: expect.stringContaining('busy') }))

    retryWorktreeRecovery('target-session')
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sent' }))
    expect(client.prompt).toHaveBeenCalledTimes(2)
    expect(fixture.adapter.inspect).toHaveBeenCalledTimes(4)
    expect(fixture.adapter.resumeRevision).not.toHaveBeenCalled()
  })

  test('a newer recovery request supersedes a deferred older request without duplicate sends', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const older = conflictRequest(8, 'older')
    const newer = conflictRequest(8, 'newer')
    let authorized = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, older)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: authorized } }))
    const client = runtime(authorized, { running: true })

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request: older, isActive: () => true })
    authorized = authorizedTarget(authorized, newer)
    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request: newer, isActive: () => true })
    client.setSessionSnapshot({ running: false })

    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledTimes(1))
    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sent', request: newer })
    expect(client.prompt.mock.calls[0]?.[0]).toEqual([
      { type: 'text', text: expect.stringContaining('Working revision: 8') },
    ])
  })

  test('restores a persisted unsent request after renderer teardown and revalidates before sending', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'persisted')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working, { running: true })

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'queued' }))
    expect(localStorage.getItem('dsh-git-worktree:recovery:v1:target-session')).toContain(request.requestId)

    detachWorktreeRecoveryRuntime('target-session')
    client.setSessionSnapshot({ running: false })
    restoreWorktreeRecovery({ sessionId: 'target-session', adapter: fixture.adapter, services: client.services })

    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledTimes(1))
    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sent', request })
    expect(localStorage.getItem('dsh-git-worktree:recovery:v1:target-session')).toBeNull()
  })

  test('does not automatically replay an ambiguously sending request after renderer teardown', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = conflictRequest(8, 'ambiguous')
    const working = authorizedTarget({ ...fixture.target, state: 'working' as const, revision: 8, review: undefined }, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: working } }))
    const client = runtime(working)
    client.prompt.mockImplementation(async (_content, _mode, signal) => new Promise(resolve => {
      signal?.addEventListener('abort', () => resolve({ ok: false, error: { code: 'cancelled', message: 'aborted' } } as never), { once: true })
    }))

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })
    await vi.waitFor(() => expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sending' }))
    detachWorktreeRecoveryRuntime('target-session')
    restoreWorktreeRecovery({ sessionId: 'target-session', adapter: fixture.adapter, services: client.services })

    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({
      status: 'failed', error: expect.stringMatching(/结果未知.*显式重新发送/),
    })
    expect(client.prompt).toHaveBeenCalledTimes(1)
  })

  test('rejects unsafe conflict paths before persistence or outward prompt construction', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const client = runtime(fixture.target)
    const request = { ...conflictRequest(8, 'unsafe-path'), conflictingFiles: ['../escape.ts'] }

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })

    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({
      status: 'failed', error: expect.stringContaining('边界校验'),
    })
    expect(localStorage.getItem('dsh-git-worktree:recovery:v1:target-session')).toContain('边界校验')
    expect(fixture.calls).not.toContainEqual(expect.objectContaining({ method: 'inspect' }))
    expect(client.prompt).not.toHaveBeenCalled()
  })

  test('rejects a forged persisted recovery kind instead of routing it through a conflict prompt branch', () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const client = runtime(fixture.target)
    localStorage.setItem('dsh-git-worktree:recovery:v1:target-session', JSON.stringify({
      version: 1,
      status: 'queued',
      request: {
        ...regenerationRequest(),
        kind: 'forged_recovery_kind',
        localHeadOid: 'a'.repeat(40),
        conflictingFiles: ['src/index.ts'],
      },
    }))

    expect(restoreWorktreeRecovery({
      sessionId: 'target-session', adapter: fixture.adapter, services: client.services,
    })).toBeNull()
    expect(localStorage.getItem('dsh-git-worktree:recovery:v1:target-session')).toBeNull()
    expect(client.prompt).not.toHaveBeenCalled()
  })

  test('review regeneration remains read-only and requires the original Ready review identity', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const request = regenerationRequest()
    const ready = authorizedTarget(fixture.target, request)
    fixture.adapter.inspect = vi.fn(async () => ({ ok: true as const, value: { target: ready } }))
    const client = runtime(ready)

    enqueueWorktreeRecovery({ adapter: fixture.adapter, services: client.services, request, isActive: () => true })

    await vi.waitFor(() => expect(client.prompt).toHaveBeenCalledTimes(1))
    const prompt = buildWorktreeRecoveryPrompt(request)
    expect(prompt).toMatch(/严格 Read Only/)
    expect(prompt).toMatch(/不要修改任何文件/)
    expect(prompt).not.toMatch(/merge.*Local HEAD/)
    expect(getWorktreeRecoverySnapshot('target-session')).toMatchObject({ status: 'sent', request })
  })
})
