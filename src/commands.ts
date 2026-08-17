/**
 * `/worktree` human command surface. Destructive verbs are intentionally
 * user-initiated; model tools stop at Ready for Review.
 * @module dsh-git-worktree/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-commands'
import type { SessionCheckoutModule } from './index.js'
import type { SessionTargetView, WorktreeRetentionMode } from './types.js'

function targetText(target: SessionTargetView): string {
  const lines = [
    `checkout: ${target.checkout.label} (${target.checkout.kind}, phase ${target.checkout.phase})`,
    `dirty: ${target.dirty}`,
    `current: ${target.current.branch ?? 'detached'} @ ${target.current.oid.slice(0, 7)}`,
  ]
  if (target.delivery) lines.push(`delivery: ${target.delivery.state}`)
  return lines.join('\n')
}

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') throw new Error('`/worktree` 只能在 DSH Agent 会话中使用')
  return session.id
}

const RETENTIONS = new Set<WorktreeRetentionMode>(['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'])
const USAGE = 'Usage: /worktree status | list | continue | next | finalize [<reviewId> <revision>] [cleanup|retain_24h|retain_3d|retain_manual] | finish <message> | discard | remove <checkoutId>'

function finishedText(result: Extract<Awaited<ReturnType<SessionCheckoutModule['operate']>>, { status: 'finished' }>): string {
  return `Finished: committed ${result.changedFiles.length} file(s) as ${result.commitOid?.slice(0, 7) ?? 'no-op'} (cleanup: ${result.cleanup}).`
}

/** Register the `/worktree` command. */
export function registerWorktreeCommand(ctx: Context, module: SessionCheckoutModule): void {
  ctx.commands.register({
    name: 'worktree',
    description: 'inspect and explicitly accept managed worktree delivery',
    input: { hint: 'status | list | continue | next | finalize [retention] | finish <message> | discard | remove <checkoutId>' },
    handler: async (invocation) => {
      const rawInput = invocation.rawInput.trim()
      const tokens = rawInput.split(/\s+/u).filter(Boolean)
      const verb = tokens[0] ?? 'status'
      const sessionId = sessionIdOf(invocation.agent)
      try {
        switch (verb) {
          case 'status': {
            return { kind: 'success', text: targetText(await module.inspect(sessionId)) }
          }
          case 'list': {
            const summaries = await module.listManagedWorktreesForSession(sessionId)
            if (summaries.length === 0) return { kind: 'success', text: 'No managed worktrees visible to this Session.' }
            return {
              kind: 'success',
              text: summaries.map((summary) => (
                `${summary.checkoutId}  ${summary.project.name}  i${summary.iteration}  ${summary.state}/${summary.phase}  dirty=${summary.dirty}`
              )).join('\n'),
            }
          }
          case 'continue': {
            const current = await module.inspect(sessionId)
            if (current.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: '当前 Worktree 没有尚未同步的 Ready for Review 验收稿。' }
            }
            const target = await module.resumeRevision(
              sessionId,
              current.revision,
              current.delivery.review.reviewId,
            )
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            return { kind: 'success', text: `Resumed Worktree iteration ${iteration}; Local was not modified.` }
          }
          case 'next': {
            const current = await module.inspect(sessionId)
            const target = await module.beginNextIteration(sessionId, current.revision)
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            return { kind: 'success', text: `Started Worktree iteration ${iteration} in the current Session.` }
          }
          case 'finalize': {
            const hasReviewIdentity = tokens[1] !== undefined && !RETENTIONS.has(tokens[1] as WorktreeRetentionMode)
            const expectedReviewId = hasReviewIdentity ? tokens[1] : undefined
            const parsedRevision = hasReviewIdentity ? Number(tokens[2]) : undefined
            const retention = (hasReviewIdentity ? tokens[3] : tokens[1] ?? 'cleanup') as WorktreeRetentionMode
            if (!RETENTIONS.has(retention) || (hasReviewIdentity && (!expectedReviewId || !Number.isSafeInteger(parsedRevision)))) {
              return { kind: 'error', text: USAGE }
            }
            const target = await module.inspect(sessionId)
            if (target.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: '当前 Worktree 尚未 Ready for Review，不能 finalize。' }
            }
            if (expectedReviewId && (
              target.delivery.review.reviewId !== expectedReviewId
              || target.revision !== parsedRevision
            )) {
              return { kind: 'error', text: '该验收卡已过期；请确认会话中的最新 Ready for Review 卡片。' }
            }
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: parsedRevision ?? target.revision,
              commitMessage: target.delivery.review.suggestedCommitMessage,
              retention,
              ...(expectedReviewId ? { expectedReviewId } : {}),
            })
            if (result.status === 'finished') return { kind: 'success', text: finishedText(result) }
            if (result.status === 'conflict') {
              return { kind: 'error', text: `Conflict: ${result.conflictingFiles.join('、')}\nLocal HEAD: ${result.localHeadOid.slice(0, 7)} — 在 Worktree 内同步并解决后重新 Ready。` }
            }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}` }
            return { kind: 'error', text: 'Finalize 未返回预期结果' }
          }
          case 'finish': {
            const commitMessage = rawInput.slice(verb.length).trim()
            if (!commitMessage) return { kind: 'error', text: USAGE }
            const target = await module.inspect(sessionId)
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: target.revision,
              commitMessage,
            })
            if (result.status === 'finished') return { kind: 'success', text: finishedText(result) }
            if (result.status === 'conflict') return { kind: 'error', text: `Conflict: ${result.conflictingFiles.join('、')}` }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}` }
            return { kind: 'error', text: 'Finish 未返回预期结果' }
          }
          case 'discard': {
            const target = await module.inspect(sessionId)
            const result = await module.operate({
              action: 'discard',
              sessionId,
              expectedRevision: target.revision,
              confirmDirty: true,
              ...(target.delivery?.state === 'preview_active' ? { rollbackPreview: true } : {}),
            })
            return result.status === 'discarded'
              ? { kind: 'success', text: 'Worktree discarded. This Session target is no longer available.' }
              : result.status === 'error'
                ? { kind: 'error', text: `${result.code}: ${result.message}` }
                : { kind: 'error', text: 'Discard 未返回预期结果' }
          }
          case 'remove': {
            const checkoutId = tokens[1]
            if (!checkoutId) return { kind: 'error', text: USAGE }
            const summaries = await module.listManagedWorktreesForSession(sessionId, { checkoutId })
            const summary = summaries[0]
            if (!summary) return { kind: 'error', text: `No managed worktree ${checkoutId} visible to this Session.` }
            await module.manageManagedWorktreeForSession(sessionId, {
              checkoutId,
              expectedRevision: summary.revision,
              action: 'discard',
              confirmDirty: true,
              ...(summary.state === 'preview_active' ? { rollbackPreview: true } : {}),
            })
            return { kind: 'success', text: `Removed worktree ${checkoutId}.` }
          }
          default:
            return { kind: 'error', text: `Unknown verb ${JSON.stringify(verb)}.\n${USAGE}` }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
}
