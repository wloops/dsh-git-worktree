/**
 * `/worktree` human command surface: create, list, apply, finish, discard,
 * remove. Commands run against the receiving agent's session like the tools,
 * but are user-initiated, so destructive verbs carry their own confirmation
 * semantics (dirty discard is the user's own command).
 * @module dsh-git-worktree/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import '@deepseek-ai/dsh-commands'
import type { SessionCheckoutModule } from './index.js'
import type { SessionTargetView } from './types.js'

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

const USAGE = 'Usage: /worktree create | list | apply | finish <message> | discard | remove <checkoutId>'

/** Register the `/worktree` command. */
export function registerWorktreeCommand(ctx: Context, module: SessionCheckoutModule): void {
  ctx.commands.register({
    name: 'worktree',
    description: 'manage Domi-grade git worktrees (create / list / apply / finish / discard / remove)',
    input: { hint: 'create | list | apply | finish <message> | discard | remove <checkoutId>' },
    handler: async (invocation) => {
      const tokens = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
      const verb = tokens[0] ?? 'list'
      const sessionId = sessionIdOf(invocation.agent)
      try {
        switch (verb) {
          case 'create': {
            const target = await module.bind(sessionId, { kind: 'isolated' })
            return { kind: 'success', text: `Worktree created:\n${targetText(target)}\n打开新会话并选择该工作区以在其中工作。` }
          }
          case 'list': {
            const summaries = await module.listManagedWorktrees()
            if (summaries.length === 0) return { kind: 'success', text: 'No managed worktrees.' }
            return {
              kind: 'success',
              text: summaries.map((summary) => (
                `${summary.checkoutId}  ${summary.project.name}  i${summary.iteration}  ${summary.state}/${summary.phase}  dirty=${summary.dirty}`
              )).join('\n'),
            }
          }
          case 'apply': {
            const target = await module.inspect(sessionId)
            const result = await module.operate({ action: 'apply', sessionId, expectedRevision: target.revision })
            if (result.status === 'applied') return { kind: 'success', text: `Applied ${result.changedFiles.length} file(s) to Local.` }
            if (result.status === 'conflict') {
              return { kind: 'error', text: `Conflict: ${result.conflictingFiles.join('、')}\nLocal HEAD: ${result.localHeadOid.slice(0, 7)} — 在 worktree 内同步并解决后重试。` }
            }
            if (result.status === 'error') return { kind: 'error', text: `${result.code}: ${result.message}` }
            return { kind: 'error', text: 'Apply 未返回预期结果' }
          }
          case 'finish': {
            const commitMessage = tokens.slice(1).join(' ').trim()
            if (!commitMessage) return { kind: 'error', text: USAGE }
            const target = await module.inspect(sessionId)
            const result = await module.operate({
              action: 'finish',
              sessionId,
              expectedRevision: target.revision,
              commitMessage,
            })
            if (result.status === 'finished') {
              return { kind: 'success', text: `Finished: committed ${result.changedFiles.length} file(s) as ${result.commitOid?.slice(0, 7) ?? 'no-op'} (cleanup: ${result.cleanup}).` }
            }
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
            })
            return result.status === 'discarded'
              ? { kind: 'success', text: 'Worktree discarded.' }
              : result.status === 'error'
                ? { kind: 'error', text: `${result.code}: ${result.message}` }
                : { kind: 'error', text: 'Discard 未返回预期结果' }
          }
          case 'remove': {
            const checkoutId = tokens[1]
            if (!checkoutId) return { kind: 'error', text: USAGE }
            const summaries = await module.listManagedWorktrees({ checkoutId })
            const summary = summaries[0]
            if (!summary) return { kind: 'error', text: `No managed worktree ${checkoutId}.` }
            await module.manageManagedWorktree({
              checkoutId,
              expectedRevision: summary.revision,
              action: 'discard',
              confirmDirty: true,
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
