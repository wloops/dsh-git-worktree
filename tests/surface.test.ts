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
  test('model tools expose creation, scoped listing, same-session iteration, and a schema-valid Ready for Review result', () => {
    const tools: Array<{
      name: string
      output?: { schema?: { properties?: Record<string, { type?: string; required?: boolean }> } }
    }> = []
    const ctx = { tools: { register: (tool: (typeof tools)[number]) => { tools.push(tool) } } }
    registerTools(ctx as never, {} as SessionCheckoutModule)

    expect(tools.map(tool => tool.name)).toEqual([
      'worktree_create',
      'worktree_list',
      'worktree_resume_revision',
      'worktree_begin_next_iteration',
      'worktree_ready_for_review',
    ])
    const readyTool = tools.find(tool => tool.name === 'worktree_ready_for_review')
    expect(readyTool?.output?.schema?.properties?.iteration).toEqual({ type: 'number' })
  })

  test('resume-revision model tool automatically invalidates the current review before more file changes', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const working: SessionTargetView = {
      ...readyTarget,
      revision: 8,
      delivery: { state: 'working', iteration: 1 },
    }
    const module = {
      inspect: vi.fn(async () => readyTarget),
      resumeRevision: vi.fn(async () => working),
    } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_resume_revision')
    if (!tool) throw new Error('resume revision tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } })

    expect(module.resumeRevision).toHaveBeenCalledWith('target-session', 7, 'review-1')
    expect(result).toMatchObject({
      kind: 'worktree_revision_resumed', checkoutId: 'checkout-1', iteration: 1, revision: 8, sessionId: 'target-session',
    })
  })

  test('next-iteration model tool keeps the current Session and uses the latest delivered revision', async () => {
    const tools: Array<{ name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }> = []
    const delivered: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'discarded' },
      dirty: false,
      revision: 9,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const next: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, id: 'checkout-2' },
      dirty: false,
      revision: 11,
      delivery: { state: 'working', iteration: 2 },
    }
    const module = {
      inspect: vi.fn(async () => delivered),
      beginNextIteration: vi.fn(async () => next),
    } as unknown as SessionCheckoutModule
    registerTools({ tools: { register: (tool: typeof tools[number]) => { tools.push(tool) } } } as never, module)
    const tool = tools.find(candidate => candidate.name === 'worktree_begin_next_iteration')
    if (!tool) throw new Error('next iteration tool was not registered')

    const result = await tool.execute({}, { agent: { session: { id: 'target-session' } } })

    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', 9)
    expect(result).toMatchObject({
      kind: 'worktree_next_iteration_started', checkoutId: 'checkout-2', iteration: 2, sessionId: 'target-session',
    })
  })

  test('/worktree continue resumes an unsynced review without requiring Local Preview', async () => {
    let command: { name: string; handler: (invocation: unknown) => Promise<unknown> } | undefined
    const working: SessionTargetView = { ...readyTarget, revision: 8, delivery: { state: 'working', iteration: 1 } }
    const module = {
      inspect: vi.fn(async () => readyTarget),
      resumeRevision: vi.fn(async () => working),
    } as unknown as SessionCheckoutModule
    registerWorktreeCommand({ commands: { register: (value: typeof command) => { command = value } } } as never, module)
    if (!command) throw new Error('command was not registered')

    const result = await command.handler({ rawInput: 'continue', agent: { session: { id: 'target-session' } } })

    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('Resumed Worktree iteration 1') })
    expect(module.resumeRevision).toHaveBeenCalledWith('target-session', 7, 'review-1')
  })

  test('/worktree next starts the next iteration through the same Session revision', async () => {
    let command: { name: string; handler: (invocation: unknown) => Promise<unknown> } | undefined
    const delivered: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, phase: 'discarded' },
      revision: 9,
      delivery: { state: 'delivered', iteration: 1, commitOid: 'c'.repeat(40), deliveredAt: 2 },
    }
    const next: SessionTargetView = {
      ...readyTarget,
      checkout: { ...readyTarget.checkout, id: 'checkout-2' },
      revision: 11,
      delivery: { state: 'working', iteration: 2 },
    }
    const module = {
      inspect: vi.fn(async () => delivered),
      beginNextIteration: vi.fn(async () => next),
    } as unknown as SessionCheckoutModule
    registerWorktreeCommand({ commands: { register: (value: typeof command) => { command = value } } } as never, module)
    if (!command) throw new Error('command was not registered')

    const result = await command.handler({ rawInput: 'next', agent: { session: { id: 'target-session' } } })

    expect(result).toMatchObject({ kind: 'success', text: expect.stringContaining('iteration 2') })
    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', 9)
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
