import {
  consoleStateFromDomain,
  type WorktreeConsoleCapabilities,
  type WorktreeConsoleDeliveryProof,
  type WorktreeConsoleReviewSummary,
  type WorktreeConsoleTargetDetails,
  type WorktreeConsoleTargetSummary,
} from '../console-contract.js'
import type { GitCheckoutSnapshot, ManagedCheckoutRecord } from '../ports.js'
import type { ManagedWorktreeSummaryView, SessionTargetView } from '../types.js'

function review(record: ManagedCheckoutRecord): WorktreeConsoleReviewSummary | undefined {
  if (!('review' in record.delivery)) return undefined
  const source = record.delivery.review
  return {
    reviewId: source.reviewId,
    revision: record.revision,
    iteration: source.iteration,
    preparedAt: source.preparedAt,
    summary: source.summary,
    validationStatus: source.validationStatus,
    ...(source.validationSummary === undefined ? {} : { validationSummary: source.validationSummary }),
    tests: source.tests.map(item => ({ ...item })),
    changedFiles: [...source.changedFiles],
    suggestedCommitMessage: source.suggestedCommitMessage,
  }
}

function commitOid(record: ManagedCheckoutRecord): string | null {
  return 'commitOid' in record.delivery ? record.delivery.commitOid : null
}

function deliveryProof(
  record: ManagedCheckoutRecord,
  observed?: WorktreeConsoleDeliveryProof,
): WorktreeConsoleDeliveryProof | undefined {
  if (observed) return {
    ...observed,
    changedFiles: [...observed.changedFiles],
  }
  if (!('proof' in record.delivery) || !record.delivery.proof) return undefined
  const proof = record.delivery.proof
  return {
    localBranch: proof.localBranch,
    localHeadBefore: proof.localHeadBefore,
    localHeadAfter: proof.localHeadAfter,
    changedFiles: [...proof.changedFiles],
    ...(proof.validationStatus === undefined ? {} : { validationStatus: proof.validationStatus }),
    ...(proof.validationSummary === undefined ? {} : { validationSummary: proof.validationSummary }),
    commitInLocalHistory: null,
  }
}

function iteration(record: ManagedCheckoutRecord): number {
  return 'review' in record.delivery ? record.delivery.review.iteration : record.delivery.iteration
}

export function capabilities(
  record: ManagedCheckoutRecord,
  callerSessionId: string,
  ownerSessionAvailable = true,
  linkedRead = false,
): WorktreeConsoleCapabilities {
  const owner = callerSessionId === record.ownerSessionId
  const source = callerSessionId === record.sourceSessionId
  const sourceReservation = source && !ownerSessionAvailable
  const readAuthorized = owner || source || linkedRead
  const manageAuthorized = owner || source
  const ready = record.phase === 'ready' && record.delivery.state === 'ready_for_review'
  const previewActive = record.phase === 'ready' && record.delivery.state === 'preview_active'
  const previewDetached = record.phase === 'ready' && record.delivery.state === 'preview_detached'
  const previewRecovery = record.phase === 'recovery_required'
    && record.delivery.state === 'preview_active'
    && record.journal?.operation === 'rollback_preview'
  const cleanup = record.delivery.state === 'finalized' || record.delivery.state === 'retained'
  const delivered = record.phase === 'discarded' && record.delivery.state === 'delivered'
  const active = record.phase !== 'discarded'
  return {
    create: false,
    open: readAuthorized && active && (!linkedRead || ownerSessionAvailable),
    inspect: readAuthorized,
    discard: (owner || sourceReservation) && active && !cleanup && !previewDetached,
    preflight: owner && ready,
    preview: owner && ready,
    resumeRevision: owner && ready,
    rollbackPreview: owner && (previewActive || previewDetached || previewRecovery),
    finalize: owner && ready,
    finalizePreview: owner && previewActive,
    setRetention: manageAuthorized && record.delivery.state === 'retained',
    retryCleanup: manageAuthorized && cleanup,
    beginNextIteration: owner && delivered,
  }
}

function fallbackOid(record: ManagedCheckoutRecord): string {
  if ('proof' in record.delivery && record.delivery.proof) return record.delivery.proof.localHeadAfter
  return commitOid(record) ?? record.applyBaseOid ?? record.baseOid
}

export function projectRecord(
  record: ManagedCheckoutRecord,
  callerSessionId: string,
  observed?: {
    snapshot?: GitCheckoutSnapshot
    dirty?: boolean
    summary?: ManagedWorktreeSummaryView
    ownerSessionAvailable?: boolean
    linkedRead?: boolean
    deliveryProof?: WorktreeConsoleDeliveryProof
  },
): WorktreeConsoleTargetSummary {
  const projectedReview = review(record)
  const projectedProof = observed?.linkedRead === true
    ? undefined
    : deliveryProof(record, observed?.deliveryProof)
  const delivery = record.delivery
  return {
    project: { id: record.projectId, name: record.projectName },
    checkoutId: record.checkoutId,
    sourceSessionId: record.sourceSessionId ?? record.ownerSessionId,
    ownerSessionId: record.ownerSessionId,
    targetSessionId: record.ownerSessionId,
    iteration: iteration(record),
    revision: record.revision,
    state: consoleStateFromDomain({ kind: 'isolated', phase: record.phase, deliveryState: delivery.state }),
    phase: record.phase,
    dirty: observed?.dirty ?? observed?.summary?.dirty ?? false,
    currentOid: observed?.snapshot?.headOid ?? fallbackOid(record),
    commitOid: commitOid(record),
    ...(delivery.state === 'retained' ? {
      retention: delivery.retention,
      retainedAt: delivery.retainedAt,
      expiresAt: delivery.expiresAt,
    } : {}),
    ...((delivery.state === 'retained' || delivery.state === 'finalized') && delivery.cleanupMessage !== undefined
      ? { cleanupMessage: delivery.cleanupMessage }
      : {}),
    ...(projectedProof === undefined ? {} : { deliveryProof: projectedProof }),
    ...(projectedReview === undefined ? {} : { review: projectedReview }),
    ...(delivery.state === 'ready_for_review' ? { reviewSlot: 'available' as const } : {}),
    ...(delivery.state === 'preview_detached' ? {
      previewRecovery: {
        reason: delivery.reason,
        attemptedAction: delivery.attemptedAction,
      },
    } : {}),
    capabilities: capabilities(
      record,
      callerSessionId,
      observed?.ownerSessionAvailable,
      observed?.linkedRead,
    ),
  }
}

export function projectDetails(
  record: ManagedCheckoutRecord,
  callerSessionId: string,
  managedRoot: string | null,
  snapshot?: GitCheckoutSnapshot,
  dirty?: boolean,
  ownerSessionAvailable?: boolean,
  linkedRead = false,
  observedDeliveryProof?: WorktreeConsoleDeliveryProof,
): WorktreeConsoleTargetDetails {
  return {
    ...projectRecord(record, callerSessionId, {
      snapshot,
      dirty,
      ownerSessionAvailable,
      linkedRead,
      deliveryProof: observedDeliveryProof,
    }),
    managedRoot,
    sourceRoot: record.localRoot,
    sourceOid: record.baseOid,
    currentBranch: snapshot?.branch ?? null,
    ...(callerSessionId === record.ownerSessionId && !linkedRead && record.recoveryContinuation
      ? {
          recoveryContinuation: record.recoveryContinuation.kind === 'worktree_apply_conflict'
            ? {
                kind: record.recoveryContinuation.kind,
                requestId: record.recoveryContinuation.requestId,
                checkoutId: record.checkoutId,
                reviewId: record.recoveryContinuation.reviewId,
                revision: record.recoveryContinuation.workingRevision,
                localHeadOid: record.recoveryContinuation.localHeadOid,
                conflictingFiles: [...record.recoveryContinuation.conflictingFiles],
              }
            : {
                kind: record.recoveryContinuation.kind,
                requestId: record.recoveryContinuation.requestId,
                checkoutId: record.checkoutId,
                reviewId: record.recoveryContinuation.reviewId,
                revision: record.recoveryContinuation.revision,
              },
        }
      : {}),
  }
}

export function projectLocal(target: SessionTargetView, sessionId: string): WorktreeConsoleTargetDetails {
  return {
    project: { ...target.project },
    checkoutId: null,
    sourceSessionId: sessionId,
    ownerSessionId: sessionId,
    targetSessionId: null,
    iteration: 0,
    revision: target.revision,
    state: 'local',
    phase: 'local',
    dirty: target.dirty,
    currentOid: target.current.oid,
    commitOid: null,
    capabilities: {
      create: true,
      open: true,
      inspect: true,
      discard: false,
      preflight: false,
      preview: false,
      resumeRevision: false,
      rollbackPreview: false,
      finalize: false,
      finalizePreview: false,
      setRetention: false,
      retryCleanup: false,
      beginNextIteration: false,
    },
    managedRoot: null,
    sourceRoot: null,
    sourceOid: target.source.oid,
    currentBranch: target.current.branch,
  }
}
