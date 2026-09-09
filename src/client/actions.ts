import { translatorForServices } from './i18n.js'
/** Browser-side orchestration over Harness Workspace and Session runtime faces. */

import type { WorktreeConsoleAdapter } from '../console-contract.js'

export interface IsolatedTargetLocation {
  managedRoot: string
  targetSessionId: string
}

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ClientSessionSnapshot {
  running: boolean
  openState: 'cold' | 'loading' | 'open' | 'error'
  removed: boolean
}

export interface ClientSessionBinding {
  /** Agent-scoped Client Context; present on real Harness bindings. */
  ctx?: unknown
  session: {
    readonly sessionId?: string
    getSnapshot?(): ClientSessionSnapshot
    subscribe?(listener: () => void): () => void
    prompt?(
      content: Array<{ type: 'text'; text: string }>,
      mode: 'queue' | 'steer',
      signal?: AbortSignal,
    ): Promise<
      | { ok: true; value: { accepted: true } }
      | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
    >
    command(line: string): Promise<
      | { ok: true; value: { matched: boolean } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
}

export interface ClientSessions {
  list: SnapshotStore<{
    current?: string
    ids: string[]
    byId: Record<string, { cwd?: string } | undefined>
  }>
  /** Harness resolves only after the new Session is projected into list/binding. */
  create(input: { workspaceId: string; sessionId: string }): Promise<string>
  open(sessionId: string): void
  binding(sessionId: string): ClientSessionBinding | undefined
}

export interface ClientWorkspaces {
  create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
  openPath(path: string): Promise<void>
}

export interface WorktreeClientServices {
  locale?: unknown
  sessions: ClientSessions
  workspaces: ClientWorkspaces
  /** Optional public composer face used only by manual draft-prefill actions. */
  conversation?: {
    input: {
      for(ctx: unknown): PreSessionInput
    }
  }
}

export interface PreSessionInput {
  setDraft(text: string): void
  addImages(ids: readonly string[]): boolean
  removeImage(id: string): void
}

/** Additional public Harness faces used only by the blank-session preparation flow. */
export interface PreSessionWorktreeServices extends WorktreeClientServices {
  sessions: ClientSessions
  workspaces: ClientWorkspaces & {
    archiveSession(sessionId: string): Promise<void>
    delete(workspaceId: string): Promise<void>
  }
  conversation: {
    input: {
      for(ctx: unknown): PreSessionInput
    }
    blocks: {
      set(sessionId: string, block: { reason: string } | undefined): void
      storeFor(sessionId: string): { getSnapshot(): { reason: string } | undefined }
    }
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[A-Za-z]:\//u.test(normalizedLeft) || /^[A-Za-z]:\//u.test(normalizedRight)
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** Open a Session only when the Harness list proves both its identity and cwd. */
export function openExistingSession(
  services: Pick<WorktreeClientServices, 'sessions' | 'locale'>,
  sessionId: string,
  expectedCwd: string,
): boolean {
  const summary = services.sessions.list.getSnapshot().byId[sessionId]
  if (summary?.cwd === undefined || !samePath(summary.cwd, expectedCwd)) return false
  services.sessions.open(sessionId)
  return true
}

async function waitForProjectedSessionPath(
  services: Pick<WorktreeClientServices, 'sessions' | 'locale'>,
  sessionId: string,
  expectedCwd: string,
  isActive: () => boolean,
): Promise<boolean> {
  const t = translatorForServices(services)

  return new Promise<boolean>((resolvePromise, rejectPromise) => {
    let settled = false
    let unsubscribe: () => void = () => {}
    const settle = (result: boolean, error?: Error): void => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      unsubscribe()
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const inspect = (): void => {
      if (!isActive()) {
        settle(false)
        return
      }
      const summary = services.sessions.list.getSnapshot().byId[sessionId]
      if (summary?.cwd === undefined) return
      if (!samePath(summary.cwd, expectedCwd)) {
        settle(false, new Error(t("the.cwd.of.new.harness.session.does.not", { p0: sessionId })))
        return
      }
      settle(true)
    }
    const timer = globalThis.setTimeout(() => {
      settle(false, new Error(t("harness.has.not.projected.a.trusted.cwd.for", { p0: sessionId })))
    }, 2_000)
    const dispose = services.sessions.list.subscribe(inspect)
    unsubscribe = dispose
    if (settled) dispose()
    else inspect()
  })
}

/** Idempotently register the managed root, create the preallocated Session, and navigate. */
export async function openIsolatedTarget(
  services: WorktreeClientServices,
  payload: IsolatedTargetLocation,
  isActive: () => boolean = () => true,
): Promise<void> {
  const t = translatorForServices(services)

  if (!isActive()) return
  const existing = services.sessions.list.getSnapshot().byId[payload.targetSessionId]
  if (existing !== undefined) {
    if (!isActive()) return
    if (!openExistingSession(services, payload.targetSessionId, payload.managedRoot)) {
      throw new Error(t("the.cwd.of.existing.harness.session.does.not", { p0: payload.targetSessionId }))
    }
    return
  }
  const workspace = await services.workspaces.create({ path: payload.managedRoot })
  if (!isActive()) return
  if (workspace.path !== payload.managedRoot) {
    throw new Error(t("the.working.directory.registered.by.harness.does.not", { p0: workspace.path }))
  }
  const sessionId = await services.sessions.create({
    workspaceId: workspace.workspaceId,
    sessionId: payload.targetSessionId,
  })
  if (sessionId !== payload.targetSessionId) {
    throw new Error(t("harness.created.unexpected.session.expected", { p0: sessionId, p1: payload.targetSessionId }))
  }
  if (!await waitForProjectedSessionPath(services, sessionId, payload.managedRoot, isActive)) return
  if (!isActive()) return
  services.sessions.open(sessionId)
}

/**
 * Inspect a path-free Host authorization, verify exact checkout/owner identity,
 * then reuse the cwd-validated Session navigation path.
 */
export async function openAuthorizedWorktreeTarget(
  adapter: Pick<WorktreeConsoleAdapter, 'inspect'>,
  services: WorktreeClientServices,
  callerSessionId: string,
  expected: { checkoutId: string; ownerSessionId: string },
  isActive: () => boolean = () => true,
): Promise<void> {
  const t = translatorForServices(services)

  const outcome = await adapter.inspect({ sessionId: callerSessionId, checkoutId: expected.checkoutId })
  if (!isActive()) return
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  const target = outcome.value.target
  if (!target.capabilities.inspect || !target.capabilities.open) {
    throw new Error(t("the.latest.host.state.no.longer.permits.opening"))
  }
  if (
    target.checkoutId !== expected.checkoutId
    || target.ownerSessionId !== expected.ownerSessionId
    || target.targetSessionId !== expected.ownerSessionId
  ) throw new Error(t("the.worktree.identity.returned.by.host.inspection.does"))
  if (target.managedRoot === null) throw new Error(t("host.did.not.provide.a.verifiable.worktree.path"))
  if (!isActive()) return
  await openIsolatedTarget(services, {
    managedRoot: target.managedRoot,
    targetSessionId: expected.ownerSessionId,
  }, isActive)
}

/** Prefill a visible recovery request. This never invokes command/send/followup. */
export function prefillSessionDraft(
  services: WorktreeClientServices,
  sessionId: string,
  text: string,
): boolean {
  const binding = services.sessions.binding(sessionId)
  if (binding?.ctx === undefined || services.conversation === undefined) return false
  services.conversation.input.for(binding.ctx).setDraft(text)
  return true
}

/** Submit an exact review-card acceptance as an explicit user command. */
export async function finalizeCurrentSession(
  services: Pick<WorktreeClientServices, 'sessions' | 'locale'>,
  reviewId: string,
  revision: number,
  retention: 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual',
): Promise<void> {
  const t = translatorForServices(services)

  const sessionId = services.sessions.list.getSnapshot().current
  if (!sessionId) throw new Error(t("no.session.is.currently.selected"))
  const binding = services.sessions.binding(sessionId)
  if (!binding) throw new Error(t("the.current.session.is.not.ready"))
  const result = await binding.session.command(`/worktree finalize ${reviewId} ${revision} ${retention}`)
  if (!result.ok) throw new Error(t("finalize.command.failed", { p0: result.error.code, p1: result.error.message }))
  if (!result.value.matched) throw new Error(t("host.did.not.recognize.the.worktree.command"))
}
