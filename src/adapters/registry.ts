/**
 * Durable registry adapter: the session-checkout registry (version 2) as one
 * atomic JSON file under the plugin's state directory. Validation gates every
 * read — a corrupt file fails loud instead of being silently overwritten;
 * v1 records migrate conservatively to `recovery_required` like Domi.
 * @module dsh-git-worktree/adapters/registry
 */

import { existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ManagedCheckoutsRegistry, SessionCheckoutRegistryPort } from '../ports.js'
import { SessionCheckoutError } from '../index.js'
import { readJsonFileSafe, writeJsonFileAtomic } from './safe-file.js'

function emptyRegistry(): ManagedCheckoutsRegistry {
  return {
    version: 2,
    revision: 0,
    sessionBindings: {},
    managedCheckouts: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isTargetRef(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  return value.kind === 'unselected'
    || value.kind === 'local'
    || (value.kind === 'isolated' && typeof value.checkoutId === 'string')
}

function isSessionBinding(value: unknown): boolean {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.projectId === 'string'
    && typeof value.projectName === 'string'
    && isTargetRef(value.target)
    && typeof value.ownerSessionId === 'string'
    && typeof value.sourceRef === 'string'
    && typeof value.sourceOid === 'string'
    && typeof value.revision === 'number'
}

function isReview(value: unknown): boolean {
  return isRecord(value)
    && typeof value.reviewId === 'string'
    && typeof value.iteration === 'number'
    && typeof value.preparedAt === 'number'
    && (value.detailsMarkdown === undefined || typeof value.detailsMarkdown === 'string')
    && typeof value.summary === 'string'
    && (value.validationStatus === 'passed' || value.validationStatus === 'failed' || value.validationStatus === 'partial' || value.validationStatus === 'not_run')
    && (value.validationSummary === undefined || typeof value.validationSummary === 'string')
    && Array.isArray(value.tests)
    && value.tests.every((test) => isRecord(test)
      && typeof test.command === 'string'
      && (test.status === 'passed' || test.status === 'failed' || test.status === 'not_run')
      && (test.summary === undefined || typeof test.summary === 'string'))
    && isStringArray(value.changedFiles)
    && typeof value.suggestedCommitMessage === 'string'
    && typeof value.isolatedFingerprint === 'string'
    && typeof value.isolatedHeadOid === 'string'
}

function isPreviewReceipt(value: unknown): boolean {
  return isRecord(value)
    && typeof value.previewId === 'string'
    && typeof value.reviewId === 'string'
    && typeof value.iteration === 'number'
    && typeof value.previewedAt === 'number'
    && typeof value.configuredBaseOid === 'string'
    && typeof value.effectiveBaseOid === 'string'
    && (value.baseStrategy === 'recorded_base' || value.baseStrategy === 'isolated_contains_local_head' || value.baseStrategy === 'local_contains_isolated_head')
    && typeof value.localHeadOid === 'string'
    && (value.localHeadRef === null || typeof value.localHeadRef === 'string')
    && typeof value.localFingerprintBefore === 'string'
    && typeof value.localFingerprintPreview === 'string'
    && typeof value.localWorkingTreeOid === 'string'
    && typeof value.localIndexTreeOid === 'string'
    && typeof value.previewWorkingTreeOid === 'string'
    && typeof value.isolatedHeadOid === 'string'
    && typeof value.isolatedFingerprint === 'string'
    && typeof value.isolatedSnapshotOid === 'string'
    && isStringArray(value.changedFiles)
}

function isDeliveryProof(value: unknown): boolean {
  return isRecord(value)
    && (value.localBranch === null || typeof value.localBranch === 'string')
    && typeof value.localHeadBefore === 'string'
    && typeof value.localHeadAfter === 'string'
    && isStringArray(value.changedFiles)
}

function isDelivery(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== 'string') return false
  if (value.state === 'working') return typeof value.iteration === 'number'
  if (value.state === 'ready_for_review') return isReview(value.review)
  if (value.state === 'preview_active') return isReview(value.review) && isPreviewReceipt(value.preview)
  if (value.state === 'preview_detached') {
    return isReview(value.review)
      && isPreviewReceipt(value.preview)
      && typeof value.detachedAt === 'number'
      && (value.reason === 'stale_local' || value.reason === 'preview_modified')
      && (value.attemptedAction === 'rollback_preview' || value.attemptedAction === 'finalize_preview' || value.attemptedAction === 'discard')
  }
  if (value.state === 'finalized') {
    return isReview(value.review)
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.isolatedFingerprint === 'string'
      && typeof value.finalizedAt === 'number'
      && (value.cleanup === 'pending' || value.cleanup === 'blocked')
      && (value.cleanupMessage === undefined || typeof value.cleanupMessage === 'string')
  }
  if (value.state === 'retained') {
    return isReview(value.review)
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.isolatedFingerprint === 'string'
      && (value.retention === 'retain_24h' || value.retention === 'retain_3d' || value.retention === 'retain_manual')
      && typeof value.retainedAt === 'number'
      && (value.expiresAt === null || typeof value.expiresAt === 'number')
      && (value.cleanup === 'scheduled' || value.cleanup === 'blocked')
      && (value.cleanupMessage === undefined || typeof value.cleanupMessage === 'string')
  }
  if (value.state === 'delivered') {
    return typeof value.iteration === 'number'
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.deliveredAt === 'number'
  }
  return false
}

function isJournal(value: unknown): boolean {
  if (value === null) return true
  if (
    !isRecord(value)
    || typeof value.operationId !== 'string'
    || typeof value.step !== 'string'
    || typeof value.startedAt !== 'number'
  ) return false
  if (value.operation === 'create') return value.step === 'creating_worktree'
  const validOperation = value.operation === 'apply'
    || value.operation === 'preview'
    || value.operation === 'rollback_preview'
    || value.operation === 'finish'
    || value.operation === 'finalize_preview'
    || value.operation === 'cleanup'
  const validStep = value.step === 'planning'
    || value.step === 'artifacts_retained'
    || value.step === 'writing_local'
    || value.step === 'updating_ref'
    || value.step === 'replacing_index'
    || value.step === 'removing_worktree'
  return validOperation
    && validStep
    && (value.baseOid === undefined || typeof value.baseOid === 'string')
    && (value.planRevision === undefined || typeof value.planRevision === 'string')
    && (value.previewId === undefined || typeof value.previewId === 'string')
    && (value.reviewId === undefined || typeof value.reviewId === 'string')
    && (value.localFingerprint === undefined || typeof value.localFingerprint === 'string')
    && (value.isolatedFingerprint === undefined || typeof value.isolatedFingerprint === 'string')
    && (value.effectiveBaseOid === undefined || typeof value.effectiveBaseOid === 'string')
    && (value.baseStrategy === undefined || value.baseStrategy === 'recorded_base' || value.baseStrategy === 'isolated_contains_local_head' || value.baseStrategy === 'local_contains_isolated_head')
    && (value.localHeadOid === undefined || typeof value.localHeadOid === 'string')
    && (value.isolatedHeadOid === undefined || typeof value.isolatedHeadOid === 'string')
    && (value.commitOid === undefined || typeof value.commitOid === 'string')
    && (value.retention === undefined || value.retention === 'cleanup' || value.retention === 'retain_24h' || value.retention === 'retain_3d' || value.retention === 'retain_manual')
    && (value.resumeRevision === undefined || typeof value.resumeRevision === 'boolean')
    && (value.changedFiles === undefined || isStringArray(value.changedFiles))
}

function isManagedCheckout(value: unknown): boolean {
  return isRecord(value)
    && typeof value.checkoutId === 'string'
    && (value.predecessorCheckoutId === undefined || typeof value.predecessorCheckoutId === 'string')
    && typeof value.projectId === 'string'
    && typeof value.projectName === 'string'
    && typeof value.ownerSessionId === 'string'
    && (value.sourceSessionId === undefined || typeof value.sourceSessionId === 'string')
    && typeof value.localRoot === 'string'
    && typeof value.managedRoot === 'string'
    && typeof value.managedGitRoot === 'string'
    && typeof value.gitCommonDir === 'string'
    && typeof value.gitDir === 'string'
    && typeof value.baseOid === 'string'
    && (value.applyBaseOid === undefined || typeof value.applyBaseOid === 'string')
    && typeof value.sourceRef === 'string'
    && (value.phase === 'preparing' || value.phase === 'ready' || value.phase === 'mutating' || value.phase === 'recovery_required' || value.phase === 'finalized' || value.phase === 'retained' || value.phase === 'discarded')
    && isDelivery(value.delivery)
    && isJournal(value.journal)
    && typeof value.revision === 'number'
}

function isRegistry(value: unknown): value is ManagedCheckoutsRegistry {
  if (
    !isRecord(value)
    || value.version !== 2
    || typeof value.revision !== 'number'
    || !isRecord(value.sessionBindings)
    || !isRecord(value.managedCheckouts)
  ) return false
  return Object.values(value.sessionBindings).every(isSessionBinding)
    && Object.values(value.managedCheckouts).every(isManagedCheckout)
}

function migrateLegacyRegistry(value: unknown): ManagedCheckoutsRegistry | null {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.revision !== 'number'
    || !isRecord(value.sessionBindings)
    || !isRecord(value.managedCheckouts)
    || !Object.values(value.sessionBindings).every(isSessionBinding)
  ) return null
  const managedCheckouts: ManagedCheckoutsRegistry['managedCheckouts'] = {}
  for (const [checkoutId, raw] of Object.entries(value.managedCheckouts)) {
    if (
      !isRecord(raw)
      || typeof raw.checkoutId !== 'string'
      || typeof raw.projectId !== 'string'
      || typeof raw.projectName !== 'string'
      || typeof raw.ownerSessionId !== 'string'
      || typeof raw.localRoot !== 'string'
      || typeof raw.managedRoot !== 'string'
      || typeof raw.managedGitRoot !== 'string'
      || typeof raw.gitCommonDir !== 'string'
      || typeof raw.gitDir !== 'string'
      || typeof raw.baseOid !== 'string'
      || typeof raw.sourceRef !== 'string'
      || typeof raw.revision !== 'number'
    ) return null
    const legacyPhase = raw.phase
    const phase = legacyPhase === 'ready' || legacyPhase === 'discarded'
      ? legacyPhase
      : 'recovery_required'
    managedCheckouts[checkoutId] = {
      checkoutId: raw.checkoutId,
      projectId: raw.projectId,
      projectName: raw.projectName,
      ownerSessionId: raw.ownerSessionId,
      localRoot: raw.localRoot,
      managedRoot: raw.managedRoot,
      managedGitRoot: raw.managedGitRoot,
      gitCommonDir: raw.gitCommonDir,
      gitDir: raw.gitDir,
      baseOid: raw.baseOid,
      ...(typeof raw.applyBaseOid === 'string' ? { applyBaseOid: raw.applyBaseOid } : {}),
      sourceRef: raw.sourceRef,
      phase,
      delivery: { state: 'working', iteration: 1 },
      journal: null,
      revision: raw.revision + (phase === legacyPhase ? 0 : 1),
    }
  }
  return {
    version: 2,
    revision: value.revision + 1,
    sessionBindings: value.sessionBindings as ManagedCheckoutsRegistry['sessionBindings'],
    managedCheckouts,
  }
}

/** Atomic JSON registry file with `.tmp`/`.bak` crash recovery (see safe-file). */
export class AtomicJsonCheckoutRegistry implements SessionCheckoutRegistryPort {
  constructor(private readonly path: string) {}

  read(): ManagedCheckoutsRegistry {
    const value = readJsonFileSafe<unknown>(this.path)
    if (value && isRegistry(value)) return value
    const migrated = migrateLegacyRegistry(value)
    if (migrated) {
      this.write(migrated)
      return migrated
    }
    if (!existsSync(this.path)) return emptyRegistry()
    throw new SessionCheckoutError('registry_corrupt', 'managed-checkouts.json 损坏，已停止访问 checkout')
  }

  write(registry: ManagedCheckoutsRegistry): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeJsonFileAtomic(this.path, registry)
  }
}
