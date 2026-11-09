import { describe, expect, test } from 'vitest'
import { DeferredWorktree } from '../src/deferred-worktree.js'

function fixture() {
  const events: any[] = []
  const session = { id: 's', get seq() { return events.length }, eventAt: (i: number) => events[i] }
  const calls: string[] = []
  let fail = false
  const launch = new DeferredWorktree({
    supported: () => true,
    append: (_session, data) => { events.push({ type: 'plugin:git-worktree/launch', data }) },
    create: async () => { calls.push('create'); if (fail) throw new Error('disk full'); return '/isolated' },
    enter: async () => { calls.push('enter') },
  })
  const agent = { id: 's', session } as any
  return { launch, agent, calls, events, fail: () => { fail = true }, recover: () => { fail = false } }
}

describe('deferred worktree execution boundary', () => {
  test('selection records intent without creating resources', () => {
    const f = fixture()
    expect(f.launch.update(f.agent, true).requested).toBe(true)
    expect(f.calls).toEqual([])
    f.launch.update(f.agent, false)
    expect(f.launch.state(f.agent).requested).toBe(false)
  })
  test('creation and directory binding precede admission and are deduplicated', async () => {
    const f = fixture()
    f.launch.update(f.agent, true)
    await Promise.all([f.launch.ensure(f.agent, new AbortController().signal), f.launch.ensure(f.agent, new AbortController().signal)])
    expect(f.calls).toEqual(['create', 'enter'])
    expect(f.launch.state(f.agent).phase).toBe('ready')
  })
  test('failure never marks ready; retry reuses intent and cannot cancel after send', async () => {
    const f = fixture()
    f.launch.update(f.agent, true)
    f.fail()
    await expect(f.launch.ensure(f.agent, new AbortController().signal)).rejects.toThrow('disk full')
    expect(f.calls).toEqual(['create'])
    expect(f.launch.state(f.agent).phase).toBe('failed')
    expect(() => f.launch.update(f.agent, false)).toThrow()
    f.recover()
    await f.launch.ensure(f.agent, new AbortController().signal)
    expect(f.calls).toEqual(['create', 'create', 'enter'])
  })
  test('durable requested/started state survives controller reload', async () => {
    const f = fixture()
    f.launch.update(f.agent, true)
    f.events.push({ type: 'turn/start' })
    expect(() => f.launch.update(f.agent, false)).toThrow()
  })
})

import { Session } from '@deepseek-ai/dsh-session'
import { mountDeferredWorktree } from '../src/deferred-worktree.js'
import type { Context } from '@deepseek-ai/cordis'

function mounted() {
  const callbacks: Record<string, Function> = {}
  const calls: string[] = []
  let cwd = '/local'
  let failing = false
  const session = Session.create('session-launch' as never)
  const agent = { id: session.id, session, inbox: { nextStep: [], remove() {} },
    runMaintenance: (task: (signal: AbortSignal) => Promise<void>) => task(new AbortController().signal),
  } as any
  const ctx = {
    get: (name: string) => name === 'workingDirectory' ? {
      get: () => cwd,
      set: async (_agent: unknown, root: string) => { calls.push('enter'); cwd = root; return root },
    } : undefined,
    on: (name: string, callback: Function) => { callbacks[name] = callback }, effect() {},
  } as unknown as Context
  const controller = mountDeferredWorktree(ctx, async () => {
    calls.push('create')
    if (failing) throw new Error('unavailable')
    return '/managed'
  })
  return { controller, callbacks, calls, agent, ctx, fail: () => { failing = true }, recover: () => { failing = false } }
}

test('real Session records replay into a new launch controller', () => {
  const f = mounted()
  f.controller.update(f.agent, true)
  const restored = mountDeferredWorktree(f.ctx, async () => '/managed')
  expect(restored.state(f.agent)).toMatchObject({ requested: true, locked: false })
})

test('pre-step holds the original message on failure until retry then admits it in isolation', async () => {
  const f = mounted()
  f.controller.update(f.agent, true)
  f.fail()
  let admitted = false
  const message = { id: 'original', content: [{ type: 'text', text: 'native attachment and text' }] }
  const next = async () => { admitted = true; return { kind: 'enter', messages: [message] } }
  const step = f.callbacks['agent/pre-step']!({ agent: f.agent, signal: new AbortController().signal }, next)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect(admitted).toBe(false)
  expect(f.controller.state(f.agent).phase).toBe('failed')
  f.recover()
  f.controller.retry(f.agent)
  expect(await step).toEqual({ kind: 'enter', messages: [message] })
  expect(f.calls).toEqual(['create', 'create', 'enter'])
})

test('inbox maintenance claims idle synchronously before asynchronous creation', async () => {
  const f = mounted()
  f.controller.update(f.agent, true)
  let held = false
  let task: Promise<void> | undefined
  f.agent.runMaintenance = (body: (signal: AbortSignal) => Promise<void>) => {
    held = true
    task = body(new AbortController().signal)
    return task
  }
  f.callbacks['agent/inbox/inserted']!({ agent: f.agent })
  expect(held).toBe(true)
  expect(f.calls).toEqual([])
  expect(() => f.controller.update(f.agent, false)).toThrow()
  await task
  expect(f.calls).toEqual(['create', 'enter'])
})
