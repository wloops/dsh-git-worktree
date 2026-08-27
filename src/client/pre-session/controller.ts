import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleTargetDetails,
} from '../../console-contract.js'
import type { PreSessionWorktreeServices } from '../actions.js'

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
  return current.phase === 'plain'
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
    if (request.input.phase !== 'plain') {
      throw new PreSessionWorktreeError('当前草稿正在提交或解析，请等待输入恢复后再创建 Worktree。')
    }
    if (request.input.occurrences.length > 0) {
      throw new PreSessionWorktreeError('草稿包含尚未序列化的引用，请先移除引用芯片或发送后再创建 Worktree。')
    }

    const previousBlock = this.services.conversation.blocks.storeFor(request.sessionId).getSnapshot()
    this.services.conversation.blocks.set(request.sessionId, { reason: '正在创建隔离 Worktree…' })

    let created: WorktreeConsoleCreateResponse | undefined
    let workspaceId: string | undefined
    let actualSessionId: string | undefined
    try {
      const outcome = await this.adapter.create({ sourceSessionId: request.sessionId })
      if (!outcome.ok) throw new PreSessionWorktreeError(`${outcome.error.code}: ${outcome.error.message}`)
      created = outcome.value

      const workspace = await this.services.workspaces.create({ path: created.managedRoot })
      if (workspace.path !== created.managedRoot) {
        throw new PreSessionWorktreeError(`Harness 将 managed root 注册到了不同路径：${workspace.path}`)
      }
      workspaceId = workspace.workspaceId

      actualSessionId = await this.services.sessions.create({
        workspaceId: workspace.workspaceId,
        sessionId: created.targetSessionId,
      })
      if (actualSessionId !== created.targetSessionId) {
        throw new PreSessionWorktreeError(
          `Harness 创建了意外的 Session ${actualSessionId}；预期 ${created.targetSessionId}。`,
        )
      }

      const targetBinding = this.services.sessions.binding(created.targetSessionId)
      if (targetBinding?.ctx === undefined) {
        throw new PreSessionWorktreeError('目标 Session 已创建，但 Harness 尚未提供可迁移草稿的 Session binding。')
      }
      const targetInput = this.services.conversation.input.for(targetBinding.ctx)
      if (!sourceStillMatches(request)) {
        throw new PreSessionWorktreeError('确认后 Local 草稿或附件发生了变化，已取消迁移以避免覆盖新的输入。')
      }
      // From the final source CAS through target writes, navigation and source
      // clear there is no await. This ordering matters for image IDs: a failed
      // target archived after accepting them would release browser-owned bytes
      // that the preserved source still references.
      targetInput.setDraft(request.input.draft)
      if (!targetInput.addImages(request.input.imageIds)) {
        throw new PreSessionWorktreeError('目标 Session 暂时拒绝接收草稿附件。')
      }
      this.services.sessions.open(created.targetSessionId)
      request.inputActions.setDraft('')
      for (const imageId of request.input.imageIds) request.inputActions.removeImage(imageId)
      // The source is now an empty launcher. Retire it so Harness's New Session
      // reuse cannot route a concurrent task back into this reserved source.
      // A failed retirement must not roll back the already-safe target handoff:
      // the source no longer owns draft/image state and the target remains the
      // only writable Session for this task.
      try { await this.services.workspaces.archiveSession(request.sessionId) } catch { /* target handoff remains authoritative */ }
      return created.target
    } catch (error) {
      if (created !== undefined) {
        const cleaned = await this.rollback(
          request.sessionId,
          created.targetSessionId,
          created.target,
          workspaceId,
          actualSessionId,
        )
        if (!cleaned) {
          throw new PreSessionWorktreeError(
            `${messageOf(error)} Worktree 已持久化但自动回滚失败，请从 Worktree Console 打开 owner Session 继续恢复。`,
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
