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
  test('Given the emitted browser script When it executes Then it registers the package id and materializable exports', () => {
    const handoff = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8'))
    expect(handoff.id).toBe('dsh-git-worktree')
    const nodeRequire = createRequire(import.meta.url)
    const clientExports = handoff.factory((specifier) => nodeRequire(specifier))
    expect(clientExports.apply).toBeTypeOf('function')
    expect(clientExports.inject).toEqual(['slots', 'workspaces', 'sessions', 'remote'])
  })

  test('mounts the strict contribution in a real Harness Client Remote service and withdraws it with the fiber', async () => {
    const nodeRequire = createRequire(import.meta.url)
    const gatewayPath = nodeRequire.resolve('@deepseek-ai/dsh-api-gateway/client')
    const gateway = executeBundle(readFileSync(gatewayPath, 'utf8')).factory(nodeRequire) as {
      apply(ctx: Context): void
      inject: string[]
    }
    const worktree = executeBundle(readFileSync(resolve('lib/client.js'), 'utf8')).factory(nodeRequire) as {
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
    ctx.provide('slots', {
      inject(_name: string, callback: () => unknown) { callback() },
      register: vi.fn(),
    } as never)
    ctx.provide('workspaces', {} as never)
    ctx.provide('sessions', {} as never)

    const fiber = ctx.plugin({ inject: worktree.inject, apply: worktree.apply })
    await fiber
    expect(ctx.worktreeConsole).toBeDefined()
    await expect(ctx.worktreeConsole.current({ sessionId: 'agent-1' })).resolves.toEqual(expected)
    expect(call).toHaveBeenCalledWith('/api', 'gitWorktree/current', { args: { agentId: 'agent-1' } }, expect.any(AbortSignal))
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeDefined()

    await fiber.dispose()
    expect((ctx.remote as unknown as Record<string, unknown>).gitWorktree).toBeUndefined()
    expect(document.querySelector('style[data-dsh-git-worktree]')).toBeNull()
  })
})
