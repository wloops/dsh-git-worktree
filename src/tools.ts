/**
 * Model-facing worktree tools. Destructive delivery actions are deliberately
 * absent: Finish/Discard/Remove are human commands surfaced by the client
 * ToolView. The model can reserve a real target session, inspect its own
 * scoped worktrees, and stop at Ready for Review.
 * @module dsh-git-worktree/tools
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCheckoutModule } from './index.js'
import type { WorktreeValidationStatus } from './types.js'

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') {
    throw new Error('worktree 工具只能在 DSH Agent 会话中调用')
  }
  return session.id
}

/** Canonical logged payload consumed by both the model and the keyed ToolView. */
function renderJson(value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Register the safe model-facing worktree tools. */
export function registerTools(ctx: Context, module: SessionCheckoutModule): void {
  ctx.tools.register(defineTool({
    name: 'worktree_create',
    description: 'Reserve a unique managed Git worktree and a distinct owner Session ID. This does not change the current Session cwd. After the tool returns, stop modifying code in this Local Session and let the user open the isolated Session from the Worktree card.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          targetSessionId: { type: 'string', required: true },
          managedRoot: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          currentOid: { type: 'string', required: true },
          sourceSessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      const sourceSessionId = sessionIdOf(exec.agent)
      const targetSessionId = randomUUID()
      const launch = await module.createIsolatedTarget(sourceSessionId, targetSessionId)
      return {
        kind: 'worktree_target_created',
        checkoutId: launch.target.checkout.id,
        targetSessionId,
        managedRoot: launch.managedRoot,
        phase: launch.target.checkout.phase,
        currentOid: launch.target.current.oid,
        sourceSessionId,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Create isolated Session Target', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_list',
    description: 'List managed worktrees visible to the current Session. Results are scoped to the original project and to worktrees this Session owns or created.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          worktrees: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                checkoutId: { type: 'string', required: true },
                projectName: { type: 'string', required: true },
                ownerSessionId: { type: 'string', required: true },
                iteration: { type: 'number', required: true },
                state: { type: 'string', required: true },
                phase: { type: 'string', required: true },
                dirty: { type: 'boolean', required: true },
                commitOid: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const summaries = await module.listManagedWorktreesForSession(sessionId)
      return {
        kind: 'worktree_list',
        worktrees: summaries.map((summary) => ({
          checkoutId: summary.checkoutId,
          projectName: summary.project.name,
          ownerSessionId: summary.ownerSessionId,
          iteration: summary.iteration,
          state: summary.state,
          phase: summary.phase,
          dirty: summary.dirty,
          commitOid: summary.commitOid ?? undefined,
        })),
      }
    },
    presentCall: () => ({ card: 'generic', title: 'List managed worktrees', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_ready_for_review',
    description: 'Final model action for an isolated Session: persist the complete delivery report and suggested commit message, then stop. The user reviews the Worktree card and explicitly chooses Finish/retention; the model must not commit or clean up automatically.',
    parameters: {
      summary: {
        type: 'string',
        required: true,
        description: 'One-line summary of the change (max 240 chars).',
      },
      details: {
        type: 'string',
        description: 'Optional full Markdown details (max 12000 chars).',
      },
      validationStatus: {
        type: 'string',
        required: true,
        enum: ['passed', 'failed', 'partial', 'not_run'],
      },
      validationSummary: {
        type: 'string',
        description: 'Optional one-line validation outcome.',
      },
      tests: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            command: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['passed', 'failed', 'not_run'] },
            summary: { type: 'string' },
          },
        },
      },
      suggestedCommitMessage: {
        type: 'string',
        required: true,
        description: 'Suggested commit message for the human acceptance action.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          state: { type: 'string', required: true },
          reviewId: { type: 'string', required: true },
          revision: { type: 'number', required: true },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const target = await module.markReadyForReview(sessionId, {
        summary: args.summary,
        detailsMarkdown: args.details,
        validationStatus: args.validationStatus as WorktreeValidationStatus,
        validationSummary: args.validationSummary,
        tests: (args.tests ?? []).map((test) => ({
          command: test.command,
          status: test.status as 'passed' | 'failed' | 'not_run',
          ...(test.summary ? { summary: test.summary } : {}),
        })),
        suggestedCommitMessage: args.suggestedCommitMessage,
      })
      if (target.delivery?.state !== 'ready_for_review') {
        throw new Error(`worktree 未进入可验收状态: ${target.delivery?.state ?? 'unknown'}`)
      }
      return {
        kind: 'worktree_ready_for_review',
        state: target.delivery.state,
        reviewId: target.delivery.review.reviewId,
        revision: target.revision,
        changedFiles: target.delivery.review.changedFiles,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Ready for Worktree review', kind: 'other', rawInput: {} }),
  }))
}
