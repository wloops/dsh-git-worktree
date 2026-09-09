import { hostMessage, withHostLanguage, languageForInvocation } from './i18n/host.js'
import { hostRegistrationMessage } from './i18n/host-messages.js'
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
    hostMessage('checkoutPhase', { p0: target.checkout.label, p1: target.checkout.kind, p2: target.checkout.phase }),
    hostMessage('commandDirty', { value: String(target.dirty) }),
    hostMessage('commandCurrent', { branch: target.current.branch ?? hostMessage('commandDetached'), oid: target.current.oid.slice(0, 7) }),
  ]
  if (target.delivery) lines.push(hostMessage('commandDelivery', { state: target.delivery.state }))
  return lines.join('\n')
}

function sessionIdOf(agent: unknown): string {
  const session = (agent as { session?: { id: unknown } } | undefined)?.session
  if (!session || typeof session.id !== 'string') throw new Error(hostMessage('worktreeCanOnlyBeUsedInADSHAgent'))
  return session.id
}

const RETENTIONS = new Set<WorktreeRetentionMode>(['cleanup', 'retain_24h', 'retain_3d', 'retain_manual'])
const usage = () => hostMessage('usageWorktreeStatusListContinueNextFinalizeReviewIdRevision')

function finishedText(result: Extract<Awaited<ReturnType<SessionCheckoutModule['operate']>>, { status: 'finished' }>): string {
  return hostMessage('finishedCommittedFileSAsCleanup', { p0: result.changedFiles.length, p1: result.commitOid?.slice(0, 7) ?? hostMessage('commandNoOp'), p2: result.cleanup })
}

/** Register the `/worktree` command. */
export function registerWorktreeCommand(ctx: Context, module: SessionCheckoutModule): void {
  ctx.commands.register({
    name: 'worktree',
    description: hostRegistrationMessage('inspectAndExplicitlyAcceptManagedWorktreeDelivery'),
    input: { hint: hostRegistrationMessage('statusListContinueNextFinalizeRetentionFinishMessageDiscard') },
    handler: async (invocation) => withHostLanguage(languageForInvocation(invocation.agent, ctx), async () => {
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
            if (summaries.length === 0) return { kind: 'success', text: hostMessage('noManagedWorktreesVisibleToThisSession') }
            return {
              kind: 'success',
              text: summaries.map((summary) => (
                `${summary.checkoutId}  ${summary.project.name}  i${summary.iteration}  ${summary.state}/${summary.phase}  ${hostMessage('commandDirty', { value: String(summary.dirty) })}`
              )).join('\n'),
            }
          }
          case 'continue': {
            const current = await module.inspect(sessionId)
            if (current.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: hostMessage('theCurrentWorktreeHasNoUnsyncedReadyForReview') }
            }
            const target = await module.resumeRevision(
              sessionId,
              current.revision,
              current.delivery.review.reviewId,
            )
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            return { kind: 'success', text: hostMessage('resumedWorktreeIterationLocalWasNotModified', { p0: iteration }) }
          }
          case 'next': {
            const current = await module.inspect(sessionId)
            const target = await module.beginNextIteration(sessionId, current.revision)
            const iteration = target.delivery?.state === 'working' ? target.delivery.iteration : 0
            return { kind: 'success', text: hostMessage('startedWorktreeIterationInTheCurrentSession', { p0: iteration }) }
          }
          case 'finalize': {
            const hasReviewIdentity = tokens[1] !== undefined && !RETENTIONS.has(tokens[1] as WorktreeRetentionMode)
            const expectedReviewId = hasReviewIdentity ? tokens[1] : undefined
            const parsedRevision = hasReviewIdentity ? Number(tokens[2]) : undefined
            const retention = (hasReviewIdentity ? tokens[3] : tokens[1] ?? 'cleanup') as WorktreeRetentionMode
            if (!RETENTIONS.has(retention) || (hasReviewIdentity && (!expectedReviewId || !Number.isSafeInteger(parsedRevision)))) {
              return { kind: 'error', text: usage() }
            }
            const target = await module.inspect(sessionId)
            if (target.delivery?.state !== 'ready_for_review') {
              return { kind: 'error', text: hostMessage('theCurrentWorktreeIsNotReadyForReviewAnd') }
            }
            if (expectedReviewId && (
              target.delivery.review.reviewId !== expectedReviewId
              || target.revision !== parsedRevision
            )) {
              return { kind: 'error', text: hostMessage('thisReviewCardHasExpiredConfirmTheLatestReady') }
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
              return { kind: 'error', text: hostMessage('conflictNLocalHEADSyncAndResolveConflictsInWorktree', { p0: result.conflictingFiles.join('、'), p1: result.localHeadOid.slice(0, 7) }) }
            }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}` }
            return { kind: 'error', text: hostMessage('finalizeDidNotReturnTheExpectedResult') }
          }
          case 'finish': {
            const commitMessage = rawInput.slice(verb.length).trim()
            if (!commitMessage) return { kind: 'error', text: usage() }
            const target = await module.inspect(sessionId)
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: target.revision,
              commitMessage,
            })
            if (result.status === 'finished') return { kind: 'success', text: finishedText(result) }
            if (result.status === 'conflict') return { kind: 'error', text: hostMessage('commandConflict', { files: result.conflictingFiles.join('、') }) }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}` }
            return { kind: 'error', text: hostMessage('finishDidNotReturnTheExpectedResult') }
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
              ? { kind: 'success', text: hostMessage('worktreeDiscardedThisSessionTargetIsNoLongerAvailable') }
              : result.status === 'error'
                ? { kind: 'error', text: `${result.code}: ${result.message}` }
                : { kind: 'error', text: hostMessage('discardDidNotReturnTheExpectedResult') }
          }
          case 'remove': {
            const checkoutId = tokens[1]
            if (!checkoutId) return { kind: 'error', text: usage() }
            const summaries = await module.listManagedWorktreesForSession(sessionId, { checkoutId })
            const summary = summaries[0]
            if (!summary) return { kind: 'error', text: hostMessage('noManagedWorktreeVisibleToThisSession', { p0: checkoutId }) }
            await module.manageManagedWorktreeForSession(sessionId, {
              checkoutId,
              expectedRevision: summary.revision,
              action: 'discard',
              confirmDirty: true,
              ...(summary.state === 'preview_active' ? { rollbackPreview: true } : {}),
            })
            return { kind: 'success', text: hostMessage('removedWorktree', { p0: checkoutId }) }
          }
          default:
            return { kind: 'error', text: hostMessage('unknownVerb', { p0: JSON.stringify(verb), p1: usage() }) }
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    }),
  })
}
