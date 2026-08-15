/**
 * Model-facing worktree tools. Every tool operates on the receiving agent's
 * own session through the session-checkout module; the module's revision CAS
 * guards all mutations. Outputs are canonical JSON (the UI card is a separate
 * concern); conflict results carry `localHeadOid` so the agent can sync the
 * isolated checkout to Local HEAD and resolve before retrying.
 * @module dsh-git-worktree/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionCheckoutModule } from './index.js'
import type { SessionTargetView, WorktreeValidationStatus } from './types.js'

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') {
    throw new Error('worktree 工具只能在 DSH Agent 会话中调用')
  }
  return session.id
}

function targetText(target: SessionTargetView): string {
  const lines = [
    `checkout: ${target.checkout.label} (${target.checkout.kind}, phase ${target.checkout.phase})`,
    `dirty: ${target.dirty}`,
    `current: ${target.current.branch ?? 'detached'} @ ${target.current.oid.slice(0, 7)}`,
  ]
  if (target.delivery) lines.push(`delivery: ${target.delivery.state}`)
  return lines.join('\n')
}

/** Register the seven worktree tools. */
export function registerTools(ctx: Context, module: SessionCheckoutModule): void {
  ctx.tools.register(defineTool({
    name: 'worktree_create',
    description: 'Create a Domi-grade managed git worktree for the current session: a detached checkout at the Local HEAD under <repo>/.dsh-worktrees/, registered as a DSH workspace, with the session bound to it as owner. Use it to isolate experimental or parallel work from the Local checkout.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          checkoutId: { type: 'string', required: true },
          phase: { type: 'string', required: true },
          dirty: { type: 'boolean', required: true },
          currentBranch: { type: 'string' },
          currentOid: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Worktree created: ${value.checkoutId} (${value.phase}, dirty=${value.dirty}, ${value.currentBranch ?? 'detached'} @ ${value.currentOid.slice(0, 7)})` }],
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const target = await module.bind(sessionId, { kind: 'isolated' })
      return {
        checkoutId: target.checkout.id,
        phase: target.checkout.phase,
        dirty: target.dirty,
        currentBranch: target.current.branch ?? undefined,
        currentOid: target.current.oid,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Create managed worktree', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_list',
    description: 'List every managed worktree of the current project with its checkout id, iteration, state, and dirty flag. Use the checkout id with worktree_remove or to find where a task left off.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          worktrees: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                checkoutId: { type: 'string', required: true },
                projectName: { type: 'string', required: true },
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
      render: (_args, value) => [{
        type: 'text',
        text: value.worktrees.length === 0
          ? 'No managed worktrees.'
          : value.worktrees.map((entry) => (
              `${entry.checkoutId}  ${entry.projectName}  i${entry.iteration}  ${entry.state}/${entry.phase}  dirty=${entry.dirty}${entry.commitOid ? `  commit ${entry.commitOid.slice(0, 7)}` : ''}`
            )).join('\n'),
      }],
    },
    async execute(_args, exec) {
      const summaries = await module.listManagedWorktrees()
      return {
        worktrees: summaries.map((summary) => ({
          checkoutId: summary.checkoutId,
          projectName: summary.project.name,
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
    name: 'worktree_remove',
    description: 'Remove a managed worktree by checkout id (see worktree_list). Dirty worktrees require confirmDirty: true and are still never force-removed silently — the lifecycle refuses when the worktree is the current session target.',
    parameters: {
      checkoutId: {
        type: 'string',
        required: true,
        description: 'Checkout id from worktree_list.',
      },
      confirmDirty: {
        type: 'boolean',
        required: true,
        description: 'Confirm discarding uncommitted changes inside the worktree.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          checkoutId: { type: 'string', required: true },
          discarded: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.discarded ? `Removed worktree ${value.checkoutId}.` : `Worktree ${value.checkoutId} retained (not discarded).` }],
    },
    async execute(args, exec) {
      const summaries = await module.listManagedWorktrees({ checkoutId: args.checkoutId })
      const summary = summaries[0]
      if (!summary) {
        return { checkoutId: args.checkoutId, discarded: false }
      }
      await module.manageManagedWorktree({
        checkoutId: args.checkoutId,
        expectedRevision: summary.revision,
        action: 'discard',
        confirmDirty: args.confirmDirty === true,
      })
      return { checkoutId: args.checkoutId, discarded: true }
    },
    presentCall: (args) => ({ card: 'generic', title: 'Remove managed worktree', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_ready_for_review',
    description: 'Mark the current managed worktree as ready for review: the agent submits what changed, what validation ran (tests), and a suggested commit message. After this, worktree_apply merges the changes into the Local checkout and worktree_finish commits them directly.',
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
        description: 'Suggested commit message for the change.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', required: true },
          reviewId: { type: 'string', required: true },
          changedFiles: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `Ready for review: ${value.reviewId} — ${value.changedFiles.length} file(s) changed (${value.state}).` }],
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
        state: target.delivery.state,
        reviewId: target.delivery.review.reviewId,
        changedFiles: target.delivery.review.changedFiles,
      }
    },
    presentCall: () => ({ card: 'generic', title: 'Mark worktree ready for review', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_apply',
    description: 'Merge the current managed worktree\'s changes into the Local checkout: conflict-aware, fingerprint-CAS, and Local untouched until the plan is verified. On conflict the result carries conflictingFiles and localHeadOid — sync the worktree to Local HEAD, resolve, and retry. After a successful apply the worktree stays ready_for_review; use worktree_finish to commit or worktree_discard to abandon.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['applied', 'conflict', 'error'] },
          changedFiles: { type: 'array', items: { type: 'string' } },
          conflictingFiles: { type: 'array', items: { type: 'string' } },
          localHeadOid: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.status === 'applied') {
          return [{ type: 'text', text: `Applied ${value.changedFiles?.length ?? 0} file(s) to Local.` }]
        }
        if (value.status === 'conflict') {
          return [{ type: 'text', text: `Conflict in ${value.conflictingFiles?.join(', ')} — sync worktree to Local HEAD ${value.localHeadOid?.slice(0, 7)} and resolve.` }]
        }
        return [{ type: 'text', text: value.message ?? 'Apply failed.' }]
      },
    },
    async execute(_args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const target = await module.inspect(sessionId)
      const result = await module.operate({
        action: 'apply',
        sessionId,
        expectedRevision: target.revision,
      })
      if (result.status === 'applied') {
        return { status: 'applied' as const, changedFiles: result.changedFiles }
      }
      if (result.status === 'conflict') {
        return {
          status: 'conflict' as const,
          conflictingFiles: result.conflictingFiles,
          localHeadOid: result.localHeadOid,
        }
      }
      if (result.status === 'error') {
        return { status: 'error' as const, message: `${result.code}: ${result.message}` }
      }
      return { status: 'error' as const, message: 'Apply 未返回预期结果' }
    },
    presentCall: () => ({ card: 'generic', title: 'Apply worktree to Local', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_finish',
    description: 'Commit the current managed worktree\'s changes onto the Local branch as one task commit, preserving any unrelated staged/working state the user has in Local, then clean up the worktree. Refuses when Local is detached. Optional retention keeps the frozen worktree for a while instead of removing it.',
    parameters: {
      commitMessage: {
        type: 'string',
        required: true,
        description: 'Commit message for the task delta.',
      },
      retention: {
        type: 'string',
        enum: ['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'],
        description: 'Default cleanup removes the worktree after the commit; retain_* keeps it.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['finished', 'conflict', 'error'] },
          commitOid: { type: 'string' },
          changedFiles: { type: 'array', items: { type: 'string' } },
          cleanup: { type: 'string' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (value.status === 'finished') {
          return [{ type: 'text', text: `Finished: committed ${value.changedFiles?.length ?? 0} file(s) as ${value.commitOid?.slice(0, 7)} (cleanup: ${value.cleanup ?? 'unknown'}).` }]
        }
        return [{ type: 'text', text: value.message ?? 'Finish failed.' }]
      },
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const target = await module.inspect(sessionId)
      const result = await module.operate({
        action: 'finish',
        sessionId,
        expectedRevision: target.revision,
        commitMessage: args.commitMessage,
        ...(args.retention ? { retention: args.retention as 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual' } : {}),
      })
      if (result.status === 'finished') {
        return {
          status: 'finished' as const,
          commitOid: result.commitOid ?? undefined,
          changedFiles: result.changedFiles,
          cleanup: result.cleanup,
        }
      }
      if (result.status === 'conflict') {
        return { status: 'conflict' as const, message: `冲突：${result.conflictingFiles.join('、')} — 请先在 worktree 内同步 Local HEAD 并解决。` }
      }
      if (result.status === 'error') {
        return { status: 'error' as const, message: `${result.code}: ${result.message}` }
      }
      return { status: 'error' as const, message: 'Finish 未返回预期结果' }
    },
    presentCall: () => ({ card: 'generic', title: 'Finish worktree (commit to Local)', kind: 'other', rawInput: {} }),
  }))

  ctx.tools.register(defineTool({
    name: 'worktree_discard',
    description: 'Discard the current managed worktree and all its uncommitted changes. Requires confirmDirty: true. The worktree the current session is working inside cannot be discarded; use worktree_remove from a Local session instead.',
    parameters: {
      confirmDirty: {
        type: 'boolean',
        required: true,
        description: 'Confirm discarding uncommitted worktree changes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          status: { type: 'string', required: true, enum: ['discarded', 'error'] },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.status === 'discarded' ? 'Worktree discarded.' : (value.message ?? 'Discard failed.') }],
    },
    async execute(args, exec) {
      const sessionId = sessionIdOf(exec.agent)
      const target = await module.inspect(sessionId)
      const result = await module.operate({
        action: 'discard',
        sessionId,
        expectedRevision: target.revision,
        confirmDirty: args.confirmDirty === true,
      })
      if (result.status === 'discarded') return { status: 'discarded' as const }
      if (result.status === 'error') {
        return { status: 'error' as const, message: `${result.code}: ${result.message}` }
      }
      return { status: 'error' as const, message: 'Discard 未返回预期结果' }
    },
    presentCall: () => ({ card: 'generic', title: 'Discard worktree', kind: 'other', rawInput: {} }),
  }))
}
