import { useClientTranslator, defaultClientTranslator, type ClientTranslator } from '../i18n.js'
import { useEffect, useId, useRef, useState } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorktreeApplyConflictContinuation,
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleTargetSummary,
} from '../../console-contract.js'
import { worktreeConsoleErrorMeta } from '../../console-contract.js'
import type { WorktreeApplyPreflightView, WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../../types.js'
import {
  openAuthorizedWorktreeTarget,
  openIsolatedTarget,
  prefillSessionDraft,
  type WorktreeClientServices,
} from '../actions.js'
import type { WorktreeReviewEvidence, WorktreeReviewIdentity } from './WorktreeReviewPanel.js'
import { DeliveryProof } from './DeliveryProof.js'
import { PreflightStatus } from './PreflightStatus.js'
import { invalidateReviewPreflight, readReviewPreflight, useReviewPreflight } from './preflight-cache.js'
import { readPreviewRecoveryPreflight, usePreviewRecoveryPreflight } from './preview-recovery-cache.js'
import {
  enqueueWorktreeRecovery,
  restoreWorktreeRecovery,
  retryWorktreeRecovery,
  useWorktreeRecoverySnapshot,
  type WorktreeRecoveryRequest,
} from './recovery-continuation.js'
import { requestWorktreeReviewRefresh } from './status-events.js'

interface ReviewActionsProps {
  review: WorktreeReviewEvidence
  adapter?: WorktreeConsoleAdapter | null
  services?: WorktreeClientServices
  identity?: WorktreeReviewIdentity
  target?: WorktreeConsoleTargetSummary
  disabled: boolean
  unavailableMessage: string
  focusReview?: () => void
  isActive?: () => boolean
  onStale: (error: WorktreeConsoleError) => void
  onTargetChange: (target: WorktreeConsoleTargetSummary) => void
}

type Mutation = 'preview' | 'checkpoint' | 'resume_revision' | 'recovery' | 'recovery_analysis' | 'recovery_handoff' | 'open_holder' | 'rollback' | 'finish' | 'finalize_preview' | 'discard' | 'retry_cleanup'
type CommitMode = 'finish' | 'finalize_preview'

function checkpointRequestIdForGeneration(generation: string): string {
  return `checkpoint:${generation}`
}

function isStale(error: WorktreeConsoleError): boolean {
  return error.code === 'stale_target' || error.code === 'stale_isolated' || error.code === 'stale_local'
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function preflightMessage(preflight: WorktreeApplyPreflightView, t: ClientTranslator = defaultClientTranslator): string {
  if (preflight.status === 'ready') return t("sync.preflight.passed.creating.a.reversible.local.preview")
  if (preflight.status === 'local_advanced') return t("local.advanced.but.preflight.confirmed.a.safe.merge")
  if (preflight.status === 'already_in_local') return t("this.iteration.is.already.in.local.sync.will")
  if (preflight.status === 'conflict') return t("sync.preflight.found.conflicting.files.local.is.unchanged", { p0: preflight.conflictingFiles.length })
  if (preflight.status === 'blocked') return t("sync.is.temporarily.blocked", { p0: preflight.message })
  return t("sync.preflight.finished.local.is.unchanged")
}

export function ReviewActions({
  review,
  adapter,
  services,
  identity,
  target,
  disabled,
  unavailableMessage,
  focusReview,
  isActive = () => true,
  onStale,
  onTargetChange,
}: ReviewActionsProps) {
  const t = useClientTranslator()

  const formId = useId()
  const moreMenuRef = useRef<HTMLDetailsElement>(null)
  const [submitting, setSubmitting] = useState<Mutation | null>(null)
  const [commitMode, setCommitMode] = useState<CommitMode | null>(null)
  const [checkpointOpen, setCheckpointOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [commitMessage, setCommitMessage] = useState(review.suggestedCommitMessage)
  const [checkpointMessage, setCheckpointMessage] = useState(review.suggestedCommitMessage)
  const checkpointRequestId = useRef<string | null>(null)
  const [retainEnvironment, setRetainEnvironment] = useState(false)
  const [retention, setRetention] = useState<Exclude<WorktreeRetentionMode, 'cleanup'>>('retain_24h')
  const [message, setMessage] = useState<((t: ClientTranslator) => string) | null>(null)
  const [errorText, setError] = useState<((t: ClientTranslator) => WorktreeConsoleError) | null>(null)
  const error = errorText?.(t) ?? null
  const [runtimeConflict, setRuntimeConflict] = useState<WorktreeApplyConflictContinuation | null>(null)
  const mutationLock = useRef(false)
  const observedTargetRevision = useRef(target?.revision)
  const observedReviewSlot = useRef(target?.reviewSlot)
  const recoverySnapshot = useWorktreeRecoverySnapshot(identity?.sessionId)
  const autoPreflightEnabled = Boolean(
    adapter
    && identity
    && !disabled
    && target?.state === 'ready_for_review'
    && target.capabilities.preflight,
  )
  const { snapshot: preflightSnapshot, refresh: refreshPreflight } = useReviewPreflight(
    adapter,
    identity,
    autoPreflightEnabled,
  )
  const safeReadyPreflight = preflightSnapshot.status === 'success'
    && preflightSnapshot.preflight.status !== 'blocked'
    && preflightSnapshot.preflight.status !== 'conflict'
  const recoveryIdentity = identity && target?.state === 'preview_detached' && target.previewRecovery
    ? {
        ...identity,
        expectedPreviewId: target.previewRecovery.previewId,
      }
    : undefined
  const { snapshot: recoveryPreflight, refresh: refreshRecoveryPreflight } = usePreviewRecoveryPreflight(
    adapter,
    recoveryIdentity,
    Boolean(adapter && recoveryIdentity && !disabled),
  )
  const recoveryProof: WorktreePreviewRecoveryProof | undefined = recoveryPreflight.status === 'success'
    && recoveryPreflight.preflight.status === 'assessed'
    ? recoveryPreflight.preflight.proof
    : undefined
  const activeRecovery = recoverySnapshot
    && identity
    && recoverySnapshot.request.checkoutId === identity.checkoutId
    && recoverySnapshot.request.reviewId === identity.expectedReviewId
    ? recoverySnapshot
    : null

  useEffect(() => {
    if (!adapter || !services || !identity) return
    restoreWorktreeRecovery({ sessionId: identity.sessionId, adapter, services, isActive })
  }, [adapter, services, identity?.sessionId])

  useEffect(() => {
    setCommitMessage(review.suggestedCommitMessage)
    setCheckpointMessage(review.suggestedCommitMessage)
    setCheckpointOpen(false)
    if (moreMenuRef.current) moreMenuRef.current.open = false
    checkpointRequestId.current = null
    setRetainEnvironment(false)
    setRetention('retain_24h')
  }, [review.reviewId, review.suggestedCommitMessage])

  useEffect(() => {
    const closeFromOutside = (event: MouseEvent): void => {
      const menu = moreMenuRef.current
      if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
    }
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      const menu = moreMenuRef.current
      if (event.key !== 'Escape' || !menu?.open) return
      event.preventDefault()
      menu.open = false
      menu.querySelector<HTMLElement>('summary')?.focus()
    }
    document.addEventListener('mousedown', closeFromOutside)
    document.addEventListener('keydown', closeFromKeyboard)
    return () => {
      document.removeEventListener('mousedown', closeFromOutside)
      document.removeEventListener('keydown', closeFromKeyboard)
    }
  }, [])

  useEffect(() => {
    const revision = target?.revision
    if (revision === undefined || revision === observedTargetRevision.current) return
    observedTargetRevision.current = revision
    if (submitting !== null) return
    setMessage(null)
    setError(null)
    setRuntimeConflict(null)
  }, [submitting, target?.revision])

  useEffect(() => {
    const previous = observedReviewSlot.current
    observedReviewSlot.current = target?.reviewSlot
    if (
      previous === 'waiting'
      && target?.reviewSlot === 'available'
      && adapter
      && identity
    ) {
      invalidateReviewPreflight(adapter, identity)
      void readReviewPreflight(adapter, identity)
    }
  }, [adapter, identity?.checkoutId, identity?.expectedReviewId, identity?.expectedRevision, target?.reviewSlot])

  const begin = (mutation: Mutation): boolean => {
    if (disabled || !adapter || !identity || !target || mutationLock.current) return false
    mutationLock.current = true
    setSubmitting(mutation)
    setMessage(null)
    setError(null)
    return true
  }

  const finish = (): void => {
    mutationLock.current = false
    setSubmitting(null)
  }

  const closeMoreMenu = (): void => {
    if (moreMenuRef.current) moreMenuRef.current.open = false
  }

  const finishError = (nextError: WorktreeConsoleError): void => {
    if (nextError.code === 'apply_conflict' && nextError.continuation?.kind === 'worktree_apply_conflict') {
      setRuntimeConflict(nextError.continuation)
      setCommitMode(null)
      setError(null)
      setMessage(() => (t: ClientTranslator) => t("the.live.write.check.found.conflicts.local.is"))
      finish()
      return
    }
    setError(() => (t: ClientTranslator): WorktreeConsoleError => (nextError))
    if (nextError.code === 'stale_target') onStale(nextError)
    if (nextError.code === 'stale_local' || nextError.code === 'stale_isolated') {
      setMessage(() => (t: ClientTranslator) => t("state.changed.before.writing.the.operation.stopped.recover"))
      void refreshPreflight()
    }
    finish()
  }

  const applyTarget = (nextTarget: WorktreeConsoleTargetSummary): void => {
    if (!isActive()) return
    observedTargetRevision.current = nextTarget.revision
    onTargetChange(nextTarget)
    if (identity) requestWorktreeReviewRefresh(identity.sessionId)
  }

  const enqueueRecovery = (request: WorktreeRecoveryRequest): void => {
    if (!adapter || !services) return
    enqueueWorktreeRecovery({ adapter, services, request, isActive })
  }

  const startConflictRecovery = async (
    preflight: Extract<WorktreeApplyPreflightView, { status: 'conflict' }>,
    requestId = `preflight-conflict:${preflight.checkoutId}:${preflight.reviewId}:${preflight.revision}:${preflight.localHeadOid}`,
  ): Promise<void> => {
    if (!services || !begin('recovery') || !adapter || !identity) return
    const resumeIdentity = {
      sessionId: identity.sessionId,
      checkoutId: preflight.checkoutId,
      expectedRevision: preflight.revision,
      expectedReviewId: preflight.reviewId,
    }
    const latest = await readReviewPreflight(adapter, resumeIdentity, true)
    if (!isActive()) {
      finish()
      return
    }
    if (latest.status === 'error') {
      finishError(latest.error)
      return
    }
    if (latest.status !== 'success' || latest.preflight.status !== 'conflict') {
      setMessage(() => (t: ClientTranslator) => latest.status === 'success' ? preflightMessage(latest.preflight, t) : t("conflict.preflight.has.not.finished"))
      finish()
      return
    }
    if (
      latest.preflight.checkoutId !== preflight.checkoutId
      || latest.preflight.reviewId !== preflight.reviewId
      || latest.preflight.revision !== preflight.revision
      || latest.preflight.localHeadOid !== preflight.localHeadOid
      || !sameStrings(latest.preflight.conflictingFiles, preflight.conflictingFiles)
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'stale_target', message: t("the.conflict.identity.changed.before.recovery.retry.using") }))
      finish()
      return
    }
    const outcome = await adapter.resumeRevision({ ...resumeIdentity, conflictContinuation: {
      kind: 'worktree_apply_conflict',
      requestId,
      checkoutId: preflight.checkoutId,
      reviewId: preflight.reviewId,
      revision: preflight.revision,
      localHeadOid: preflight.localHeadOid,
      conflictingFiles: [...preflight.conflictingFiles],
    } })
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    const nextTarget = outcome.value.target
    if (
      nextTarget.checkoutId !== preflight.checkoutId
      || nextTarget.ownerSessionId !== identity.sessionId
      || nextTarget.targetSessionId !== identity.sessionId
      || nextTarget.state !== 'working'
      || nextTarget.revision !== preflight.revision + 1
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("the.working.identity.returned.by.host.after.resuming") }))
      finish()
      return
    }
    const recovery = outcome.value.recoveryContinuation
    if (
      !recovery
      || recovery.kind !== 'worktree_apply_conflict'
      || recovery.checkoutId !== preflight.checkoutId
      || recovery.reviewId !== preflight.reviewId
      || recovery.revision !== nextTarget.revision
      || recovery.localHeadOid !== preflight.localHeadOid
      || !sameStrings(recovery.conflictingFiles, preflight.conflictingFiles)
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("host.did.not.return.an.exact.conflict.recovery") }))
      finish()
      return
    }
    applyTarget(nextTarget)
    setRuntimeConflict(null)
    enqueueRecovery({
      kind: recovery.kind,
      sessionId: identity.sessionId,
      requestId: recovery.requestId,
      checkoutId: recovery.checkoutId,
      reviewId: recovery.reviewId,
      revision: recovery.revision,
      localHeadOid: recovery.localHeadOid,
      conflictingFiles: [...recovery.conflictingFiles],
    })
    setMessage(() => (t: ClientTranslator) => t("safely.resumed.working.the.conflict.resolution.request.is"))
    finish()
  }

  const startReviewRegeneration = async (
    preflight: Extract<WorktreeApplyPreflightView, { status: 'blocked' }> & { reason: 'stale_isolated'; reviewId: string },
  ): Promise<void> => {
    if (!services || !begin('recovery') || !adapter || !identity) return
    const regenerationIdentity = {
      sessionId: identity.sessionId,
      checkoutId: preflight.checkoutId,
      expectedRevision: preflight.revision,
      expectedReviewId: preflight.reviewId,
    }
    const latest = await readReviewPreflight(adapter, regenerationIdentity, true)
    if (!isActive()) {
      finish()
      return
    }
    if (latest.status === 'error') {
      finishError(latest.error)
      return
    }
    if (
      latest.status !== 'success'
      || latest.preflight.status !== 'blocked'
      || latest.preflight.reason !== 'stale_isolated'
      || latest.preflight.checkoutId !== preflight.checkoutId
      || latest.preflight.reviewId !== preflight.reviewId
      || latest.preflight.revision !== preflight.revision
    ) {
      setMessage(() => (t: ClientTranslator) => latest.status === 'success' ? preflightMessage(latest.preflight, t) : t("read.only.recheck.has.not.finished"))
      finish()
      return
    }
    const prepared = await adapter.prepareReviewRegeneration(regenerationIdentity)
    if (!isActive()) {
      finish()
      return
    }
    if (!prepared.ok) {
      finishError(prepared.error)
      return
    }
    const recovery = prepared.value.recoveryContinuation
    if (
      !recovery
      || recovery.kind !== 'worktree_review_regeneration'
      || recovery.checkoutId !== preflight.checkoutId
      || recovery.reviewId !== preflight.reviewId
      || recovery.revision !== preflight.revision
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("host.did.not.return.an.exact.read.only") }))
      finish()
      return
    }
    enqueueRecovery({
      kind: recovery.kind,
      sessionId: identity.sessionId,
      requestId: recovery.requestId,
      checkoutId: recovery.checkoutId,
      reviewId: recovery.reviewId,
      revision: recovery.revision,
    })
    setMessage(() => (t: ClientTranslator) => t("read.only.review.regeneration.is.waiting.for.the"))
    finish()
  }

  const recoverPreflight = (preflight: WorktreeApplyPreflightView): void => {
    if (preflight.status === 'conflict') {
      void startConflictRecovery(preflight)
      return
    }
    if (preflight.status === 'blocked' && preflight.reason === 'stale_isolated' && preflight.reviewId !== null) {
      void startReviewRegeneration({ ...preflight, reason: 'stale_isolated', reviewId: preflight.reviewId })
    }
  }

  const recoverRuntimeConflict = (): void => {
    if (!runtimeConflict) return
    void startConflictRecovery({
      status: 'conflict',
      localModified: false,
      checkoutId: runtimeConflict.checkoutId,
      reviewId: runtimeConflict.reviewId,
      revision: runtimeConflict.revision,
      configuredBaseOid: runtimeConflict.localHeadOid,
      effectiveBaseOid: runtimeConflict.localHeadOid,
      baseStrategy: 'recorded_base',
      localBranch: null,
      localHeadOid: runtimeConflict.localHeadOid,
      isolatedHeadOid: target?.currentOid ?? runtimeConflict.localHeadOid,
      changedFiles: [],
      conflictingFiles: runtimeConflict.conflictingFiles,
    }, runtimeConflict.requestId)
  }

  const previewLocal = async (): Promise<void> => {
    if (!begin('preview') || !adapter || !identity) return
    const inspected = await readReviewPreflight(adapter, identity, true)
    if (!isActive()) {
      finish()
      return
    }
    if (inspected.status === 'error') {
      finishError(inspected.error)
      return
    }
    if (inspected.status !== 'success') {
      finish()
      return
    }
    setMessage(() => (t: ClientTranslator) => preflightMessage(inspected.preflight, t))
    if (inspected.preflight.status === 'conflict' || inspected.preflight.status === 'blocked') {
      finish()
      return
    }
    const outcome = await adapter.preview(identity)
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(() => (t: ClientTranslator) => t("synced.as.a.reversible.local.preview.review.the"))
    finish()
  }

  const openCheckpoint = (): void => {
    if (!target?.checkpointGeneration || !target.capabilities.checkpoint || disabled || submitting !== null) return
    checkpointRequestId.current = checkpointRequestIdForGeneration(target.checkpointGeneration)
    setCheckpointMessage(review.suggestedCommitMessage)
    setCheckpointOpen(true)
  }

  const checkpoint = async (): Promise<void> => {
    const value = checkpointMessage.trim()
    const requestId = checkpointRequestId.current
    if (!value || value.length > 500 || !requestId || !begin('checkpoint') || !adapter || !identity || !target?.checkpointGeneration) return
    const expectedCount = target.checkpoints?.length ?? 0
    const outcome = await adapter.checkpoint({
      ...identity,
      expectedGeneration: target.checkpointGeneration,
      requestId,
      commitMessage: value,
    })
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    const saved = outcome.value.checkpoint
    const nextTarget = outcome.value.target
    if (
      !saved
      || saved.reviewId !== identity.expectedReviewId
      || saved.sequence !== expectedCount + 1
      || nextTarget.checkoutId !== identity.checkoutId
      || nextTarget.ownerSessionId !== identity.sessionId
      || nextTarget.state !== 'working'
      || nextTarget.review !== undefined
      || nextTarget.checkpoints?.at(-1)?.checkpointId !== saved.checkpointId
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("host.returned.a.mismatched.checkpoint.identity.or.working") }))
      finish()
      return
    }
    applyTarget(nextTarget)
    setCheckpointOpen(false)
    checkpointRequestId.current = null
    setMessage(() => (t: ClientTranslator) => t("saved.worktree.stage.and.resumed.editing.the.stage", { p0: saved.sequence }))
    finish()
  }

  const resumeRevision = async (): Promise<void> => {
    if (!begin('resume_revision') || !adapter || !identity) return
    const outcome = await adapter.resumeRevision(identity)
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    const drafted = services
      ? prefillSessionDraft(
          services,
          identity.sessionId,
          t("please.recheck.the.current.worktree.changes.rerun.the"),
        )
      : false
    setMessage(() => (t: ClientTranslator) => drafted
      ? t("resumed.editing.and.prefilled.a.new.review.request")
      : t("resumed.editing.recheck.validate.and.generate.a.new"))
    finish()
  }

  const rollbackPreview = async (resumeRevision = false): Promise<void> => {
    if (!begin('rollback') || !adapter || !identity) return
    let freshProof: WorktreePreviewRecoveryProof | undefined
    if (target?.state === 'preview_detached') {
      if (!recoveryIdentity) {
        setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'stale_target', message: t("detached.preview.identity.is.incomplete.please.refresh") }))
        finish()
        return
      }
      const inspected = await readPreviewRecoveryPreflight(adapter, recoveryIdentity, true)
      if (!isActive()) {
        finish()
        return
      }
      if (inspected.status === 'error') {
        finishError(inspected.error)
        return
      }
      if (inspected.status !== 'success' || inspected.preflight.status !== 'assessed') {
        setMessage(() => (t: ClientTranslator) => inspected.status === 'success' && inspected.preflight.status === 'blocked'
          ? inspected.preflight.message
          : t("preview.recovery.preflight.has.not.finished"))
        finish()
        return
      }
      if (inspected.preflight.proof.rollback.status !== 'safe') {
        const explanation = inspected.preflight.proof.rollback.message
        setMessage(() => () => explanation)
        finish()
        return
      }
      freshProof = inspected.preflight.proof
    }
    const outcome = await adapter.rollbackPreview({
      ...identity,
      resumeRevision,
      ...(freshProof ? { recoveryProof: freshProof } : {}),
    })
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(() => (t: ClientTranslator) => outcome.value.target.state === 'preview_detached'
      ? t("recovery.conditions.changed.before.writing.preview.evidence.and")
      : resumeRevision ? t("local.preview.rolled.back.you.can.continue.editing") : t("local.preview.rolled.back.the.review.can.be"))
    finish()
  }

  const submitCommit = async (): Promise<void> => {
    const value = commitMessage.trim()
    const mode = commitMode
    if (!mode || !value || value.length > 500 || !begin(mode) || !adapter || !identity) return
    const selectedRetention: WorktreeRetentionMode = retainEnvironment ? retention : 'cleanup'
    const request = { ...identity, commitMessage: value, retention: selectedRetention }
    if (mode === 'finish') {
      const inspected = await readReviewPreflight(adapter, identity, true)
      if (!isActive()) {
        finish()
        return
      }
      if (inspected.status === 'error') {
        finishError(inspected.error)
        return
      }
      if (inspected.status !== 'success' || inspected.preflight.status === 'blocked' || inspected.preflight.status === 'conflict') {
        setMessage(() => (t: ClientTranslator) => inspected.status === 'success' ? preflightMessage(inspected.preflight, t) : t("sync.preflight.has.not.finished"))
        finish()
        return
      }
    }
    let previewProof: WorktreePreviewRecoveryProof | undefined
    if (mode === 'finalize_preview' && target?.state === 'preview_detached') {
      if (!recoveryIdentity) {
        setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'stale_target', message: t("detached.preview.identity.is.incomplete.please.refresh") }))
        finish()
        return
      }
      const inspected = await readPreviewRecoveryPreflight(adapter, recoveryIdentity, true)
      if (!isActive()) {
        finish()
        return
      }
      if (inspected.status === 'error') {
        finishError(inspected.error)
        return
      }
      if (inspected.status !== 'success' || inspected.preflight.status !== 'assessed') {
        setMessage(() => (t: ClientTranslator) => inspected.status === 'success' && inspected.preflight.status === 'blocked'
          ? inspected.preflight.message
          : t("preview.recovery.preflight.has.not.finished"))
        finish()
        return
      }
      if (inspected.preflight.proof.finalize.status !== 'safe') {
        const explanation = inspected.preflight.proof.finalize.message
        setMessage(() => () => explanation)
        finish()
        return
      }
      previewProof = inspected.preflight.proof
    }
    const outcome = mode === 'finalize_preview'
      ? await adapter.finalizePreview({ ...request, ...(previewProof ? { recoveryProof: previewProof } : {}) })
      : await adapter.finalize(request)
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    if (outcome.value.target.state === 'preview_detached') {
      setMessage(() => (t: ClientTranslator) => t("local.changed.a.reliable.commit.is.not.possible"))
    } else {
      setMessage(() => (t: ClientTranslator) => selectedRetention === 'cleanup' ? t("committed.to.local.and.started.worktree.cleanup") : t("committed.to.local.and.retained.the.current.environment"))
    }
    setCommitMode(null)
    finish()
  }

  const discard = async (): Promise<void> => {
    if (!begin('discard') || !adapter || !identity || !target) return
    const outcome = await adapter.discard({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
      confirmDirty: true,
      ...(target.state === 'preview_active' || target.capabilities.rollbackPreview ? { rollbackPreview: true } : {}),
    })
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(() => (t: ClientTranslator) => outcome.value.target.state === 'preview_detached'
      ? t("local.changed.lossless.rollback.is.not.possible.the")
      : t("discarded.this.iteration.s.worktree.changes.local.is"))
    setDiscardOpen(false)
    finish()
  }

  const freshRecoveryProof = async (): Promise<WorktreePreviewRecoveryProof | null> => {
    if (!adapter || !recoveryIdentity) return null
    const inspected = await readPreviewRecoveryPreflight(adapter, recoveryIdentity, true)
    if (!isActive()) return null
    if (inspected.status === 'error') {
      finishError(inspected.error)
      return null
    }
    if (inspected.status !== 'success' || inspected.preflight.status !== 'assessed') {
      setMessage(() => (t: ClientTranslator) => inspected.status === 'success' && inspected.preflight.status === 'blocked'
        ? inspected.preflight.message
        : t("preview.recovery.preflight.has.not.finished"))
      return null
    }
    return inspected.preflight.proof
  }

  const analyzeRecovery = async (): Promise<void> => {
    if (!services || !begin('recovery_analysis') || !adapter || !identity || !recoveryIdentity) return
    const proof = await freshRecoveryProof()
    if (!proof) {
      finish()
      return
    }
    const prepared = await adapter.preparePreviewRecoveryAnalysis({ ...recoveryIdentity, recoveryProof: proof })
    if (!isActive()) {
      finish()
      return
    }
    if (!prepared.ok) {
      finishError(prepared.error)
      return
    }
    const continuation = prepared.value.recoveryContinuation
    if (
      continuation?.kind !== 'worktree_preview_recovery_analysis'
      || continuation.checkoutId !== identity.checkoutId
      || continuation.reviewId !== identity.expectedReviewId
      || continuation.previewId !== recoveryIdentity.expectedPreviewId
      || continuation.revision !== identity.expectedRevision
      || continuation.generation !== proof.generation
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("host.did.not.return.an.exact.detached.recovery") }))
      finish()
      return
    }
    try {
      await openAuthorizedWorktreeTarget(adapter, services, identity.sessionId, {
        checkoutId: identity.checkoutId,
        ownerSessionId: identity.sessionId,
      }, isActive)
      const verified = await adapter.inspect({ sessionId: identity.sessionId, checkoutId: identity.checkoutId })
      if (!verified.ok || verified.value.target.recoveryContinuation?.kind !== continuation.kind
        || verified.value.target.recoveryContinuation.requestId !== continuation.requestId
        || verified.value.target.recoveryContinuation.generation !== continuation.generation) {
        throw new Error(t("the.second.host.inspection.did.not.confirm.the"))
      }
      const binding = services.sessions.binding(identity.sessionId)
      const prompt = binding?.session.prompt
      if (!binding || !prompt) throw new Error(t("the.owner.session.has.not.provided.the.harness"))
      const result = await prompt.call(binding.session, [{ type: 'text', text: [
        t("analyze.detached.preview.recovery.in.read.only.mode", { p0: identity.checkoutId, p1: identity.expectedReviewId, p2: recoveryIdentity.expectedPreviewId, p3: proof.generation }),
        t("do.not.modify.the.old.managed.worktree.local"),
        t("explain.the.rollback.finalize.blockers.missing.task.changes"),
      ].join('\n') }], 'queue')
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setMessage(() => (t: ClientTranslator) => t("sent.a.read.only.recovery.analysis.request.to"))
    } catch (reason) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) }))
    }
    finish()
  }

  const handoffRecovery = async (): Promise<void> => {
    if (!services || !begin('recovery_handoff') || !adapter || !identity || !recoveryIdentity) return
    const proof = await freshRecoveryProof()
    if (!proof) {
      finish()
      return
    }
    const created = await adapter.createPreviewRecoveryHandoff({ ...recoveryIdentity, recoveryProof: proof })
    if (!isActive()) {
      finish()
      return
    }
    if (!created.ok) {
      finishError(created.error)
      return
    }
    const continuation = created.value.recoveryContinuation
    if (
      continuation.kind !== 'worktree_preview_recovery_handoff'
      || continuation.sourceCheckoutId !== identity.checkoutId
      || continuation.reviewId !== identity.expectedReviewId
      || continuation.previewId !== recoveryIdentity.expectedPreviewId
      || continuation.revision !== identity.expectedRevision
      || continuation.generation !== proof.generation
      || continuation.checkoutId !== created.value.target.checkoutId
      || continuation.checkoutId === identity.checkoutId
    ) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: t("host.returned.a.mismatched.recovery.handoff.identity") }))
      finish()
      return
    }
    try {
      await openIsolatedTarget(services, {
        targetSessionId: created.value.targetSessionId,
        managedRoot: created.value.managedRoot,
      }, isActive)
      const verified = await adapter.inspect({
        sessionId: created.value.targetSessionId,
        checkoutId: continuation.checkoutId,
      })
      if (!verified.ok || verified.value.target.managedRoot !== created.value.managedRoot
        || verified.value.target.recoveryContinuation?.kind !== continuation.kind
        || verified.value.target.recoveryContinuation.requestId !== continuation.requestId) {
        throw new Error(t("the.second.host.cwd.check.of.the.new"))
      }
      const binding = services.sessions.binding(created.value.targetSessionId)
      const prompt = binding?.session.prompt
      if (!binding || !prompt) throw new Error(t("the.new.owner.session.has.not.provided.the"))
      const result = await prompt.call(binding.session, [{ type: 'text', text: [
        t("this.is.a.detached.preview.recovery.handoff.the", { p0: identity.checkoutId, p1: identity.expectedReviewId, p2: recoveryIdentity.expectedPreviewId, p3: proof.generation }),
        t("the.new.worktree.is.based.on.the.latest"),
        t("run.the.necessary.validation.and.generate.a.new"),
      ].join('\n') }], 'queue')
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setMessage(() => (t: ClientTranslator) => t("created.and.opened.a.fresh.worktree.based.on"))
    } catch (reason) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) }))
    }
    finish()
  }

  const retryCleanup = async (): Promise<void> => {
    if (!begin('retry_cleanup') || !adapter || !identity) return
    const outcome = await adapter.retryCleanup({
      sessionId: identity.sessionId,
      checkoutId: identity.checkoutId,
      expectedRevision: identity.expectedRevision,
    })
    if (!isActive()) {
      finish()
      return
    }
    if (!outcome.ok) {
      finishError(outcome.error)
      return
    }
    applyTarget(outcome.value.target)
    setMessage(() => (t: ClientTranslator) => outcome.value.target.state === 'delivered' ? t("worktree.environment.cleaned.up") : t("cleanup.is.still.incomplete.recovery.information.was.retained"))
    finish()
  }

  const openHolder = async (): Promise<void> => {
    const holder = preflightSnapshot.status === 'success'
      && preflightSnapshot.preflight.status === 'blocked'
      && preflightSnapshot.preflight.reason === 'project_acceptance_busy'
      ? preflightSnapshot.preflight.blocker ?? target?.reviewSlotHolder
      : recoveryProof?.blocker ?? target?.reviewSlotHolder
    if (!holder || !adapter || !identity || !services || mutationLock.current) return
    mutationLock.current = true
    setSubmitting('open_holder')
    setError(null)
    try {
      await openAuthorizedWorktreeTarget(adapter, services, identity.sessionId, holder, isActive)
    } catch (reason) {
      setError(() => (t: ClientTranslator): WorktreeConsoleError => ({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) }))
    } finally {
      finish()
    }
  }

  const live = Boolean(adapter && identity && target)
  const allDisabled = disabled || submitting !== null || !live
  const ready = target?.state === 'ready_for_review'
  const previewActive = target?.state === 'preview_active'
  const previewRecovery = target?.state === 'preview_detached'
    || target?.state === 'recovery_required' && target.capabilities.rollbackPreview
  const rollbackRecoverySafe = target?.state === 'preview_detached'
    && recoveryProof?.rollback.status === 'safe'
  const finalizeRecoverySafe = target?.state === 'preview_detached'
    && recoveryProof?.finalize.status === 'safe'
  const cleanupPending = target?.state === 'cleanup_pending'
  const terminal = target?.state === 'retained' || target?.state === 'delivered'
  const canDiscard = Boolean(target?.capabilities.discard)

  const closeCommit = (): void => {
    if (submitting === null) setCommitMode(null)
  }
  const closeCheckpoint = (): void => {
    if (submitting !== null) return
    setCheckpointOpen(false)
    checkpointRequestId.current = null
  }
  const closeDiscard = (): void => {
    if (submitting === null) setDiscardOpen(false)
  }

  const primary = ready ? (
    <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={allDisabled || !target.capabilities.preview || !safeReadyPreflight} onClick={() => { void previewLocal() }}>
      {submitting === 'preview'
        ? t("syncing")
        : autoPreflightEnabled && (preflightSnapshot.status === 'idle' || preflightSnapshot.status === 'loading')
          ? t("checking")
          : t("preview.changes")}
    </button>
  ) : previewActive ? (
    <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={allDisabled || !target.capabilities.finalizePreview} onClick={() => setCommitMode('finalize_preview')}>
      {t("confirm.and.save")} </button>
  ) : previewRecovery ? (
    rollbackRecoverySafe ? (
      <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.rollbackPreview} onClick={() => { void rollbackPreview(true) }}>
        {submitting === 'rollback' ? t("processing") : t("recover.and.roll.back.preview")}
      </button>
    ) : (
      <button type="button" className="dsh-wt-button" disabled={allDisabled || target?.state !== 'preview_detached'} onClick={() => { void refreshRecoveryPreflight() }}>
        {recoveryPreflight.status === 'loading' ? t("checking") : t("check.again")}
      </button>
    )
  ) : cleanupPending ? (
    <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.retryCleanup} onClick={() => { void retryCleanup() }}>
      {submitting === 'retry_cleanup' ? t("cleaning.up") : t("retry.environment.cleanup")}
    </button>
  ) : null

  return (
    <section className="dsh-wt-review-actions" aria-label={t("review.actions")}>
      {!live ? <p className="dsh-wt-status">{unavailableMessage}</p> : null}
      {terminal ? (
        <p className="dsh-wt-status">
          {target.state === 'retained'
            ? t("this.iteration.was.committed.the.environment.is.temporarily", { p0: target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : '' })
            : t("this.iteration.was.delivered", { p0: target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : '' })}
        </p>
      ) : (
        <div className="dsh-wt-actions">
          {primary}
          <details ref={moreMenuRef} className="dsh-wt-more-menu">
            <summary className="dsh-wt-more-trigger" aria-label={t("more.delivery.actions")}>{t("symbol")}</summary>
            <div className="dsh-wt-more-content" role="menu">
              {focusReview ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" onClick={() => {
                  focusReview()
                  closeMoreMenu()
                }}>{t("view.review")}</button>
              ) : null}
              {ready ? (
                <>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.checkpoint || !target.checkpointGeneration} onClick={() => {
                    openCheckpoint()
                    closeMoreMenu()
                  }}>{t("save.stage.and.continue")}</button>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.resumeRevision} onClick={() => {
                    void resumeRevision()
                    closeMoreMenu()
                  }}>{submitting === 'resume_revision' ? t("recovering") : t("continue.editing")}</button>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.finalize || !safeReadyPreflight} onClick={() => {
                    setCommitMode('finish')
                    closeMoreMenu()
                  }}>{t("skip.preview.and.save")}</button>
                </>
              ) : null}
              {previewActive && target.capabilities.checkpoint && target.checkpointGeneration ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled} onClick={() => {
                  openCheckpoint()
                  closeMoreMenu()
                }}>{t("save.stage.and.continue")}</button>
              ) : null}
              {previewActive || rollbackRecoverySafe ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.rollbackPreview} onClick={() => {
                  void rollbackPreview(true)
                  closeMoreMenu()
                }}>{previewActive ? t("roll.back.this.preview") : t("retry.rollback")}</button>
              ) : null}
              {finalizeRecoverySafe ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.finalizePreview} onClick={() => {
                  setCommitMode('finalize_preview')
                  closeMoreMenu()
                }}>{t("save.changes")}</button>
              ) : null}
              {canDiscard ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item dsh-wt-danger-text" disabled={allDisabled} onClick={() => {
                  setDiscardOpen(true)
                  closeMoreMenu()
                }}>{t("discard.task")}</button>
              ) : null}
            </div>
          </details>
        </div>
      )}

      <Modal
        open={checkpointOpen}
        onClose={closeCheckpoint}
        title={t("save.current.progress.and.continue")}
        closeLabel={t("close.save.progress.confirmation")}
        description={previewActive
          ? t("first.safely.roll.back.the.preview.then.save")
          : t("save.task.progress.and.continue.to.the.next")}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeCheckpoint}>{t("cancel")}</button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null || !checkpointMessage.trim() || checkpointMessage.trim().length > 500} onClick={() => { void checkpoint() }}>
              {submitting === 'checkpoint' ? t("saving") : t("save.progress.and.continue")}
            </button>
          </div>
        )}
      >
        <div className="dsh-wt-commit-dialog">
          <div className="dsh-wt-checkpoint-note">
            <strong>{t("stages.are.not.published.to.local")}</strong>
            <span>{t("checkpoint.summary", { count: target?.checkpoints?.length ?? 0 })}</span>
          </div>
          <label htmlFor={`${formId}-checkpoint-message`}>{t("checkpoint.commit.message")}</label>
          <textarea id={`${formId}-checkpoint-message`} aria-label={t("checkpoint.commit.message")} rows={6} maxLength={500} value={checkpointMessage} onChange={event => setCheckpointMessage(event.target.value)} />
          <div className="dsh-wt-character-count">{checkpointMessage.length}{t("500")}</div>
        </div>
      </Modal>

      <Modal
        open={commitMode !== null}
        onClose={closeCommit}
        title={commitMode === 'finalize_preview'
          ? t("confirm.and.save.these.changes")
          : target?.state === 'preview_detached' ? t("save.these.changes") : t("skip.preview.and.save.directly")}
        closeLabel={t("close.save.confirmation")}
        description={commitMode === 'finalize_preview'
          ? t("only.this.iteration.s.task.changes.in.the")
          : t("skip.local.preview.and.save.this.iteration.s")}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeCommit}>{t("cancel")}</button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null || !commitMessage.trim() || commitMessage.trim().length > 500} onClick={() => { void submitCommit() }}>
              {submitting === 'finish' || submitting === 'finalize_preview'
                ? t("saving")
                : retainEnvironment ? t("confirm.delivery.and.retain.environment") : t("confirm.delivery.and.clean.up")}
            </button>
          </div>
        )}
      >
        <div className="dsh-wt-commit-dialog">
          <label htmlFor={`${formId}-message`}>{t("commit.message")}</label>
          <textarea id={`${formId}-message`} aria-label={t("commit.message")} rows={6} maxLength={500} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} />
          <div className="dsh-wt-character-count">{commitMessage.length}{t("500")}</div>
          <label className="dsh-wt-retention-check">
            <input type="checkbox" checked={retainEnvironment} onChange={event => setRetainEnvironment(event.target.checked)} />
            <span>{t("temporarily.retain.the.current.environment.after.committing")}</span>
          </label>
          {retainEnvironment ? (
            <label className="dsh-wt-retention-select">
              <span>{t("retention.period")}</span>
              <select aria-label={t("retention.period")} value={retention} onChange={event => setRetention(event.target.value as Exclude<WorktreeRetentionMode, 'cleanup'>)}>
                <option value="retain_24h">{t("retain.for.24.hours")}</option>
                <option value="retain_3d">{t("retain.for.3.days")}</option>
                <option value="retain_manual">{t("manual.cleanup")}</option>
              </select>
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={discardOpen}
        onClose={closeDiscard}
        title={t("discard.this.iteration")}
        closeLabel={t("close.discard.confirmation")}
        description={previewActive
          ? t("first.safely.roll.back.this.local.preview.then")
          : t("undelivered.worktree.changes.will.be.permanently.discarded.local")}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeDiscard}>{t("cancel")}</button>
            <button type="button" className="dsh-wt-button dsh-wt-danger" disabled={submitting !== null} onClick={() => { void discard() }}>
              {submitting === 'discard' ? t("discarding") : t("confirm.discard.task")}
            </button>
          </div>
        )}
      />

      {ready ? (
        <PreflightStatus
          snapshot={preflightSnapshot}
          target={target}
          onRefresh={() => { void refreshPreflight() }}
          onRecovery={recoverPreflight}
          onOpenHolder={() => { void openHolder() }}
          busy={submitting !== null || activeRecovery?.status === 'queued' || activeRecovery?.status === 'sending' || activeRecovery?.status === 'sent'}
        />
      ) : null}
      {target?.state === 'preview_detached' ? (
        <div className="dsh-wt-preflight" data-status={recoveryPreflight.status}>
          <div className="dsh-wt-preflight-head">
            <strong>{t("detached.preview.recovery")}</strong>
            <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || recoveryPreflight.status === 'loading'} onClick={() => { void refreshRecoveryPreflight() }}>
              {t("check.again")} </button>
          </div>
          <p>{t("detached.is.a.delivery.recovery.state.not.git")}</p>
          {recoveryPreflight.status === 'loading' ? <p>{t("checking.local.head.index.working.tree.retained.artifacts")}</p> : null}
          {recoveryPreflight.status === 'error' ? <p className="dsh-wt-error">{recoveryPreflight.error.message}</p> : null}
          {recoveryPreflight.status === 'success' && recoveryPreflight.preflight.status === 'blocked' ? (
            <p className="dsh-wt-error">{recoveryPreflight.preflight.message}</p>
          ) : null}
          {recoveryProof ? (
            <>
              <p className="dsh-wt-code">{t("generation")} {recoveryProof.generation.slice(0, 12)} {t("head")} {recoveryProof.localHeadOid.slice(0, 12)} · {recoveryProof.localHeadRef ?? 'detached HEAD'}</p>
              <ul className="dsh-wt-test-list" aria-label={t("preview.recovery.outcome")}>
                <li>{t("rollback")}{recoveryProof.rollback.status === 'safe' ? t("verified.safe") : recoveryProof.rollback.message}</li>
                <li>{t("commit.2")}{recoveryProof.finalize.status === 'safe' ? t("verified.safe") : recoveryProof.finalize.message}</li>
              </ul>
              {recoveryProof.rollback.status === 'blocked' && recoveryProof.rollback.conflictingFiles?.length ? (
                <p>{t("rollback.conflicts")}{recoveryProof.rollback.conflictingFiles.join('、')}</p>
              ) : null}
              {recoveryProof.finalize.status === 'blocked' && recoveryProof.finalize.conflictingFiles?.length ? (
                <p>{t("commit.conflicts")}{recoveryProof.finalize.conflictingFiles.join('、')}</p>
              ) : null}
              {recoveryProof.blocker ? (
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void openHolder() }}>
                  {t("open.the.worktree.holding.the.local.review.slot")} </button>
              ) : null}
              <div className="dsh-wt-recovery-actions">
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void analyzeRecovery() }}>
                  {t("ask.agent.for.read.only.analysis")} </button>
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void handoffRecovery() }}>
                  {t("hand.off.to.a.new.worktree")} </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {runtimeConflict ? (
        <div className="dsh-wt-recovery-actions">
          <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={recoverRuntimeConflict}>
            {t("ask.agent.to.resolve.conflicts")} </button>
        </div>
      ) : null}
      {activeRecovery ? (
        <div className="dsh-wt-action-status" data-recovery-status={activeRecovery.status}>
          {activeRecovery.status === 'queued' ? t("recovery.request.queued.waiting.for.the.owner.session") : null}
          {activeRecovery.status === 'sending' ? t("sending.the.recovery.request.through.the.official.harness") : null}
          {activeRecovery.status === 'sent'
            ? activeRecovery.request.kind === 'worktree_apply_conflict'
              ? t("agent.will.resolve.the.conflicts.and.must.generate")
              : t("agent.will.regenerate.the.review.in.read.only")
            : null}
          {activeRecovery.status === 'cancelled' ? t("session.checkout.changed.the.old.recovery.request.was") : null}
          {activeRecovery.status === 'failed' ? (
            <>
              <span>{t("recovery.request.failed")}{activeRecovery.error}</span>
              <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null} onClick={() => retryWorktreeRecovery(activeRecovery.request.sessionId)}>{t("resend")}</button>
            </>
          ) : null}
        </div>
      ) : null}
      {target && (target.state === 'cleanup_pending' || terminal) ? <DeliveryProof target={target} /> : null}
      <div className="dsh-wt-action-status" aria-live="polite">
        {submitting ? t("processing.worktree.please.wait") : message?.(t)}
      </div>
      {error && !isStale(error) ? (
        <div className="dsh-wt-error" role="alert">
          {t("error.detail", { message: error.message, category: t(`error.category.${worktreeConsoleErrorMeta(error.code).category}`), recovery: t(`error.recovery.${worktreeConsoleErrorMeta(error.code).recovery}`) })} </div>
      ) : null}
    </section>
  )
}
