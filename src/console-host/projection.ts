import {
  consoleStateFromDomain,
  type WorktreeConsoleCapabilities,
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

function iteration(record: ManagedCheckoutRecord): number {
  return 'review' in record.delivery ? record.delivery.review.iteration : record.delivery.iteration
}

export function capabilities(
  record: ManagedCheckoutRecord,
  callerSessionId: string,
  ownerSessionAvailable = true,
): WorktreeConsoleCapabilities {
  const owner = callerSessionId === record.ownerSessionId
  const sourceReservation = callerSessionId === record.sourceSessionId && !ownerSessionAvailable
  const authorized = owner || callerSessionId === record.sourceSessionId
  const ready = record.phase === 'ready' && record.delivery.state === 'ready_for_review'
  const cleanup = record.delivery.state === 'finalized' || record.delivery.state === 'retained'
  const active = record.phase !== 'discarded'
  return {
    create: false,
    open: authorized && active,
    inspect: authorized,
    discard: (owner || sourceReservation) && active && !cleanup,
    finalize: owner && ready,
    setRetention: authorized && record.delivery.state === 'retained',
    retryCleanup: authorized && cleanup,
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
  },
): WorktreeConsoleTargetSummary {
  const projectedReview = review(record)
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
    ...(projectedReview === undefined ? {} : { review: projectedReview }),
    capabilities: capabilities(record, callerSessionId, observed?.ownerSessionAvailable),
  }
}

export function projectDetails(
  record: ManagedCheckoutRecord,
  callerSessionId: string,
  managedRoot: string | null,
  snapshot?: GitCheckoutSnapshot,
  dirty?: boolean,
  ownerSessionAvailable?: boolean,
): WorktreeConsoleTargetDetails {
  return {
    ...projectRecord(record, callerSessionId, { snapshot, dirty, ownerSessionAvailable }),
    managedRoot,
    sourceOid: record.baseOid,
    currentBranch: snapshot?.branch ?? null,
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
      finalize: false,
      setRetention: false,
      retryCleanup: false,
    },
    managedRoot: null,
    sourceOid: target.source.oid,
    currentBranch: target.current.branch,
  }
}
