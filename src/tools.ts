import { hostMessage, withHostLanguage, languageForInvocation } from './i18n/host.js'
import { hostRegistrationMessage } from './i18n/host-messages.js'
/**
 * Model-facing worktree tools. Destructive delivery actions are deliberately
 * absent: Finish/Discard/Remove are human commands surfaced by the client
 * ToolView. The model can reserve a real target session, inspect its own
 * scoped worktrees, invalidate an unsynced review before further file edits,
 * safely begin a cleaned same-session iteration, and stop at Ready for Review.
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
    throw new Error(hostMessage('worktreeToolsCanOnlyBeCalledInADSH'))
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
    description: hostRegistrationMessage('reserveAUniqueManagedGitWorktreeAndADistinct'),
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
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
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
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('createIsolatedSessionTarget'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_list',
    description: hostRegistrationMessage('listManagedWorktreesVisibleToTheCurrentSessionResults'),
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
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
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
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('listManagedWorktrees'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_resume_revision',
    description: hostRegistrationMessage('whenTheCurrentIsolatedSessionIsReadyForReview'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          iteration: { type: 'number', required: true },
          revision: { type: 'number', required: true },
          phase: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        if (current.delivery?.state !== 'ready_for_review') {
          throw new Error(hostMessage('theCurrentWorktreeHasNoUnsyncedReviewToResume372', { p0: current.delivery?.state ?? 'unknown' }))
        }
        const target = await module.resumeRevision(
          sessionId,
          current.revision,
          current.delivery.review.reviewId,
        )
        if (target.delivery?.state !== 'working') {
          throw new Error(hostMessage('worktreeDidNotReturnToWorkingState', { p0: target.delivery?.state ?? 'unknown' }))
        }
        return {
          kind: 'worktree_revision_resumed',
          checkoutId: target.checkout.id,
          iteration: target.delivery.iteration,
          revision: target.revision,
          phase: target.checkout.phase,
          sessionId,
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('resumeWorktreeRevision'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_begin_next_iteration',
    description: hostRegistrationMessage('whenTheCurrentIsolatedSessionHasBeenDeliveredAnd'),
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', required: true },
          checkoutId: { type: 'string', required: true },
          iteration: { type: 'number', required: true },
          phase: { type: 'string', required: true },
          currentOid: { type: 'string', required: true },
          sessionId: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(_args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
        const sessionId = sessionIdOf(exec.agent)
        const current = await module.inspect(sessionId)
        const target = await module.beginNextIteration(sessionId, current.revision)
        if (target.delivery?.state !== 'working') {
          throw new Error(hostMessage('theNextWorktreeIterationDidNotEnterWorkingState', { p0: target.delivery?.state ?? 'unknown' }))
        }
        return {
          kind: 'worktree_next_iteration_started',
          checkoutId: target.checkout.id,
          iteration: target.delivery.iteration,
          phase: target.checkout.phase,
          currentOid: target.current.oid,
          sessionId,
        }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('startNextWorktreeIteration'), kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_ready_for_review',
    description: hostRegistrationMessage('onlyForWorktreeSessionsThatHaveAlreadySelectedAn'),
    parameters: {
      summary: {
        type: 'string',
        required: true,
        description: hostRegistrationMessage('oneLineSummaryOfTheChangeMax240Chars'),
      },
      details: {
        type: 'string',
        description: hostRegistrationMessage('optionalFullMarkdownDetailsMax12000Chars'),
      },
      validationStatus: {
        type: 'string',
        required: true,
        enum: ['passed', 'failed', 'partial', 'not_run'],
      },
      validationSummary: {
        type: 'string',
        description: hostRegistrationMessage('optionalOneLineValidationOutcome'),
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
        description: hostRegistrationMessage('suggestedCommitMessageForTheHumanAcceptanceAction'),
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
          iteration: { type: 'number', required: true },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    async execute(args, exec) {
      return withHostLanguage(languageForInvocation(exec.agent, ctx), async () => {
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
        throw new Error(hostMessage('worktreeDidNotEnterAReviewableState', { p0: target.delivery?.state ?? 'unknown' }))
      }
      return {
        kind: 'worktree_ready_for_review',
        state: target.delivery.state,
        reviewId: target.delivery.review.reviewId,
        revision: target.revision,
        iteration: target.delivery.review.iteration,
        changedFiles: target.delivery.review.changedFiles,
      }
      })
    },
    presentCall: () => ({ card: 'generic', title: hostRegistrationMessage('readyForWorktreeReview'), kind: 'other', rawInput: {} }),
  }))
}
