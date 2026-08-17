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
    name: 'worktree_resume_revision',
    description: '当前 Isolated Session 处于尚未同步 Local 的 Ready for Review，且用户提出新的代码或文件修改时，必须先自动调用本工具使旧 Review 失效并恢复同一轮 Working，然后直接继续执行请求。纯讨论、问答或补充信息不要调用；不要要求用户点击恢复编辑，也不要先同步 Local。',
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
      const sessionId = sessionIdOf(exec.agent)
      const current = await module.inspect(sessionId)
      if (current.delivery?.state !== 'ready_for_review') {
        throw new Error(`当前 Worktree 没有可恢复的未同步 Review: ${current.delivery?.state ?? 'unknown'}`)
      }
      const target = await module.resumeRevision(
        sessionId,
        current.revision,
        current.delivery.review.reviewId,
      )
      if (target.delivery?.state !== 'working') {
        throw new Error(`Worktree 未恢复到 working 状态: ${target.delivery?.state ?? 'unknown'}`)
      }
      return {
        kind: 'worktree_revision_resumed',
        checkoutId: target.checkout.id,
        iteration: target.delivery.iteration,
        revision: target.revision,
        phase: target.checkout.phase,
        sessionId,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Resume Worktree revision', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_begin_next_iteration',
    description: '当当前 Isolated Session 已交付并完成 cleanup，而用户在同一对话中提出新的代码或文件修改时，先调用本工具安全重建同一个 immutable cwd 并进入下一轮，然后继续执行用户请求。不要改用 worktree_create；retained 或 cleanup_pending 状态不能调用。',
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
      const sessionId = sessionIdOf(exec.agent)
      const current = await module.inspect(sessionId)
      const target = await module.beginNextIteration(sessionId, current.revision)
      if (target.delivery?.state !== 'working') {
        throw new Error(`下一轮 Worktree 未进入 working 状态: ${target.delivery?.state ?? 'unknown'}`)
      }
      return {
        kind: 'worktree_next_iteration_started',
        checkoutId: target.checkout.id,
        iteration: target.delivery.iteration,
        phase: target.checkout.phase,
        currentOid: target.current.oid,
        sessionId,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Start next Worktree iteration', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_ready_for_review',
    description: 'Isolated Session 的最后一个模型动作：把完整交付报告、验证证据和建议 Commit Message 仅写入本工具参数，然后立即停止。不要在调用前后用普通回复重复完整报告；最多用一句话提示用户通过底部验收条处理。用户会显式决定是否提交或放弃，模型不得自动提交或清理。',
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
          iteration: { type: 'number', required: true },
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
        iteration: target.delivery.review.iteration,
        changedFiles: target.delivery.review.changedFiles,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Ready for Worktree review', kind: 'other', rawInput: {} }),
  }))
}
