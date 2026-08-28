import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  WorktreeConsoleBeginNextIterationRequest,
  WorktreeConsoleCreatePreviewRecoveryHandoffRequest,
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCheckpointRequest,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleDiscardRequest,
  WorktreeConsoleFinalizePreviewRequest,
  WorktreeConsoleFinalizeRequest,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListRequest,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightRequest,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreparePreviewRecoveryAnalysisRequest,
  WorktreeConsolePreviewRecoveryPreflightRequest,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsolePrepareRegenerationRequest,
  WorktreeConsolePreviewRequest,
  WorktreeConsoleResumeRevisionRequest,
  WorktreeConsoleRollbackPreviewRequest,
  WorktreeConsoleRetryCleanupRequest,
  WorktreeConsoleReviewDiffRequest,
  WorktreeConsoleReviewDiffResponse,
  WorktreeConsoleSetRetentionRequest,
  WorktreeConsoleTargetSummary,
  WorktreeConsoleDeliveryProof,
  WorktreeSidebarTaskState,
  WorktreeSidebarTopologyResponse,
} from '../console-contract.js'
import type {
  GitCheckoutSnapshot,
  ManagedCheckoutRecord,
  SessionCheckoutFilesPort,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from '../ports.js'
import type { SessionCheckoutModule } from '../index.js'
import type { SessionTargetView } from '../types.js'
import { consoleFailure, domainError, failure, outcome } from './errors.js'
import { projectDetails, projectLocal, projectRecord } from './projection.js'
import { ReviewDiffStaleError, type WorktreeReviewDiffReader } from './review-diff.js'

export interface WorktreeConsoleControlPlaneOptions {
  module: SessionCheckoutModule
  lookup: SessionCheckoutLookupPort
  files: SessionCheckoutFilesPort
  registry: SessionCheckoutRegistryPort
  git: SessionCheckoutGitPort
  reviewDiff: WorktreeReviewDiffReader
  createTargetSessionId?: () => string
}

export interface WorktreeConsoleControlPlane {
  sidebarTopology(): Promise<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>>
  current(sessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>>
  list(request: WorktreeConsoleListRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>>
  create(sourceSessionId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>>
  inspect(sessionId: string, checkoutId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>>
  reviewDiff(request: WorktreeConsoleReviewDiffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>>
  preflight(request: WorktreeConsolePreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>>
  previewRecoveryPreflight(request: WorktreeConsolePreviewRecoveryPreflightRequest): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>>
  preparePreviewRecoveryAnalysis(request: WorktreeConsolePreparePreviewRecoveryAnalysisRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  createPreviewRecoveryHandoff(request: WorktreeConsoleCreatePreviewRecoveryHandoffRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>>
  preview(request: WorktreeConsolePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  checkpoint(request: WorktreeConsoleCheckpointRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  resumeRevision(request: WorktreeConsoleResumeRevisionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  prepareReviewRegeneration(request: WorktreeConsolePrepareRegenerationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  rollbackPreview(request: WorktreeConsoleRollbackPreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  discard(request: WorktreeConsoleDiscardRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalize(request: WorktreeConsoleFinalizeRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  finalizePreview(request: WorktreeConsoleFinalizePreviewRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  setRetention(request: WorktreeConsoleSetRetentionRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  retryCleanup(request: WorktreeConsoleRetryCleanupRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
  beginNextIteration(request: WorktreeConsoleBeginNextIterationRequest): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>>
}

function recordOf(registry: SessionCheckoutRegistryPort, checkoutId: string): ManagedCheckoutRecord {
  const record = registry.read().managedCheckouts[checkoutId]
  if (record === undefined) throw domainError('checkout_missing', 'Worktree 记录不存在')
  return record
}

function sidebarTaskState(record: ManagedCheckoutRecord): WorktreeSidebarTaskState {
  if (record.phase === 'discarded') return 'discarded'
  if (record.phase === 'finalized'
    || record.phase === 'retained'
    || record.delivery.state === 'finalized'
    || record.delivery.state === 'retained'
    || record.delivery.state === 'delivered') return 'finalized'
  if (record.phase === 'recovery_required') return 'recovery_required'
  if (record.delivery.state === 'preview_detached') return 'preview_detached'
  if (record.delivery.state === 'preview_active') return 'preview_active'
  if (record.delivery.state === 'ready_for_review') return 'ready_for_review'
  return 'working'
}

function readyReview(record: ManagedCheckoutRecord) {
  if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
    throw domainError('operation_not_allowed', '当前 Worktree 尚未处于可验收状态')
  }
  return record.delivery.review
}

function previewReview(record: ManagedCheckoutRecord) {
  if (
    record.phase !== 'ready'
    || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
  ) {
    throw domainError('preview_not_active', '当前没有等待验收的 Local Preview')
  }
  return record.delivery.review
}

function safeRecoveryRequestId(value: string): boolean {
  return value.length > 0 && value.length <= 500 && !/[\0\r\n]/u.test(value)
}

function safeConflictFile(file: string): boolean {
  if (!file || file.length > 1000 || /[\0-\x1f\x7f]/u.test(file)) return false
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(file)) return false
  return !file.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')
}

function applyConflictContinuation(
  result: Extract<Awaited<ReturnType<SessionCheckoutModule['operate']>>, { status: 'conflict' }>,
  reviewId: string,
) {
  const checkoutId = result.target.checkout.id
  const revision = result.target.revision
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(result.localHeadOid)) {
    throw domainError('git_error', '冲突恢复缺少有效的 Local HEAD 身份')
  }
  const localHeadOid = result.localHeadOid
  if (result.conflictingFiles.length > 500 || !result.conflictingFiles.every(safeConflictFile)) {
    throw domainError('git_error', '冲突恢复包含不安全或越界的文件身份')
  }
  const conflictingFiles = [...result.conflictingFiles]
  return {
    kind: 'worktree_apply_conflict' as const,
    requestId: `apply-conflict:${checkoutId}:${reviewId}:${revision}:${localHeadOid}`,
    checkoutId,
    reviewId,
    revision,
    localHeadOid,
    conflictingFiles,
  }
}

function preflightFailure(view: Awaited<ReturnType<NonNullable<SessionCheckoutModule['preflight']>>> | undefined) {
  if (view === undefined) return failure<never>('git_error', '当前 SessionCheckoutModule 不支持验收预检')
  if (view.status !== 'blocked') return undefined
  const code = view.reason === 'stale_isolated' ? 'stale_isolated'
    : view.reason === 'stale_local' ? 'stale_local'
      : view.reason === 'stale_target' ? 'stale_target'
      : view.reason === 'project_acceptance_busy' ? 'project_acceptance_busy'
        : view.reason === 'not_owner' ? 'not_owner'
          : view.reason === 'not_ready_for_review' ? 'operation_not_allowed'
            : view.reason === 'checkout_unavailable' ? 'checkout_mismatch'
              : 'git_error'
  return failure<never>(code, view.message)
}

export function createWorktreeConsoleControlPlane(options: WorktreeConsoleControlPlaneOptions): WorktreeConsoleControlPlane {
  const createTargetSessionId = options.createTargetSessionId ?? randomUUID

  async function unboundLocalTarget(sessionId: string): Promise<SessionTargetView> {
    const session = options.lookup.getSession(sessionId)
    if (session === undefined) throw domainError('session_not_found', '当前 Session 不存在')
    if (session.projectId === undefined) throw domainError('project_not_found', '当前 Session 尚未关联项目')
    const project = options.lookup.getProject(session.projectId)
    if (project === undefined) throw domainError('project_not_found', '当前 Session 项目不存在')
    if (!options.files.exists(project.root)) throw domainError('project_root_missing', '当前 Session 项目目录不存在')
    const snapshot = await options.git.inspect(project.root)
    if (snapshot === null) throw domainError('not_git_repository', '当前 Session 项目不是可用的 Git Worktree')
    const status = await options.git.status(project.root)
    return {
      project: { id: project.id, name: project.name },
      checkout: { id: 'local', kind: 'local', label: 'Local', phase: 'ready' },
      source: { ref: snapshot.headRef, oid: snapshot.headOid },
      current: { branch: snapshot.branch, oid: snapshot.headOid },
      ownership: 'owner',
      dirty: status.dirty,
      revision: 0,
    }
  }

  async function callerTarget(sessionId: string): Promise<SessionTargetView> {
    try {
      return await options.module.inspect(sessionId)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'target_unselected') {
        return unboundLocalTarget(sessionId)
      }
      throw error
    }
  }

  async function verifyCallerRoot(
    sessionId: string,
    record: ManagedCheckoutRecord,
    expectedRoot: string,
  ): Promise<void> {
    const session = options.lookup.getSession(sessionId)
    const project = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
    if (project === undefined) {
      throw domainError('project_mismatch', '当前 Session Workspace 无法证明属于该 Worktree 的原始项目')
    }
    const cleanedOwnerCwd = record.ownerSessionId === sessionId
      && record.phase === 'discarded'
      && record.delivery.state === 'delivered'
      && !options.files.exists(project.root)
      && sameLocalRoot(resolve(project.root), resolve(expectedRoot))
    if (cleanedOwnerCwd) return
    if (!options.files.exists(project.root)) {
      throw domainError('project_mismatch', '当前 Session Workspace 无法证明属于该 Worktree 的原始项目')
    }
    const workspaceRoot = await options.files.canonicalize(project.root)
    if (!sameLocalRoot(workspaceRoot, expectedRoot)) {
      throw domainError('project_mismatch', '当前 Session cwd 与 Worktree 授权边界不一致')
    }
  }

  async function authorize(sessionId: string, checkoutId: string): Promise<ManagedCheckoutRecord> {
    const caller = await options.module.inspect(sessionId)
    const record = recordOf(options.registry, checkoutId)
    if (record.ownerSessionId !== sessionId && record.sourceSessionId !== sessionId) {
      throw domainError('not_owner', '当前 Session 无权访问该 Worktree')
    }
    if (record.projectId !== caller.project.id) {
      throw domainError('project_mismatch', 'Worktree 与当前 Session 项目不一致')
    }
    const expectedRoot = record.ownerSessionId === sessionId ? record.managedRoot : record.localRoot
    await verifyCallerRoot(sessionId, record, expectedRoot)
    if (record.phase !== 'discarded') {
      const visible = await options.module.listManagedWorktreesForSession(sessionId, { checkoutId })
      if (!visible.some(item => item.checkoutId === checkoutId)) {
        throw domainError('not_owner', '当前 Session 无权访问该 Worktree')
      }
    }
    return record
  }

  async function linkedReadAccess(
    sessionId: string,
    checkoutId: string,
  ): Promise<{
    record: ManagedCheckoutRecord
    linkedRead: boolean
    acceptanceAnchorCheckoutId?: string
  }> {
    const requested = recordOf(options.registry, checkoutId)
    if (requested.ownerSessionId === sessionId || requested.sourceSessionId === sessionId) {
      return { record: await authorize(sessionId, checkoutId), linkedRead: false }
    }
    const caller = await callerTarget(sessionId)
    if (caller.checkout.kind !== 'isolated') {
      throw domainError('not_owner', '当前 Session 无权访问该 Worktree')
    }
    const anchor = await authorize(sessionId, caller.checkout.id)
    const sourceSessionId = anchor.sourceSessionId ?? anchor.ownerSessionId
    const requestedSourceSessionId = requested.sourceSessionId ?? requested.ownerSessionId
    const sameLinkedGroup = requested.projectId === anchor.projectId
      && requestedSourceSessionId === sourceSessionId
      && sameLocalRoot(requested.localRoot, anchor.localRoot)
    const holder = anchor.ownerSessionId === sessionId
      && anchor.phase === 'ready'
      && anchor.delivery.state === 'ready_for_review'
      ? acceptanceHolder(anchor)
      : undefined
    const exactAcceptanceHolder = holder?.checkoutId === requested.checkoutId
      && requested.projectId === anchor.projectId
      && sameLocalRoot(requested.localRoot, anchor.localRoot)
    if (!sameLinkedGroup && !exactAcceptanceHolder) {
      throw domainError('not_owner', '当前 Session 无权访问该 Worktree')
    }
    if (!ownerSessionAvailable(requested)) {
      throw domainError('checkout_missing', '关联 Worktree 的 owner Session 不可用')
    }
    await verifyCallerRoot(requested.ownerSessionId, requested, requested.managedRoot)
    if (exactAcceptanceHolder) {
      const currentAnchor = recordOf(options.registry, anchor.checkoutId)
      const currentRequested = recordOf(options.registry, requested.checkoutId)
      const currentHolder = currentAnchor.ownerSessionId === sessionId
        && currentAnchor.phase === 'ready'
        && currentAnchor.delivery.state === 'ready_for_review'
        ? acceptanceHolder(currentAnchor)
        : undefined
      if (
        currentHolder?.checkoutId !== currentRequested.checkoutId
        || currentRequested.ownerSessionId !== requested.ownerSessionId
        || !sameLocalRoot(currentRequested.localRoot, currentAnchor.localRoot)
      ) throw domainError('not_owner', '验收槽位占用者已变化，请重新检查')
      return {
        record: currentRequested,
        linkedRead: true,
        acceptanceAnchorCheckoutId: currentAnchor.checkoutId,
      }
    }
    return { record: requested, linkedRead: true }
  }

  async function observe(record: ManagedCheckoutRecord): Promise<{
    managedRoot: string | null
    snapshot?: GitCheckoutSnapshot
    dirty?: boolean
  }> {
    if (record.phase === 'discarded') return { managedRoot: null }
    const managedRoot = await options.module.resolveManagedRoot(record.checkoutId)
    const snapshot = await options.git.inspect(managedRoot)
    if (snapshot === null) throw domainError('checkout_mismatch', 'Worktree Git 身份无法验证')
    const status = await options.git.status(managedRoot)
    return { managedRoot, snapshot, dirty: status.dirty }
  }

  function ownerSessionAvailable(record: ManagedCheckoutRecord): boolean {
    return options.lookup.getSession(record.ownerSessionId) !== undefined
  }

  function sameLocalRoot(left: string, right: string): boolean {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
  }

  function acceptanceHolder(record: ManagedCheckoutRecord): ManagedCheckoutRecord | undefined {
    return Object.values(options.registry.read().managedCheckouts).find(candidate => (
      candidate.checkoutId !== record.checkoutId
      && candidate.phase !== 'discarded'
      && sameLocalRoot(candidate.localRoot, record.localRoot)
      && (
        candidate.delivery.state === 'preview_active'
        || candidate.journal?.operation === 'preview'
        || candidate.journal?.operation === 'rollback_preview'
        || candidate.journal?.operation === 'finalize_preview'
        || candidate.journal?.operation === 'finish'
      )
    ))
  }

  function projectReviewSlot<T extends WorktreeConsoleTargetSummary>(record: ManagedCheckoutRecord, target: T): T {
    if (record.delivery.state !== 'ready_for_review') return target
    const holder = acceptanceHolder(record)
    return {
      ...target,
      reviewSlot: holder ? 'waiting' : 'available',
      ...(holder ? {
        reviewSlotOwnerSessionId: holder.ownerSessionId,
        reviewSlotHolder: {
          checkoutId: holder.checkoutId,
          ownerSessionId: holder.ownerSessionId,
          revision: holder.revision,
          state: holder.delivery.state,
        },
        capabilities: { ...target.capabilities, preview: false, checkpoint: false, finalize: false },
      } : {}),
    } as T
  }

  function deliveryProofFromTarget(target: SessionTargetView): WorktreeConsoleDeliveryProof | undefined {
    const delivery = target.delivery
    if (!delivery || !('proof' in delivery) || !delivery.proof) return undefined
    return {
      ...delivery.proof,
      changedFiles: [...delivery.proof.changedFiles],
    }
  }

  async function details(
    sessionId: string,
    checkoutId: string,
    observedDeliveryProof?: WorktreeConsoleDeliveryProof,
  ) {
    const access = await linkedReadAccess(sessionId, checkoutId)
    const observed = await observe(access.record)
    let projectedRecord = access.record
    if (access.acceptanceAnchorCheckoutId !== undefined) {
      const currentAnchor = recordOf(options.registry, access.acceptanceAnchorCheckoutId)
      const currentRequested = recordOf(options.registry, checkoutId)
      const currentHolder = currentAnchor.ownerSessionId === sessionId
        && currentAnchor.phase === 'ready'
        && currentAnchor.delivery.state === 'ready_for_review'
        ? acceptanceHolder(currentAnchor)
        : undefined
      if (
        currentHolder?.checkoutId !== currentRequested.checkoutId
        || currentRequested.ownerSessionId !== access.record.ownerSessionId
        || !sameLocalRoot(currentRequested.localRoot, currentAnchor.localRoot)
        || observed.managedRoot === null
        || !sameLocalRoot(observed.managedRoot, currentRequested.managedRoot)
      ) throw domainError('not_owner', '验收槽位占用者已变化，请重新检查')
      projectedRecord = currentRequested
    }
    return projectReviewSlot(projectedRecord, projectDetails(
      projectedRecord,
      sessionId,
      observed.managedRoot,
      observed.snapshot,
      observed.dirty,
      ownerSessionAvailable(access.record),
      access.linkedRead,
      observedDeliveryProof,
    ))
  }

  async function mutationResponse(
    sessionId: string,
    checkoutId: string,
    observedDeliveryProof?: WorktreeConsoleDeliveryProof,
  ): Promise<WorktreeConsoleMutationResponse> {
    const record = recordOf(options.registry, checkoutId)
    if (record.phase === 'discarded') {
      return {
        target: projectReviewSlot(record, projectRecord(record, sessionId, {
          ownerSessionAvailable: ownerSessionAvailable(record),
          deliveryProof: observedDeliveryProof,
        })),
      }
    }
    const observed = await observe(record)
    return {
      target: projectReviewSlot(record, projectRecord(record, sessionId, {
        ...observed,
        ownerSessionAvailable: ownerSessionAvailable(record),
        deliveryProof: observedDeliveryProof,
      })),
    }
  }

  return {
    sidebarTopology: () => outcome(async () => {
      const projects = new Map<string, {
        project: { id: string; name: string }
        tasksByOwner: Map<string, WorktreeSidebarTopologyResponse['projects'][number]['tasks'][number]>
      }>()
      for (const record of Object.values(options.registry.read().managedCheckouts)) {
        const project = projects.get(record.projectId) ?? {
          project: { id: record.projectId, name: record.projectName },
          tasksByOwner: new Map(),
        }
        const task = {
          checkoutId: record.checkoutId,
          ownerSessionId: record.ownerSessionId,
          sourceSessionId: record.sourceSessionId ?? record.ownerSessionId,
          iteration: record.delivery.state === 'working' || record.delivery.state === 'delivered'
            ? record.delivery.iteration
            : record.delivery.review.iteration,
          revision: record.revision,
          phase: record.phase,
          state: sidebarTaskState(record),
        }
        const previous = project.tasksByOwner.get(record.ownerSessionId)
        if (!previous
          || task.iteration > previous.iteration
          || (task.iteration === previous.iteration && task.revision > previous.revision)) {
          project.tasksByOwner.set(record.ownerSessionId, task)
        }
        projects.set(record.projectId, project)
      }
      return {
        projects: [...projects.values()].map(project => ({
          project: project.project,
          tasks: [...project.tasksByOwner.values()],
        })),
      }
    }),

    current: sessionId => outcome(async () => {
      const target = await callerTarget(sessionId)
      if (target.checkout.kind === 'local') return { target: projectLocal(target, sessionId) }
      return {
        target: await details(sessionId, target.checkout.id, deliveryProofFromTarget(target)),
      }
    }),

    list: request => outcome(async () => {
      const caller = await callerTarget(request.sessionId)
      let sourceSessionId = request.sessionId
      let localRoot: string | undefined
      if (caller.checkout.kind === 'isolated') {
        const anchor = await authorize(request.sessionId, caller.checkout.id)
        sourceSessionId = anchor.sourceSessionId ?? anchor.ownerSessionId
        localRoot = anchor.localRoot
      } else {
        const session = options.lookup.getSession(request.sessionId)
        const project = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
        if (project === undefined || project.id !== caller.project.id || !options.files.exists(project.root)) {
          throw domainError('project_mismatch', '当前 Session Workspace 无法证明关联 Worktree 项目')
        }
        localRoot = await options.files.canonicalize(project.root)
      }
      const active = await options.module.listManagedWorktreesForSession(sourceSessionId, {
        needsAttention: request.needsAttention,
      })
      const activeById = new Map(active.map(summary => [summary.checkoutId, summary]))
      const records = Object.values(options.registry.read().managedCheckouts)
        .filter(record => record.projectId === caller.project.id)
        .filter(record => (record.sourceSessionId ?? record.ownerSessionId) === sourceSessionId)
        .filter(record => localRoot === undefined || sameLocalRoot(record.localRoot, localRoot))
        .filter(record => request.includeDelivered === true || record.phase !== 'discarded')
        .filter(record => record.phase === 'discarded' || activeById.has(record.checkoutId))
      const worktrees = []
      for (const record of records) {
        const observed = record.phase === 'discarded' ? undefined : await observe(record)
        const linkedRead = record.ownerSessionId !== request.sessionId && record.sourceSessionId !== request.sessionId
        const projected = projectReviewSlot(record, projectRecord(record, request.sessionId, {
          ...observed,
          summary: activeById.get(record.checkoutId),
          ownerSessionAvailable: ownerSessionAvailable(record),
          linkedRead,
        }))
        if (request.needsAttention !== true || projected.state === 'cleanup_pending' || projected.state === 'recovery_required') {
          worktrees.push(projected)
        }
      }
      return { project: { ...caller.project }, worktrees }
    }),

    create: sourceSessionId => outcome(async () => {
      const targetSessionId = createTargetSessionId()
      const launch = await options.module.createIsolatedTarget(sourceSessionId, targetSessionId)
      const record = recordOf(options.registry, launch.target.checkout.id)
      const observed = await observe(record)
      if (
        record.sourceSessionId !== sourceSessionId
        || record.ownerSessionId !== targetSessionId
        || observed.managedRoot !== launch.managedRoot
      ) throw domainError('checkout_mismatch', '新建 Worktree 的 Host 身份校验失败')
      return {
        target: projectDetails(
          record,
          sourceSessionId,
          observed.managedRoot,
          observed.snapshot,
          observed.dirty,
          ownerSessionAvailable(record),
        ),
        targetSessionId,
        managedRoot: launch.managedRoot,
      }
    }),

    inspect: (sessionId, checkoutId) => outcome(async () => ({ target: await details(sessionId, checkoutId) })),

    reviewDiff: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', '只有 owner Isolated Session 可以读取验收 Diff')
        if (record.revision !== request.expectedRevision) return failure('stale_target', 'Session Target 已变化，请刷新')
        const review = readyReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', 'Review 身份已变化，请刷新')
        const before = await options.module.preflight?.(request.sessionId, request.expectedRevision)
        if (before === undefined || before.status === 'blocked') return preflightFailure(before)!
        if (before.reviewId !== review.reviewId || before.isolatedHeadOid !== review.isolatedHeadOid) {
          return failure('stale_isolated', 'Ready 后 Isolated HEAD 已变化')
        }
        const observed = await observe(record)
        const diff = await options.reviewDiff.read({
          managedRoot: observed.managedRoot!,
          baseOid: record.applyBaseOid ?? record.baseOid,
          reviewId: review.reviewId,
          revision: record.revision,
          changedFiles: review.changedFiles,
        })
        const after = await options.module.preflight?.(request.sessionId, request.expectedRevision)
        if (after === undefined || after.status === 'blocked') {
          return failure('stale_isolated', 'Ready 后 Isolated 内容已变化，Diff bytes 已丢弃')
        }
        const current = recordOf(options.registry, request.checkoutId)
        if (
          after.reviewId !== review.reviewId
          || after.isolatedHeadOid !== review.isolatedHeadOid
          || current.revision !== request.expectedRevision
          || current.delivery.state !== 'ready_for_review'
          || current.delivery.review.reviewId !== review.reviewId
          || current.delivery.review.isolatedFingerprint !== review.isolatedFingerprint
        ) return failure('stale_isolated', 'Ready 后 Isolated 内容已变化，Diff bytes 已丢弃')
        return { ok: true, value: diff }
      } catch (error) {
        if (error instanceof ReviewDiffStaleError) return failure('stale_isolated', error.message)
        return consoleFailure(error)
      }
    },

    preflight: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以执行同步预检')
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', 'Session Target 已变化，请刷新')
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', 'Review 身份已变化，请刷新')
      const preflight = await options.module.preflight?.(request.sessionId, request.expectedRevision)
      if (preflight === undefined) throw domainError('git_error', '当前 SessionCheckoutModule 不支持验收预检')
      return { preflight }
    }),

    previewRecoveryPreflight: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以检查 Preview 恢复')
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', 'Session Target 已变化，请刷新')
      if (
        record.phase !== 'ready'
        || record.delivery.state !== 'preview_detached'
        || record.delivery.review.reviewId !== request.expectedReviewId
        || record.delivery.preview.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', 'Detached Preview 身份已变化，请刷新')
      const preflight = await options.module.preflightPreviewRecovery?.(
        request.sessionId,
        request.expectedRevision,
        request.expectedReviewId,
        request.expectedPreviewId,
      )
      if (preflight === undefined) throw domainError('git_error', '当前 SessionCheckoutModule 不支持 Preview Recovery 预检')
      return { preflight }
    }),

    preparePreviewRecoveryAnalysis: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (
        record.ownerSessionId !== request.sessionId
        || request.recoveryProof.sessionId !== request.sessionId
        || request.recoveryProof.checkoutId !== request.checkoutId
        || request.recoveryProof.revision !== request.expectedRevision
        || request.recoveryProof.reviewId !== request.expectedReviewId
        || request.recoveryProof.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', 'Preview Recovery 分析身份不匹配')
      const prepared = await options.module.preparePreviewRecoveryAnalysis(
        request.sessionId,
        request.recoveryProof,
        `preview-recovery-analysis:${randomUUID()}`,
      )
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      return {
        ...response,
        recoveryContinuation: {
          kind: prepared.kind,
          requestId: prepared.requestId,
          checkoutId: request.checkoutId,
          reviewId: prepared.reviewId,
          previewId: prepared.previewId,
          revision: prepared.revision,
          generation: prepared.generation,
        },
      }
    }),

    createPreviewRecoveryHandoff: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (
        record.ownerSessionId !== request.sessionId
        || request.recoveryProof.sessionId !== request.sessionId
        || request.recoveryProof.checkoutId !== request.checkoutId
        || request.recoveryProof.revision !== request.expectedRevision
        || request.recoveryProof.reviewId !== request.expectedReviewId
        || request.recoveryProof.previewId !== request.expectedPreviewId
      ) throw domainError('stale_target', 'Preview Recovery handoff 身份不匹配')
      const targetSessionId = createTargetSessionId()
      const launch = await options.module.createPreviewRecoveryHandoff(
        request.sessionId,
        request.recoveryProof,
        targetSessionId,
        `preview-recovery-handoff:${randomUUID()}`,
      )
      const created = recordOf(options.registry, launch.target.checkout.id)
      const observed = await observe(created)
      if (
        created.ownerSessionId !== targetSessionId
        || created.recoveryContinuation?.kind !== 'worktree_preview_recovery_handoff'
        || created.recoveryContinuation.requestId !== launch.continuation.requestId
        || observed.managedRoot !== launch.managedRoot
      ) throw domainError('checkout_mismatch', 'Recovery handoff Worktree 的 Host 身份校验失败')
      return {
        target: projectDetails(
          created,
          targetSessionId,
          observed.managedRoot,
          observed.snapshot,
          observed.dirty,
          false,
        ),
        targetSessionId,
        managedRoot: launch.managedRoot,
        recoveryContinuation: {
          kind: launch.continuation.kind,
          requestId: launch.continuation.requestId,
          checkoutId: created.checkoutId,
          sourceCheckoutId: launch.continuation.sourceCheckoutId,
          reviewId: launch.continuation.reviewId,
          previewId: launch.continuation.previewId,
          revision: launch.continuation.sourceRevision,
          generation: launch.continuation.generation,
        },
      }
    }),

    checkpoint: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以保存阶段')
      const commitMessage = request.commitMessage.trim()
      if (!commitMessage || commitMessage.length > 500 || !safeRecoveryRequestId(request.requestId)) {
        throw domainError('invalid_input', 'Checkpoint Commit Message 或 requestId 无效')
      }
      const result = await options.module.operate({
        action: 'checkpoint',
        sessionId: request.sessionId,
        expectedRevision: request.expectedRevision,
        expectedReviewId: request.expectedReviewId,
        expectedGeneration: request.expectedGeneration,
        requestId: request.requestId,
        commitMessage,
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status === 'preview_detached') {
        return { ...(await mutationResponse(request.sessionId, request.checkoutId)), changedFiles: [...result.changedFiles] }
      }
      if (result.status !== 'checkpointed') throw domainError('operation_not_allowed', 'Checkpoint 返回了非预期状态')
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      if (response.target.state !== 'working' || response.target.revision !== result.target.revision) {
        throw domainError('checkout_mismatch', 'Checkpoint 后 Worktree 状态未收敛到 Working')
      }
      return { ...response, checkpoint: result.checkpoint, changedFiles: [...result.changedFiles] }
    }),

    preview: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以预览修改')
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', 'Session Target 已变化，请刷新')
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', 'Review 身份已变化，请刷新')
      const result = await options.module.operate({
        action: 'preview', sessionId: request.sessionId, expectedRevision: request.expectedRevision,
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status === 'conflict') {
        throw domainError(
          'apply_conflict',
          'Local Preview 预检发现内容冲突',
          applyConflictContinuation(result, review.reviewId),
        )
      }
      if (result.status !== 'previewed') throw domainError('operation_not_allowed', 'Preview 返回了非预期状态')
      return {
        ...(await mutationResponse(request.sessionId, request.checkoutId)),
        changedFiles: [...result.changedFiles],
      }
    }),

    resumeRevision: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以继续修改')
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', 'Session Target 已变化，请刷新')
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', 'Review 身份已变化，请刷新')
      const requestedRecovery = request.conflictContinuation
      if (requestedRecovery && (
        requestedRecovery.kind !== 'worktree_apply_conflict'
        || !safeRecoveryRequestId(requestedRecovery.requestId)
        || requestedRecovery.checkoutId !== request.checkoutId
        || requestedRecovery.reviewId !== request.expectedReviewId
        || requestedRecovery.revision !== request.expectedRevision
        || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(requestedRecovery.localHeadOid)
        || requestedRecovery.conflictingFiles.length > 500
        || !requestedRecovery.conflictingFiles.every(safeConflictFile)
      )) throw domainError('invalid_input', '冲突恢复请求身份无效')
      const recovery = requestedRecovery ? {
        kind: 'worktree_apply_conflict' as const,
        requestId: `conflict-recovery:${randomUUID()}`,
        reviewId: request.expectedReviewId,
        readyRevision: request.expectedRevision,
        localHeadOid: requestedRecovery.localHeadOid,
        conflictingFiles: [...requestedRecovery.conflictingFiles],
      } : undefined
      const target = recovery
        ? await options.module.resumeRevision(
            request.sessionId,
            request.expectedRevision,
            request.expectedReviewId,
            recovery,
          )
        : await options.module.resumeRevision(
            request.sessionId,
            request.expectedRevision,
            request.expectedReviewId,
          )
      if (target.checkout.id !== request.checkoutId || target.delivery?.state !== 'working') {
        throw domainError('checkout_mismatch', '恢复编辑后 Worktree 身份或状态不一致')
      }
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      if (!requestedRecovery) return response
      const current = recordOf(options.registry, request.checkoutId).recoveryContinuation
      if (
        !current
        || current.kind !== 'worktree_apply_conflict'
        || current.requestId !== recovery!.requestId
        || current.workingRevision !== response.target.revision
      ) throw domainError('checkout_mismatch', 'Host 未能持久化精确冲突恢复凭证')
      return {
        ...response,
        recoveryContinuation: {
          kind: current.kind,
          requestId: current.requestId,
          checkoutId: request.checkoutId,
          reviewId: current.reviewId,
          revision: current.workingRevision,
          localHeadOid: current.localHeadOid,
          conflictingFiles: [...current.conflictingFiles],
        },
      }
    }),

    prepareReviewRegeneration: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以请求重新生成验收结果')
      if (record.revision !== request.expectedRevision) throw domainError('stale_target', 'Session Target 已变化，请刷新')
      const review = readyReview(record)
      if (review.reviewId !== request.expectedReviewId) throw domainError('stale_target', 'Review 身份已变化，请刷新')
      const prepared = await options.module.prepareReviewRegeneration(
        request.sessionId,
        request.expectedRevision,
        request.expectedReviewId,
        `review-regeneration:${randomUUID()}`,
      )
      const response = await mutationResponse(request.sessionId, request.checkoutId)
      return {
        ...response,
        recoveryContinuation: {
          kind: prepared.kind,
          requestId: prepared.requestId,
          checkoutId: request.checkoutId,
          reviewId: prepared.reviewId,
          revision: prepared.revision,
        },
      }
    }),

    rollbackPreview: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId) throw domainError('not_owner', '只有 owner Isolated Session 可以撤回 Local Preview')
      const result = await options.module.operate({
        action: 'rollback_preview',
        sessionId: request.sessionId,
        expectedRevision: request.expectedRevision,
        ...(request.resumeRevision === undefined ? {} : { resumeRevision: request.resumeRevision }),
        ...(request.recoveryProof === undefined ? {} : { recoveryProof: request.recoveryProof }),
      })
      if (result.status === 'error') throw domainError(result.code, result.message)
      if (result.status !== 'preview_rolled_back' && result.status !== 'preview_detached') {
        throw domainError('operation_not_allowed', 'Rollback Preview 返回了非预期状态')
      }
      return {
        ...(await mutationResponse(request.sessionId, request.checkoutId)),
        changedFiles: [...result.changedFiles],
      }
    }),

    discard: request => outcome(async () => {
      const record = await authorize(request.sessionId, request.checkoutId)
      if (record.ownerSessionId !== request.sessionId && ownerSessionAvailable(record)) {
        throw domainError('not_owner', 'Owner Session 已接管该 Worktree，只有 owner 可以 Discard')
      }
      if (record.ownerSessionId === request.sessionId) {
        const result = await options.module.operate({
          action: 'discard',
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          confirmDirty: request.confirmDirty,
          ...(request.rollbackPreview === undefined ? {} : { rollbackPreview: request.rollbackPreview }),
        })
        if (result.status === 'error') throw domainError(result.code, result.message)
        if (result.status === 'preview_detached') {
          return { ...(await mutationResponse(request.sessionId, request.checkoutId)), changedFiles: [...result.changedFiles] }
        }
        if (result.status !== 'discarded') throw domainError('operation_not_allowed', 'Discard 返回了非预期状态')
      } else {
        await options.module.manageManagedWorktreeForSession(request.sessionId, {
          checkoutId: request.checkoutId,
          expectedRevision: request.expectedRevision,
          action: 'discard',
          confirmDirty: request.confirmDirty,
        })
      }
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    finalize: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', '只有 owner Isolated Session 可以提交验收')
        if (record.revision !== request.expectedRevision) return failure('stale_target', 'Session Target 已变化，请刷新')
        const review = readyReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', 'Review 身份已变化，请刷新')
        const commitMessage = request.commitMessage.trim()
        if (!commitMessage || commitMessage.length > 500) return failure('invalid_input', 'Commit Message 必须为 1–500 个字符')
        const result = await options.module.operate({
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          action: 'finish',
          expectedReviewId: request.expectedReviewId,
          commitMessage,
          retention: request.retention,
        })
        if (result.status === 'error') return failure(result.code, result.message)
        if (result.status === 'conflict') {
          return failure(
            'apply_conflict',
            'Local 应用发生冲突',
            undefined,
            applyConflictContinuation(result, review.reviewId),
          )
        }
        if (result.status !== 'finished') return failure('operation_not_allowed', 'Finalize 返回了非预期状态')
        return {
          ok: true,
          value: {
            ...(await mutationResponse(
              request.sessionId,
              request.checkoutId,
              deliveryProofFromTarget(result.target),
            )),
            changedFiles: [...result.changedFiles],
            commitOid: result.commitOid,
          },
        }
      } catch (error) {
        return consoleFailure(error)
      }
    },

    finalizePreview: async request => {
      try {
        const record = await authorize(request.sessionId, request.checkoutId)
        if (record.ownerSessionId !== request.sessionId) return failure('not_owner', '只有 owner Isolated Session 可以完成 Local Preview 验收')
        if (record.revision !== request.expectedRevision) return failure('stale_target', 'Session Target 已变化，请刷新')
        const review = previewReview(record)
        if (review.reviewId !== request.expectedReviewId) return failure('stale_target', 'Review 身份已变化，请刷新')
        const commitMessage = request.commitMessage.trim()
        if (!commitMessage || commitMessage.length > 500) return failure('invalid_input', 'Commit Message 必须为 1–500 个字符')
        const result = await options.module.operate({
          action: 'finalize_preview',
          sessionId: request.sessionId,
          expectedRevision: request.expectedRevision,
          commitMessage,
          retention: request.retention,
          ...(request.recoveryProof === undefined ? {} : { recoveryProof: request.recoveryProof }),
        })
        if (result.status === 'error') return failure(result.code, result.message)
        if (result.status === 'preview_detached') {
          return {
            ok: true,
            value: {
              ...(await mutationResponse(request.sessionId, request.checkoutId)),
              changedFiles: [...result.changedFiles],
            },
          }
        }
        if (result.status !== 'finished') return failure('operation_not_allowed', 'Finalize Preview 返回了非预期状态')
        return {
          ok: true,
          value: {
            ...(await mutationResponse(
              request.sessionId,
              request.checkoutId,
              deliveryProofFromTarget(result.target),
            )),
            changedFiles: [...result.changedFiles],
            commitOid: result.commitOid,
          },
        }
      } catch (error) {
        return consoleFailure(error)
      }
    },

    setRetention: request => outcome(async () => {
      await authorize(request.sessionId, request.checkoutId)
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'set_retention',
        retention: request.retention,
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    retryCleanup: request => outcome(async () => {
      await authorize(request.sessionId, request.checkoutId)
      await options.module.manageManagedWorktreeForSession(request.sessionId, {
        checkoutId: request.checkoutId,
        expectedRevision: request.expectedRevision,
        action: 'retry_cleanup',
      })
      return mutationResponse(request.sessionId, request.checkoutId)
    }),

    beginNextIteration: request => outcome(async () => {
      const predecessor = recordOf(options.registry, request.checkoutId)
      if (predecessor.ownerSessionId !== request.sessionId) {
        throw domainError('not_owner', '只有 owner Session 可以开始下一轮')
      }
      if (predecessor.revision !== request.expectedRevision) {
        throw domainError('stale_target', 'Worktree 状态已变化，请刷新后再开始下一轮')
      }
      if (predecessor.phase !== 'discarded' || predecessor.delivery.state !== 'delivered') {
        throw domainError('operation_not_allowed', '只有已成功清理的交付状态可以开始下一轮')
      }
      const session = options.lookup.getSession(request.sessionId)
      const workspace = session?.projectId === undefined ? undefined : options.lookup.getProject(session.projectId)
      if (!workspace || !sameLocalRoot(resolve(workspace.root), resolve(predecessor.managedRoot))) {
        throw domainError('project_mismatch', '当前 Session 的 immutable cwd 与上一轮 Worktree 不一致')
      }

      const target = await options.module.beginNextIteration(request.sessionId, request.expectedRevision)
      if (target.checkout.kind !== 'isolated' || target.delivery?.state !== 'working') {
        throw domainError('checkout_mismatch', '下一轮 Worktree 未进入 working 状态')
      }
      const record = recordOf(options.registry, target.checkout.id)
      if (
        record.predecessorCheckoutId !== predecessor.checkoutId
        || record.ownerSessionId !== request.sessionId
        || !sameLocalRoot(record.managedRoot, predecessor.managedRoot)
      ) {
        throw domainError('checkout_mismatch', '下一轮 Worktree 的 lineage 或 cwd 身份不一致')
      }
      const observed = await observe(record)
      return {
        target: projectRecord(record, request.sessionId, {
          snapshot: observed.snapshot,
          dirty: observed.dirty,
          ownerSessionAvailable: true,
        }),
      }
    }),
  }
}
