import { translatorForServices } from '../i18n.js'
import { adaptHarnessInputActions } from './harness-input.js'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import { navigateToSession, type PreSessionWorktreeServices } from '../actions.js'

export interface PreSessionDraftState {
  readonly draft: string
  readonly imageIds: readonly string[]
  readonly occurrences: readonly unknown[]
  readonly phase: string
  /** Monotonic Harness input revision captured when the confirmation opened. */
  readonly draftRev?: number
}

export interface PreSessionDraftActions {
  setDraft(text: string): void
  addImages(ids: readonly string[]): boolean
  removeImage(id: string): void
}

export interface PreparePreSessionWorktreeRequest {
  sessionId: string
  /** Immutable confirmation-time snapshot moved into the target. */
  input: PreSessionDraftState
  /** Live source state used for the final compare-and-clear boundary. */
  currentInput?: () => PreSessionDraftState
  inputActions: PreSessionDraftActions
  initialCommitConfirmationToken?: string
  /** Invalidated when the composer leaves its source Session. */
  isCurrentSession?: () => boolean
}

export class PreSessionWorktreeError extends Error {
  constructor(message: string, readonly recoveryRequired = false) {
    super(message)
    this.name = 'PreSessionWorktreeError'
  }
}

function messageOf(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sourceStillMatches(request: PreparePreSessionWorktreeRequest): boolean {
  const current = request.currentInput?.() ?? request.input
  return request.isCurrentSession?.() !== false
    && current.phase === 'plain'
    && current.draft === request.input.draft
    && sameStrings(current.imageIds, request.input.imageIds)
    && current.occurrences.length === request.input.occurrences.length
    && (request.input.draftRev === undefined || current.draftRev === request.input.draftRev)
}

/**
 * Prepares an isolated blank Session before the normal Harness composer sends.
 * The controller never sends a prompt; after it opens the target, the resident
 * composer remains the sole submission path.
 */
export class PreSessionWorktreeController {
  private readonly inflight = new Map<string, Promise<WorktreeConsoleTargetDetails>>()

  constructor(
    private readonly adapter: WorktreeConsoleAdapter,
    private readonly services: PreSessionWorktreeServices,
  ) {}

  prepare(request: PreparePreSessionWorktreeRequest): Promise<WorktreeConsoleTargetDetails> {
    const existing = this.inflight.get(request.sessionId)
    if (existing !== undefined) return existing
    const attempt = this.run(request).finally(() => {
      if (this.inflight.get(request.sessionId) === attempt) this.inflight.delete(request.sessionId)
    })
    this.inflight.set(request.sessionId, attempt)
    return attempt
  }

  private async run(request: PreparePreSessionWorktreeRequest): Promise<WorktreeConsoleTargetDetails> {
    const t = translatorForServices(this.services)

    if (request.isCurrentSession?.() === false) throw new PreSessionWorktreeError(t("pre.session.changed"))
    if (request.input.phase !== 'plain') {
      throw new PreSessionWorktreeError(t("the.draft.is.being.submitted.or.parsed.wait"))
    }
    if (request.input.occurrences.length > 0) {
      throw new PreSessionWorktreeError(t("the.draft.contains.unserialized.references.remove.the.reference"))
    }
    // Abort before creating a checkout or moving draft bytes if no UI can own the target.
    if (!this.services.uiWorkspace?.openSession && !this.services.sessions.open) {
      throw new PreSessionWorktreeError(t('harness.session.navigation.unavailable'))
    }

    const previousBlock = this.services.conversation.blocks.storeFor(request.sessionId).getSnapshot()
    this.services.conversation.blocks.set(request.sessionId, { reason: t("creating.isolated.worktree") })

    let created: WorktreeConsoleCreateResponse | undefined
    let workspaceId: string | undefined
    let actualSessionId: string | undefined
    try {
      if (request.initialCommitConfirmationToken !== undefined && !this.adapter.createWithInitialCommit) {
        throw new PreSessionWorktreeError(t("pre.session.initial.unavailable"))
      }
      const outcome = request.initialCommitConfirmationToken !== undefined
        ? await this.adapter.createWithInitialCommit!({ sourceSessionId: request.sessionId, confirmationToken: request.initialCommitConfirmationToken })
        : await this.adapter.create({ sourceSessionId: request.sessionId })
      if (!outcome.ok) throw new PreSessionWorktreeError(`${outcome.error.code}: ${outcome.error.message}`)
      created = outcome.value

      const workspace = await this.services.workspaces.create({ path: created.managedRoot })
      if (workspace.path !== created.managedRoot) {
        throw new PreSessionWorktreeError(t("harness.registered.the.managed.root.at.a.different", { p0: workspace.path }))
      }
      workspaceId = workspace.workspaceId

      actualSessionId = await this.services.sessions.create({
        workspaceId: workspace.workspaceId,
        sessionId: created.targetSessionId,
      })
      if (actualSessionId !== created.targetSessionId) {
        throw new PreSessionWorktreeError(
          t("harness.created.unexpected.session.expected.2", { p0: actualSessionId, p1: created.targetSessionId }),
        )
      }

      const targetSessionId = created.targetSessionId
      const handoff = (targetBinding: ReturnType<PreSessionWorktreeServices['sessions']['binding']>): void => {
        if (targetBinding?.ctx === undefined) {
          throw new PreSessionWorktreeError(t("the.target.session.was.created.but.harness.has"))
        }
        const targetInput = adaptHarnessInputActions(this.services.conversation.input.for(targetBinding.ctx))
        if (!sourceStillMatches(request)) {
          throw new PreSessionWorktreeError(t("the.local.draft.or.attachments.changed.after.confirmation"))
        }
        // From the final source CAS through target writes, navigation and source
        // clear there is no await. A failed target archived after accepting images
        // would release browser-owned bytes that the source still references.
        targetInput.setDraft(request.input.draft)
        if (!targetInput.addImages(request.input.imageIds)) {
          throw new PreSessionWorktreeError(t("the.target.session.is.temporarily.refusing.draft.attachments"))
        }
        navigateToSession(this.services, targetSessionId)
        request.inputActions.setDraft('')
        for (const imageId of request.input.imageIds) request.inputActions.removeImage(imageId)
      }
      // create() only catalogues the identity on newer Hosts. Hold an official
      // Session reference until navigation takes mainView ownership; older Hosts
      // without using() still expose their immediately available binding.
      if (this.services.sessions.using) {
        await this.services.sessions.using(created.targetSessionId, { source: 'controllerOperation' }, reference => handoff(reference.binding))
      } else {
        handoff(this.services.sessions.binding(created.targetSessionId))
      }
      // The source is now an empty launcher. Retire it so Harness's New Session
      // reuse cannot route a concurrent task back into this reserved source.
      // A failed retirement must not roll back the already-safe target handoff:
      // the source no longer owns draft/image state and the target remains the
      // only writable Session for this task.
      try { await this.services.workspaces.archiveSession(request.sessionId) } catch { /* target handoff remains authoritative */ }
      return created.target
    } catch (error) {
      if (created !== undefined && request.initialCommitConfirmationToken !== undefined) {
        error = new PreSessionWorktreeError(t("pre.session.initial.created.failure", { p0: messageOf(error) }))
      }
      if (created !== undefined) {
        const cleaned = await this.rollback(
          request.sessionId,
          created.targetSessionId,
          created.target,
          workspaceId,
          actualSessionId,
        ).catch(() => false)
        if (!cleaned) {
          throw new PreSessionWorktreeError(
            t("the.worktree.was.persisted.but.automatic.rollback.failed", { p0: messageOf(error) }),
            true,
          )
        }
      }
      throw error
    } finally {
      this.services.conversation.blocks.set(request.sessionId, previousBlock)
    }
  }

  private async rollback(
    sourceSessionId: string,
    targetSessionId: string,
    target: WorktreeConsoleTargetDetails,
    workspaceId: string | undefined,
    actualSessionId: string | undefined,
  ): Promise<boolean> {
    if (target.checkoutId === null) return false
    let discarded = false
    for (const caller of [targetSessionId, sourceSessionId]) {
      const result = await this.adapter.discard({
        sessionId: caller,
        checkoutId: target.checkoutId,
        expectedRevision: target.revision,
        confirmDirty: false,
      })
      if (result.ok) {
        discarded = true
        break
      }
    }
    if (!discarded) return false

    const sessionToArchive = actualSessionId ?? targetSessionId
    // A dropped create response can publish the Host Session without leaving a
    // Client binding. Always attempt the idempotent archive after Discard;
    // binding absence is not proof that no Session exists.
    try { await this.services.workspaces.archiveSession(sessionToArchive) } catch { /* checkout is already discarded */ }
    if (workspaceId !== undefined) {
      try { await this.services.workspaces.delete(workspaceId) } catch { /* stale Workspace stays user-visible, never hidden */ }
    }
    return true
  }
}

export function createPreSessionWorktreeController(
  adapter: WorktreeConsoleAdapter,
  services: PreSessionWorktreeServices,
): PreSessionWorktreeController {
  return new PreSessionWorktreeController(adapter, services)
}
