import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import * as sessionRuntime from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import { hostMessage } from './i18n/host.js'
import type { DeferredWorktreeState } from './console-contract.js'

const RECORD = 'plugin:git-worktree/launch' as const
interface LaunchRecord { requested: boolean; started: boolean }
declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap { 'plugin:git-worktree/launch': LaunchRecord }
}
interface LaunchSession {
  id: string
  readonly seq: number
  eventAt(seq: number): { type: string; data?: unknown } | undefined
}
interface LaunchAgent { id: string; session: LaunchSession }
interface Options {
  supported(): boolean
  append(session: LaunchSession, data: LaunchRecord): void
  create(agent: LaunchAgent): Promise<string | undefined>
  enter(agent: LaunchAgent, root: string, signal: AbortSignal): Promise<void>
}

/** Durable intent belongs to the Session; a failed attempt never grants execution in Local. */
export class DeferredWorktree {
  private readonly folds = new WeakMap<LaunchSession, { seq: number; state: LaunchRecord }>()
  private readonly attempts = new Map<LaunchSession, Promise<void>>()
  private readonly errors = new WeakMap<LaunchSession, string>()
  private readonly ready = new WeakSet<LaunchSession>()
  private readonly wake = new WeakMap<LaunchSession, () => void>()
  retry(agent: LaunchAgent): void { this.wake.get(agent.session)?.() }
  constructor(private readonly options: Options) {}

  private read(session: LaunchSession): LaunchRecord {
    const previous = this.folds.get(session)
    let state: LaunchRecord = previous && previous.seq <= session.seq ? { ...previous.state } : { requested: false, started: false }
    for (let seq = previous && previous.seq <= session.seq ? previous.seq : 0; seq < session.seq; seq++) {
      const event = session.eventAt(seq)
      if (event?.type === RECORD) {
        const data = event.data as Partial<LaunchRecord> | undefined
        if (typeof data?.requested !== 'boolean' || typeof data.started !== 'boolean') {
          throw new Error('Invalid persisted Worktree launch state')
        }
        state = { requested: data.requested, started: state.started || data.started }
      }
      if (event?.type === 'turn/start' || event?.type === 'step/start') state.started = true
    }
    this.folds.set(session, { seq: session.seq, state })
    return state
  }

  state(agent: LaunchAgent): DeferredWorktreeState {
    const supported = this.options.supported() && typeof agent.session.eventAt === 'function'
    const state = typeof agent.session.eventAt === 'function' ? this.read(agent.session) : { requested: false, started: false }
    return {
      supported, requested: state.requested, locked: state.started,
      phase: this.attempts.has(agent.session) ? 'creating' : this.errors.has(agent.session) ? 'failed'
        : this.ready.has(agent.session) ? 'ready' : 'idle',
      ...(this.errors.has(agent.session) ? { error: this.errors.get(agent.session)! } : {}),
    }
  }

  update(agent: LaunchAgent, requested: boolean): DeferredWorktreeState {
    if (!this.options.supported()) throw new Error(hostMessage('deferredUnsupported'))
    const state = this.read(agent.session)
    if (state.started) throw new Error(hostMessage('deferredLocked'))
    this.options.append(agent.session, { requested, started: false })
    return this.state(agent)
  }

  lock(agent: LaunchAgent): void {
    const state = this.read(agent.session)
    if (state.requested && !state.started) this.options.append(agent.session, { requested: true, started: true })
  }

  waitForRetry(agent: LaunchAgent, signal: AbortSignal): Promise<void> {
    return new Promise(resolve => {
      const done = (): void => {
        this.wake.delete(agent.session)
        signal.removeEventListener('abort', done)
        resolve()
      }
      this.wake.set(agent.session, done)
      signal.addEventListener('abort', done, { once: true })
      if (signal.aborted) done()
    })
  }

  async ensure(agent: LaunchAgent, signal: AbortSignal): Promise<void> {
    const state = this.read(agent.session)
    if (!state.requested) return
    const running = this.attempts.get(agent.session)
    if (running) return running
    // Always revalidate the target, including after reload/cleanup. A cached
    // success must not permit the Host's missing-directory fallback to Local.
    this.lock(agent)
    const attempt = Promise.resolve().then(async () => {
      signal.throwIfAborted()
      const root = await this.options.create(agent)
      signal.throwIfAborted()
      if (root !== undefined) await this.options.enter(agent, root, signal)
      this.ready.add(agent.session)
      this.errors.delete(agent.session)
    }).catch((error: unknown) => {
      this.ready.delete(agent.session)
      this.errors.set(agent.session, error instanceof Error ? error.message : String(error))
      throw error
    }).finally(() => { this.attempts.delete(agent.session) })
    this.attempts.set(agent.session, attempt)
    return attempt
  }
}

export interface WorkingDirectoryPort {
  get(session: Session): string
  set(agent: Agent, path: string, signal?: AbortSignal): Promise<string>
}
export function workingDirectoryPort(ctx: Context): WorkingDirectoryPort | undefined {
  const value = ctx.get?.('workingDirectory') as Partial<WorkingDirectoryPort> | undefined
  return typeof value?.get === 'function' && typeof value.set === 'function' ? value as WorkingDirectoryPort : undefined
}

export function mountDeferredWorktree(ctx: Context, create: (agent: Agent) => Promise<string | undefined>): DeferredWorktree {
  const controller = new DeferredWorktree({
    supported: () => workingDirectoryPort(ctx) !== undefined && typeof sessionRuntime.appendPluginRecord === 'function',
    append: (session, data) => { sessionRuntime.appendPluginRecord(session as Session, RECORD, data) },
    create: agent => create(agent as Agent),
    enter: async (agent, root, signal) => {
      const directory = workingDirectoryPort(ctx)
      if (!directory) throw new Error(hostMessage('deferredUnsupported'))
      if (directory.get(agent.session as Session) !== root) await directory.set(agent as Agent, root, signal)
    },
  })
  const holds = new WeakSet<Session>()
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() })
  ctx.on('agent/inbox/inserted', ({ agent }) => {
    if (!controller.state(agent).requested || holds.has(agent.session)) return
    controller.lock(agent)
    holds.add(agent.session)
    let task: Promise<void>
    try { task = agent.runMaintenance(async maintenance => {
      await Promise.resolve()
      const signal = AbortSignal.any([maintenance, lifetime.signal])
      try {
        while (!signal.aborted) {
          try { await controller.ensure(agent, signal); return } catch {
            if (signal.aborted) return
            await controller.waitForRetry(agent, signal)
          }
        }
      } finally { holds.delete(agent.session) }
    }) } catch {
      // Another driver owns the Agent: pre-step remains the admission gate.
      holds.delete(agent.session)
      return
    }
    void task.catch(() => { holds.delete(agent.session) })
  })
  // The waterfall is the final admission boundary, also covering reloaded
  // pending messages. Failures retain the original decision while awaiting a
  // retry; reject is reserved for cancellation, not a lossy failure fallback.
  ctx.on('agent/pre-step', async ({ agent, signal }, next): Promise<PreStepDecision> => {
    if (!controller.state(agent).requested) return next()
    const operation = AbortSignal.any([signal, lifetime.signal])
    while (!operation.aborted) {
      try { await controller.ensure(agent, operation); break } catch {
        if (!operation.aborted) await controller.waitForRetry(agent, operation)
      }
    }
    if (operation.aborted) return { kind: 'reject' }
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const notices = agent.inbox.nextStep.filter(message => message.source.kind as string === 'working-directory')
    for (const notice of notices) agent.inbox.remove(notice.id)
    return notices.length ? { ...decision, messages: [...decision.messages, ...notices] } : decision
  })
  return controller
}
