import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { AgentRegistry, type Agent } from '@deepseek-ai/dsh-agent'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, it, vi } from 'vitest'
import { apply as applyTypertLoader, inject as typertLoaderInject, validateTypertManifest } from '@deepseek-ai/dsh-typert-loader'
import { WORKTREE_CONSOLE_DESCRIPTORS, WORKTREE_CONSOLE_REMOTE } from '../src/console-remote/descriptors.js'
import { TYPERT } from '../src/console-remote/typert.js'
import { WorktreeConsoleService } from '../src/console-host/service.js'
import type { WorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import { createWorktreeConsoleRemoteAdapter } from '../src/client/console-remote/adapter.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

interface ClientModuleHandoff {
  factory(require: (specifier: string) => unknown): { apply: (ctx: Context) => void; inject: string[] }
}

async function loadRemoteClientModule(): Promise<{ apply: (ctx: Context) => void; inject: string[] }> {
  let handoff: ClientModuleHandoff | undefined
  const previousWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = {
    __ModuleLoader__: { load: (value: ClientModuleHandoff) => { handoff = value } },
  }
  try {
    await import('@deepseek-ai/dsh-api-gateway/client')
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
  if (handoff === undefined) throw new Error('api-gateway client did not register a ModuleLoader handoff')
  return handoff.factory(createRequire(import.meta.url))
}

const METHODS = [
  'current',
  'list',
  'create',
  'inspect',
  'reviewDiff',
  'preflight',
  'preview',
  'rollbackPreview',
  'discard',
  'finalize',
  'finalizePreview',
  'setRetention',
  'retryCleanup',
]

describe('manual strict Worktree Console Remote contribution', () => {
  it('shares one strict descriptor set between Host and Client artifacts', () => {
    expect(validateTypertManifest('dsh-git-worktree', TYPERT)).toBe(TYPERT)
    expect(TYPERT.invocations).toBe(WORKTREE_CONSOLE_DESCRIPTORS)
    expect(WORKTREE_CONSOLE_REMOTE.descriptors).toBe(WORKTREE_CONSOLE_DESCRIPTORS)
    expect(WORKTREE_CONSOLE_DESCRIPTORS.map((descriptor) => descriptor.method)).toEqual(METHODS)
    for (const descriptor of WORKTREE_CONSOLE_DESCRIPTORS) {
      expect(descriptor.namespace).toBe('gitWorktree')
      expect(descriptor.service).toBe('gitWorktree')
      expect(descriptor.result.mode).toBe('strict')
      expect(descriptor.parameters[0]).toMatchObject({
        name: 'agent',
        wire: 'agentId',
        source: 'lookup',
        lookup: 'agent',
      })
      expect(descriptor.parameters.every((parameter) => parameter.codec.mode === 'strict')).toBe(true)
    }
  })

  it('fails malformed wire input and business output closed at the shared Zod boundary', () => {
    const inspect = WORKTREE_CONSOLE_DESCRIPTORS.find((descriptor) => descriptor.method === 'inspect')!
    expect(() => inspect.parameters[0]!.codec.mode === 'strict'
      && inspect.parameters[0]!.codec.schema.parse('')).toThrow()
    expect(() => inspect.parameters[1]!.codec.mode === 'strict'
      && inspect.parameters[1]!.codec.schema.parse('../checkout')).toThrow()
    expect(() => inspect.result.mode === 'strict'
      && inspect.result.schema.parse({ ok: true, value: { target: { managedRoot: 42 } } })).toThrow()
    const finalize = WORKTREE_CONSOLE_DESCRIPTORS.find((descriptor) => descriptor.method === 'finalize')!
    const commitMessage = finalize.parameters.find(parameter => parameter.name === 'commitMessage')!
    expect(() => commitMessage.codec.mode === 'strict' && commitMessage.codec.schema.parse('   ')).toThrow()
    expect(() => commitMessage.codec.mode === 'strict' && commitMessage.codec.schema.parse('x'.repeat(501))).toThrow()
  })

  it('is automatically discovered from the package ./typert export by the official Loader', async () => {
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(resolve('package.json')).href
    await ctx.plugin(TypertRegistry)
    ctx.provide('loader', {
      *entries() {
        yield { options: { name: 'dsh-git-worktree' }, fiber: {}, disabled: false }
      },
    } as never)
    const loader = ctx.plugin({ inject: typertLoaderInject, apply: applyTypertLoader }, { packages: [] })
    await loader

    expect(ctx.typert.local.list().map(descriptor => descriptor.method)).toEqual(METHODS)
    await loader.dispose()
    expect(ctx.typert.local.list()).toEqual([])
  })

  it('registers the Host manifest and resolves the official agent lookup before dispatch', async () => {
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    const agents = new AgentRegistry(ctx)
    const agent = {
      id: 'agent-1', session: { id: 'agent-1' }, ctx, options: {}, status: 'idle', inbox: {},
      cancel: () => undefined, whenIdle: async () => undefined, runMaintenance: async () => undefined,
      send: () => undefined, followup: () => undefined,
    } as unknown as Agent
    agents.register(agent)
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const control = {
      current: vi.fn(async (sessionId: string) => {
        expect(sessionId).toBe('agent-1')
        return expected
      }),
    } as unknown as WorktreeConsoleControlPlane
    new WorktreeConsoleService(ctx, control)
    new TypertGatewayService(ctx)
    ctx.typert.register(TYPERT)

    await expect(ctx.typertGateway.invoke({ namespace: 'gitWorktree', method: 'current', args: { agentId: 'agent-1' } }))
      .resolves.toEqual(expected)
    await expect(ctx.typertGateway.invoke({ namespace: 'gitWorktree', method: 'current', args: { agentId: 'missing-agent' } }))
      .rejects.toThrow('did not resolve the requested identity')
    expect(control.current).toHaveBeenCalledTimes(1)
  })

  it('roundtrips Client $mount through the Host registry, Gateway, and official agent lookup, then withdraws', async () => {
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const host = new Context()
    await host.plugin(TypertRegistry)
    const agents = new AgentRegistry(host)
    agents.register({
      id: 'agent-1', session: { id: 'agent-1' }, ctx: host, options: {}, status: 'idle', inbox: {},
      cancel: () => undefined, whenIdle: async () => undefined, runMaintenance: async () => undefined,
      send: () => undefined, followup: () => undefined,
    } as unknown as Agent)
    const { managedRoot: _managedRoot, sourceOid: _sourceOid, currentBranch: _currentBranch, ...summary } = fixture.target
    const listed = { ok: true as const, value: { project: fixture.target.project, worktrees: [summary] } }
    const control = {
      current: vi.fn(async () => expected),
      list: vi.fn(async () => listed),
    } as unknown as WorktreeConsoleControlPlane
    new WorktreeConsoleService(host, control)
    new TypertGatewayService(host)
    host.typert.register(TYPERT)

    const call = vi.fn(async (_channel: string, endpoint: string, payload: { args: Record<string, unknown> }) => {
      const [namespace, method] = endpoint.split('/') as [string, string]
      try {
        return { ok: true as const, value: await host.typertGateway.invoke({ namespace, method, args: payload.args }) }
      } catch (error) {
        return { ok: false as const, error: { code: 'internal', message: String(error), details: {} } }
      }
    })
    const client = new Context()
    await client.plugin(TypertRegistry)
    client.provide('connection', { rpc: { call } } as never)
    const remoteClient = await loadRemoteClientModule()
    await client.plugin({ inject: remoteClient.inject, apply: remoteClient.apply })

    const dispose = await client.remote.$mount(WORKTREE_CONSOLE_REMOTE)
    const retained = client.remote.gitWorktree.current
    await expect(client.remote.gitWorktree.current('agent-1')).resolves.toEqual({ ok: true, value: expected })
    expect(call).toHaveBeenCalledWith('/api', 'gitWorktree/current', { args: { agentId: 'agent-1' } }, expect.any(AbortSignal))
    expect(control.current).toHaveBeenCalledWith('agent-1')
    await expect(client.remote.gitWorktree.list('agent-1', undefined, undefined)).resolves.toEqual({ ok: true, value: listed })
    expect(call).toHaveBeenLastCalledWith('/api', 'gitWorktree/list', { args: { agentId: 'agent-1' } }, expect.any(AbortSignal))
    expect(control.list).toHaveBeenCalledWith({ sessionId: 'agent-1', needsAttention: undefined, includeDelivered: undefined })

    await dispose()
    expect((client.remote as unknown as Record<string, unknown>).gitWorktree).toBeUndefined()
    await expect(retained('agent-1')).resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('keeps business errors distinct from carrier and malformed response failures', async () => {
    const business = { ok: false as const, error: { code: 'not_owner' as const, message: 'denied' } }
    const current = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: business })
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'carrier offline', details: {} } })
      .mockResolvedValueOnce({ ok: true, value: { ok: true, value: { target: { managedRoot: 42 } } } })
    const adapter = createWorktreeConsoleRemoteAdapter({ current } as never)

    await expect(adapter.current({ sessionId: 'agent-1' })).resolves.toEqual(business)
    await expect(adapter.current({ sessionId: 'agent-1' })).resolves.toEqual({
      ok: false, error: { code: 'transport_unavailable', message: 'carrier offline' },
    })
    await expect(adapter.current({ sessionId: 'agent-1' })).resolves.toEqual({
      ok: false,
      error: { code: 'malformed_response', message: 'Remote current 返回了不符合 strict contract 的 payload' },
    })

    const malformedInputAdapter = createWorktreeConsoleRemoteAdapter({
      inspect: vi.fn().mockRejectedValue(new Error('client api: gitWorktree/inspect rejected "checkoutId"')),
    } as never)
    await expect(malformedInputAdapter.inspect({ sessionId: 'agent-1', checkoutId: '../escape' })).resolves.toEqual({
      ok: false,
      error: { code: 'malformed_response', message: 'Remote inspect 返回了不符合 strict contract 的 payload' },
    })
  })
})
