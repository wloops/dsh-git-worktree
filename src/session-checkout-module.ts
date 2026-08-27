import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  BulkCleanupManagedWorktreeCandidate,
  BulkCleanupManagedWorktreesResult,
  ManagedWorktreeCleanupView,
  ManagedWorktreeSummaryView,
  SessionCheckoutErrorCode,
  SessionCheckoutOperation,
  SessionCheckoutOperationErrorResult,
  SessionCheckoutOperationResult,
  SessionTargetBindChoice,
  SessionTargetCurrentView,
  SessionTargetView,
  WorktreeApplyPreflightBlockedReason,
  WorktreeApplyPreflightView,
  WorktreePreviewRecoveryPreflightView,
  WorktreePreviewRecoveryProof,
  WorktreeCleanupReason,
  WorktreeDeliveryProofView,
  WorktreeRetentionMode,
  WorktreeCheckpointView,
} from './types.js'
import { SessionCheckoutError } from './index.js'
import { checkpointGenerationForRecord } from './checkpoint.js'
import {
  createManagedWorktreePathCandidates,
  createManagedWorktreeRepositoryKey,
} from './managed-worktree-path.js'
import type {
  IsolatedTargetLaunch,
  ListManagedWorktreesInput,
  ManageManagedWorktreeInput,
  MarkReadyForReviewInput,
  SessionCheckoutModule,
  SessionCheckoutReconcileSummary,
} from './index.js'
import type {
  DirectoryIdentity,
  GitCheckoutSnapshot,
  ManagedCheckoutRecord,
  ManagedDeliveryProof,
  ManagedPreviewReceipt,
  ManagedApplyConflictRecoveryContinuation,
  ManagedPreviewRecoveryAnalysisContinuation,
  ManagedPreviewRecoveryHandoffContinuation,
  ManagedReviewRegenerationContinuation,
  ManagedWorktreeCheckpointRecord,
  ManagedWorktreePreviousReviewRecord,
  ManagedWorktreeReviewRecord,
  SessionBindingRecord,
  SessionCheckoutDependencies,
  SessionCheckoutProjectRecord,
  SessionCheckoutSessionRecord,
} from './ports.js'

/**
 * dsh-git-worktree session-checkout state machine, ported from Domi. It keeps
 * receipt-first Local Preview, rollback/finalize, project acceptance slots,
 * crash recovery and fingerprint CAS while adapting ownership to Harness's
 * separate source Local Session and target owner Session.
 * @module dsh-git-worktree/session-checkout-module
 */

interface ResolvedSessionProject {
  session: SessionCheckoutSessionRecord
  project: SessionCheckoutProjectRecord
}

const UNVERSIONED_OID = 'unversioned'
const UNVERSIONED_REF = 'WORKING_TREE'
const RETENTION_24H_MS = 24 * 60 * 60 * 1000
const RETENTION_3D_MS = 3 * RETENTION_24H_MS
const CLEANUP_IDENTITY_CHANGED_MESSAGE = 'Worktree 的 Git 身份或路径已变化，未执行清理。'
const CLEANUP_RESIDUE_MESSAGE = 'Git Worktree 已解除注册，仅剩物理目录残余；可重试清理环境。'
const TRANSIENT_CLEANUP_RETRY_DELAYS_MS = [100, 300, 800]

/**
 * 单个 checkout 清理/维护操作的启动收敛超时。
 * Windows 上 Worktree 被外部进程（如残留 Agent 运行）占用时，git/fs 操作可能无限期挂起；
 * 启动收敛必须在有限时间内继续，不能因为一个损坏记录卡住整个应用启动。
 */
const CHECKOUT_CLEANUP_TIMEOUT_MS = 30_000

async function withCleanupTimeout<T>(
  checkoutId: string,
  operation: () => Promise<T>,
): Promise<T | null> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<null>((resolve) => {
        timeoutHandle = setTimeout(() => {
          console.warn(`[session-checkout] ${checkoutId.slice(0, 8)} 清理超时（${CHECKOUT_CLEANUP_TIMEOUT_MS}ms），已跳过本次收敛`)  
          resolve(null)
        }, CHECKOUT_CLEANUP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

function cleanupReasonForMessage(message: string): WorktreeCleanupReason {
  if (message.includes('提交后出现了新修改')) return 'modified_after_finalize'
  if (message.includes('解除注册') || message.includes('目录残余')) return 'detached_residue'
  if (message.includes('quarantine')) return 'quarantine_busy'
  if (message.includes('身份') || message.includes('记录') || message.includes('Local index')) return 'identity_changed'
  return 'directory_busy'
}

function isTransientCleanupError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code ?? '')
    : ''
  const message = error instanceof Error ? error.message : String(error)
  return /^(EBUSY|EPERM|EACCES|ENOTEMPTY)$/i.test(code)
    || /EBUSY|EPERM|EACCES|ENOTEMPTY|being used|access is denied|permission denied/i.test(message)
}

async function retryTransientCleanup<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= TRANSIENT_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      if (!isTransientCleanupError(error) || attempt === TRANSIENT_CLEANUP_RETRY_DELAYS_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_CLEANUP_RETRY_DELAYS_MS[attempt] ?? 0))
    }
  }
  throw lastError
}

function retentionExpiresAt(mode: Exclude<WorktreeRetentionMode, 'cleanup'>, retainedAt: number): number | null {
  if (mode === 'retain_24h') return retainedAt + RETENTION_24H_MS
  if (mode === 'retain_3d') return retainedAt + RETENTION_3D_MS
  return null
}

function pathForIdentity(path: string): string {
  try {
    return realpathSync.native(resolve(path)).replace(/\\/g, '/')
  } catch {
    return resolve(path).replace(/\\/g, '/')
  }
}

function pathsEqual(left: string, right: string): boolean {
  const normalizedLeft = pathForIdentity(left)
  const normalizedRight = pathForIdentity(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** canonical 路径与 registry 原始路径比较时不得再次 realpath，否则 Junction 会冒充原目录。 */
function resolvedPathsEqual(left: string, right: string): boolean {
  const normalizedLeft = resolve(left).replace(/\\/g, '/')
  const normalizedRight = resolve(right).replace(/\\/g, '/')
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

export function createSessionCheckoutModule(
  dependencies: SessionCheckoutDependencies,
): SessionCheckoutModule {
  function requireSession(sessionId: string): SessionCheckoutSessionRecord {
    const session = dependencies.lookup.getSession(sessionId)
    if (!session) throw new SessionCheckoutError('session_not_found', `会话不存在: ${sessionId}`)
    return session
  }

  async function resolveSessionProject(sessionId: string): Promise<ResolvedSessionProject> {
    const session = requireSession(sessionId)
    if (!session.projectId) throw new SessionCheckoutError('project_not_found', '会话尚未关联项目')
    const project = dependencies.lookup.getProject(session.projectId)
    if (!project) throw new SessionCheckoutError('project_not_found', `项目不存在: ${session.projectId}`)
    if (!dependencies.files.exists(project.root)) {
      throw new SessionCheckoutError('project_root_missing', `项目根目录不存在: ${project.name}`)
    }
    return { session, project }
  }

  async function inspectLocal(binding: SessionBindingRecord): Promise<SessionTargetView> {
    const project = dependencies.lookup.getProject(binding.projectId)
    if (!project || !dependencies.files.exists(project.root)) return recoveryView(binding)

    const snapshot = await dependencies.git.inspect(project.root)
    const current: SessionTargetCurrentView = snapshot
      ? { branch: snapshot.branch, oid: snapshot.headOid }
      : { branch: null, oid: UNVERSIONED_OID }
    const status = snapshot ? await dependencies.git.status(project.root) : { dirty: false }
    return {
      project: { id: binding.projectId, name: project.name },
      checkout: {
        id: `local:${binding.projectId}`,
        kind: 'local',
        label: 'Local Checkout',
        phase: 'ready',
      },
      source: { ref: binding.sourceRef, oid: binding.sourceOid },
      current,
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: status.dirty,
      revision: binding.revision,
    }
  }

  function projectPreviousReview(review: ManagedWorktreeReviewRecord): ManagedWorktreePreviousReviewRecord {
    return {
      reviewId: review.reviewId,
      iteration: review.iteration,
      summary: review.summary,
      suggestedCommitMessage: review.suggestedCommitMessage,
      changedFiles: review.changedFiles.slice(0, 50),
    }
  }

  function projectCheckpoint(checkpoint: ManagedWorktreeCheckpointRecord): WorktreeCheckpointView {
    return {
      checkpointId: checkpoint.checkpointId,
      sequence: checkpoint.sequence,
      reviewId: checkpoint.reviewId,
      createdAt: checkpoint.createdAt,
      summary: checkpoint.summary,
      validationStatus: checkpoint.validationStatus,
      changedFiles: [...checkpoint.changedFiles],
    }
  }

  function projectDelivery(
    record: ManagedCheckoutRecord,
    commitInLocalHistory: boolean | null = null,
  ): SessionTargetView['delivery'] {
    const delivery = record.delivery
    const projectProof = (proof: ManagedDeliveryProof | undefined): WorktreeDeliveryProofView | undefined => proof
      ? {
          localBranch: proof.localBranch,
          localHeadBefore: proof.localHeadBefore,
          localHeadAfter: proof.localHeadAfter,
          changedFiles: [...proof.changedFiles],
          ...(proof.validationStatus === undefined ? {} : { validationStatus: proof.validationStatus }),
          ...(proof.validationSummary === undefined ? {} : { validationSummary: proof.validationSummary }),
          commitInLocalHistory,
        }
      : undefined
    if (delivery.state === 'working') return delivery
    if (delivery.state === 'ready_for_review') return { state: delivery.state, review: delivery.review }
    if (delivery.state === 'preview_active') {
      return { state: delivery.state, review: delivery.review, previewedAt: delivery.preview.previewedAt }
    }
    if (delivery.state === 'preview_detached') {
      return {
        state: delivery.state,
        review: delivery.review,
        previewedAt: delivery.preview.previewedAt,
        detachedAt: delivery.detachedAt,
        reason: delivery.reason,
        attemptedAction: delivery.attemptedAction,
      }
    }
    if (delivery.state === 'finalized') {
      return {
        state: delivery.state,
        review: delivery.review,
        commitOid: delivery.commitOid,
        ...(projectProof(delivery.proof) ? { proof: projectProof(delivery.proof) } : {}),
        cleanup: delivery.cleanup,
        ...(delivery.cleanupMessage ? { cleanupMessage: delivery.cleanupMessage } : {}),
      }
    }
    if (delivery.state === 'retained') {
      return {
        state: delivery.state,
        review: delivery.review,
        commitOid: delivery.commitOid,
        ...(projectProof(delivery.proof) ? { proof: projectProof(delivery.proof) } : {}),
        retention: delivery.retention,
        retainedAt: delivery.retainedAt,
        expiresAt: delivery.expiresAt,
        cleanup: delivery.cleanup,
        ...(delivery.cleanupMessage ? { cleanupMessage: delivery.cleanupMessage } : {}),
      }
    }
    if (delivery.state === 'delivered') {
      const deliveredProof = projectProof(delivery.proof)
      return {
        state: delivery.state,
        iteration: delivery.iteration,
        commitOid: delivery.commitOid,
        deliveredAt: delivery.deliveredAt,
        ...(deliveredProof ? { proof: deliveredProof } : {}),
      }
    }
    return delivery
  }

  function bindingForManagedRecord(record: ManagedCheckoutRecord): SessionBindingRecord {
    const persisted = dependencies.registry.read().sessionBindings[record.ownerSessionId]
    if (persisted?.target.kind === 'isolated' && persisted.target.checkoutId === record.checkoutId) return persisted
    return {
      sessionId: record.ownerSessionId,
      projectId: record.projectId,
      projectName: record.projectName,
      target: { kind: 'isolated', checkoutId: record.checkoutId },
      ownerSessionId: record.ownerSessionId,
      sourceRef: record.sourceRef,
      sourceOid: record.baseOid,
      revision: record.revision,
    }
  }

  function recoveryView(
    binding: SessionBindingRecord,
    record?: ManagedCheckoutRecord,
    dirty = false,
  ): SessionTargetView {
    const phase = record?.phase === 'discarded' ? 'discarded' : 'recovery_required'
    return {
      project: { id: binding.projectId, name: binding.projectName },
      checkout: {
        id: record?.checkoutId ?? (binding.target.kind === 'isolated' ? binding.target.checkoutId : `local:${binding.projectId}`),
        kind: binding.target.kind === 'isolated' ? 'isolated' : 'local',
        label: binding.target.kind === 'isolated' ? 'Isolated Checkout' : 'Local Checkout',
        phase,
      },
      source: { ref: binding.sourceRef, oid: binding.sourceOid },
      current: { branch: null, oid: binding.sourceOid },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty,
      revision: record?.revision ?? binding.revision,
      ...(record ? { delivery: projectDelivery(record) } : {}),
      ...((record?.checkpoints?.length ?? 0) > 0 ? { checkpoints: record!.checkpoints!.map(projectCheckpoint) } : {}),
      ...(record && checkpointGenerationForRecord(record) ? { checkpointGeneration: checkpointGenerationForRecord(record) } : {}),
    }
  }

  async function validateCommittedLocalCheckout(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
  ): Promise<{ canonicalLocalRoot: string; snapshot: GitCheckoutSnapshot } | undefined> {
    if (
      binding.target.kind !== 'isolated'
      || binding.target.checkoutId !== record.checkoutId
      || binding.projectId !== record.projectId
      || binding.ownerSessionId !== record.ownerSessionId
    ) return undefined
    try {
      const project = dependencies.lookup.getProject(record.projectId)
      if (!project || !dependencies.files.exists(project.root) || !dependencies.files.exists(record.localRoot)) return undefined
      const canonicalProjectRoot = await dependencies.files.canonicalize(project.root)
      const canonicalLocalRoot = await dependencies.files.canonicalize(record.localRoot)
      if (!pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return undefined
      const snapshot = await dependencies.git.inspect(canonicalLocalRoot)
      if (!snapshot || !pathsEqual(snapshot.commonDir, record.gitCommonDir)) return undefined
      return { canonicalLocalRoot, snapshot }
    } catch {
      return undefined
    }
  }

  async function committedFollowupView(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
  ): Promise<SessionTargetView> {
    if (
      record.delivery.state !== 'finalized'
      && record.delivery.state !== 'retained'
      && record.delivery.state !== 'delivered'
    ) return recoveryView(binding, record, true)
    const local = await validateCommittedLocalCheckout(binding, record)
    if (!local) return recoveryView(binding, record, true)
    const localSnapshot = local.snapshot
    let commitInLocalHistory: boolean | null = null
    if (record.delivery.commitOid) {
      try {
        commitInLocalHistory = await dependencies.git.isAncestor(
          local.canonicalLocalRoot,
          record.delivery.commitOid,
          localSnapshot.headOid,
        )
      } catch {
        commitInLocalHistory = null
      }
    }
    const delivery = projectDelivery(record, commitInLocalHistory)
    if (!delivery || (delivery.state !== 'finalized' && delivery.state !== 'retained' && delivery.state !== 'delivered')) {
      return recoveryView(binding, record, true)
    }
    return {
      project: { id: record.projectId, name: record.projectName },
      checkout: {
        id: record.checkoutId,
        kind: 'isolated',
        label: 'Isolated Checkout',
        // Commit 已是权威交付事实；残余环境异常只能影响 cleanup，不能降级整个会话。
        phase: delivery.state === 'retained' ? 'retained' : delivery.state === 'delivered' ? 'discarded' : 'finalized',
      },
      source: { ref: record.sourceRef, oid: record.baseOid },
      current: {
        branch: localSnapshot.branch,
        oid: localSnapshot.headOid,
      },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: true,
      revision: record.revision,
      delivery,
    }
  }

  function markRecoveryRequired(record: ManagedCheckoutRecord): ManagedCheckoutRecord {
    if (record.phase === 'recovery_required' || record.phase === 'discarded') return record
    const registry = dependencies.registry.read()
    const current = registry.managedCheckouts[record.checkoutId]
    if (!current) return record
    if (current.revision !== record.revision || current.phase !== record.phase) return current
    const recovered = {
      ...current,
      phase: 'recovery_required' as const,
      revision: current.revision + 1,
    }
    registry.managedCheckouts[record.checkoutId] = recovered
    registry.revision += 1
    dependencies.registry.write(registry)
    return recovered
  }

  interface ValidatedManagedCheckout {
    canonicalManagedRoot: string
    canonicalManagedGitRoot: string
    snapshot: GitCheckoutSnapshot
    status: { dirty: boolean }
  }

  type ManagedCheckoutValidationResult =
    | { status: 'valid'; checkout: ValidatedManagedCheckout }
    | { status: 'invalid' }
    | { status: 'unavailable' }

  async function checkpointHeadInvariantHolds(
    record: ManagedCheckoutRecord,
    managedRoot: string,
    headOid: string,
  ): Promise<boolean> {
    const checkpoints = record.checkpoints ?? []
    if (checkpoints.length === 0) return true
    const checkpointIds = new Set<string>()
    const reviewIds = new Set<string>()
    for (let index = 0; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index]!
      if (
        checkpoint.sequence !== index + 1
        || checkpointIds.has(checkpoint.checkpointId)
        || reviewIds.has(checkpoint.reviewId)
      ) return false
      checkpointIds.add(checkpoint.checkpointId)
      reviewIds.add(checkpoint.reviewId)
      if (await dependencies.git.readInternalArtifact(record.localRoot, record.checkoutId, `checkpoints/${checkpoint.checkpointId}`) !== checkpoint.commitOid) return false
      if (!(await dependencies.git.isAncestor(managedRoot, checkpoint.parentOid, checkpoint.commitOid))) return false
      if (index > 0 && !(await dependencies.git.isAncestor(managedRoot, checkpoints[index - 1]!.commitOid, checkpoint.parentOid))) return false
    }
    return dependencies.git.isAncestor(managedRoot, checkpoints[checkpoints.length - 1]!.commitOid, headOid)
  }

  async function validateManagedCheckoutDetailed(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
    requireCreateBase: boolean,
  ): Promise<ManagedCheckoutValidationResult> {
    if (
      binding.target.kind !== 'isolated'
      || binding.target.checkoutId !== record.checkoutId
      || binding.projectId !== record.projectId
      || binding.ownerSessionId !== record.ownerSessionId
      || !dependencies.files.exists(record.managedRoot)
    ) return { status: 'invalid' }

    try {
      const canonicalManagedRoot = await dependencies.files.canonicalize(record.managedRoot)
      const canonicalManagedGitRoot = await dependencies.files.canonicalize(record.managedGitRoot)
      const canonicalLocalRoot = await dependencies.files.canonicalize(record.localRoot)
      const project = dependencies.lookup.getProject(record.projectId)
      if (project) {
        if (!dependencies.files.exists(project.root)) return { status: 'invalid' }
        const canonicalProjectRoot = await dependencies.files.canonicalize(project.root)
        if (!pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return { status: 'invalid' }
      }
      const snapshot = await dependencies.git.inspect(canonicalManagedRoot)
      const localSnapshot = await dependencies.git.inspect(canonicalLocalRoot)
      if (!snapshot || !localSnapshot) return { status: 'invalid' }

      const projectRelativePath = relative(localSnapshot.root, canonicalLocalRoot)
      if (
        projectRelativePath.startsWith('..')
        || isAbsolute(projectRelativePath)
        || !resolvedPathsEqual(canonicalManagedRoot, record.managedRoot)
        || !resolvedPathsEqual(canonicalManagedGitRoot, record.managedGitRoot)
        || !resolvedPathsEqual(canonicalLocalRoot, record.localRoot)
        || !pathsEqual(snapshot.root, canonicalManagedGitRoot)
        || !pathsEqual(snapshot.commonDir, record.gitCommonDir)
        || !pathsEqual(localSnapshot.commonDir, record.gitCommonDir)
        || !pathsEqual(resolve(snapshot.root, projectRelativePath), canonicalManagedRoot)
        || (!requireCreateBase && !pathsEqual(snapshot.gitDir, record.gitDir))
        || (requireCreateBase && snapshot.headOid !== record.baseOid)
        || (!requireCreateBase && !(await checkpointHeadInvariantHolds(record, canonicalManagedRoot, snapshot.headOid)))
      ) return { status: 'invalid' }

      const status = await dependencies.git.status(canonicalManagedRoot)
      return {
        status: 'valid',
        checkout: { canonicalManagedRoot, canonicalManagedGitRoot, snapshot, status },
      }
    } catch {
      // Git 子进程超时、杀毒软件占用等瞬时 I/O 故障不能永久污染健康 Worktree。
      return { status: 'unavailable' }
    }
  }

  async function validateManagedCheckout(
    binding: SessionBindingRecord,
    record: ManagedCheckoutRecord,
    requireCreateBase: boolean,
  ): Promise<ValidatedManagedCheckout | undefined> {
    const result = await validateManagedCheckoutDetailed(binding, record, requireCreateBase)
    return result.status === 'valid' ? result.checkout : undefined
  }

  interface ValidatedCleanupResidue {
    canonicalManagedGitRoot: string
    directoryIdentity: DirectoryIdentity
  }

  function directoryIdentitiesEqual(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
    return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs
  }

  function hasCleanupRemovalReceipt(record: ManagedCheckoutRecord): boolean {
    return record.journal?.operation === 'cleanup'
      && record.journal.step === 'removing_worktree'
      && record.journal.managedDirectoryIdentity !== undefined
  }

  function hasLegacyCleanupResidueEvidence(record: ManagedCheckoutRecord): boolean {
    if (record.journal !== null) return false
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') return false
    if (record.delivery.cleanup !== 'blocked') return false
    if (record.delivery.cleanupMessage !== CLEANUP_IDENTITY_CHANGED_MESSAGE) return false
    const checkoutIdentity = record.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)
    return checkoutIdentity.length > 0 && basename(record.managedGitRoot).endsWith(`--${checkoutIdentity}`)
  }

  async function validateCleanupLocalIdentity(record: ManagedCheckoutRecord): Promise<GitCheckoutSnapshot | undefined> {
    if (!dependencies.files.exists(record.localRoot)) return undefined
    const project = dependencies.lookup.getProject(record.projectId)
    if (!project || !dependencies.files.exists(project.root)) return undefined
    try {
      const canonicalLocalRoot = await dependencies.files.canonicalize(record.localRoot)
      const canonicalProjectRoot = await dependencies.files.canonicalize(project.root)
      if (!resolvedPathsEqual(canonicalLocalRoot, record.localRoot) || !pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) return undefined
      const localSnapshot = await dependencies.git.inspect(canonicalLocalRoot)
      if (!localSnapshot || !pathsEqual(localSnapshot.commonDir, record.gitCommonDir)) return undefined
      const projectRelativePath = relative(localSnapshot.root, canonicalLocalRoot)
      if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) return undefined
      return localSnapshot
    } catch {
      return undefined
    }
  }

  async function validateDetachedCleanupResidue(
    record: ManagedCheckoutRecord,
    allowLegacyResidue = false,
  ): Promise<ValidatedCleanupResidue | undefined> {
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') return undefined
    const receipt = hasCleanupRemovalReceipt(record)
    const legacy = allowLegacyResidue && hasLegacyCleanupResidueEvidence(record)
    if (!receipt && !legacy) return undefined
    if (!dependencies.files.exists(record.managedGitRoot) || dependencies.files.exists(record.gitDir)) return undefined

    try {
      const localSnapshot = await validateCleanupLocalIdentity(record)
      if (!localSnapshot) return undefined
      const canonicalManagedGitRoot = await dependencies.files.canonicalize(record.managedGitRoot)
      if (!resolvedPathsEqual(canonicalManagedGitRoot, record.managedGitRoot)) return undefined

      const projectRelativePath = relative(localSnapshot.root, record.localRoot)
      const expectedManagedRoot = resolve(canonicalManagedGitRoot, projectRelativePath)
      if (!pathsEqual(expectedManagedRoot, record.managedRoot)) return undefined
      if (dependencies.files.exists(record.managedRoot)) {
        const canonicalManagedRoot = await dependencies.files.canonicalize(record.managedRoot)
        if (!resolvedPathsEqual(canonicalManagedRoot, record.managedRoot) || !pathsEqual(canonicalManagedRoot, expectedManagedRoot)) return undefined
      }

      const managedSnapshot = await dependencies.git.inspect(canonicalManagedGitRoot)
      if (managedSnapshot) return undefined
      const containingWorktreeRoot = await dependencies.git.findContainingWorktreeRoot(canonicalManagedGitRoot)
      if (containingWorktreeRoot) return undefined
      const directoryIdentity = await dependencies.files.inspectDirectoryIdentity(canonicalManagedGitRoot)
      if (!directoryIdentity) return undefined
      const expectedIdentity = record.journal?.operation === 'cleanup'
        ? record.journal.managedDirectoryIdentity
        : undefined
      if (expectedIdentity && !directoryIdentitiesEqual(directoryIdentity, expectedIdentity)) return undefined
      return { canonicalManagedGitRoot, directoryIdentity }
    } catch {
      return undefined
    }
  }

  async function validateCleanupQuarantine(record: ManagedCheckoutRecord): Promise<string | undefined> {
    const journal = record.journal?.operation === 'cleanup' ? record.journal : undefined
    const quarantinePath = journal?.cleanupQuarantinePath
    const expectedIdentity = journal?.managedDirectoryIdentity
    if (!quarantinePath || !expectedIdentity || !dependencies.files.exists(quarantinePath)) return undefined
    const expectedName = `.dsh-wt-cleanup--${record.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}--${journal.operationId}`
    if (!resolvedPathsEqual(dirname(quarantinePath), dirname(record.managedGitRoot)) || basename(quarantinePath) !== expectedName) return undefined
    try {
      if (!await validateCleanupLocalIdentity(record)) return undefined
      const canonicalQuarantinePath = await dependencies.files.canonicalize(quarantinePath)
      if (!resolvedPathsEqual(canonicalQuarantinePath, quarantinePath)) return undefined
      const identity = await dependencies.files.inspectDirectoryIdentity(canonicalQuarantinePath)
      if (!identity || !directoryIdentitiesEqual(identity, expectedIdentity)) return undefined
      return canonicalQuarantinePath
    } catch {
      return undefined
    }
  }

  async function inspectIsolated(binding: SessionBindingRecord, persistRecovery = true): Promise<SessionTargetView> {
    if (binding.target.kind !== 'isolated') return recoveryView(binding)
    const registry = dependencies.registry.read()
    let record = registry.managedCheckouts[binding.target.checkoutId]
    if (!record) return recoveryView(binding)
    if (
      record.projectId !== binding.projectId
      || record.ownerSessionId !== binding.ownerSessionId
    ) {
      if (persistRecovery) record = markRecoveryRequired(record)
      return recoveryView(binding, record)
    }
    if (record.phase === 'discarded') {
      if (record.delivery.state === 'delivered') return committedFollowupView(binding, record)
      return {
        ...recoveryView(binding, record),
        checkout: {
          id: record.checkoutId,
          kind: 'isolated',
          label: 'Isolated Checkout',
          phase: 'discarded',
        },
      }
    }

    let prefetchedValidation: ValidatedManagedCheckout | undefined
    if (
      record.phase === 'recovery_required'
      && record.journal === null
      && dependencies.files.exists(record.managedRoot)
    ) {
      const recoveryValidation = await validateManagedCheckoutDetailed(binding, record, false)
      if (recoveryValidation.status === 'valid' && persistRecovery) {
        const restored = updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          managedRoot: recoveryValidation.checkout.canonicalManagedRoot,
          managedGitRoot: recoveryValidation.checkout.canonicalManagedGitRoot,
          gitDir: recoveryValidation.checkout.snapshot.gitDir,
          phase: 'ready',
          revision: current.revision + 1,
        }))
        if (restored) {
          record = restored
          prefetchedValidation = recoveryValidation.checkout
        }
      }
    }

    if ((record.phase !== 'ready' && record.phase !== 'finalized' && record.phase !== 'retained') || !dependencies.files.exists(record.managedRoot)) {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        return committedFollowupView(binding, record)
      }
      if (persistRecovery) record = markRecoveryRequired(record)
      let dirty = false
      if (dependencies.files.exists(record.managedRoot)) {
        try {
          dirty = (await dependencies.git.status(record.managedRoot)).dirty
        } catch {
          dirty = true
        }
      }
      return recoveryView(binding, record, dirty)
    }

    const validation = prefetchedValidation
      ? { status: 'valid' as const, checkout: prefetchedValidation }
      : await validateManagedCheckoutDetailed(binding, record, false)
    if (validation.status !== 'valid') {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        return committedFollowupView(binding, record)
      }
      // 只有确定的身份/路径不匹配才持久进入 recovery；瞬时 Git/I/O 故障允许下一次 inspect 直接重试。
      if (persistRecovery && validation.status === 'invalid') record = markRecoveryRequired(record)
      return recoveryView(binding, record)
    }
    const { snapshot, status } = validation.checkout
    const delivery = projectDelivery(record)
    const activePreview = delivery?.state === 'ready_for_review'
      ? Object.values(registry.managedCheckouts).find((candidate) => (
          candidate.checkoutId !== record.checkoutId
          && candidate.phase !== 'discarded'
          && pathsEqual(candidate.localRoot, record.localRoot)
          && holdsProjectAcceptanceSlot(candidate)
        ))
      : undefined
    return {
      project: { id: record.projectId, name: record.projectName },
      checkout: {
        id: record.checkoutId,
        kind: 'isolated',
        label: 'Isolated Checkout',
        phase: record.phase,
      },
      source: { ref: record.sourceRef, oid: record.baseOid },
      current: { branch: snapshot.branch, oid: snapshot.headOid },
      ownership: binding.inheritedFromSessionId ? 'inherited' : 'owner',
      dirty: status.dirty,
      revision: record.revision,
      delivery,
      ...((record.checkpoints?.length ?? 0) > 0 ? { checkpoints: record.checkpoints!.map(projectCheckpoint) } : {}),
      ...(checkpointGenerationForRecord(record) ? { checkpointGeneration: checkpointGenerationForRecord(record) } : {}),
      ...(delivery?.state === 'ready_for_review'
        ? {
            reviewSlot: activePreview ? 'waiting' as const : 'available' as const,
            ...(activePreview ? { reviewSlotOwnerSessionId: activePreview.ownerSessionId } : {}),
          }
        : {}),
    }
  }

  function getPersistedBinding(sessionId: string): SessionBindingRecord | undefined {
    return dependencies.registry.read().sessionBindings[sessionId]
  }

  function runtimeContext(sessionId: string): string {
    const registry = dependencies.registry.read()
    const binding = registry.sessionBindings[sessionId]
    if (!binding) return ''
    if (binding.target.kind === 'local') {
      const projectPreview = Object.values(registry.managedCheckouts)
        .filter((record) => record.projectId === binding.projectId && record.phase !== 'discarded')
        .filter((record) => record.delivery.state === 'preview_active'
          || record.delivery.state === 'preview_detached')
        .sort((left, right) => managedUpdatedAt(right) - managedUpdatedAt(left))[0]
      const pending = projectPreview ?? Object.values(registry.managedCheckouts)
        .filter((record) => record.sourceSessionId === sessionId && record.phase !== 'discarded')
        .filter((record) => record.delivery.state === 'working'
          || record.delivery.state === 'ready_for_review'
          || record.delivery.state === 'preview_active'
          || record.delivery.state === 'preview_detached'
          || record.phase === 'preparing'
          || record.phase === 'mutating'
          || record.phase === 'recovery_required')
        .sort((left, right) => managedUpdatedAt(right) - managedUpdatedAt(left))[0]
      if (!pending) {
        return 'Session Target: Local Checkout. No isolated target is active for this Session.'
      }
      if (pending.delivery.state === 'preview_active') {
        return [
          'Session Target: Local Checkout (Worktree Preview active).',
          `Managed checkout ${pending.checkoutId} has a reversible Preview in this Local boundary.`,
          'Do not modify project files or run repository-changing commands. Only the user may accept, rollback, or discard the Preview through the Worktree acceptance UI.',
        ].join('\n')
      }
      if (pending.delivery.state === 'preview_detached') {
        return [
          'Session Target: Local Checkout (Worktree Preview recovery required).',
          `Managed checkout ${pending.checkoutId} still has preserved Preview recovery evidence.`,
          'Do not modify project files or attempt automatic cleanup. The user must retry rollback; the Worktree stays preserved until rollback succeeds.',
        ].join('\n')
      }
      return [
        'Session Target: Local Checkout (handoff pending).',
        `Managed checkout ${pending.checkoutId} is reserved for Session ${pending.ownerSessionId}.`,
        'Stop code modifications in this Local Session. Ask the user to open the isolated Session from the Worktree card.',
      ].join('\n')
    }
    if (binding.target.kind !== 'isolated') return 'Session Target is unselected. Do not mutate project files until a target is chosen.'
    const record = registry.managedCheckouts[binding.target.checkoutId]
    if (!record) return 'Session Target: Isolated Checkout record missing. Stop mutations and request recovery.'
    if (record.phase === 'recovery_required') {
      return `Session Target: Isolated Checkout ${record.checkoutId} requires recovery. Do not modify Local or clean up automatically.`
    }
    const lines = [
      `Session Target: Isolated Checkout ${record.checkoutId}.`,
      `Authoritative cwd: ${record.managedRoot}`,
      `Original Local boundary: ${record.localRoot}`,
      'Make task changes only in the authoritative cwd; never write directly to the Original Local boundary.',
    ]
    if ((record.checkpoints?.length ?? 0) > 0) {
      lines.push(
        `Saved Worktree checkpoints: ${record.checkpoints!.length}. They remain unpublished to Local.`,
        'Final review and commit wording must summarize the cumulative diff from the original delivery base to the final Worktree snapshot. Do not manually reset, rewrite, or publish checkpoint commits.',
      )
    }
    if (record.delivery.state === 'ready_for_review') {
      lines.push('Delivery state: Ready for Review, not yet synchronized to Local. Continue ordinary discussion and answer questions without changing this Review. If the user requests new code or file changes, call worktree_resume_revision first, then continue the requested work in this same Session; do not ask the user to click a recovery control and do not synchronize Local. Until that tool succeeds, treat the Worktree as read-only. The user may still preview, directly finish, or discard through the Worktree acceptance UI.')
    } else if (record.delivery.state === 'preview_active') {
      lines.push('Delivery state: Local Preview active. The model must remain read-only; only the user may accept and commit, rollback, or discard through the Worktree acceptance UI.')
    } else if (record.delivery.state === 'preview_detached') {
      lines.push('Delivery state: Preview detached after Local drift. Do not mutate Local or the Worktree; the user must retry rollback, and Discard remains blocked until recovery succeeds.')
    } else if (record.delivery.state === 'working') {
      lines.push('Delivery state: Working. When implementation and validation are complete, put the complete report only in worktree_ready_for_review and call it as the final model tool. Do not duplicate that report in ordinary assistant prose; at most one short sentence may point the user to the bottom acceptance bar.')
    } else if (record.delivery.state === 'delivered') {
      lines.push('Delivery state: Delivered and cleaned. If the user requests new code or file changes in this conversation, call worktree_begin_next_iteration first; it safely recreates this Session immutable cwd for the next iteration. Do not call worktree_create.')
    } else if (record.delivery.state === 'retained') {
      lines.push('Delivery state: Retained. This frozen environment must be cleaned through the user controls before a next iteration can start.')
    } else {
      lines.push(`Delivery state: ${record.delivery.state}. Treat this Session as terminal until cleanup or recovery completes.`)
    }
    return lines.join('\n')
  }

  async function resolveBinding(sessionId: string): Promise<SessionBindingRecord> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    if (persisted) {
      if (session.projectId !== persisted.projectId) {
        const record = persisted.target.kind === 'isolated'
          ? dependencies.registry.read().managedCheckouts[persisted.target.checkoutId]
          : undefined
        const workspace = session.projectId ? dependencies.lookup.getProject(session.projectId) : undefined
        let isolatedWorkspaceMatches = Boolean(
          record
          && workspace
          && record.phase === 'discarded'
          && record.delivery.state === 'delivered'
          && !dependencies.files.exists(workspace.root)
          && resolvedPathsEqual(workspace.root, record.managedRoot),
        )
        if (!isolatedWorkspaceMatches && record && workspace && dependencies.files.exists(workspace.root)) {
          try {
            const workspaceRoot = await dependencies.files.canonicalize(workspace.root)
            isolatedWorkspaceMatches = pathsEqual(workspaceRoot, record.managedRoot)
          } catch {
            isolatedWorkspaceMatches = false
          }
        }
        if (!isolatedWorkspaceMatches) {
          throw new SessionCheckoutError(
            'project_mismatch',
            '会话当前 Workspace 与已绑定 Session Target 不一致，已停止访问 checkout',
          )
        }
      }
      return persisted
    }
    throw new SessionCheckoutError('target_unselected', '会话尚未选择 Session Target')
  }

  type BindingOperationMode = 'exclusive' | 'maintenance' | 'maintenance_draining'

  let bindingQueue: Promise<void> = Promise.resolve()
  let activeBindingOperation: BindingOperationMode | null = null
  let activeBindingOperationDone: Promise<void> = Promise.resolve()
  let pendingMaintenanceOperations = 0
  let maintenanceReady: Promise<void> | undefined
  let signalMaintenanceReady = (): void => undefined
  let activeMaintenanceInspects = 0
  let maintenanceInspectsDrained: Promise<void> = Promise.resolve()
  let signalMaintenanceInspectsDrained = (): void => undefined

  function prepareMaintenanceReadySignal(): void {
    maintenanceReady = new Promise<void>((resolveReady) => { signalMaintenanceReady = resolveReady })
  }

  function beginMaintenanceInspect(): void {
    if (activeMaintenanceInspects === 0) {
      maintenanceInspectsDrained = new Promise<void>((resolveDrained) => {
        signalMaintenanceInspectsDrained = resolveDrained
      })
    }
    activeMaintenanceInspects += 1
  }

  function finishMaintenanceInspect(): void {
    activeMaintenanceInspects -= 1
    if (activeMaintenanceInspects === 0) signalMaintenanceInspectsDrained()
  }

  async function withBindingLock<T>(
    operation: () => Promise<T>,
    options: { allowConcurrentInspect?: boolean } = {},
  ): Promise<T> {
    const maintenance = options.allowConcurrentInspect === true
    if (maintenance) {
      pendingMaintenanceOperations += 1
      if (pendingMaintenanceOperations === 1) prepareMaintenanceReadySignal()
    }

    const previous = bindingQueue
    let release = (): void => undefined
    bindingQueue = new Promise<void>((resolveLock) => { release = resolveLock })
    await previous.catch(() => undefined)

    let signalOperationDone = (): void => undefined
    activeBindingOperationDone = new Promise<void>((resolveDone) => { signalOperationDone = resolveDone })
    activeBindingOperation = maintenance ? 'maintenance' : 'exclusive'
    if (maintenance) signalMaintenanceReady()

    try {
      return await operation()
    } finally {
      if (maintenance) {
        // 先关闭新的只读旁路，再等待已启动 inspect 结束，之后 mutation 才能接管队列。
        activeBindingOperation = 'maintenance_draining'
        if (activeMaintenanceInspects > 0) await maintenanceInspectsDrained
        pendingMaintenanceOperations -= 1
        if (pendingMaintenanceOperations > 0) prepareMaintenanceReadySignal()
        else maintenanceReady = undefined
      }
      activeBindingOperation = null
      signalOperationDone()
      release()
    }
  }

  async function inspectTarget(sessionId: string, persistRecovery = true): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.target.kind === 'local') return inspectLocal(binding)
    return inspectIsolated(binding, persistRecovery)
  }

  async function inspectDuringMaintenance(sessionId: string): Promise<SessionTargetView> {
    if (activeBindingOperation !== 'maintenance') return inspectAvailable(sessionId)
    beginMaintenanceInspect()
    try {
      // 后台 reconcile/retention cleanup 可能因 Windows 文件占用持续数十秒。
      // 此时 inspect 只读取权威快照，不写 registry，避免一个历史 Worktree 阻塞所有会话。
      return await inspectTarget(sessionId, false)
    } finally {
      finishMaintenanceInspect()
    }
  }

  async function inspectAvailable(sessionId: string): Promise<SessionTargetView> {
    while (true) {
      if (activeBindingOperation === 'maintenance') return inspectDuringMaintenance(sessionId)
      if (activeBindingOperation === 'maintenance_draining') {
        const operationDone = activeBindingOperationDone
        await operationDone.catch(() => undefined)
        continue
      }
      if (pendingMaintenanceOperations > 0 && maintenanceReady) {
        // maintenance 可能排在当前交互操作之后；等它真正取得锁后再走只读旁路，
        // 避免 inspect 被预先排到 maintenance 后面，也避免与当前交互 mutation 并发。
        await maintenanceReady
        continue
      }
      return withBindingLock(() => inspectTarget(sessionId, true))
    }
  }

  async function reconcile(): Promise<SessionCheckoutReconcileSummary> {
    const registry = dependencies.registry.read()
    const recoveryRequiredCheckoutIds: string[] = []
    const orphanedCheckoutIds: string[] = []
    const dirtyOrphanedCheckoutIds: string[] = []
    const finalizedCheckoutIds: string[] = []
    let changed = false

    for (const [checkoutId, current] of Object.entries(registry.managedCheckouts)) {
      if (current.phase === 'discarded') continue
      if (
        current.predecessorCheckoutId
        && current.journal?.operation === 'create'
        && (current.phase === 'preparing' || current.phase === 'recovery_required')
        && !dependencies.files.exists(current.managedGitRoot)
        && !dependencies.files.exists(current.managedRoot)
      ) {
        const predecessor = registry.managedCheckouts[current.predecessorCheckoutId]
        const binding = registry.sessionBindings[current.ownerSessionId]
        if (
          predecessor?.phase === 'discarded'
          && predecessor.delivery.state === 'delivered'
          && binding?.target.kind === 'isolated'
          && binding.target.checkoutId === current.checkoutId
        ) {
          delete registry.managedCheckouts[checkoutId]
          registry.sessionBindings[current.ownerSessionId] = {
            ...binding,
            target: { kind: 'isolated', checkoutId: predecessor.checkoutId },
            sourceRef: predecessor.sourceRef,
            sourceOid: predecessor.baseOid,
            revision: binding.revision + 1,
          }
          registry.revision += 1
          changed = true
          continue
        }
      }
      let record = current
      if (current.delivery.state === 'finalized') {
        // 兼容旧版本曾把 cleanup 残余错误持久化为 recovery_required；Commit 事实优先，继续收口资源即可。
        finalizedCheckoutIds.push(checkoutId)
        continue
      }
      if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'finalize_preview' || current.journal?.operation === 'finish')
        && (current.journal.step === 'updating_ref' || current.journal.step === 'replacing_index')
      ) {
        // HEAD/ref alone cannot prove that the adjacent index replacement and working-tree preservation completed.
        // Preserve delivery, receipt, retained artifacts and journal until an explicit recovery path can verify all facts.
        record = {
          ...current,
          phase: 'recovery_required',
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        recoveryRequiredCheckoutIds.push(checkoutId)
        changed = true
      } else if (
        (current.phase === 'mutating' || current.phase === 'recovery_required')
        && current.journal?.operation === 'checkpoint'
        && current.delivery.state === 'ready_for_review'
      ) {
        const journal = current.journal
        if (journal.step === 'planning') {
          record = { ...current, phase: 'ready', journal: null, revision: current.revision + 1 }
        } else if (
          journal.step === 'updating_ref'
          && typeof journal.commitOid === 'string'
          && typeof journal.parentOid === 'string'
          && typeof journal.checkpointId === 'string'
          && typeof journal.checkpointSequence === 'number'
          && typeof journal.checkpointRequestId === 'string'
          && typeof journal.checkpointRequestedRevision === 'number'
          && typeof journal.recoveryGeneration === 'string'
          && typeof journal.checkpointMessage === 'string'
          && typeof journal.checkpointIndexTreeOid === 'string'
          && Array.isArray(journal.changedFiles)
        ) {
          const recovered = await dependencies.applyEngine.recoverCheckpoint({
            isolatedPath: current.managedRoot,
            commitOid: journal.commitOid,
            parentOid: journal.parentOid,
            expectedIndexTreeOid: journal.checkpointIndexTreeOid,
          })
          if (recovered.status === 'checkpoint_aborted') {
            try {
              await dependencies.git.releaseInternalArtifacts(current.localRoot, current.checkoutId, `checkpoints/${journal.checkpointId}`)
            } catch {
              console.warn('[session-checkout] 清理未生效 Checkpoint ref 失败，已保守保留不可见引用')
            }
            record = { ...current, phase: 'ready', journal: null, revision: current.revision + 1 }
          } else if (recovered.status === 'checkpoint_recovered') {
            const retained = await dependencies.git.readInternalArtifact(current.localRoot, current.checkoutId, `checkpoints/${journal.checkpointId}`)
            if (retained !== journal.commitOid) {
              record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
              recoveryRequiredCheckoutIds.push(checkoutId)
            } else {
              const review = current.delivery.review
              const checkpoint: ManagedWorktreeCheckpointRecord = {
                checkpointId: journal.checkpointId,
                sequence: journal.checkpointSequence,
                reviewId: review.reviewId,
                requestId: journal.checkpointRequestId,
                requestedRevision: journal.checkpointRequestedRevision,
                generation: journal.recoveryGeneration,
                iteration: review.iteration,
                createdAt: journal.startedAt,
                commitOid: journal.commitOid,
                parentOid: journal.parentOid,
                summary: review.summary,
                commitMessage: journal.checkpointMessage,
                validationStatus: review.validationStatus,
                changedFiles: [...journal.changedFiles],
              }
              record = {
                ...current,
                phase: 'ready',
                previousReview: projectPreviousReview(review),
                checkpoints: [...(current.checkpoints ?? []), checkpoint],
                delivery: { state: 'working', iteration: review.iteration },
                recoveryContinuation: undefined,
                journal: null,
                revision: current.revision + 1,
              }
            }
          } else {
            record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
            recoveryRequiredCheckoutIds.push(checkoutId)
          }
        } else {
          record = { ...current, phase: 'recovery_required', revision: current.revision + 1 }
          recoveryRequiredCheckoutIds.push(checkoutId)
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && current.journal?.operation === 'preview'
        && (
          current.journal.step === 'planning'
          || (current.journal.step === 'writing_local' && current.delivery.state === 'ready_for_review')
        )
      ) {
        // Preview receipt 尚未保留，apply patch 也尚未执行；可证明 Local 未被触碰。
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'finalize_preview' || current.journal?.operation === 'finish')
        && current.journal.step === 'planning'
      ) {
        // Finalize 的 branch/index 写入发生在 updating_ref 之后；planning 中断可安全重试。
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (
        current.phase === 'mutating'
        && (current.journal?.operation === 'preview' || current.journal?.operation === 'finish')
        && current.journal.step === 'artifacts_retained'
        && current.delivery.state === 'preview_active'
      ) {
        record = {
          ...current,
          phase: 'ready',
          journal: null,
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        changed = true
      } else if (current.phase === 'preparing' || current.phase === 'mutating') {
        record = {
          ...current,
          phase: 'recovery_required',
          revision: current.revision + 1,
        }
        registry.managedCheckouts[checkoutId] = record
        registry.revision += 1
        recoveryRequiredCheckoutIds.push(checkoutId)
        changed = true
      } else if (current.phase === 'recovery_required') {
        recoveryRequiredCheckoutIds.push(checkoutId)
      }

      if (dependencies.lookup.getSession(record.ownerSessionId)) continue
      orphanedCheckoutIds.push(checkoutId)
      let dirty = true
      if (dependencies.files.exists(record.managedRoot)) {
        try {
          dirty = (await dependencies.git.status(record.managedRoot)).dirty
        } catch {
          dirty = true
        }
      }
      if (dirty) dirtyOrphanedCheckoutIds.push(checkoutId)
    }

    if (changed) dependencies.registry.write(registry)
    for (const checkoutId of finalizedCheckoutIds) {
      const current = dependencies.registry.read().managedCheckouts[checkoutId]
      if (current?.delivery.state === 'finalized') {
        // 启动收敛不受单个卡死记录阻塞：超时后跳过，下次启动再试。
        await withCleanupTimeout(checkoutId, () => cleanupFinalized(current))
      }
    }
    await cleanupExpiredRetained()
    const currentRegistry = dependencies.registry.read()
    return {
      recoveryRequiredCheckoutIds,
      orphanedCheckoutIds,
      dirtyOrphanedCheckoutIds,
      retainedCheckoutCount: Object.values(currentRegistry.managedCheckouts)
        .filter((record) => record.phase !== 'discarded')
        .length,
    }
  }

  function operationError(
    code: SessionCheckoutErrorCode,
    message: string,
    target?: SessionTargetView,
  ): SessionCheckoutOperationErrorResult {
    return { status: 'error', code, message, ...(target ? { target } : {}) }
  }

  function updateManagedCheckout(
    checkoutId: string,
    update: (record: ManagedCheckoutRecord) => ManagedCheckoutRecord,
  ): ManagedCheckoutRecord | undefined {
    const registry = dependencies.registry.read()
    const current = registry.managedCheckouts[checkoutId]
    if (!current) return undefined
    const next = update(current)
    registry.managedCheckouts[checkoutId] = next
    registry.revision += 1
    dependencies.registry.write(registry)
    return next
  }

  async function markReadyForReviewTarget(
    sessionId: string,
    input: MarkReadyForReviewInput,
  ): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', '只有 owner Isolated 会话可以准备验收')
    }
    const summary = input.summary.trim()
    const suggestedCommitMessage = input.suggestedCommitMessage.trim()
    if (!summary || !suggestedCommitMessage || input.tests.length > 20) {
      throw new SessionCheckoutError('invalid_input', '验收摘要、提交信息或验证项目无效')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.phase !== 'ready' || record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      throw new SessionCheckoutError('operation_not_allowed', `当前 ${record.phase}/${record.delivery.state} 状态不能准备验收`)
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      throw new SessionCheckoutError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复')
    }
    const snapshot = await dependencies.applyEngine.inspectReview({
      baseOid: record.applyBaseOid ?? record.baseOid,
      isolatedPath: record.managedRoot,
      localPath: record.localRoot,
    })
    if (snapshot.status === 'error') {
      throw new SessionCheckoutError(snapshot.error.code, snapshot.error.message)
    }
    const reviewId = dependencies.createCheckoutId()
    updateManagedCheckout(record.checkoutId, (current) => {
      const { recoveryContinuation: _recovery, ...withoutRecovery } = current
      return {
      ...withoutRecovery,
      ...(current.delivery.state !== 'working' && current.delivery.state !== 'delivered'
        ? { previousReview: projectPreviousReview(current.delivery.review) }
        : {}),
      delivery: {
        state: 'ready_for_review',
        review: {
          reviewId,
          iteration: current.delivery.state === 'working'
            ? current.delivery.iteration
            : current.delivery.state === 'delivered'
              ? current.delivery.iteration + 1
              : current.delivery.review.iteration,
          preparedAt: Date.now(),
          ...(input.detailsMarkdown?.trim() ? { detailsMarkdown: input.detailsMarkdown.trim() } : {}),
          summary,
          validationStatus: input.validationStatus,
          ...(input.validationSummary?.trim() ? { validationSummary: input.validationSummary.trim() } : {}),
          tests: input.tests.map((test) => ({
            command: test.command.trim(),
            status: test.status,
            ...(test.summary?.trim() ? { summary: test.summary.trim() } : {}),
          })),
          changedFiles: [...snapshot.changedFiles],
          suggestedCommitMessage,
          isolatedFingerprint: snapshot.isolatedFingerprint,
          isolatedHeadOid: snapshot.isolatedHeadOid,
        },
      },
      revision: current.revision + 1,
    }
    })
    return inspectIsolated(binding)
  }

  async function operateCheckpoint(
    input: Extract<SessionCheckoutOperation, { action: 'checkpoint' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', '只有 owner Isolated 会话可以保存阶段')
    }
    const commitMessage = input.commitMessage.trim()
    if (
      !commitMessage
      || commitMessage.length > 500
      || !input.expectedReviewId.trim()
      || !/^[0-9a-f]{64}$/u.test(input.expectedGeneration)
      || !input.requestId.trim()
      || input.requestId.length > 200
      || /[\0\r\n]/u.test(input.requestId)
    ) return operationError('invalid_input', 'Checkpoint 请求或 Commit Message 无效')

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    const previousRequest = record.checkpoints?.find(checkpoint => checkpoint.requestId === input.requestId)
    if (previousRequest) {
      const exactReplay = record.delivery.state === 'working'
        && record.checkpoints?.at(-1)?.checkpointId === previousRequest.checkpointId
        && previousRequest.reviewId === input.expectedReviewId
        && previousRequest.requestedRevision === input.expectedRevision
        && previousRequest.generation === input.expectedGeneration
        && previousRequest.commitMessage === commitMessage
      if (!exactReplay) return operationError('stale_target', 'Checkpoint requestId 已被其他状态使用，请刷新')
      return {
        status: 'checkpointed',
        target: await inspectIsolated(binding),
        checkpoint: projectCheckpoint(previousRequest),
        changedFiles: [...previousRequest.changedFiles],
      }
    }
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (record.phase !== 'ready' || (record.delivery.state !== 'ready_for_review' && record.delivery.state !== 'preview_active')) {
      return operationError('operation_not_allowed', `当前 ${record.phase}/${record.delivery.state} 状态不能保存阶段`, await inspectIsolated(binding))
    }
    if (record.delivery.review.reviewId !== input.expectedReviewId || checkpointGenerationForRecord(record) !== input.expectedGeneration) {
      return operationError('stale_target', 'Checkpoint Review 或 generation 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError('project_acceptance_busy', '另一个任务正在占用该项目的 Local 验收槽位', await inspectIsolated(binding))
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复', inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !record
      || record.revision !== input.expectedRevision
      || record.phase !== 'ready'
      || (record.delivery.state !== 'ready_for_review' && record.delivery.state !== 'preview_active')
      || record.delivery.review.reviewId !== input.expectedReviewId
      || checkpointGenerationForRecord(record) !== input.expectedGeneration
    ) return operationError('stale_target', 'Checkpoint 状态在 Host CAS 前发生变化，请刷新后重试')

    if (record.delivery.state === 'preview_active') {
      const { preview, review } = record.delivery
      const rollbackOperationId = dependencies.createCheckoutId()
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'mutating',
        journal: {
          operation: 'rollback_preview',
          operationId: rollbackOperationId,
          step: 'planning',
          startedAt: Date.now(),
          previewId: preview.previewId,
          reviewId: review.reviewId,
          resumeRevision: false,
        },
        revision: current.revision + 1,
      }))
      const rollback = await dependencies.applyEngine.rollback({
        localPath: record.localRoot,
        receipt: preview,
        beforeWrite: async () => {
          updateManagedCheckout(record!.checkoutId, (current) => ({
            ...current,
            journal: current.journal?.operation === 'rollback_preview'
              ? { ...current.journal, step: 'writing_local' }
              : current.journal,
            revision: current.revision + 1,
          }))
        },
      })
      if (rollback.status === 'error') {
        const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
        const writeStarted = current?.journal?.operation === 'rollback_preview' && current.journal.step === 'writing_local'
        if (rollback.error.code === 'stale_local' || rollback.error.code === 'preview_modified') {
          return detachPreviewAfterLocalDrift(record, binding, rollback.error.code, 'rollback_preview')
        }
        if (!writeStarted || (rollback.error.code === 'git_error' && rollback.error.recoveryState === 'unchanged')) {
          updateManagedCheckout(record.checkoutId, (currentRecord) => ({ ...currentRecord, phase: 'ready', journal: null, revision: currentRecord.revision + 1 }))
        } else {
          updateManagedCheckout(record.checkoutId, (currentRecord) => ({ ...currentRecord, phase: 'recovery_required', revision: currentRecord.revision + 1 }))
        }
        return operationError(rollback.error.code, rollback.error.message, await inspectIsolated(binding))
      }
      const restored = updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'ready_for_review', review },
        journal: null,
        revision: current.revision + 1,
      }))
      if (!restored) return operationError('checkout_missing', 'Preview 已撤回，但 Checkout 记录丢失')
      await releasePreviewArtifactsBestEffort(record, preview.previewId)
      record = restored
    }

    if (record.delivery.state !== 'ready_for_review') {
      return operationError('operation_not_allowed', '当前没有可保存的验收阶段', await inspectIsolated(binding))
    }
    const review = record.delivery.review
    const checkpointId = dependencies.createCheckoutId()
    const checkpointSequence = (record.checkpoints?.length ?? 0) + 1
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    const mutating = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'checkpoint',
        operationId,
        step: 'planning',
        startedAt,
        reviewId: review.reviewId,
        checkpointId,
        checkpointSequence,
        checkpointRequestId: input.requestId,
        checkpointRequestedRevision: input.expectedRevision,
        checkpointMessage: commitMessage,
        recoveryGeneration: input.expectedGeneration,
        isolatedFingerprint: review.isolatedFingerprint,
        isolatedHeadOid: review.isolatedHeadOid,
      },
      revision: current.revision + 1,
    }))
    if (!mutating) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')

    const result = await dependencies.applyEngine.checkpoint({
      isolatedPath: mutating.managedRoot,
      expectedFingerprint: review.isolatedFingerprint,
      expectedHeadOid: review.isolatedHeadOid,
      commitMessage,
      beforeCommit: async (prepared) => {
        const journaled = updateManagedCheckout(mutating.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'checkpoint'
            ? {
                ...current.journal,
                step: 'updating_ref',
                commitOid: prepared.commitOid,
                parentOid: prepared.parentOid,
                checkpointIndexTreeOid: prepared.indexTreeOid,
                changedFiles: [...prepared.changedFiles],
              }
            : current.journal,
          revision: current.revision + 1,
        }))
        if (!journaled?.journal || journaled.journal.operation !== 'checkpoint' || journaled.journal.commitOid !== prepared.commitOid) {
          throw new SessionCheckoutError('stale_target', 'Checkpoint journal 在保留内部 ref 前发生变化')
        }
        await dependencies.git.retainInternalArtifact(mutating.localRoot, mutating.checkoutId, `checkpoints/${checkpointId}`, prepared.commitOid)
      },
    })
    if (result.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[mutating.checkoutId]
      const commitPrepared = current?.journal?.operation === 'checkpoint' && typeof current.journal.commitOid === 'string'
      if (!commitPrepared) {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({
          ...checkout,
          phase: 'ready',
          ...(result.error.code === 'stale_isolated' ? { previousReview: projectPreviousReview(review) } : {}),
          delivery: result.error.code === 'stale_isolated'
            ? { state: 'working', iteration: review.iteration }
            : { state: 'ready_for_review', review },
          journal: null,
          revision: checkout.revision + 1,
        }))
      } else {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding, false))
    }

    const checkpoint: ManagedWorktreeCheckpointRecord = {
      checkpointId,
      sequence: checkpointSequence,
      reviewId: review.reviewId,
      requestId: input.requestId,
      requestedRevision: input.expectedRevision,
      generation: input.expectedGeneration,
      iteration: review.iteration,
      createdAt: startedAt,
      commitOid: result.commitOid,
      parentOid: result.parentOid,
      summary: review.summary,
      commitMessage,
      validationStatus: review.validationStatus,
      changedFiles: [...result.changedFiles],
    }
    const completed = updateManagedCheckout(mutating.checkoutId, (current) => {
      const { recoveryContinuation: _continuation, ...withoutContinuation } = current
      return {
        ...withoutContinuation,
        phase: 'ready',
        previousReview: projectPreviousReview(review),
        checkpoints: [...(current.checkpoints ?? []), checkpoint],
        delivery: { state: 'working', iteration: review.iteration },
        journal: null,
        revision: current.revision + 1,
      }
    })
    if (!completed) return operationError('checkout_missing', 'Checkpoint 已创建，但 Checkout 记录丢失')
    return {
      status: 'checkpointed',
      target: await inspectIsolated(binding),
      checkpoint: projectCheckpoint(checkpoint),
      changedFiles: [...checkpoint.changedFiles],
    }
  }

  async function resumeRevisionTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    recovery?: Omit<ManagedApplyConflictRecoveryContinuation, 'workingRevision'>,
  ): Promise<SessionTargetView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', '只有 owner Isolated 会话可以恢复编辑')
    }
    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== expectedRevision) {
      throw new SessionCheckoutError('stale_target', 'Session Target 已变化，请刷新后重试')
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      throw new SessionCheckoutError('operation_not_allowed', '当前 Worktree 没有可恢复编辑的未同步验收稿')
    }
    if (record.delivery.review.reviewId !== expectedReviewId) {
      throw new SessionCheckoutError('stale_target', '该验收卡已不是当前 Review，请刷新后重试')
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      throw new SessionCheckoutError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复')
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !record
      || record.revision !== expectedRevision
      || record.phase !== 'ready'
      || record.delivery.state !== 'ready_for_review'
      || record.delivery.review.reviewId !== expectedReviewId
    ) {
      throw new SessionCheckoutError('stale_target', '验收状态在恢复编辑前发生变化，请刷新后重试')
    }
    if (recovery) {
      const preflight = await preflightTarget(sessionId, expectedRevision)
      const sameFiles = preflight.status === 'conflict'
        && preflight.conflictingFiles.length === recovery.conflictingFiles.length
        && preflight.conflictingFiles.every((file, index) => file === recovery.conflictingFiles[index])
      if (
        recovery.kind !== 'worktree_apply_conflict'
        || recovery.reviewId !== expectedReviewId
        || recovery.readyRevision !== expectedRevision
        || preflight.status !== 'conflict'
        || preflight.localHeadOid !== recovery.localHeadOid
        || !sameFiles
      ) throw new SessionCheckoutError('stale_target', '冲突恢复身份在 Host CAS 前已变化，请重新预检')
      record = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (
        !record
        || record.revision !== expectedRevision
        || record.delivery.state !== 'ready_for_review'
        || record.delivery.review.reviewId !== expectedReviewId
      ) throw new SessionCheckoutError('stale_target', '验收状态在冲突恢复前发生变化，请刷新后重试')
    }
    const reviewBeforeResume = record.delivery.review
    const iteration = reviewBeforeResume.iteration
    updateManagedCheckout(record.checkoutId, (current) => {
      const { recoveryContinuation: _previousRecovery, ...withoutRecovery } = current
      return {
        ...withoutRecovery,
        previousReview: projectPreviousReview(reviewBeforeResume),
        ...(recovery ? {
          recoveryContinuation: { ...recovery, workingRevision: current.revision + 1 },
        } : {}),
        delivery: { state: 'working', iteration },
        revision: current.revision + 1,
      }
    })
    return inspectIsolated(binding)
  }

  async function prepareReviewRegenerationTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    requestId: string,
  ): Promise<ManagedReviewRegenerationContinuation> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('not_owner', '只有 owner Isolated 会话可以请求重新生成验收结果')
    }
    const preflight = await preflightTarget(sessionId, expectedRevision)
    if (
      preflight.status !== 'blocked'
      || preflight.reason !== 'stale_isolated'
      || preflight.checkoutId !== binding.target.checkoutId
      || preflight.reviewId !== expectedReviewId
      || preflight.revision !== expectedRevision
    ) throw new SessionCheckoutError('stale_target', '只读验收再生成身份在 Host 授权前已变化')
    const continuation: ManagedReviewRegenerationContinuation = {
      kind: 'worktree_review_regeneration', requestId, reviewId: expectedReviewId, revision: expectedRevision,
    }
    const updated = updateManagedCheckout(binding.target.checkoutId, (current) => {
      if (
        current.revision !== expectedRevision
        || current.delivery.state !== 'ready_for_review'
        || current.delivery.review.reviewId !== expectedReviewId
      ) throw new SessionCheckoutError('stale_target', 'Ready Review 在只读授权前发生变化')
      return { ...current, recoveryContinuation: continuation }
    })
    if (!updated) throw new SessionCheckoutError('checkout_missing', 'Isolated Checkout 记录不存在')
    return continuation
  }

  async function preparePreviewRecoveryAnalysisTarget(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    requestId: string,
  ): Promise<ManagedPreviewRecoveryAnalysisContinuation> {
    const recovery = await preflightPreviewRecoveryTarget(
      sessionId,
      proof.revision,
      proof.reviewId,
      proof.previewId,
    )
    if (recovery.status !== 'assessed' || !recoveryProofMatches(proof, recovery.proof)) {
      throw new SessionCheckoutError('stale_target', 'Detached Preview Recovery proof 已变化，请重新检查')
    }
    const continuation: ManagedPreviewRecoveryAnalysisContinuation = {
      kind: 'worktree_preview_recovery_analysis',
      requestId,
      reviewId: proof.reviewId,
      previewId: proof.previewId,
      revision: proof.revision,
      generation: proof.generation,
    }
    const updated = updateManagedCheckout(proof.checkoutId, (current) => {
      if (
        current.ownerSessionId !== sessionId
        || current.revision !== proof.revision
        || current.delivery.state !== 'preview_detached'
        || current.delivery.review.reviewId !== proof.reviewId
        || current.delivery.preview.previewId !== proof.previewId
      ) throw new SessionCheckoutError('stale_target', 'Detached Preview 在分析授权前发生变化')
      return { ...current, recoveryContinuation: continuation }
    })
    if (!updated) throw new SessionCheckoutError('checkout_missing', 'Isolated Checkout 记录不存在')
    return continuation
  }

  async function createPreviewRecoveryHandoffTarget(
    sessionId: string,
    proof: WorktreePreviewRecoveryProof,
    targetSessionId: string,
    requestId: string,
  ): Promise<IsolatedTargetLaunch & { continuation: ManagedPreviewRecoveryHandoffContinuation }> {
    if (!targetSessionId || targetSessionId === sessionId) {
      throw new SessionCheckoutError('invalid_input', 'Recovery handoff 必须使用新的预分配 Session ID')
    }
    if (dependencies.lookup.getSession(targetSessionId) || getPersistedBinding(targetSessionId)) {
      throw new SessionCheckoutError('target_already_bound', 'Recovery handoff Session ID 已被占用')
    }
    const recovery = await preflightPreviewRecoveryTarget(
      sessionId,
      proof.revision,
      proof.reviewId,
      proof.previewId,
    )
    if (recovery.status !== 'assessed' || !recoveryProofMatches(proof, recovery.proof)) {
      throw new SessionCheckoutError('stale_target', 'Detached Preview Recovery proof 已变化，请重新检查')
    }
    const source = dependencies.registry.read().managedCheckouts[proof.checkoutId]
    if (!source || source.ownerSessionId !== sessionId || source.delivery.state !== 'preview_detached') {
      throw new SessionCheckoutError('stale_target', '旧 Detached Preview 身份已变化')
    }
    const originSessionId = source.sourceSessionId ?? source.ownerSessionId
    if (!dependencies.lookup.getSession(originSessionId)) {
      throw new SessionCheckoutError('session_not_found', '原始 source Session 不可用，未创建 handoff Worktree')
    }
    const target = await bindTarget(targetSessionId, { kind: 'isolated' }, 0, Date.now(), originSessionId)
    const binding = getPersistedBinding(targetSessionId)
    const created = binding?.target.kind === 'isolated'
      ? dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
      : undefined
    if (!created) throw new SessionCheckoutError('checkout_missing', 'Recovery handoff Worktree 创建后记录缺失')
    const continuation: ManagedPreviewRecoveryHandoffContinuation = {
      kind: 'worktree_preview_recovery_handoff',
      requestId,
      sourceCheckoutId: source.checkoutId,
      reviewId: proof.reviewId,
      previewId: proof.previewId,
      sourceRevision: proof.revision,
      generation: proof.generation,
    }
    updateManagedCheckout(created.checkoutId, (current) => ({ ...current, recoveryContinuation: continuation }))
    return { targetSessionId, managedRoot: created.managedRoot, target, continuation }
  }

  async function operateApply(
    input: Extract<SessionCheckoutOperation, { action: 'apply' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', '继承 Session Target 的会话不能执行 Apply')
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', 'Local Checkout 不支持 Apply')
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (record.phase !== 'ready') {
      return operationError('operation_not_allowed', `当前 ${record.phase}/${record.delivery.state} 状态不能 Apply`, await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        `同一项目已有验收任务正在占用 Local：${holder.projectName}`,
        await inspectIsolated(binding),
      )
    }

    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复', inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 状态已变化，需要恢复')
    }

    const startedAt = Date.now()
    const operationId = dependencies.createCheckoutId()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const applying = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: { operation: 'apply', operationId, step: 'planning', startedAt, baseOid: applyBaseOid },
      revision: current.revision + 1,
    }))
    if (!applying) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')

    const planResult = await dependencies.applyEngine.plan({
      baseOid: applyBaseOid,
      isolatedPath: applying.managedRoot,
      localPath: applying.localRoot,
    })
    if (planResult.status === 'conflict') {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return {
        status: 'conflict',
        code: 'apply_conflict',
        reason: 'content_conflict',
        target: await inspectIsolated(binding),
        baseStrategy: planResult.baseStrategy,
        effectiveBaseOid: planResult.effectiveBaseOid,
        localHeadOid: planResult.localHeadOid,
        isolatedHeadOid: planResult.isolatedHeadOid,
        canRetryAfterRefresh: false,
        conflictingFiles: planResult.conflictingFiles,
      }
    }
    if (planResult.status === 'error') {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return operationError(planResult.error.code, planResult.error.message, await inspectIsolated(binding))
    }
    if (
      applying.delivery.state === 'ready_for_review'
      && planResult.plan.isolatedFingerprint !== applying.delivery.review.isolatedFingerprint
    ) {
      updateManagedCheckout(applying.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: applying.delivery.state === 'ready_for_review' ? applying.delivery.review.iteration : 1 },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', 'Worktree 在标记可验收后又发生变化，请重新准备验收', await inspectIsolated(binding))
    }
    if (planResult.plan.changedFiles.length === 0) {
      updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return { status: 'applied', target: await inspectIsolated(binding), changedFiles: [] }
    }

    const iteration = applying.delivery.state === 'working'
      ? applying.delivery.iteration
      : applying.delivery.state === 'delivered'
        ? applying.delivery.iteration + 1
        : applying.delivery.review.iteration
    const review = applying.delivery.state === 'ready_for_review'
      ? applying.delivery.review
      : {
          reviewId: operationId,
          iteration,
          preparedAt: startedAt,
          summary: 'Worktree 修改已通过 ApplyWorktree 写入 Local Preview',
          validationStatus: 'not_run' as const,
          tests: [],
          changedFiles: [...planResult.plan.changedFiles],
          suggestedCommitMessage: 'chore: 提交 Worktree 修改',
          isolatedFingerprint: planResult.plan.isolatedFingerprint,
          isolatedHeadOid: planResult.plan.isolatedHeadOid,
        }

    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      delivery: { state: 'ready_for_review', review },
      journal: {
        operation: 'apply',
        operationId,
        step: 'writing_local',
        startedAt,
        baseOid: applyBaseOid,
        planRevision: planResult.plan.revision,
        localFingerprint: planResult.plan.localFingerprint,
        isolatedFingerprint: planResult.plan.isolatedFingerprint,
        effectiveBaseOid: planResult.plan.effectiveBaseOid,
        baseStrategy: planResult.plan.baseStrategy,
        localHeadOid: planResult.plan.localHeadOid,
        isolatedHeadOid: planResult.plan.isolatedHeadOid,
        changedFiles: [...planResult.plan.changedFiles],
      },
      revision: current.revision + 1,
    }))

    const result = await dependencies.applyEngine.apply(planResult.plan)
    if (result.status === 'error') {
      if (
        result.error.code === 'invalid_plan'
        || result.error.code === 'stale_local'
        || result.error.code === 'stale_isolated'
      ) {
        // 这些错误码可证明未触碰 Local，恢复 ready；git_error 交由 reconcile 兜底 recovery_required。
        updateManagedCheckout(applying.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }

    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      applyBaseOid: result.nextBaseOid,
      phase: 'ready',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'applied', target: await inspectIsolated(binding), changedFiles: result.changedFiles }
  }

  function holdsProjectAcceptanceSlot(record: ManagedCheckoutRecord): boolean {
    return record.delivery.state === 'preview_active'
      || record.journal?.operation === 'preview'
      || record.journal?.operation === 'rollback_preview'
      || record.journal?.operation === 'finalize_preview'
      || record.journal?.operation === 'finish'
  }

  function findProjectAcceptanceHolder(record: ManagedCheckoutRecord): ManagedCheckoutRecord | undefined {
    return Object.values(dependencies.registry.read().managedCheckouts).find((candidate) => (
      candidate.checkoutId !== record.checkoutId
      && candidate.phase !== 'discarded'
      && pathsEqual(candidate.localRoot, record.localRoot)
      && holdsProjectAcceptanceSlot(candidate)
    ))
  }

  async function retainPreviewArtifacts(record: ManagedCheckoutRecord, receipt: ManagedPreviewReceipt): Promise<void> {
    const prefix = `previews/${receipt.previewId}`
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/local-working`, receipt.localWorkingTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/local-index`, receipt.localIndexTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/preview-working`, receipt.previewWorkingTreeOid)
    await dependencies.git.retainInternalArtifact(record.localRoot, record.checkoutId, `${prefix}/isolated-snapshot`, receipt.isolatedSnapshotOid)
  }

  async function releasePreviewArtifactsBestEffort(record: ManagedCheckoutRecord, previewId: string): Promise<void> {
    try {
      await dependencies.git.releaseInternalArtifacts(record.localRoot, record.checkoutId, `previews/${previewId}`)
    } catch {
      console.warn('[session-checkout] 清理 Preview refs 失败，已保守保留不可见引用')
    }
  }

  async function previewArtifactsMatch(record: ManagedCheckoutRecord, receipt: ManagedPreviewReceipt): Promise<boolean> {
    const prefix = `previews/${receipt.previewId}`
    const expected: Array<[string, string]> = [
      [`${prefix}/local-working`, receipt.localWorkingTreeOid],
      [`${prefix}/local-index`, receipt.localIndexTreeOid],
      [`${prefix}/preview-working`, receipt.previewWorkingTreeOid],
      [`${prefix}/isolated-snapshot`, receipt.isolatedSnapshotOid],
    ]
    for (const [name, oid] of expected) {
      if (await dependencies.git.readInternalArtifact(record.localRoot, record.checkoutId, name) !== oid) return false
    }
    return true
  }

  function blockedPreviewRecovery(
    record: ManagedCheckoutRecord | undefined,
    reason: Extract<WorktreePreviewRecoveryPreflightView, { status: 'blocked' }>['reason'],
    message: string,
  ): WorktreePreviewRecoveryPreflightView {
    const delivery = record?.delivery
    const detached = delivery?.state === 'preview_detached' ? delivery : undefined
    return {
      status: 'blocked',
      localModified: false,
      checkoutId: record?.checkoutId ?? '',
      reviewId: detached?.review.reviewId ?? null,
      previewId: detached?.preview.previewId ?? null,
      revision: record?.revision ?? 0,
      reason,
      message,
    }
  }

  function canonicalJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (value !== null && typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
      return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`
    }
    return JSON.stringify(value)
  }

  function sha256Facts(value: unknown): string {
    return createHash('sha256').update(canonicalJson(value)).digest('hex')
  }

  function recoveryGeneration(facts: Omit<WorktreePreviewRecoveryProof, 'generation'>): string {
    return sha256Facts(facts)
  }

  async function preflightPreviewRecoveryTarget(
    sessionId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
  ): Promise<WorktreePreviewRecoveryPreflightView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      return blockedPreviewRecovery(undefined, 'not_owner', '只有 owner Isolated 会话可以检查 Preview 恢复')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return blockedPreviewRecovery(undefined, 'checkout_unavailable', 'Isolated Checkout 记录不存在')
    if (record.revision !== expectedRevision) {
      return blockedPreviewRecovery(record, 'stale_target', 'Session Target 已变化，请刷新后重新检查')
    }
    if (
      record.phase !== 'ready'
      || record.delivery.state !== 'preview_detached'
      || record.delivery.review.reviewId !== expectedReviewId
      || record.delivery.preview.previewId !== expectedPreviewId
    ) {
      return blockedPreviewRecovery(record, 'not_preview_detached', '当前并非指定的 detached Preview 恢复状态')
    }
    const validated = await validateManagedCheckoutDetailed(binding, record, false)
    if (validated.status !== 'valid') {
      return blockedPreviewRecovery(record, 'checkout_unavailable', 'Worktree 身份、路径或 Git 状态暂时无法确认')
    }
    const { review, preview } = record.delivery
    try {
      if (!await previewArtifactsMatch(record, preview)) {
        return blockedPreviewRecovery(record, 'artifacts_missing', 'Preview retained artifacts 缺失或与 receipt 不一致')
      }
      const assessment = await dependencies.applyEngine.assessPreviewRecovery({
        localPath: record.localRoot,
        receipt: preview,
      })
      if ('error' in assessment) {
        return blockedPreviewRecovery(record, 'git_error', assessment.error.message)
      }
      const holder = findProjectAcceptanceHolder(record)
      const blocker = holder
        ? { checkoutId: holder.checkoutId, ownerSessionId: holder.ownerSessionId, revision: holder.revision, state: holder.delivery.state }
        : undefined
      const rollback = holder
        ? { status: 'blocked' as const, code: 'project_acceptance_busy' as const, message: '另一个任务正在占用该项目的 Local 验收槽位' }
        : assessment.rollback
      const finalize = holder
        ? { status: 'blocked' as const, code: 'project_acceptance_busy' as const, message: '另一个任务正在占用该项目的 Local 验收槽位' }
        : assessment.finalize
      const facts: Omit<WorktreePreviewRecoveryProof, 'generation'> = {
        sessionId,
        checkoutId: record.checkoutId,
        reviewId: review.reviewId,
        previewId: preview.previewId,
        revision: record.revision,
        receiptFingerprint: sha256Facts(preview),
        localFingerprint: assessment.localFingerprint,
        localHeadOid: assessment.localHeadOid,
        localHeadRef: assessment.localHeadRef,
        localHeadTreeOid: assessment.localHeadTreeOid,
        localIndexTreeOid: assessment.localIndexTreeOid,
        localWorkingTreeOid: assessment.localWorkingTreeOid,
        rollback,
        finalize,
        ...(blocker ? { blocker } : {}),
      }
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (
        !current
        || current.revision !== record.revision
        || current.phase !== 'ready'
        || current.delivery.state !== 'preview_detached'
        || current.delivery.review.reviewId !== review.reviewId
        || current.delivery.preview.previewId !== preview.previewId
      ) {
        return blockedPreviewRecovery(current, 'stale_target', 'Preview 恢复状态在检查期间发生变化')
      }
      if (!await previewArtifactsMatch(current, current.delivery.preview)) {
        return blockedPreviewRecovery(current, 'artifacts_missing', 'Preview retained artifacts 在检查期间发生变化')
      }
      const proof: WorktreePreviewRecoveryProof = { ...facts, generation: recoveryGeneration(facts) }
      return { status: 'assessed', localModified: false, proof }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Preview 恢复检查失败'
      return blockedPreviewRecovery(record, 'git_error', message)
    }
  }

  function recoveryProofMatches(left: WorktreePreviewRecoveryProof | undefined, right: WorktreePreviewRecoveryProof): boolean {
    if (left === undefined) return false
    const { generation: leftGeneration, ...leftFacts } = left
    return leftGeneration === recoveryGeneration(leftFacts) && leftGeneration === right.generation
  }

  function blockedPreflight(
    record: ManagedCheckoutRecord | undefined,
    reason: WorktreeApplyPreflightBlockedReason,
    message: string,
    blocker?: ManagedCheckoutRecord,
  ): WorktreeApplyPreflightView {
    return {
      status: 'blocked',
      localModified: false,
      checkoutId: record?.checkoutId ?? '',
      reviewId: record?.delivery.state === 'ready_for_review' ? record.delivery.review.reviewId : null,
      revision: record?.revision ?? 0,
      reason,
      message,
      ...(blocker === undefined ? {} : {
        blocker: {
          checkoutId: blocker.checkoutId,
          ownerSessionId: blocker.ownerSessionId,
          revision: blocker.revision,
          state: blocker.delivery.state,
        },
      }),
    }
  }

  async function preflightTarget(sessionId: string, expectedRevision: number): Promise<WorktreeApplyPreflightView> {
    const binding = await resolveBinding(sessionId)
    if (binding.ownerSessionId !== sessionId || binding.target.kind !== 'isolated') {
      return blockedPreflight(undefined, 'not_owner', '只有 owner Isolated 会话可以执行同步预检')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return blockedPreflight(undefined, 'checkout_unavailable', 'Isolated Checkout 记录不存在')
    if (record.revision !== expectedRevision) {
      return blockedPreflight(record, 'stale_target', 'Session Target 已变化，请刷新后重新预检')
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      return blockedPreflight(record, 'not_ready_for_review', '当前 Worktree 尚未处于可验收状态')
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return blockedPreflight(record, 'project_acceptance_busy', '另一个任务正在占用该项目的 Local 验收槽位', holder)
    }
    const validated = await validateManagedCheckoutDetailed(binding, record, false)
    if (validated.status !== 'valid') {
      return blockedPreflight(record, 'checkout_unavailable', 'Worktree 身份、路径或 Git 状态暂时无法确认')
    }
    const review = record.delivery.review
    const result = await dependencies.applyEngine.preflight({
      baseOid: record.applyBaseOid ?? record.baseOid,
      isolatedPath: validated.checkout.canonicalManagedRoot,
      localPath: record.localRoot,
    })
    const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (
      !current
      || current.revision !== expectedRevision
      || current.delivery.state !== 'ready_for_review'
      || current.delivery.review.reviewId !== review.reviewId
    ) return blockedPreflight(current, 'stale_target', 'Session Target 在预检期间发生变化，请刷新后重试')
    if (result.status === 'error') {
      const reason = result.error.code === 'stale_isolated'
        ? 'stale_isolated'
        : result.error.code === 'stale_local'
          ? 'stale_local'
          : 'git_error'
      return blockedPreflight(current, reason, result.error.message)
    }
    const isolatedFingerprint = result.status === 'ready'
      ? result.plan.isolatedFingerprint
      : result.isolatedFingerprint
    if (isolatedFingerprint !== review.isolatedFingerprint) {
      return blockedPreflight(current, 'stale_isolated', 'Worktree 在准备验收后发生变化，请重新生成验收结果')
    }
    const localBranch = result.status === 'ready' && result.plan.localHeadRef?.startsWith('refs/heads/')
      ? result.plan.localHeadRef.slice('refs/heads/'.length)
      : validated.checkout.snapshot.branch
    const common = {
      localModified: false as const,
      checkoutId: record.checkoutId,
      reviewId: review.reviewId,
      revision: expectedRevision,
      configuredBaseOid: record.baseOid,
      effectiveBaseOid: result.status === 'ready' ? result.plan.effectiveBaseOid : result.effectiveBaseOid,
      baseStrategy: result.status === 'ready' ? result.plan.baseStrategy : result.baseStrategy,
      localBranch,
      localHeadOid: result.status === 'ready' ? result.plan.localHeadOid : result.localHeadOid,
      isolatedHeadOid: result.status === 'ready' ? result.plan.isolatedHeadOid : result.isolatedHeadOid,
      changedFiles: result.status === 'ready' ? [...result.plan.changedFiles] : [...review.changedFiles],
    }
    if (result.status === 'conflict') {
      return { ...common, status: 'conflict', conflictingFiles: [...result.conflictingFiles] }
    }
    const status = result.plan.changedFiles.length === 0
      ? 'already_in_local' as const
      : result.plan.localHeadOid !== record.baseOid
        ? 'local_advanced' as const
        : 'ready' as const
    return { ...common, status }
  }

  async function operatePreview(
    input: Extract<SessionCheckoutOperation, { action: 'preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', '只有 owner Isolated 会话可以同步验收')
    }
    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (record.phase !== 'ready' || record.delivery.state !== 'ready_for_review') {
      return operationError('operation_not_allowed', '当前 Worktree 尚未处于可验收状态', await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        `同一项目已有验收任务正在占用 Local：${holder.projectName}`,
        await inspectIsolated(binding),
      )
    }
    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复', inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.delivery.state !== 'ready_for_review') {
      return operationError('stale_target', '验收状态已变化，请刷新后重试')
    }
    const review = record.delivery.review
    const operationId = dependencies.createCheckoutId()
    const previewId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const mutating = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'preview',
        operationId,
        step: 'planning',
        startedAt,
        baseOid: applyBaseOid,
        previewId,
        reviewId: review.reviewId,
      },
      revision: current.revision + 1,
    }))
    if (!mutating) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')

    const planResult = await dependencies.applyEngine.plan({
      baseOid: applyBaseOid,
      isolatedPath: mutating.managedRoot,
      localPath: mutating.localRoot,
    })
    if (planResult.status === 'conflict') {
      updateManagedCheckout(mutating.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return {
        status: 'conflict',
        code: 'apply_conflict',
        reason: 'content_conflict',
        target: await inspectIsolated(binding),
        baseStrategy: planResult.baseStrategy,
        effectiveBaseOid: planResult.effectiveBaseOid,
        localHeadOid: planResult.localHeadOid,
        isolatedHeadOid: planResult.isolatedHeadOid,
        canRetryAfterRefresh: false,
        conflictingFiles: planResult.conflictingFiles,
      }
    }
    if (planResult.status === 'error') {
      updateManagedCheckout(mutating.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      return operationError(planResult.error.code, planResult.error.message, await inspectIsolated(binding))
    }
    if (planResult.plan.isolatedFingerprint !== review.isolatedFingerprint) {
      updateManagedCheckout(mutating.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: review.iteration },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', 'Worktree 在标记可验收后又发生变化，请重新准备验收', await inspectIsolated(binding))
    }
    updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      journal: {
        operation: 'preview',
        operationId,
        step: 'writing_local',
        startedAt,
        baseOid: applyBaseOid,
        previewId,
        reviewId: review.reviewId,
        planRevision: planResult.plan.revision,
        localFingerprint: planResult.plan.localFingerprint,
        isolatedFingerprint: planResult.plan.isolatedFingerprint,
        effectiveBaseOid: planResult.plan.effectiveBaseOid,
        baseStrategy: planResult.plan.baseStrategy,
        localHeadOid: planResult.plan.localHeadOid,
        isolatedHeadOid: planResult.plan.isolatedHeadOid,
        changedFiles: [...planResult.plan.changedFiles],
      },
      revision: current.revision + 1,
    }))
    const previewResult = await dependencies.applyEngine.preview(planResult.plan, {
      previewId,
      reviewId: review.reviewId,
      iteration: review.iteration,
      beforeWrite: async (receipt) => {
        await retainPreviewArtifacts(mutating, receipt)
        updateManagedCheckout(mutating.checkoutId, (current) => ({
          ...current,
          delivery: { state: 'preview_active', review, preview: receipt },
          journal: current.journal?.operation === 'preview'
            ? { ...current.journal, step: 'artifacts_retained' }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (previewResult.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[mutating.checkoutId]
      const definitelyUnchanged = previewResult.error.code === 'stale_local'
        || previewResult.error.code === 'stale_isolated'
        || previewResult.error.code === 'invalid_plan'
        || previewResult.error.code === 'invalid_input'
        || current?.journal?.step === 'writing_local'
      if (current?.journal?.step === 'writing_local') await releasePreviewArtifactsBestEffort(mutating, previewId)
      if (definitelyUnchanged || current?.journal?.step === 'artifacts_retained') {
        updateManagedCheckout(mutating.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      }
      return operationError(previewResult.error.code, previewResult.error.message, await inspectIsolated(binding))
    }
    const receipt: ManagedPreviewReceipt = previewResult.receipt
    updateManagedCheckout(mutating.checkoutId, (current) => ({
      ...current,
      phase: 'ready',
      delivery: { state: 'preview_active', review, preview: receipt },
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'previewed', target: await inspectIsolated(binding), changedFiles: previewResult.changedFiles }
  }

  async function detachPreviewAfterLocalDrift(
    record: ManagedCheckoutRecord,
    binding: SessionBindingRecord,
    reason: 'stale_local' | 'preview_modified',
    attemptedAction: 'rollback_preview' | 'finalize_preview' | 'discard',
  ): Promise<SessionCheckoutOperationResult> {
    if (record.delivery.state !== 'preview_active') {
      return operationError('preview_not_active', '当前没有可解除的 Local Preview', await inspectIsolated(binding))
    }
    const { review, preview } = record.delivery
    const detached = updateManagedCheckout(record.checkoutId, (current) => {
      if (current.delivery.state !== 'preview_active') return current
      return {
        ...current,
        phase: 'ready',
        delivery: {
          state: 'preview_detached',
          review: current.delivery.review,
          preview: current.delivery.preview,
          detachedAt: Date.now(),
          reason,
          attemptedAction,
        },
        journal: null,
        revision: current.revision + 1,
      }
    })
    if (!detached || detached.delivery.state !== 'preview_detached') {
      return operationError('stale_target', 'Preview 状态已变化，请刷新后重试', await inspectIsolated(binding))
    }
    return {
      status: 'preview_detached',
      target: await inspectIsolated(binding),
      changedFiles: [...preview.changedFiles],
      reason,
      attemptedAction,
    }
  }

  async function operateRollbackPreview(
    input: Extract<SessionCheckoutOperation, { action: 'rollback_preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', '只有 owner Isolated 会话可以撤回验收')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    const retryingRecovery = record.phase === 'recovery_required'
      && record.delivery.state === 'preview_active'
      && record.journal?.operation === 'rollback_preview'
    if (
      (record.phase !== 'ready' && !retryingRecovery)
      || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
    ) {
      return operationError('preview_not_active', '当前没有可撤回的 Local Preview', await inspectIsolated(binding))
    }
    const retryingDetached = record.delivery.state === 'preview_detached'
    if (retryingDetached) {
      const recovery = await preflightPreviewRecoveryTarget(
        input.sessionId,
        input.expectedRevision,
        record.delivery.review.reviewId,
        record.delivery.preview.previewId,
      )
      if (recovery.status !== 'assessed') {
        return operationError('stale_target', recovery.message, await inspectIsolated(binding))
      }
      if (!recoveryProofMatches(input.recoveryProof, recovery.proof)) {
        return operationError('stale_target', 'Preview Recovery proof 已过期或不匹配，请重新检查', await inspectIsolated(binding))
      }
      if (recovery.proof.rollback.status !== 'safe') {
        return operationError(recovery.proof.rollback.code, recovery.proof.rollback.message, await inspectIsolated(binding))
      }
    }
    const resumeRevision = input.resumeRevision ?? (
      retryingRecovery && record.journal?.operation === 'rollback_preview'
        ? record.journal.resumeRevision ?? false
        : false
    )
    const { preview, review } = record.delivery
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'rollback_preview',
        operationId,
        step: 'planning',
        startedAt,
        previewId: preview.previewId,
        reviewId: review.reviewId,
        resumeRevision,
        ...(input.recoveryProof ? { recoveryGeneration: input.recoveryProof.generation } : {}),
      },
      revision: current.revision + 1,
    }))
    const result = await dependencies.applyEngine.rollback({
      localPath: record.localRoot,
      receipt: preview,
      beforeWrite: async () => {
        updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'rollback_preview'
            ? { ...current.journal, step: 'writing_local' }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (result.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      const writeStarted = current?.journal?.operation === 'rollback_preview' && current.journal.step === 'writing_local'
      if (result.error.code === 'stale_local' || result.error.code === 'preview_modified') {
        if (!retryingDetached) {
          return detachPreviewAfterLocalDrift(record, binding, result.error.code, 'rollback_preview')
        }
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else if (
        result.error.code === 'invalid_input'
        || !writeStarted
        || (result.error.code === 'git_error' && result.error.recoveryState === 'unchanged')
      ) {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'ready',
      delivery: resumeRevision
        ? { state: 'working', iteration: review.iteration }
        : { state: 'ready_for_review', review },
      journal: null,
      revision: current.revision + 1,
    }))
    await releasePreviewArtifactsBestEffort(record, preview.previewId)
    return { status: 'preview_rolled_back', target: await inspectIsolated(binding), changedFiles: result.changedFiles }
  }

  function retainFinalized(
    record: ManagedCheckoutRecord,
    retention: Exclude<WorktreeRetentionMode, 'cleanup'>,
  ): ManagedCheckoutRecord | undefined {
    if (record.delivery.state !== 'finalized') return undefined
    const retainedAt = Date.now()
    return updateManagedCheckout(record.checkoutId, (current) => {
      if (current.delivery.state !== 'finalized') return current
      return {
        ...current,
        phase: 'retained',
        delivery: {
          state: 'retained',
          review: current.delivery.review,
          commitOid: current.delivery.commitOid,
          ...(current.delivery.proof ? { proof: current.delivery.proof } : {}),
          isolatedFingerprint: current.delivery.isolatedFingerprint,
          retention,
          retainedAt,
          expiresAt: retentionExpiresAt(retention, retainedAt),
          cleanup: 'scheduled',
        },
        journal: null,
        revision: current.revision + 1,
      }
    })
  }

  async function cleanupFinalized(
    record: ManagedCheckoutRecord,
    options: { allowLegacyResidue?: boolean } = {},
  ): Promise<{ cleaned: boolean; message?: string; reason?: WorktreeCleanupReason }> {
    const block = (message: string, reason = cleanupReasonForMessage(message)): { cleaned: false; message: string; reason: WorktreeCleanupReason } => {
      updateManagedCheckout(record.checkoutId, (current) => {
        const journal = current.journal?.operation === 'cleanup' ? current.journal : null
        if (current.delivery.state === 'finalized') {
          return {
            ...current,
            phase: 'finalized',
            delivery: { ...current.delivery, cleanup: 'blocked', cleanupMessage: message },
            journal,
            revision: current.revision + 1,
          }
        }
        if (current.delivery.state === 'retained') {
          return {
            ...current,
            phase: 'retained',
            delivery: { ...current.delivery, cleanup: 'blocked', cleanupMessage: message },
            journal,
            revision: current.revision + 1,
          }
        }
        return current
      })
      return { cleaned: false, message, reason }
    }
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') {
      return block('Worktree 交付状态不完整，未执行清理。')
    }
    if (
      (record.delivery.state === 'finalized' || record.delivery.state === 'retained')
      && record.delivery.cleanup === 'blocked'
      && record.delivery.cleanupMessage?.includes('Local index')
    ) {
      return block(record.delivery.cleanupMessage)
    }
    if (hasLegacyCleanupResidueEvidence(record) && !options.allowLegacyResidue && dependencies.files.exists(record.managedGitRoot)) {
      return { cleaned: false, message: CLEANUP_RESIDUE_MESSAGE, reason: 'detached_residue' }
    }
    const registry = dependencies.registry.read()
    const persistedBinding = registry.sessionBindings[record.ownerSessionId]
    const binding: SessionBindingRecord = persistedBinding?.target.kind === 'isolated'
      && persistedBinding.target.checkoutId === record.checkoutId
      ? persistedBinding
      : bindingForManagedRecord(record)

    const beginRemoval = (
      currentRecord: ManagedCheckoutRecord,
      managedDirectoryIdentity: DirectoryIdentity,
    ): ManagedCheckoutRecord | undefined => {
      if (hasCleanupRemovalReceipt(currentRecord)) return currentRecord
      return updateManagedCheckout(currentRecord.checkoutId, (current) => ({
        ...current,
        journal: {
          operation: 'cleanup',
          operationId: dependencies.createCheckoutId(),
          step: 'removing_worktree',
          startedAt: Date.now(),
          commitOid: current.delivery.state === 'finalized' || current.delivery.state === 'retained'
            ? current.delivery.commitOid ?? undefined
            : undefined,
          isolatedFingerprint: current.delivery.state === 'finalized' || current.delivery.state === 'retained'
            ? current.delivery.isolatedFingerprint
            : undefined,
          managedDirectoryIdentity,
        },
        revision: current.revision + 1,
      }))
    }

    const quarantineAndRemove = async (
      currentRecord: ManagedCheckoutRecord,
      residue: ValidatedCleanupResidue,
    ): Promise<void> => {
      const journal = currentRecord.journal?.operation === 'cleanup' ? currentRecord.journal : undefined
      if (!journal?.managedDirectoryIdentity) throw new SessionCheckoutError('checkout_mismatch', 'Worktree cleanup receipt 不完整')
      const quarantinePath = journal.cleanupQuarantinePath ?? join(
        dirname(currentRecord.managedGitRoot),
        `.dsh-wt-cleanup--${currentRecord.checkoutId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}--${journal.operationId}`,
      )
      const quarantining = journal.cleanupQuarantinePath
        ? currentRecord
        : updateManagedCheckout(currentRecord.checkoutId, (current) => ({
            ...current,
            journal: current.journal?.operation === 'cleanup'
              ? { ...current.journal, cleanupQuarantinePath: quarantinePath }
              : current.journal,
            revision: current.revision + 1,
          }))
      if (!quarantining) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录在 quarantine 前丢失')
      if (!dependencies.files.exists(quarantinePath)) {
        await retryTransientCleanup(() => dependencies.files.quarantineDirectoryTree(
          residue.canonicalManagedGitRoot,
          residue.directoryIdentity,
          quarantinePath,
        ))
      }
      const validatedQuarantine = await validateCleanupQuarantine(quarantining)
      if (!validatedQuarantine) throw new SessionCheckoutError('checkout_mismatch', 'Worktree quarantine 身份无法验证')
      await retryTransientCleanup(() => dependencies.files.removeDirectoryTree(validatedQuarantine))
    }

    try {
      const existingQuarantine = await validateCleanupQuarantine(record)
      if (existingQuarantine) {
        await retryTransientCleanup(() => dependencies.files.removeDirectoryTree(existingQuarantine))
      } else if (record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath && dependencies.files.exists(record.journal.cleanupQuarantinePath)) {
        return block(CLEANUP_IDENTITY_CHANGED_MESSAGE)
      } else if (dependencies.files.exists(record.managedGitRoot)) {
        const validated = dependencies.files.exists(record.managedRoot)
          ? await validateManagedCheckout(binding, record, false)
          : undefined
        if (validated) {
          const snapshot = await dependencies.applyEngine.inspectReview({
            baseOid: record.applyBaseOid ?? record.baseOid,
            isolatedPath: record.managedRoot,
            localPath: record.localRoot,
          })
          if (snapshot.status !== 'ready' || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint) {
            return block('Worktree 在提交后出现了新修改，未执行清理。')
          }
          const directoryIdentity = await dependencies.files.inspectDirectoryIdentity(validated.canonicalManagedGitRoot)
          if (!directoryIdentity) return block(CLEANUP_IDENTITY_CHANGED_MESSAGE)
          const removing = beginRemoval(record, directoryIdentity)
          if (!removing) return block('Worktree 记录在清理前丢失，未执行清理。')
          await retryTransientCleanup(() => dependencies.git.removeWorktree(removing.localRoot, removing.managedGitRoot))
          if (dependencies.files.exists(removing.managedGitRoot)) {
            const residue = await validateDetachedCleanupResidue(removing)
            if (!residue) return block(CLEANUP_IDENTITY_CHANGED_MESSAGE)
            await quarantineAndRemove(removing, residue)
          }
        } else {
          const residue = await validateDetachedCleanupResidue(record, options.allowLegacyResidue === true)
          if (!residue) return block(CLEANUP_IDENTITY_CHANGED_MESSAGE)
          const removing = beginRemoval(record, residue.directoryIdentity)
          if (!removing) return block('Worktree 记录在清理前丢失，未执行清理。')
          const revalidatedResidue = await validateDetachedCleanupResidue(removing)
          if (!revalidatedResidue) return block(CLEANUP_IDENTITY_CHANGED_MESSAGE)
          await quarantineAndRemove(removing, revalidatedResidue)
        }
      }
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => {
        if (current.delivery.state !== 'finalized' && current.delivery.state !== 'retained') return current
        return {
          ...current,
          phase: 'discarded',
          delivery: {
            state: 'delivered',
            iteration: current.delivery.review.iteration,
            commitOid: current.delivery.commitOid,
            ...(current.delivery.proof ? { proof: current.delivery.proof } : {}),
            deliveredAt: Date.now(),
          },
          journal: null,
          revision: current.revision + 1,
        }
      })
      return { cleaned: true }
    } catch (error) {
      console.warn('[session-checkout] finalized Worktree cleanup failed:', error)
      const failureRecord = dependencies.registry.read().managedCheckouts[record.checkoutId] ?? record
      const quarantineBusy = failureRecord.journal?.operation === 'cleanup' && Boolean(failureRecord.journal.cleanupQuarantinePath)
      const reason: WorktreeCleanupReason = quarantineBusy ? 'quarantine_busy' : 'directory_busy'
      const message = quarantineBusy
        ? 'Worktree 已安全移入 quarantine，但目录仍被进程占用；dsh-git-worktree 会在同一清理授权内有限重试。'
        : 'Worktree 目录仍被进程占用或 Windows 暂时拒绝删除；dsh-git-worktree 已完成有限重试，可稍后重试清理。'
      updateManagedCheckout(record.checkoutId, (current) => {
        const journal = current.journal?.operation === 'cleanup' ? current.journal : null
        if (current.delivery.state === 'finalized') {
          return { ...current, phase: 'finalized', delivery: { ...current.delivery, cleanup: 'pending', cleanupMessage: message }, journal, revision: current.revision + 1 }
        }
        if (current.delivery.state === 'retained') {
          return { ...current, phase: 'retained', delivery: { ...current.delivery, cleanup: 'blocked', cleanupMessage: message }, journal, revision: current.revision + 1 }
        }
        return current
      })
      return { cleaned: false, message, reason }
    }
  }


  async function operateFinalizePreview(
    input: Extract<SessionCheckoutOperation, { action: 'finalize_preview' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', '只有 owner Isolated 会话可以完成验收提交')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (
      record.phase !== 'ready'
      || (record.delivery.state !== 'preview_active' && record.delivery.state !== 'preview_detached')
    ) {
      return operationError('preview_not_active', '当前没有等待验收的 Local Preview', await inspectIsolated(binding))
    }
    const retryingDetached = record.delivery.state === 'preview_detached'
    if (retryingDetached) {
      const recovery = await preflightPreviewRecoveryTarget(
        input.sessionId,
        input.expectedRevision,
        record.delivery.review.reviewId,
        record.delivery.preview.previewId,
      )
      if (recovery.status !== 'assessed') {
        return operationError('stale_target', recovery.message, await inspectIsolated(binding))
      }
      if (!recoveryProofMatches(input.recoveryProof, recovery.proof)) {
        return operationError('stale_target', 'Preview Recovery proof 已过期或不匹配，请重新检查', await inspectIsolated(binding))
      }
      if (recovery.proof.finalize.status !== 'safe') {
        return operationError(recovery.proof.finalize.code, recovery.proof.finalize.message, await inspectIsolated(binding))
      }
    }
    // Harness plugin does not expose Domi collaborator checkout inheritance.
    const { preview, review } = record.delivery
    const operationId = dependencies.createCheckoutId()
    const startedAt = Date.now()
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'finalize_preview',
        operationId,
        step: 'planning',
        startedAt,
        previewId: preview.previewId,
        reviewId: review.reviewId,
        retention: input.retention ?? 'cleanup',
        ...(input.recoveryProof ? { recoveryGeneration: input.recoveryProof.generation } : {}),
      },
      revision: current.revision + 1,
    }))
    const result = await dependencies.applyEngine.finalize({
      localPath: record.localRoot,
      receipt: preview,
      commitMessage: input.commitMessage,
      beforeCommit: async (commitOid) => {
        updateManagedCheckout(record.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'finalize_preview'
            ? { ...current.journal, step: 'updating_ref', commitOid }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (result.status === 'error') {
      if ((result.error.code === 'stale_local' || result.error.code === 'preview_modified') && !retryingDetached) {
        return detachPreviewAfterLocalDrift(record, binding, result.error.code, 'finalize_preview')
      }
      const current = dependencies.registry.read().managedCheckouts[record.checkoutId]
      const writeStarted = current?.journal?.operation === 'finalize_preview' && current.journal.step === 'updating_ref'
      if (
        result.error.code === 'commit_isolation_conflict'
        || result.error.code === 'operation_not_allowed'
        || result.error.code === 'invalid_input'
        || result.error.code === 'stale_local'
        || result.error.code === 'preview_modified'
        || !writeStarted
        || (result.error.code === 'git_error' && result.error.recoveryState === 'unchanged')
      ) {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      } else {
        updateManagedCheckout(record.checkoutId, (checkout) => ({ ...checkout, phase: 'recovery_required', revision: checkout.revision + 1 }))
      }
      return operationError(result.error.code, result.error.message, await inspectIsolated(binding))
    }
    const finalized = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'finalized',
      delivery: {
        state: 'finalized',
        review,
        commitOid: result.commitOid,
        proof: {
          localBranch: input.recoveryProof?.localHeadRef?.startsWith('refs/heads/')
            ? input.recoveryProof.localHeadRef.slice('refs/heads/'.length)
            : preview.localHeadRef?.startsWith('refs/heads/')
              ? preview.localHeadRef.slice('refs/heads/'.length)
              : null,
          localHeadBefore: input.recoveryProof?.localHeadOid ?? preview.localHeadOid,
          localHeadAfter: result.commitOid ?? input.recoveryProof?.localHeadOid ?? preview.localHeadOid,
          changedFiles: [...result.changedFiles],
          validationStatus: review.validationStatus,
          ...(review.validationSummary === undefined ? {} : { validationSummary: review.validationSummary }),
        },
        isolatedFingerprint: preview.isolatedFingerprint,
        finalizedAt: Date.now(),
        cleanup: 'pending',
      },
      journal: null,
      revision: current.revision + 1,
    }))
    if (!finalized) return operationError('checkout_missing', '提交已创建，但 Checkout 记录丢失')
    const retention = input.retention ?? 'cleanup'
    if (retention !== 'cleanup') {
      const retained = retainFinalized(finalized, retention)
      if (!retained) return operationError('checkout_missing', '提交已创建，但保留 Worktree 状态写入失败')
      return {
        status: 'finished',
        target: await inspectIsolated(binding),
        changedFiles: result.changedFiles,
        commitOid: result.commitOid,
        cleanup: 'retained',
      }
    }
    const cleanup = await cleanupFinalized(finalized)
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: result.changedFiles,
      commitOid: result.commitOid,
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
    }
  }

  async function operateRetryCleanup(
    input: Extract<SessionCheckoutOperation, { action: 'retry_cleanup' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId || binding.target.kind !== 'isolated') {
      return operationError('not_owner', '只有 owner Isolated 会话可以重试清理')
    }
    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (record.delivery.state !== 'finalized' && record.delivery.state !== 'retained') {
      return operationError('operation_not_allowed', '当前没有待重试的 Worktree 清理', await inspectIsolated(binding))
    }
    const cleanup = await cleanupFinalized(record, { allowLegacyResidue: true })
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: [...record.delivery.review.changedFiles],
      commitOid: record.delivery.commitOid,
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
    }
  }

  async function operateFinish(
    input: Extract<SessionCheckoutOperation, { action: 'finish' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', '继承 Session Target 的会话不能执行 Finish')
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', 'Local Checkout 不支持 Finish')
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (input.expectedReviewId !== undefined && (
      record.delivery.state !== 'ready_for_review'
      || record.delivery.review.reviewId !== input.expectedReviewId
    )) {
      return operationError('stale_target', '该验收卡已不是当前 Review，请刷新并确认最新交付', await inspectIsolated(binding))
    }
    if (record.applyBaseOid && (record.delivery.state === 'working' || record.delivery.state === 'ready_for_review')) {
      return operationError(
        'operation_not_allowed',
        '该历史 Worktree 已通过旧版 Apply 写入 Local；为避免遗漏或重复提交，已禁止自动 Finish，请先人工核对 Local 后再清理记录。',
        await inspectIsolated(binding),
      )
    }
    if (record.phase !== 'ready' || record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      return operationError('operation_not_allowed', `当前 ${record.phase}/${record.delivery.state} 状态不能直接 Finish`, await inspectIsolated(binding))
    }
    const holder = findProjectAcceptanceHolder(record)
    if (holder) {
      return operationError(
        'project_acceptance_busy',
        `同一项目已有验收任务正在占用 Local：${holder.projectName}`,
        await inspectIsolated(binding),
      )
    }

    const inspected = await inspectIsolated(binding)
    if (inspected.checkout.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复', inspected)
    }
    record = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!record || record.phase !== 'ready') {
      return operationError('recovery_required', 'Isolated Checkout 状态已变化，需要恢复')
    }
    const startedAt = Date.now()
    const operationId = dependencies.createCheckoutId()
    const applyBaseOid = record.applyBaseOid ?? record.baseOid
    const applying = updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      journal: {
        operation: 'finish',
        operationId,
        step: 'planning',
        startedAt,
        baseOid: applyBaseOid,
      },
      revision: current.revision + 1,
    }))
    if (!applying) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')

    const planResult = await dependencies.applyEngine.plan({
      baseOid: applyBaseOid,
      isolatedPath: applying.managedRoot,
      localPath: applying.localRoot,
    })
    if (planResult.status === 'conflict') {
      updateManagedCheckout(applying.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        journal: null,
        revision: current.revision + 1,
      }))
      return {
        status: 'conflict',
        code: 'apply_conflict',
        reason: 'content_conflict',
        target: await inspectIsolated(binding),
        baseStrategy: planResult.baseStrategy,
        effectiveBaseOid: planResult.effectiveBaseOid,
        localHeadOid: planResult.localHeadOid,
        isolatedHeadOid: planResult.isolatedHeadOid,
        canRetryAfterRefresh: false,
        conflictingFiles: planResult.conflictingFiles,
      }
    }
    if (planResult.status === 'error') {
      updateManagedCheckout(applying.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError(planResult.error.code, planResult.error.message, await inspectIsolated(binding))
    }

    if (
      input.expectedReviewId !== undefined
      && applying.delivery.state === 'ready_for_review'
      && (
        applying.delivery.review.reviewId !== input.expectedReviewId
        || planResult.plan.isolatedFingerprint !== applying.delivery.review.isolatedFingerprint
        || planResult.plan.isolatedHeadOid !== applying.delivery.review.isolatedHeadOid
      )
    ) {
      const reviewIteration = applying.delivery.review.iteration
      updateManagedCheckout(applying.checkoutId, (current) => ({
        ...current,
        phase: 'ready',
        delivery: { state: 'working', iteration: reviewIteration },
        journal: null,
        revision: current.revision + 1,
      }))
      return operationError('stale_isolated', 'Worktree 在验收后又发生变化，请重新准备验收', await inspectIsolated(binding))
    }

    const iteration = applying.delivery.state === 'working'
      ? applying.delivery.iteration
      : applying.delivery.state === 'delivered'
        ? applying.delivery.iteration + 1
        : applying.delivery.review.iteration
    const review = applying.delivery.state === 'ready_for_review'
      ? applying.delivery.review
      : {
          reviewId: operationId,
          iteration,
          preparedAt: startedAt,
          summary: '跳过 Local 验收并直接提交',
          validationStatus: 'not_run' as const,
          tests: [],
          changedFiles: [...planResult.plan.changedFiles],
          suggestedCommitMessage: input.commitMessage,
          isolatedFingerprint: planResult.plan.isolatedFingerprint,
          isolatedHeadOid: planResult.plan.isolatedHeadOid,
        }
    const previewId = dependencies.createCheckoutId()
    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      delivery: { state: 'ready_for_review', review },
      journal: {
        operation: 'finish',
        operationId,
        step: 'writing_local',
        startedAt,
        baseOid: applyBaseOid,
        planRevision: planResult.plan.revision,
        localFingerprint: planResult.plan.localFingerprint,
        isolatedFingerprint: planResult.plan.isolatedFingerprint,
        effectiveBaseOid: planResult.plan.effectiveBaseOid,
        baseStrategy: planResult.plan.baseStrategy,
        localHeadOid: planResult.plan.localHeadOid,
        isolatedHeadOid: planResult.plan.isolatedHeadOid,
        changedFiles: [...planResult.plan.changedFiles],
      },
      revision: current.revision + 1,
    }))
    const previewResult = await dependencies.applyEngine.preview(planResult.plan, {
      previewId,
      reviewId: review.reviewId,
      iteration: review.iteration,
      beforeWrite: async (receipt) => {
        await retainPreviewArtifacts(applying, receipt)
        updateManagedCheckout(applying.checkoutId, (current) => ({
          ...current,
          delivery: { state: 'preview_active', review, preview: receipt },
          journal: current.journal?.operation === 'finish'
            ? { ...current.journal, step: 'artifacts_retained', previewId, reviewId: review.reviewId }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (previewResult.status === 'error') {
      const current = dependencies.registry.read().managedCheckouts[applying.checkoutId]
      if (current?.journal?.step === 'writing_local') {
        await releasePreviewArtifactsBestEffort(applying, previewId)
        updateManagedCheckout(applying.checkoutId, (checkout) => ({ ...checkout, phase: 'ready', journal: null, revision: checkout.revision + 1 }))
      }
      return operationError(previewResult.error.code, previewResult.error.message, await inspectIsolated(binding))
    }
    const receipt = previewResult.receipt
    updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      phase: 'mutating',
      delivery: { state: 'preview_active', review, preview: receipt },
      journal: {
        operation: 'finish',
        operationId,
        step: 'planning',
        startedAt,
        previewId,
        reviewId: review.reviewId,
        isolatedFingerprint: receipt.isolatedFingerprint,
        retention: input.retention ?? 'cleanup',
        changedFiles: [...receipt.changedFiles],
      },
      revision: current.revision + 1,
    }))
    const finishResult = await dependencies.applyEngine.finalize({
      localPath: applying.localRoot,
      receipt,
      commitMessage: input.commitMessage,
      beforeCommit: async (commitOid) => {
        updateManagedCheckout(applying.checkoutId, (current) => ({
          ...current,
          journal: current.journal?.operation === 'finish'
            ? { ...current.journal, step: 'updating_ref', commitOid }
            : current.journal,
          revision: current.revision + 1,
        }))
      },
    })
    if (finishResult.status === 'error') {
      const safePreview = finishResult.error.code === 'stale_local'
        || finishResult.error.code === 'preview_modified'
        || finishResult.error.code === 'invalid_input'
        || finishResult.error.code === 'commit_isolation_conflict'
        || finishResult.error.code === 'operation_not_allowed'
      if (safePreview) {
        updateManagedCheckout(applying.checkoutId, (current) => ({ ...current, phase: 'ready', journal: null, revision: current.revision + 1 }))
      }
      return operationError(finishResult.error.code, finishResult.error.message, await inspectIsolated(binding))
    }

    const finalized = updateManagedCheckout(applying.checkoutId, (current) => ({
      ...current,
      phase: 'finalized',
      delivery: {
        state: 'finalized' as const,
        review,
        commitOid: finishResult.commitOid,
        proof: {
          localBranch: receipt.localHeadRef?.startsWith('refs/heads/')
            ? receipt.localHeadRef.slice('refs/heads/'.length)
            : null,
          localHeadBefore: receipt.localHeadOid,
          localHeadAfter: finishResult.commitOid ?? receipt.localHeadOid,
          changedFiles: [...finishResult.changedFiles],
          validationStatus: review.validationStatus,
          ...(review.validationSummary === undefined ? {} : { validationSummary: review.validationSummary }),
        },
        isolatedFingerprint: receipt.isolatedFingerprint,
        finalizedAt: Date.now(),
        cleanup: 'pending' as const,
      },
      journal: null,
      revision: current.revision + 1,
    }))
    if (!finalized) {
      return operationError('checkout_missing', '任务提交已创建，但 Checkout 记录丢失，需要人工检查')
    }
    const retention = input.retention ?? 'cleanup'
    if (retention !== 'cleanup') {
      const retained = retainFinalized(finalized, retention)
      if (!retained) return operationError('checkout_missing', '任务提交已创建，但保留 Worktree 状态写入失败')
      return {
        status: 'finished',
        target: await inspectIsolated(binding),
        changedFiles: finishResult.changedFiles,
        commitOid: finishResult.commitOid,
        cleanup: 'retained',
      }
    }
    const cleanup = await cleanupFinalized(finalized)
    return {
      status: 'finished',
      target: await inspectIsolated(binding),
      changedFiles: finishResult.changedFiles,
      commitOid: finishResult.commitOid,
      cleanup: cleanup.cleaned ? 'discarded' : 'pending',
      ...(cleanup.message ? { cleanupMessage: cleanup.message } : {}),
      ...(cleanup.reason ? { cleanupReason: cleanup.reason } : {}),
    }
  }

  async function releaseApplyBaseBestEffort(record: ManagedCheckoutRecord): Promise<void> {
    try {
      await dependencies.git.releaseApplyBase(record.localRoot, record.checkoutId)
      await dependencies.git.releaseInternalArtifacts(record.localRoot, record.checkoutId)
    } catch {
      // checkout 删除优先；内部无 ref artifact 的清理失败不能阻止 owner 明确收口。
      console.warn('[session-checkout] 清理内部 Session Checkout refs 失败，已保守保留不可见引用')
    }
  }

  async function operateDiscard(
    input: Extract<SessionCheckoutOperation, { action: 'discard' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', '继承 Session Target 的会话不能执行 Discard')
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', 'Local Checkout 不支持 Discard')
    }

    let record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    if (record.delivery.state === 'preview_detached') {
      return operationError(
        'preview_modified',
        'Local Preview 已因漂移进入 detached 恢复态；为保留恢复证据，不能删除 Worktree。请先成功撤回 Preview。',
        await inspectIsolated(binding),
      )
    }
    if (record.applyBaseOid && (record.delivery.state === 'working' || record.delivery.state === 'ready_for_review')) {
      return operationError(
        'operation_not_allowed',
        '该历史 Worktree 已通过旧版 Apply 写入 Local；不会自动 Discard，请先人工核对 Local 的未提交修改。',
        await inspectIsolated(binding),
      )
    }
    if (record.delivery.state === 'preview_active') {
      if (!input.rollbackPreview) {
        return operationError(
          'preview_not_active',
          '本任务正在 Local 预览；放弃任务前必须先安全撤回 Preview',
          await inspectIsolated(binding),
        )
      }
      const rollback = await dependencies.applyEngine.rollback({
        localPath: record.localRoot,
        receipt: record.delivery.preview,
      })
      if (rollback.status === 'error') {
        if (rollback.error.code === 'stale_local' || rollback.error.code === 'preview_modified') {
          return detachPreviewAfterLocalDrift(record, binding, rollback.error.code, 'discard')
        }
        return operationError(rollback.error.code, rollback.error.message, await inspectIsolated(binding))
      }
      const previewId = record.delivery.preview.previewId
      const iteration = record.delivery.review.iteration
      const rolledBack = updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        delivery: { state: 'working', iteration },
        journal: null,
        revision: current.revision + 1,
      }))
      if (!rolledBack) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
      await releasePreviewArtifactsBestEffort(record, previewId)
      record = rolledBack
    }
    // Harness plugin has no inherited collaborator checkout ownership.
    if (record.phase === 'recovery_required' && !dependencies.files.exists(record.managedRoot)) {
      await releaseApplyBaseBestEffort(record)
      updateManagedCheckout(record.checkoutId, (current) => ({
        ...current,
        phase: 'discarded',
        journal: null,
        revision: current.revision + 1,
      }))
      return { status: 'discarded', target: await inspectIsolated(binding) }
    }
    if (record.phase !== 'ready' && record.phase !== 'recovery_required') {
      return operationError('operation_not_allowed', `当前 ${record.phase} 状态不能 Discard`, await inspectIsolated(binding))
    }

    let inspected: SessionTargetView
    let dirty = true
    if (record.phase === 'ready') {
      inspected = await inspectIsolated(binding)
      if (inspected.checkout.phase !== 'ready') {
        return operationError('recovery_required', 'Isolated Checkout 身份无法确认，需要恢复', inspected)
      }
      record = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (!record || record.phase !== 'ready') {
        return operationError('recovery_required', 'Isolated Checkout 状态已变化，需要恢复')
      }
      dirty = (await dependencies.git.status(record.managedRoot)).dirty || (record.checkpoints?.length ?? 0) > 0
    } else {
      try {
        dirty = (await dependencies.git.status(record.managedRoot)).dirty || (record.checkpoints?.length ?? 0) > 0
      } catch {
        dirty = true
      }
      inspected = recoveryView(binding, record, dirty)
    }
    if (dirty && !input.confirmDirty) {
      const checkpointDetail = (record.checkpoints?.length ?? 0) > 0
        ? `；确认后会永久删除 ${record.checkpoints!.length} 个尚未交付到 Local 的阶段`
        : ''
      return operationError('dirty_confirmation_required', `Isolated Checkout 含未提交修改、未交付阶段或状态无法确认，需要明确确认${checkpointDetail}`, inspected)
    }

    try {
      await dependencies.git.removeWorktree(record.localRoot, record.managedGitRoot)
    } catch {
      return operationError('git_operation_failed', '删除 managed checkout 失败', await inspectIsolated(binding))
    }
    await releaseApplyBaseBestEffort(record)
    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      phase: 'discarded',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'discarded', target: await inspectIsolated(binding) }
  }

  async function operateRecover(
    input: Extract<SessionCheckoutOperation, { action: 'recover' }>,
    binding: SessionBindingRecord,
  ): Promise<SessionCheckoutOperationResult> {
    if (binding.ownerSessionId !== input.sessionId) {
      return operationError('not_owner', '继承 Session Target 的会话不能执行 Recover')
    }
    if (binding.target.kind !== 'isolated') {
      return operationError('operation_not_allowed', 'Local Checkout 不支持 Recover')
    }

    const record = dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
    if (!record) return operationError('checkout_missing', 'Isolated Checkout 记录不存在')
    if (record.revision !== input.expectedRevision) {
      return operationError('stale_target', 'Session Target 已变化，请刷新后重试', await inspectIsolated(binding))
    }
    const recoverCreate = record.journal?.operation === 'create'
    if ((record.journal !== null && !recoverCreate) || record.phase === 'mutating') {
      return operationError(
        'recovery_unsafe',
        'Apply 是否已修改 Local 无法安全确认；不会自动重试或猜测成功',
        await inspectIsolated(binding),
      )
    }
    if (!dependencies.files.exists(record.managedRoot)) {
      return operationError('recovery_required', 'Isolated Checkout 缺失，只能由 owner 明确 Discard 收口')
    }

    const validated = await validateManagedCheckout(binding, record, recoverCreate)
    if (!validated) {
      return operationError('recovery_unsafe', 'Isolated Checkout 的路径、Git 身份、项目、HEAD 或状态无法完整确认')
    }

    updateManagedCheckout(record.checkoutId, (current) => ({
      ...current,
      managedRoot: validated.canonicalManagedRoot,
      managedGitRoot: validated.canonicalManagedGitRoot,
      gitDir: validated.snapshot.gitDir,
      phase: 'ready',
      journal: null,
      revision: current.revision + 1,
    }))
    return { status: 'recovered', target: await inspectIsolated(binding) }
  }

  async function operateTarget(input: SessionCheckoutOperation): Promise<SessionCheckoutOperationResult> {
    try {
      const binding = await resolveBinding(input.sessionId)
      if (input.action === 'apply') return await operateApply(input, binding)
      if (input.action === 'finish') return await operateFinish(input, binding)
      if (input.action === 'preview') return await operatePreview(input, binding)
      if (input.action === 'checkpoint') return await operateCheckpoint(input, binding)
      if (input.action === 'rollback_preview') return await operateRollbackPreview(input, binding)
      if (input.action === 'finalize_preview') return await operateFinalizePreview(input, binding)
      if (input.action === 'retry_cleanup') return await operateRetryCleanup(input, binding)
      if (input.action === 'discard') return await operateDiscard(input, binding)
      if (input.action === 'recover') return await operateRecover(input, binding)
      const exhaustive: never = input
      return exhaustive
    } catch (error) {
      if (error instanceof SessionCheckoutError) return operationError(error.code, error.message)
      throw error
    }
  }

  function managedIteration(record: ManagedCheckoutRecord): number {
    if (record.delivery.state === 'working' || record.delivery.state === 'delivered') return record.delivery.iteration
    return record.delivery.review.iteration
  }

  function managedUpdatedAt(record: ManagedCheckoutRecord): number {
    if (record.delivery.state === 'working') return record.journal?.startedAt ?? 0
    if (record.delivery.state === 'ready_for_review') return record.delivery.review.preparedAt
    if (record.delivery.state === 'preview_active') return record.delivery.preview.previewedAt
    if (record.delivery.state === 'preview_detached') return record.delivery.detachedAt
    if (record.delivery.state === 'finalized') return record.delivery.finalizedAt
    if (record.delivery.state === 'retained') return record.delivery.retainedAt
    return record.delivery.deliveredAt
  }

  async function summarizeManagedWorktree(
    record: ManagedCheckoutRecord,
    includeDiagnostics = false,
  ): Promise<ManagedWorktreeSummaryView> {
    // 快速列表必须保守且不扫描 Git/磁盘；只有后台单项诊断完成后才开放清理。
    let dirty = true
    let cleanupResidue = false
    let approximateBytes: number | null = null
    if (includeDiagnostics) {
      if (record.delivery.state === 'finalized' || record.delivery.state === 'retained') {
        const quarantine = await validateCleanupQuarantine(record)
        const residue = quarantine ? undefined : await validateDetachedCleanupResidue(record, true)
        if (quarantine || residue) {
          cleanupResidue = true
          dirty = false
        } else if (dependencies.files.exists(record.managedRoot)) {
          try {
            const snapshot = await dependencies.applyEngine.inspectReview({
              baseOid: record.applyBaseOid ?? record.baseOid,
              isolatedPath: record.managedRoot,
              localPath: record.localRoot,
            })
            dirty = snapshot.status !== 'ready' || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint
          } catch { dirty = true }
        }
      } else if (dependencies.files.exists(record.managedRoot)) {
        try { dirty = (await dependencies.git.status(record.managedRoot)).dirty } catch { dirty = true }
      }
      const physicalRoot = record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath
        ? record.journal.cleanupQuarantinePath
        : record.managedGitRoot
      if (dependencies.files.exists(physicalRoot)) {
        try { approximateBytes = await dependencies.files.measureDirectoryBytes(physicalRoot) } catch { approximateBytes = null }
      }
    }
    const delivery = record.delivery
    const state: ManagedWorktreeSummaryView['state'] = record.phase === 'recovery_required'
      ? 'needs_attention'
      : delivery.state === 'retained'
        ? delivery.cleanup === 'blocked' ? 'needs_attention' : 'retained'
        : delivery.state === 'finalized'
          ? delivery.cleanup === 'blocked' ? 'needs_attention' : 'cleanup_pending'
          : delivery.state === 'preview_active'
            ? 'preview_active'
            : delivery.state === 'preview_detached'
              ? 'needs_attention'
              : delivery.state === 'ready_for_review'
            ? 'ready_for_review'
            : delivery.state === 'delivered'
              ? 'delivered'
              : 'working'
    const commitOid = delivery.state === 'finalized' || delivery.state === 'retained' || delivery.state === 'delivered'
      ? delivery.commitOid
      : null
    const cleanupMessage = cleanupResidue
      ? CLEANUP_RESIDUE_MESSAGE
      : delivery.state === 'finalized' || delivery.state === 'retained'
        ? delivery.cleanupMessage
        : undefined
    const cleanupReason = cleanupMessage ? cleanupReasonForMessage(cleanupMessage) : undefined
    return {
      checkoutId: record.checkoutId,
      revision: record.revision,
      ownerSessionId: record.ownerSessionId,
      ownerSessionTitle: dependencies.lookup.getSession(record.ownerSessionId)?.title?.trim() || '已删除的 Agent 会话',
      project: { id: record.projectId, name: record.projectName },
      iteration: managedIteration(record),
      state,
      phase: record.phase,
      dirty,
      commitOid,
      ...((record.checkpoints?.length ?? 0) > 0 ? { checkpointCount: record.checkpoints!.length } : {}),
      ...(delivery.state === 'retained' ? {
        retention: delivery.retention,
        retainedAt: delivery.retainedAt,
        expiresAt: delivery.expiresAt,
      } : {}),
      ...(cleanupMessage ? { cleanupMessage } : {}),
      ...(cleanupReason ? { cleanupReason } : {}),
      approximateBytes,
      updatedAt: managedUpdatedAt(record),
      canCleanup: includeDiagnostics && (delivery.state === 'retained' || delivery.state === 'finalized') && !dirty,
    }
  }

  function cleanupBlocked(reason: ManagedWorktreeCleanupView['reason'], message: string, revision: number): ManagedWorktreeCleanupView {
    return { eligibility: 'blocked', reason, message, inspectedRevision: revision }
  }

  async function inspectCleanupForRecord(record: ManagedCheckoutRecord): Promise<ManagedWorktreeCleanupView> {
    if (record.delivery.state === 'working') return cleanupBlocked('working', '当前轮次仍在修改，尚未形成可清理的交付环境。', record.revision)
    if (record.delivery.state === 'ready_for_review') return cleanupBlocked('review_pending', '当前轮次正在等待验收，不能清理。', record.revision)
    if (record.delivery.state === 'preview_active' || record.delivery.state === 'preview_detached') {
      return cleanupBlocked('preview_active', 'Local Preview 尚未完成安全收口，不能清理。', record.revision)
    }
    if (record.delivery.state === 'delivered' || record.phase === 'discarded') {
      return cleanupBlocked('unknown', 'Worktree 已交付并解除管理，无需再次清理。', record.revision)
    }
    if (record.delivery.commitOid && record.delivery.proof) {
      const local = await validateCommittedLocalCheckout(bindingForManagedRecord(record), record)
      if (!local) return cleanupBlocked('identity_mismatch', 'Local checkout identity 无法验证，不能证明本轮交付仍存在。', record.revision)
      try {
        const delivered = await dependencies.git.isAncestor(local.canonicalLocalRoot, record.delivery.commitOid, local.snapshot.headOid)
        if (!delivered) return cleanupBlocked('identity_mismatch', '本轮交付 commit 已不在 Local 历史中，不能清理环境。', record.revision)
      } catch {
        return cleanupBlocked('unknown', '无法验证本轮交付 commit 是否仍在 Local 历史中。', record.revision)
      }
    }
    const quarantine = await validateCleanupQuarantine(record)
    const residue = quarantine ? undefined : await validateDetachedCleanupResidue(record, true)
    if (record.journal?.operation === 'cleanup' && record.journal.cleanupQuarantinePath && !quarantine) {
      return cleanupBlocked('identity_mismatch', '清理目录身份无法重新验证，已保留环境。', record.revision)
    }
    if (!quarantine && !residue && dependencies.files.exists(record.managedRoot)) {
      const binding = bindingForManagedRecord(record)
      const validated = await validateManagedCheckout(binding, record, false)
      if (!validated) return cleanupBlocked('identity_mismatch', 'Worktree checkout identity 无法验证，已保留环境。', record.revision)
      try {
        const snapshot = await dependencies.applyEngine.inspectReview({
          baseOid: record.applyBaseOid ?? record.baseOid,
          isolatedPath: record.managedRoot,
          localPath: record.localRoot,
        })
        if (snapshot.status !== 'ready' || snapshot.isolatedFingerprint !== record.delivery.isolatedFingerprint) {
          return cleanupBlocked('uncommitted_changes', '提交或保留后检测到新增修改，不能批量清理。', record.revision)
        }
      } catch {
        return cleanupBlocked('unknown', '无法证明 Worktree 当前状态安全，已保留环境。', record.revision)
      }
    }
    if (record.delivery.cleanup === 'blocked' || record.delivery.cleanup === 'pending') {
      const cleanupMessage = record.delivery.cleanupMessage ?? '上次清理未完成，可重新校验后重试。'
      if (cleanupReasonForMessage(cleanupMessage) === 'identity_changed') return cleanupBlocked('identity_mismatch', cleanupMessage, record.revision)
      if (cleanupReasonForMessage(cleanupMessage) === 'modified_after_finalize') return cleanupBlocked('uncommitted_changes', cleanupMessage, record.revision)
    }
    if (
      record.delivery.state === 'retained'
      && (record.delivery.retention === 'retain_manual' || record.delivery.expiresAt === null || record.delivery.expiresAt > Date.now())
    ) {
      return { eligibility: 'retained', reason: 'retention_active', message: record.delivery.retention === 'retain_manual' ? '按用户选择手动保留。' : '保留期限尚未到期。', inspectedRevision: record.revision }
    }
    return { eligibility: 'safe', reason: 'cleanup_failed', message: record.delivery.cleanupMessage ?? '已通过只读安全巡检，可以清理。', inspectedRevision: record.revision }
  }

  async function inspectManagedWorktreeCleanup(input: ListManagedWorktreesInput = {}): Promise<ManagedWorktreeSummaryView[]> {
    const records = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.phase !== 'discarded')
      .filter((record) => !input.projectId || record.projectId === input.projectId)
      .filter((record) => !input.checkoutId || record.checkoutId === input.checkoutId)
    const summaries = await Promise.all(records.map(async (record) => ({
      ...(await summarizeManagedWorktree(record, true)),
      cleanup: await inspectCleanupForRecord(record),
    })))
    return summaries
      .filter((summary) => !input.needsAttention || summary.cleanup?.eligibility === 'blocked')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function bulkCleanupManagedWorktrees(
    candidates: BulkCleanupManagedWorktreeCandidate[],
  ): Promise<BulkCleanupManagedWorktreesResult> {
    const cleaned: BulkCleanupManagedWorktreesResult['cleaned'] = []
    const retained: BulkCleanupManagedWorktreesResult['retained'] = []
    const uniqueCandidates = [...new Map(candidates.map((candidate) => [candidate.checkoutId, candidate])).values()]
      .sort((left, right) => left.checkoutId.localeCompare(right.checkoutId))
    for (const candidate of uniqueCandidates) {
      const record = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (!record || record.phase === 'discarded') continue
      if (record.revision !== candidate.expectedRevision) {
        retained.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          cleanup: cleanupBlocked('unknown', 'Worktree revision 已变化，未执行清理。', record.revision),
        })
        continue
      }
      const inspection = await inspectCleanupForRecord(record)
      if (inspection.eligibility !== 'safe') {
        retained.push({ checkoutId: record.checkoutId, iteration: managedIteration(record), cleanup: inspection })
        continue
      }
      const latest = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (!latest || latest.revision !== candidate.expectedRevision) {
        retained.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          cleanup: cleanupBlocked('unknown', 'Worktree 在清理前发生变化，未执行清理。', latest?.revision ?? record.revision),
        })
        continue
      }
      const result = await cleanupFinalized(latest, { allowLegacyResidue: true })
      const updated = dependencies.registry.read().managedCheckouts[candidate.checkoutId]
      if (result.cleaned) {
        cleaned.push({
          checkoutId: record.checkoutId,
          iteration: managedIteration(record),
          commitOid: record.delivery.state === 'finalized' || record.delivery.state === 'retained' ? record.delivery.commitOid : null,
        })
      } else if (updated) {
        retained.push({
          checkoutId: updated.checkoutId,
          iteration: managedIteration(updated),
          cleanup: await inspectCleanupForRecord(updated),
        })
      }
    }
    return { cleaned, retained }
  }

  async function listManagedWorktrees(input: ListManagedWorktreesInput = {}): Promise<ManagedWorktreeSummaryView[]> {
    const records = Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.phase !== 'discarded')
      .filter((record) => !input.projectId || record.projectId === input.projectId)
      .filter((record) => !input.checkoutId || record.checkoutId === input.checkoutId)
    const summaries = await Promise.all(records.map((record) => summarizeManagedWorktree(record, input.includeDiagnostics === true)))
    return summaries
      .filter((summary) => !input.needsAttention || summary.state === 'needs_attention' || summary.state === 'cleanup_pending')
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async function listManagedWorktreesForSession(
    sessionId: string,
    input: Omit<ListManagedWorktreesInput, 'projectId'> = {},
  ): Promise<ManagedWorktreeSummaryView[]> {
    const session = requireSession(sessionId)
    const persisted = getPersistedBinding(sessionId)
    const projectId = persisted?.projectId ?? session.projectId
    if (!projectId) throw new SessionCheckoutError('project_not_found', '会话尚未关联项目')
    const allowedCheckoutIds = new Set(Object.values(dependencies.registry.read().managedCheckouts)
      .filter((record) => record.projectId === projectId)
      .filter((record) => record.ownerSessionId === sessionId || record.sourceSessionId === sessionId)
      .map((record) => record.checkoutId))
    const summaries = await listManagedWorktrees({ ...input, projectId })
    return summaries.filter((summary) => allowedCheckoutIds.has(summary.checkoutId))
  }

  async function manageManagedWorktreeForSession(
    sessionId: string,
    input: ManageManagedWorktreeInput,
  ): Promise<ManagedWorktreeSummaryView> {
    requireSession(sessionId)
    const record = dependencies.registry.read().managedCheckouts[input.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录不存在')
    if (record.ownerSessionId !== sessionId && record.sourceSessionId !== sessionId) {
      throw new SessionCheckoutError('not_owner', '当前 Session 无权管理该 Worktree')
    }
    if (record.ownerSessionId !== sessionId && dependencies.lookup.getSession(record.ownerSessionId)) {
      throw new SessionCheckoutError('not_owner', 'Owner Session 已接管该 Worktree，只有 owner 可以管理')
    }
    const persisted = getPersistedBinding(sessionId)
    const callerProjectId = persisted?.projectId ?? dependencies.lookup.getSession(sessionId)?.projectId
    if (callerProjectId !== record.projectId) {
      throw new SessionCheckoutError('project_mismatch', '当前 Session 与 Worktree 不属于同一原始项目')
    }
    return manageManagedWorktree(input)
  }

  async function manageManagedWorktree(input: ManageManagedWorktreeInput): Promise<ManagedWorktreeSummaryView> {
    const record = dependencies.registry.read().managedCheckouts[input.checkoutId]
    if (!record) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录不存在')
    if (record.revision !== input.expectedRevision) throw new SessionCheckoutError('stale_target', 'Worktree 状态已变化，请刷新后重试')
    if (input.action === 'discard') {
      // Caller authorization is performed by the scoped wrapper (or a trusted Host manager).
      // The reserved owner Session may not exist yet, so do not re-resolve it through lookup.
      const result = await operateDiscard({
        action: 'discard',
        sessionId: record.ownerSessionId,
        expectedRevision: input.expectedRevision,
        confirmDirty: input.confirmDirty === true,
        ...(input.rollbackPreview === undefined ? {} : { rollbackPreview: input.rollbackPreview }),
      }, bindingForManagedRecord(record))
      if (result.status === 'error') throw new SessionCheckoutError(result.code, result.message)
      const updated = dependencies.registry.read().managedCheckouts[record.checkoutId]
      if (!updated) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录不存在')
      return summarizeManagedWorktree(updated)
    }
    if (input.action === 'set_retention') {
      if (record.phase !== 'retained' || record.delivery.state !== 'retained' || !input.retention) {
        throw new SessionCheckoutError('operation_not_allowed', '只有已保留的冻结 Worktree 可以调整保留期限')
      }
      const retainedAt = Date.now()
      const updated = updateManagedCheckout(record.checkoutId, (current) => {
        if (current.delivery.state !== 'retained') return current
        return {
          ...current,
          delivery: {
            ...current.delivery,
            retention: input.retention!,
            retainedAt,
            expiresAt: retentionExpiresAt(input.retention!, retainedAt),
            cleanup: 'scheduled',
            cleanupMessage: undefined,
          },
          revision: current.revision + 1,
        }
      })
      if (!updated) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录不存在')
      return summarizeManagedWorktree(updated)
    }
    if (record.delivery.state !== 'retained' && record.delivery.state !== 'finalized') {
      throw new SessionCheckoutError('operation_not_allowed', '当前 Worktree 不处于可清理状态')
    }
    await cleanupFinalized(record, { allowLegacyResidue: true })
    const updated = dependencies.registry.read().managedCheckouts[record.checkoutId]
    if (!updated) throw new SessionCheckoutError('checkout_missing', 'Worktree 记录不存在')
    return summarizeManagedWorktree(updated)
  }

  async function resolveManagedRoot(checkoutId: string): Promise<string> {
    const record = dependencies.registry.read().managedCheckouts[checkoutId]
    if (!record || record.phase === 'discarded') throw new SessionCheckoutError('checkout_missing', 'Worktree 目录已不存在')
    const validated = await validateManagedCheckout(bindingForManagedRecord(record), record, false)
    if (!validated) throw new SessionCheckoutError('checkout_mismatch', 'Worktree 目录身份无法验证')
    return validated.canonicalManagedRoot
  }

  async function cleanupExpiredRetained(now = Date.now()): Promise<string[]> {
    const expired = Object.values(dependencies.registry.read().managedCheckouts).filter((record) => (
      record.phase === 'retained'
      && record.delivery.state === 'retained'
      && record.delivery.cleanup === 'scheduled'
      && record.delivery.expiresAt !== null
      && record.delivery.expiresAt <= now
    ))
    const cleaned: string[] = []
    for (const record of expired) {
      try {
        // 到期保留清理同样受收敛超时保护，避免单个占用记录卡住后续启动。
        const result = await withCleanupTimeout(record.checkoutId, () => cleanupFinalized(record))
        if (result?.cleaned) cleaned.push(record.checkoutId)
      } catch (error) {
        console.warn(`[session-checkout] expired retained Worktree cleanup skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return cleaned
  }

  async function beginNextIterationTarget(
    sessionId: string,
    expectedRevision: number,
  ): Promise<SessionTargetView> {
    const session = requireSession(sessionId)
    const registry = dependencies.registry.read()
    const previousBinding = registry.sessionBindings[sessionId]
    if (!previousBinding || previousBinding.target.kind !== 'isolated') {
      throw new SessionCheckoutError('operation_not_allowed', '只有已交付的 Isolated Session 可以开始下一轮')
    }
    const predecessor = registry.managedCheckouts[previousBinding.target.checkoutId]
    if (!predecessor) throw new SessionCheckoutError('checkout_missing', '上一轮 Worktree 记录不存在')
    if (predecessor.ownerSessionId !== sessionId || previousBinding.ownerSessionId !== sessionId) {
      throw new SessionCheckoutError('not_owner', '只有 owner Session 可以开始下一轮')
    }
    if (predecessor.revision !== expectedRevision) {
      throw new SessionCheckoutError('stale_target', 'Worktree 状态已变化，请刷新后再开始下一轮')
    }
    if (predecessor.phase !== 'discarded' || predecessor.delivery.state !== 'delivered') {
      throw new SessionCheckoutError('operation_not_allowed', '只有已成功清理的交付状态可以开始下一轮')
    }
    if (!session.projectId) throw new SessionCheckoutError('project_not_found', '当前 Session 尚未关联 Workspace')
    const ownerWorkspace = dependencies.lookup.getProject(session.projectId)
    if (!ownerWorkspace || !resolvedPathsEqual(ownerWorkspace.root, predecessor.managedRoot)) {
      throw new SessionCheckoutError('project_mismatch', '当前 Session 的 immutable cwd 与上一轮 Worktree 不一致')
    }
    if (dependencies.files.exists(predecessor.managedGitRoot) || dependencies.files.exists(predecessor.managedRoot)) {
      throw new SessionCheckoutError('checkout_mismatch', '上一轮 Worktree 路径已重新出现，拒绝覆盖未知内容')
    }

    const localProject = dependencies.lookup.getProject(predecessor.projectId)
    if (!localProject || !dependencies.files.exists(localProject.root) || !dependencies.files.exists(predecessor.localRoot)) {
      throw new SessionCheckoutError('project_root_missing', '原始 Local 项目已不可用，不能开始下一轮')
    }
    const canonicalProjectRoot = await dependencies.files.canonicalize(localProject.root)
    const canonicalLocalRoot = await dependencies.files.canonicalize(predecessor.localRoot)
    if (!pathsEqual(canonicalProjectRoot, canonicalLocalRoot)) {
      throw new SessionCheckoutError('project_mismatch', '原始 Local 项目身份已变化')
    }
    const snapshot = await dependencies.git.inspect(canonicalLocalRoot)
    if (!snapshot || !pathsEqual(snapshot.commonDir, predecessor.gitCommonDir)) {
      throw new SessionCheckoutError('checkout_mismatch', '原始 Local Git 身份已变化')
    }
    const projectRelativePath = relative(snapshot.root, canonicalLocalRoot)
    if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) {
      throw new SessionCheckoutError('checkout_mismatch', '项目根目录不在其 Git checkout 内')
    }
    if (!resolvedPathsEqual(resolve(predecessor.managedGitRoot, projectRelativePath), predecessor.managedRoot)) {
      throw new SessionCheckoutError('checkout_mismatch', '上一轮 managed project 路径无法从 Local 身份重建')
    }

    const managedContainer = dirname(predecessor.managedGitRoot)
    if (!dependencies.files.exists(managedContainer)) dependencies.files.ensureDirectory(managedContainer)
    const containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
    if (!containerIdentity) throw new SessionCheckoutError('checkout_mismatch', 'Worktree 容器不是可信目录')
    const canonicalContainer = await dependencies.files.canonicalize(managedContainer)
    if (!resolvedPathsEqual(canonicalContainer, managedContainer)) {
      throw new SessionCheckoutError('checkout_mismatch', 'Worktree 容器路径已被重定向')
    }

    const checkoutId = dependencies.createCheckoutId()
    const iteration = predecessor.delivery.iteration + 1
    const record: ManagedCheckoutRecord = {
      checkoutId,
      predecessorCheckoutId: predecessor.checkoutId,
      projectId: predecessor.projectId,
      projectName: predecessor.projectName,
      ownerSessionId: sessionId,
      ...(predecessor.sourceSessionId ? { sourceSessionId: predecessor.sourceSessionId } : {}),
      localRoot: canonicalLocalRoot,
      managedRoot: predecessor.managedRoot,
      managedGitRoot: predecessor.managedGitRoot,
      gitCommonDir: snapshot.commonDir,
      gitDir: '',
      baseOid: snapshot.headOid,
      sourceRef: snapshot.headRef,
      phase: 'preparing',
      delivery: { state: 'working', iteration },
      journal: {
        operation: 'create',
        operationId: dependencies.createCheckoutId(),
        step: 'creating_worktree',
        startedAt: Date.now(),
      },
      revision: predecessor.revision + 1,
    }
    const binding: SessionBindingRecord = {
      sessionId,
      projectId: predecessor.projectId,
      projectName: predecessor.projectName,
      target: { kind: 'isolated', checkoutId },
      ownerSessionId: sessionId,
      sourceRef: snapshot.headRef,
      sourceOid: snapshot.headOid,
      revision: previousBinding.revision + 1,
    }
    registry.sessionBindings[sessionId] = binding
    registry.managedCheckouts[checkoutId] = record
    registry.revision += 1
    dependencies.registry.write(registry)

    try {
      await dependencies.git.createDetachedWorktree(snapshot.root, predecessor.managedGitRoot, snapshot.headOid)
      const canonicalManagedGitRoot = await dependencies.files.canonicalize(predecessor.managedGitRoot)
      const canonicalManagedRoot = await dependencies.files.canonicalize(predecessor.managedRoot)
      const containerAfterCreate = await dependencies.files.inspectDirectoryIdentity(managedContainer)
      const created = await dependencies.git.inspect(canonicalManagedRoot)
      if (
        !containerAfterCreate
        || !directoryIdentitiesEqual(containerIdentity, containerAfterCreate)
        || !resolvedPathsEqual(canonicalManagedGitRoot, predecessor.managedGitRoot)
        || !resolvedPathsEqual(canonicalManagedRoot, predecessor.managedRoot)
        || !created
        || !pathsEqual(created.root, canonicalManagedGitRoot)
        || !pathsEqual(created.commonDir, snapshot.commonDir)
        || created.headOid !== snapshot.headOid
      ) {
        throw new SessionCheckoutError('checkout_mismatch', '下一轮 checkout 的 Git 身份不匹配')
      }
      const readyRegistry = dependencies.registry.read()
      const current = readyRegistry.managedCheckouts[checkoutId]
      if (!current || current.phase !== 'preparing') {
        throw new SessionCheckoutError('stale_target', '下一轮 Worktree 创建期间状态已变化')
      }
      readyRegistry.managedCheckouts[checkoutId] = {
        ...current,
        managedRoot: canonicalManagedRoot,
        managedGitRoot: canonicalManagedGitRoot,
        gitDir: created.gitDir,
        phase: 'ready',
        journal: null,
        revision: current.revision + 1,
      }
      readyRegistry.revision += 1
      dependencies.registry.write(readyRegistry)
      return inspectIsolated(binding)
    } catch (error) {
      let partialCheckout: GitCheckoutSnapshot | null = null
      try {
        if (dependencies.files.exists(join(predecessor.managedGitRoot, '.git'))) {
          partialCheckout = await dependencies.git.inspect(predecessor.managedRoot)
        }
      } catch {
        partialCheckout = null
      }
      if (partialCheckout) {
        const current = dependencies.registry.read().managedCheckouts[checkoutId]
        if (current) markRecoveryRequired(current)
        throw error
      }

      let residueRemoved = false
      try {
        residueRemoved = dependencies.files.removeEmptyDirectoryTree(predecessor.managedGitRoot)
      } catch {
        residueRemoved = false
      }
      if (!residueRemoved) {
        const current = dependencies.registry.read().managedCheckouts[checkoutId]
        if (current) markRecoveryRequired(current)
        throw new SessionCheckoutError('recovery_required', '下一轮 Worktree 创建失败且残余目录包含未知内容，已保留现场')
      }

      const failedRegistry = dependencies.registry.read()
      delete failedRegistry.managedCheckouts[checkoutId]
      const currentBinding = failedRegistry.sessionBindings[sessionId]
      if (currentBinding?.target.kind === 'isolated' && currentBinding.target.checkoutId === checkoutId) {
        failedRegistry.sessionBindings[sessionId] = { ...previousBinding, revision: previousBinding.revision + 1 }
      }
      failedRegistry.revision += 1
      dependencies.registry.write(failedRegistry)
      throw new SessionCheckoutError('git_operation_failed', error instanceof Error ? error.message : String(error))
    }
  }

  async function bindTarget(
    sessionId: string,
    choice: SessionTargetBindChoice,
    createAttempt = 0,
    requestStartedAt = Date.now(),
    sourceSessionId = sessionId,
  ): Promise<SessionTargetView> {
      const session = requireSession(sourceSessionId)
      let nextIteration = 1
      let replacedDeliveredBinding: SessionBindingRecord | undefined
      const existing = getPersistedBinding(sessionId)
      if (existing) {
        if (choice.kind === 'local' && existing.target.kind === 'local') {
          return inspectLocal(existing)
        }
        if (choice.kind === 'isolated' && existing.target.kind === 'isolated') {
          const existingView = await inspectIsolated(existing)
          const registry = dependencies.registry.read()
          const existingRecord = registry.managedCheckouts[existing.target.checkoutId]
          if (
            existingView.ownership === 'owner'
            && existingRecord
            && (
              (existingView.checkout.phase === 'discarded' && existingRecord.delivery.state === 'delivered')
              || (existingView.checkout.phase === 'finalized' && existingRecord.delivery.state === 'finalized')
              || (existingView.checkout.phase === 'retained' && existingRecord.delivery.state === 'retained')
            )
          ) {
            nextIteration = managedIteration(existingRecord) + 1
            replacedDeliveredBinding = {
              ...existing,
              target: { ...existing.target },
            }
            delete registry.sessionBindings[sessionId]
            registry.revision += 1
            dependencies.registry.write(registry)
          } else {
            return existingView
          }
        }
        if (!(choice.kind === 'isolated' && existing.target.kind === 'isolated' && nextIteration > 1)) {
          throw new SessionCheckoutError('target_already_bound', '会话已经绑定 Session Target，不能切换')
        }
      }

      const { project } = await resolveSessionProject(sourceSessionId)
      const snapshot = await dependencies.git.inspect(project.root)

      if (choice.kind === 'local') {
        const binding: SessionBindingRecord = {
          sessionId,
          projectId: project.id,
          projectName: project.name,
          target: { kind: 'local' },
          ownerSessionId: sessionId,
          sourceRef: snapshot?.headRef ?? UNVERSIONED_REF,
          sourceOid: snapshot?.headOid ?? UNVERSIONED_OID,
          revision: 1,
        }
        const registry = dependencies.registry.read()
        registry.sessionBindings[sessionId] = binding
        registry.revision += 1
        dependencies.registry.write(registry)
        return inspectLocal(binding)
      }

      if (!snapshot) {
        throw new SessionCheckoutError('not_git_repository', '非 Git 项目不能创建 Isolated Checkout')
      }
      // managed Worktree 不再使用全局数量硬上限；生命周期通过交付后清理收口。
      const checkoutId = dependencies.createCheckoutId()
      const localRoot = await dependencies.files.canonicalize(project.root)
      const localGitRoot = await dependencies.files.canonicalize(snapshot.root)
      const repositoryKey = createManagedWorktreeRepositoryKey(localGitRoot)
      const pathCandidates = [8, 12, 32].map(identityLength => createManagedWorktreePathCandidates({
        localGitRoot,
        managedCheckoutsRoot: dependencies.managedCheckoutsRoot,
        repositoryKey,
        checkoutId,
        identityLength,
      }))
      // Prefer one repository-owned sibling container so Local never sees its
      // managed worktrees as untracked. A container that is a file/symlink is
      // untrusted and falls back without modification. Existing child paths
      // are never reused or cleaned: extend the trusted checkout identity.
      const outerContainingRoot = await dependencies.git.findContainingWorktreeRoot(dirname(localGitRoot))
      const siblingWouldPolluteOuter = outerContainingRoot !== null && !pathsEqual(outerContainingRoot, localGitRoot)
      const usingSibling = createAttempt === 0 && !siblingWouldPolluteOuter
      const managedContainer = usingSibling
        ? pathCandidates[0]!.siblingContainer
        : pathCandidates[0]!.fallbackContainer
      const knownContainer = Object.values(dependencies.registry.read().managedCheckouts)
        .some(record => pathsEqual(dirname(record.managedGitRoot), managedContainer))
      const containerExisted = dependencies.files.exists(managedContainer)
      let containerIdentity = containerExisted
        ? await dependencies.files.inspectDirectoryIdentity(managedContainer)
        : null
      if (containerExisted && containerIdentity !== null && !knownContainer) {
        // A same-named directory with unknown content is not ours. An empty
        // directory has no user bytes to preserve, so remove/recreate it as the
        // ownership boundary; a non-empty tree is left untouched and rejected.
        let reclaimedEmpty = false
        try { reclaimedEmpty = dependencies.files.removeEmptyDirectoryTree(managedContainer) } catch { /* fail closed below */ }
        if (!reclaimedEmpty) containerIdentity = null
        else {
          try {
            dependencies.files.ensureDirectory(managedContainer)
            containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
          } catch {
            containerIdentity = null
          }
        }
      } else if (!containerExisted) {
        try {
          dependencies.files.ensureDirectory(managedContainer)
          containerIdentity = await dependencies.files.inspectDirectoryIdentity(managedContainer)
        } catch {
          containerIdentity = null
        }
      }
      if (containerIdentity === null) {
        if (usingSibling) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId)
        }
        throw new SessionCheckoutError(
          'checkout_mismatch',
          'Worktree 回退容器不是可信目录，未创建或修改任何 checkout',
        )
      }
      const managedGitRoot = pathCandidates
        .map(candidate => usingSibling ? candidate.siblingRoot : candidate.fallbackRoot)
        .find(candidate => !dependencies.files.exists(candidate))
      if (managedGitRoot === undefined) {
        if (usingSibling) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId)
        }
        throw new SessionCheckoutError(
          'checkout_mismatch',
          'Worktree Checkout identity 路径均已存在，拒绝覆盖未知目录',
        )
      }
      const projectRelativePath = relative(localGitRoot, localRoot)
      if (projectRelativePath.startsWith('..') || isAbsolute(projectRelativePath)) {
        throw new SessionCheckoutError('checkout_mismatch', '项目根目录不在其 Git checkout 内')
      }
      const managedRoot = join(managedGitRoot, projectRelativePath)
      const record: ManagedCheckoutRecord = {
        checkoutId,
        projectId: project.id,
        projectName: project.name,
        ownerSessionId: sessionId,
        sourceSessionId,
        localRoot,
        managedRoot: resolve(managedRoot),
        managedGitRoot: resolve(managedGitRoot),
        gitCommonDir: snapshot.commonDir,
        gitDir: '',
        baseOid: snapshot.headOid,
        sourceRef: snapshot.headRef,
        phase: 'preparing',
        delivery: { state: 'working', iteration: nextIteration },
        journal: {
          operation: 'create',
          operationId: dependencies.createCheckoutId(),
          step: 'creating_worktree',
          startedAt: Date.now(),
        },
        revision: 1,
      }
      const binding: SessionBindingRecord = {
        sessionId,
        projectId: project.id,
        projectName: project.name,
        target: { kind: 'isolated', checkoutId },
        ownerSessionId: sessionId,
        sourceRef: snapshot.headRef,
        sourceOid: snapshot.headOid,
        revision: 1,
      }
      const preparingRegistry = dependencies.registry.read()
      preparingRegistry.sessionBindings[sessionId] = binding
      preparingRegistry.managedCheckouts[checkoutId] = record
      preparingRegistry.revision += 1
      dependencies.registry.write(preparingRegistry)

      try {
        await dependencies.git.createDetachedWorktree(localGitRoot, managedGitRoot, snapshot.headOid)
        const canonicalManagedGitRoot = await dependencies.files.canonicalize(managedGitRoot)
        const canonicalManagedRoot = await dependencies.files.canonicalize(managedRoot)
        const created = await dependencies.git.inspect(canonicalManagedRoot)
        if (
          !created
          || !pathsEqual(created.root, canonicalManagedGitRoot)
          || !pathsEqual(created.commonDir, snapshot.commonDir)
        ) {
          throw new SessionCheckoutError('checkout_mismatch', '新建 checkout 的 Git common dir 不匹配')
        }
        const readyRegistry = dependencies.registry.read()
        const readyRecord: ManagedCheckoutRecord = {
          ...record,
          managedRoot: canonicalManagedRoot,
          managedGitRoot: canonicalManagedGitRoot,
          gitDir: created.gitDir,
          phase: 'ready',
          journal: null,
          revision: record.revision + 1,
        }
        readyRegistry.managedCheckouts[checkoutId] = readyRecord
        readyRegistry.revision += 1
        dependencies.registry.write(readyRegistry)
        return inspectIsolated(binding)
      } catch (error) {
        let partialCheckout: GitCheckoutSnapshot | null = null
        try {
          // 仓库内布局下，残余目录会被 git 识别为上层主仓库 checkout；
          // 有效 worktree 必须带 .git 文件（git worktree add 创建），否则视为残余。
          if (dependencies.files.exists(join(managedGitRoot, '.git'))) {
            partialCheckout = await dependencies.git.inspect(managedRoot)
          }
        } catch {
          partialCheckout = null
        }
        if (partialCheckout) {
          markRecoveryRequired(record)
          throw error
        }

        let residueRemoved = false
        try {
          residueRemoved = dependencies.files.removeEmptyDirectoryTree(managedGitRoot)
        } catch {
          residueRemoved = false
        }
        if (!residueRemoved) {
          markRecoveryRequired(record)
          throw new SessionCheckoutError(
            'recovery_required',
            'Worktree 创建失败且残余目录包含未知内容，已保留现场，请查看原因或改用新会话',
          )
        }

        const failedRegistry = dependencies.registry.read()
        delete failedRegistry.managedCheckouts[checkoutId]
        const currentBinding = failedRegistry.sessionBindings[sessionId]
        if (currentBinding?.target.kind === 'isolated' && currentBinding.target.checkoutId === checkoutId) {
          if (replacedDeliveredBinding) {
            failedRegistry.sessionBindings[sessionId] = replacedDeliveredBinding
          } else {
            delete failedRegistry.sessionBindings[sessionId]
          }
        }
        failedRegistry.revision += 1
        dependencies.registry.write(failedRegistry)

        if (createAttempt < 1) {
          return bindTarget(sessionId, choice, createAttempt + 1, requestStartedAt, sourceSessionId)
        }
        throw new SessionCheckoutError('git_operation_failed', 'Worktree 创建失败，已安全清理残余目录，可直接重试')
      }
  }

  return {
    inspect: inspectAvailable,
    runtimeContext,
    preflight: (sessionId, expectedRevision) => withBindingLock(
      () => preflightTarget(sessionId, expectedRevision),
    ),
    preflightPreviewRecovery: (sessionId, expectedRevision, expectedReviewId, expectedPreviewId) => withBindingLock(
      () => preflightPreviewRecoveryTarget(sessionId, expectedRevision, expectedReviewId, expectedPreviewId),
      { allowConcurrentInspect: true },
    ),
    runExclusiveSessionMutation: (sessionId, operation) => withBindingLock(async () => (
      operation(await inspectTarget(sessionId, true))
    )),
    bind: (sessionId, choice) => {
      const requestStartedAt = Date.now()
      return withBindingLock(() => bindTarget(sessionId, choice, 0, requestStartedAt))
    },
    createIsolatedTarget: (sourceSessionId, targetSessionId) => withBindingLock(async () => {
      if (!targetSessionId || targetSessionId === sourceSessionId) {
        throw new SessionCheckoutError('invalid_input', 'Isolated Target 必须使用独立的预分配 Session ID')
      }
      if (dependencies.lookup.getSession(targetSessionId) && !getPersistedBinding(targetSessionId)) {
        throw new SessionCheckoutError('target_already_bound', '目标 Session ID 已被其他 Workspace 使用')
      }
      const sourceBinding = getPersistedBinding(sourceSessionId)
      if (!sourceBinding) {
        await bindTarget(sourceSessionId, { kind: 'local' })
      } else if (sourceBinding.target.kind !== 'local') {
        throw new SessionCheckoutError('operation_not_allowed', '只能从 Local Session 创建新的 Isolated Target')
      }
      const target = await bindTarget(targetSessionId, { kind: 'isolated' }, 0, Date.now(), sourceSessionId)
      const binding = getPersistedBinding(targetSessionId)
      const record = binding?.target.kind === 'isolated'
        ? dependencies.registry.read().managedCheckouts[binding.target.checkoutId]
        : undefined
      if (!record) throw new SessionCheckoutError('checkout_missing', 'Isolated Target 创建后记录缺失')
      return { targetSessionId, managedRoot: record.managedRoot, target }
    }),
    beginNextIteration: (sessionId, expectedRevision) => withBindingLock(
      () => beginNextIterationTarget(sessionId, expectedRevision),
    ),
    resumeRevision: (sessionId, expectedRevision, expectedReviewId, recovery) => withBindingLock(
      () => resumeRevisionTarget(sessionId, expectedRevision, expectedReviewId, recovery),
    ),
    prepareReviewRegeneration: (sessionId, expectedRevision, expectedReviewId, requestId) => withBindingLock(
      () => prepareReviewRegenerationTarget(sessionId, expectedRevision, expectedReviewId, requestId),
    ),
    preparePreviewRecoveryAnalysis: (sessionId, proof, requestId) => withBindingLock(
      () => preparePreviewRecoveryAnalysisTarget(sessionId, proof, requestId),
    ),
    createPreviewRecoveryHandoff: (sessionId, proof, targetSessionId, requestId) => withBindingLock(
      () => createPreviewRecoveryHandoffTarget(sessionId, proof, targetSessionId, requestId),
    ),
    markReadyForReview: (sessionId, input) => withBindingLock(
      () => markReadyForReviewTarget(sessionId, input),
    ),
    operate: (input) => withBindingLock(() => operateTarget(input)),
    // 只读管理列表不占用全局 mutation lock；慢速目录诊断与用户操作互不阻塞。
    listManagedWorktrees,
    listManagedWorktreesForSession,
    manageManagedWorktreeForSession: (sessionId, input) => withBindingLock(
      () => manageManagedWorktreeForSession(sessionId, input),
    ),
    inspectManagedWorktreeCleanup,
    bulkCleanupManagedWorktrees: (candidates) => withBindingLock(() => bulkCleanupManagedWorktrees(candidates)),
    manageManagedWorktree: (input) => withBindingLock(() => manageManagedWorktree(input)),
    resolveManagedRoot: (checkoutId) => withBindingLock(() => resolveManagedRoot(checkoutId)),
    cleanupExpiredRetained: (now) => withBindingLock(
      () => cleanupExpiredRetained(now),
      { allowConcurrentInspect: true },
    ),
    reconcile: () => withBindingLock(reconcile, { allowConcurrentInspect: true }),
  }
}
