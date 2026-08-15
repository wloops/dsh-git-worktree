import { describe, expect, test, vi } from 'vitest'
import { registerTools } from '../src/tools.js'
import { registerWorktreeCommand } from '../src/commands.js'
import type { SessionCheckoutModule } from '../src/index.js'
import type { SessionTargetView } from '../src/types.js'

const readyTarget: SessionTargetView = {
  project: { id: 'project-1', name: 'Project' },
  checkout: { id: 'checkout-1', kind: 'isolated', label: 'Isolated Checkout', phase: 'ready' },
  source: { ref: 'refs/heads/main', oid: 'a'.repeat(40) },
  current: { branch: null, oid: 'b'.repeat(40) },
  ownership: 'owner',
  dirty: true,
  revision: 7,
  delivery: {
    state: 'ready_for_review',
    review: {
      reviewId: 'review-1',
      iteration: 1,
      preparedAt: 1,
      summary: 'summary',
      validationStatus: 'passed',
      tests: [],
      changedFiles: ['src/index.ts'],
      suggestedCommitMessage: 'fix: exact reviewed message',
    },
  },
}

describe('public surfaces', () => {
  test('model tools expose creation, scoped listing, and Ready for Review only', () => {
    const names: string[] = []
    const ctx = { tools: { register: (tool: { name: string }) => { names.push(tool.name) } } }
    registerTools(ctx as never, {} as SessionCheckoutModule)
    expect(names).toEqual(['worktree_create', 'worktree_list', 'worktree_ready_for_review'])
  })

  test('finalize uses the persisted reviewed commit message and explicit retention', async () => {
    let command: { name: string; handler: (invocation: unknown) => Promise<unknown> } | undefined
    const operate = vi.fn(async () => ({
      status: 'finished' as const,
      target: readyTarget,
      changedFiles: ['src/index.ts'],
      commitOid: 'c'.repeat(40),
      cleanup: 'retained' as const,
    }))
    const module = {
      inspect: vi.fn(async () => readyTarget),
      operate,
    } as unknown as SessionCheckoutModule
    registerWorktreeCommand({ commands: { register: (value: typeof command) => { command = value } } } as never, module)
    if (!command) throw new Error('command was not registered')

    const result = await command.handler({
      rawInput: 'finalize review-1 7 retain_24h',
      agent: { session: { id: 'target-session' } },
    })

    expect(result).toMatchObject({ kind: 'success' })
    expect(operate).toHaveBeenCalledWith({
      action: 'finish',
      sessionId: 'target-session',
      expectedRevision: 7,
      commitMessage: 'fix: exact reviewed message',
      retention: 'retain_24h',
      expectedReviewId: 'review-1',
    })
  })
})
