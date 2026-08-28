// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import { describe, expect, test, vi } from 'vitest'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

interface ClientHandoff {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}

function platformRequire(nodeRequire: NodeRequire, specifier: string): unknown {
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Modal: () => null, Menu: () => null }
  if (specifier === '@deepseek-ai/dsh-client-runtime/client') return {
    defineStore: (spec: unknown) => ({ spec, create: () => ({ actions: {} }) }),
    indexSubagentDescendants: () => new Map(),
    abbreviateHomePath: (path: string) => path,
  }
  return nodeRequire(specifier)
}

function executeBundle(code: string): ClientHandoff {
  let handoff: ClientHandoff | undefined
  const window = {
    __ModuleLoader__: {
      load(value: ClientHandoff) { handoff = value },
    },
  }
  new Function('window', code)(window)
  if (handoff === undefined) throw new Error('bundle did not register a ModuleLoader handoff')
  return handoff
}

describe('built Client ModuleLoader artifact', () => {
  test('inlines strict Remote codecs instead of requiring packages absent from the browser module table', () => {
    const source = readFileSync(resolve('lib/client.js'), 'utf8')
    const required = [...new Set([...source.matchAll(/require\(["']([^"']+)["']\)/gu)].map(match => match[1]))]
    expect(required).toEqual([
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-runtime/client',
    ])
  })

  test('Given the emitted browser script When it executes Then it registers the package id and materializable exports', () => {
    const handoff = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
    expect(handoff.id).toBe('dsh-git-worktree')
    const nodeRequire = createRequire(import.meta.url)
    const clientExports = handoff.factory(specifier => platformRequire(nodeRequire, specifier))
    expect(clientExports.apply).toBeTypeOf('function')
    expect(clientExports.inject).toEqual(['slots', 'workspaces', 'sessions', 'conversation', 'connection', 'locale', 'remote'])
  })

  test('mounts the strict contribution in a real Harness Client Remote service and withdraws it with the fiber', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const gatewayPath = nodeRequire.resolve('@deepseek-ai/dsh-api-gateway/client')
    const gateway = executeBundle(readFileSync(gatewayPath, 'utf8')).factory(nodeRequire) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const worktree = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
      .factory(specifier => platformRequire(nodeRequire, specifier)) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const fixture = createWorktreeConsoleAdapterFixture()
    const expected = await fixture.adapter.current({ sessionId: 'agent-1' })
    const call = vi.fn(async () => ({ ok: true as const, value: expected }))
    const ctx = new Context()
    await ctx.plugin(TypertRegistry)
    ctx.provide('connection', { rpc: { call } } as never)
    await ctx.plugin({ inject: gateway.inject, apply: gateway.apply })
    const register = vi.fn()
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn((...args: unknown[]) => { register(...args); return () => {} }),
    } as never)
    ctx.provide('workspaces', {} as never)
    ctx.provide('sessions', {} as never)
    ctx.provide('locale', { register: vi.fn() } as never)
    ctx.provide('conversation', {
      blocks: { set() {}, storeFor: () => ({ getSnapshot: () => undefined }) },
      input: { for: () => ({ setDraft() {}, addImages: () => true, removeImage() {} }) },
    } as never)

    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    expect(ctx.worktreeConsole).toBeDefined()
    const descriptors = register.mock.calls.map(call => call[0])
    expect(descriptors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_create' }),
      expect.objectContaining({ name: 'tool.call.toolview', key: 'worktree_ready_for_review' }),
      expect.objectContaining({ name: 'conversation.session.header.actions', id: 'worktree-target' }),
      expect.objectContaining({ name: 'conversation.input.dock', id: 'worktree-review-status' }),
      expect.objectContaining({ name: 'conversation.input.left', id: 'worktree-pre-session' }),
    ]))
    expect(descriptors).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'conversation.view', id: 'worktree' }),
    ]))
    await expect(ctx.worktreeConsole.current({ sessionId: 'agent-1' })).resolves.toEqual(expected)
    expect(call).toHaveBeenCalledWith('/api', 'gitWorktree/current', { args: { agentId: 'agent-1' } }, expect.any(AbortSignal))
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeDefined()

    await fiber.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeUndefined()
    expect(document.querySelector('style[data-dsh-git-worktree]')).toBeNull()
  })
})
