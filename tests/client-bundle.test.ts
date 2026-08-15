import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

interface ClientHandoff {
  id: string
  factory(require: (specifier: string) => unknown): Record<string, unknown>
}

describe('built Client ModuleLoader artifact', () => {
  test('Given the emitted browser script When it executes Then it registers the package id and materializable exports', () => {
    const code = readFileSync(resolve('lib/client.js'), 'utf8')
    let handoff: ClientHandoff | undefined
    const window = {
      __ModuleLoader__: {
        load(value: ClientHandoff) { handoff = value },
      },
    }

    new Function('window', code)(window)

    expect(handoff).toBeDefined()
    expect(handoff!.id).toBe('dsh-git-worktree')
    const nodeRequire = createRequire(import.meta.url)
    const clientExports = handoff!.factory((specifier) => nodeRequire(specifier))
    expect(clientExports.apply).toBeTypeOf('function')
    expect(clientExports.inject).toEqual(['slots', 'workspaces', 'sessions'])
  })
})
