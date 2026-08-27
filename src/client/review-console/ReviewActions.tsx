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

function preflightMessage(preflight: WorktreeApplyPreflightView): string {
  if (preflight.status === 'ready') return '同步预检通过，正在创建可撤回的 Local Preview。'
  if (preflight.status === 'local_advanced') return 'Local 已前进，但预检确认可以安全合并。'
  if (preflight.status === 'already_in_local') return '本轮内容已在 Local 中；同步将是安全空操作。'
  if (preflight.status === 'conflict') return `同步预检发现 ${preflight.conflictingFiles.length} 个冲突文件；Local 未修改。`
  if (preflight.status === 'blocked') return `同步暂时阻塞：${preflight.message}`
  return '同步预检完成；Local 未修改。'
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
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<WorktreeConsoleError | null>(null)
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
      setMessage('实时写入校验发现冲突；Local 未修改。请明确让 Agent 在 managed Worktree 中解决。')
      finish()
      return
    }
    setError(nextError)
    if (nextError.code === 'stale_target') onStale(nextError)
    if (nextError.code === 'stale_local' || nextError.code === 'stale_isolated') {
      setMessage('状态在写入前发生变化；已停止操作，请按最新只读预检恢复。')
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
      setMessage(latest.status === 'success' ? preflightMessage(latest.preflight) : '冲突预检未完成。')
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
      setError({ code: 'stale_target', message: '冲突身份在恢复前已变化，请按最新预检重试。' })
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
      setError({ code: 'checkout_mismatch', message: '恢复编辑后 Host 返回的 Working 身份不一致。' })
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
      setError({ code: 'checkout_mismatch', message: 'Host 未返回精确的冲突恢复凭证。' })
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
    setMessage('已安全恢复 Working，冲突解决请求正在等待精确 owner Session 空闲。Local 未修改。')
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
      setMessage(latest.status === 'success' ? preflightMessage(latest.preflight) : '只读复核未完成。')
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
      setError({ code: 'checkout_mismatch', message: 'Host 未返回精确的只读验收再生成凭证。' })
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
    setMessage('只读验收再生成请求正在等待精确 owner Session 空闲；不会恢复 Working 或修改文件。')
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
    setMessage(preflightMessage(inspected.preflight))
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
    setMessage('已同步为可撤回的 Local Preview；请在 Local 中验收。')
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
      setError({ code: 'checkout_mismatch', message: 'Host 返回的 Checkpoint 身份或 Working 状态不一致。' })
      finish()
      return
    }
    applyTarget(nextTarget)
    setCheckpointOpen(false)
    checkpointRequestId.current = null
    setMessage(`已保存第 ${saved.sequence} 个 Worktree 阶段并继续修改；阶段尚未发布到 Local。`)
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
          '请重新检查当前 Worktree 的修改，重新运行必要验证，并重新生成验收稿。',
        )
      : false
    setMessage(drafted
      ? '已恢复编辑并预填重新验收请求；Local 未受影响。'
      : '已恢复编辑；请重新检查、验证并生成新的验收稿。Local 未受影响。')
    finish()
  }

  const rollbackPreview = async (resumeRevision = false): Promise<void> => {
    if (!begin('rollback') || !adapter || !identity) return
    let freshProof: WorktreePreviewRecoveryProof | undefined
    if (target?.state === 'preview_detached') {
      if (!recoveryIdentity) {
        setError({ code: 'stale_target', message: 'Detached Preview 身份不完整，请刷新。' })
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
        setMessage(inspected.status === 'success' && inspected.preflight.status === 'blocked'
          ? inspected.preflight.message
          : 'Preview Recovery 预检未完成。')
        finish()
        return
      }
      if (inspected.preflight.proof.rollback.status !== 'safe') {
        setMessage(inspected.preflight.proof.rollback.message)
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
    setMessage(outcome.value.target.state === 'preview_detached'
      ? '恢复条件在写入前发生变化；Preview 证据和 Worktree 已保留，请重新检查。'
      : resumeRevision ? '已撤回 Local Preview，可以继续修改 Worktree。' : '已撤回 Local Preview，验收卡仍可再次同步。')
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
        setMessage(inspected.status === 'success' ? preflightMessage(inspected.preflight) : '同步预检未完成。')
        finish()
        return
      }
    }
    let previewProof: WorktreePreviewRecoveryProof | undefined
    if (mode === 'finalize_preview' && target?.state === 'preview_detached') {
      if (!recoveryIdentity) {
        setError({ code: 'stale_target', message: 'Detached Preview 身份不完整，请刷新。' })
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
        setMessage(inspected.status === 'success' && inspected.preflight.status === 'blocked'
          ? inspected.preflight.message
          : 'Preview Recovery 预检未完成。')
        finish()
        return
      }
      if (inspected.preflight.proof.finalize.status !== 'safe') {
        setMessage(inspected.preflight.proof.finalize.message)
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
      setMessage('Local 已变化，无法可靠提交；Preview 恢复证据和 Worktree 已保留。')
    } else {
      setMessage(selectedRetention === 'cleanup' ? '已提交到 Local，并开始清理 Worktree。' : '已提交到 Local，并保留当前运行环境。')
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
    setMessage(outcome.value.target.state === 'preview_detached'
      ? 'Local 已变化，无法无损撤回；未删除 Worktree。'
      : '已放弃本轮 Worktree 修改，Local 未受影响。')
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
      setMessage(inspected.status === 'success' && inspected.preflight.status === 'blocked'
        ? inspected.preflight.message
        : 'Preview Recovery 预检未完成。')
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
      setError({ code: 'checkout_mismatch', message: 'Host 未返回精确的 detached Recovery 分析凭证。' })
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
        throw new Error('二次 Host 检查未确认 detached Recovery 分析凭证。')
      }
      const binding = services.sessions.binding(identity.sessionId)
      const prompt = binding?.session.prompt
      if (!binding || !prompt) throw new Error('Owner Session 尚未提供 Harness prompt API。')
      const result = await prompt.call(binding.session, [{ type: 'text', text: [
        `请只读分析 detached Preview Recovery：checkout ${identity.checkoutId}，review ${identity.expectedReviewId}，preview ${recoveryIdentity.expectedPreviewId}，generation ${proof.generation}。`,
        '禁止修改旧 managed Worktree、Local、Git refs、index、receipt 或 retained artifacts；不要运行 reset/rebase/force checkout/clean。',
        '请解释 rollback/finalize blocker、仍缺失的任务增量与最安全的人工下一步。',
      ].join('\n') }], 'queue')
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setMessage('已向精确 owner Session 发送只读 Recovery 分析请求。')
    } catch (reason) {
      setError({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) })
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
      setError({ code: 'checkout_mismatch', message: 'Host 返回的 Recovery handoff 身份不一致。' })
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
        throw new Error('新 Worktree 的二次 Host/cwd 检查未通过。')
      }
      const binding = services.sessions.binding(created.value.targetSessionId)
      const prompt = binding?.session.prompt
      if (!binding || !prompt) throw new Error('新 owner Session 尚未提供 Harness prompt API。')
      const result = await prompt.call(binding.session, [{ type: 'text', text: [
        `这是 detached Preview Recovery handoff。旧 checkout ${identity.checkoutId} / review ${identity.expectedReviewId} / preview ${recoveryIdentity.expectedPreviewId} / generation ${proof.generation} 只读。`,
        '当前新 Worktree 基于最新 Local HEAD；只恢复仍缺失的任务增量。禁止修改 Local、旧 Worktree、旧 receipt/refs，禁止 reset/rebase/force checkout/clean。',
        '完成后运行必要验证并生成新的 Ready for Review。',
      ].join('\n') }], 'queue')
      if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
      setMessage('已创建并打开基于最新 Local HEAD 的 fresh Worktree，Recovery handoff 请求已发送。')
    } catch (reason) {
      setError({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) })
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
    setMessage(outcome.value.target.state === 'delivered' ? 'Worktree 环境已清理。' : '清理仍未完成，已保留恢复信息。')
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
      setError({ code: 'checkout_mismatch', message: reason instanceof Error ? reason.message : String(reason) })
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
        ? '同步中…'
        : autoPreflightEnabled && (preflightSnapshot.status === 'idle' || preflightSnapshot.status === 'loading')
          ? '检查中…'
          : '预览修改'}
    </button>
  ) : previewActive ? (
    <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={allDisabled || !target.capabilities.finalizePreview} onClick={() => setCommitMode('finalize_preview')}>
      确认并保存
    </button>
  ) : previewRecovery ? (
    rollbackRecoverySafe ? (
      <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.rollbackPreview} onClick={() => { void rollbackPreview(true) }}>
        {submitting === 'rollback' ? '处理中…' : '恢复并撤回预览'}
      </button>
    ) : (
      <button type="button" className="dsh-wt-button" disabled={allDisabled || target?.state !== 'preview_detached'} onClick={() => { void refreshRecoveryPreflight() }}>
        {recoveryPreflight.status === 'loading' ? '检查中…' : '重新检查'}
      </button>
    )
  ) : cleanupPending ? (
    <button type="button" className="dsh-wt-button" disabled={allDisabled || !target?.capabilities.retryCleanup} onClick={() => { void retryCleanup() }}>
      {submitting === 'retry_cleanup' ? '清理中…' : '重试清理环境'}
    </button>
  ) : null

  return (
    <section className="dsh-wt-review-actions" aria-label="验收操作">
      {!live ? <p className="dsh-wt-status">{unavailableMessage}</p> : null}
      {terminal ? (
        <p className="dsh-wt-status">
          {target.state === 'retained'
            ? `本轮已提交，运行环境暂时保留${target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : ''}`
            : `本轮已交付${target.commitOid ? ` · ${target.commitOid.slice(0, 8)}` : ''}`}
        </p>
      ) : (
        <div className="dsh-wt-actions">
          {primary}
          <details ref={moreMenuRef} className="dsh-wt-more-menu">
            <summary className="dsh-wt-more-trigger" aria-label="更多交付操作">•••</summary>
            <div className="dsh-wt-more-content" role="menu">
              {focusReview ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" onClick={() => {
                  focusReview()
                  closeMoreMenu()
                }}>查看验收卡</button>
              ) : null}
              {ready ? (
                <>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.checkpoint || !target.checkpointGeneration} onClick={() => {
                    openCheckpoint()
                    closeMoreMenu()
                  }}>保存阶段并继续</button>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.resumeRevision} onClick={() => {
                    void resumeRevision()
                    closeMoreMenu()
                  }}>{submitting === 'resume_revision' ? '恢复中…' : '继续修改'}</button>
                  <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.finalize || !safeReadyPreflight} onClick={() => {
                    setCommitMode('finish')
                    closeMoreMenu()
                  }}>跳过预览并保存</button>
                </>
              ) : null}
              {previewActive && target.capabilities.checkpoint && target.checkpointGeneration ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled} onClick={() => {
                  openCheckpoint()
                  closeMoreMenu()
                }}>保存阶段并继续</button>
              ) : null}
              {previewActive || rollbackRecoverySafe ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.rollbackPreview} onClick={() => {
                  void rollbackPreview(true)
                  closeMoreMenu()
                }}>{previewActive ? '撤回本次预览' : '重新尝试撤回'}</button>
              ) : null}
              {finalizeRecoverySafe ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item" disabled={allDisabled || !target.capabilities.finalizePreview} onClick={() => {
                  setCommitMode('finalize_preview')
                  closeMoreMenu()
                }}>保存修改</button>
              ) : null}
              {canDiscard ? (
                <button type="button" role="menuitem" className="dsh-wt-more-item dsh-wt-danger-text" disabled={allDisabled} onClick={() => {
                  setDiscardOpen(true)
                  closeMoreMenu()
                }}>放弃任务</button>
              ) : null}
            </div>
          </details>
        </div>
      )}

      <Modal
        open={checkpointOpen}
        onClose={closeCheckpoint}
        title="保存当前进度并继续？"
        closeLabel="关闭保存进度确认"
        description={previewActive
          ? '会先安全撤回当前预览，再保存本轮任务进度并继续开发；无法证明可以安全撤回时会停止。当前项目不会立即更新。'
          : '保存当前任务进度并继续下一阶段；当前项目不会立即更新，最终确认时仍只会生成一次交付。'}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeCheckpoint}>取消</button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null || !checkpointMessage.trim() || checkpointMessage.trim().length > 500} onClick={() => { void checkpoint() }}>
              {submitting === 'checkpoint' ? '正在保存…' : '保存进度并继续'}
            </button>
          </div>
        )}
      >
        <div className="dsh-wt-commit-dialog">
          <div className="dsh-wt-checkpoint-note">
            <strong>阶段不会发布到 Local</strong>
            <span>已有 {target?.checkpoints?.length ?? 0} 个阶段；最终交付仍会从原始任务基线汇总为一个 Local Commit。</span>
          </div>
          <label htmlFor={`${formId}-checkpoint-message`}>Checkpoint Commit Message</label>
          <textarea id={`${formId}-checkpoint-message`} aria-label="Checkpoint Commit Message" rows={6} maxLength={500} value={checkpointMessage} onChange={event => setCheckpointMessage(event.target.value)} />
          <div className="dsh-wt-character-count">{checkpointMessage.length}/500</div>
        </div>
      </Modal>

      <Modal
        open={commitMode !== null}
        onClose={closeCommit}
        title={commitMode === 'finalize_preview'
          ? '确认并保存本次修改？'
          : target?.state === 'preview_detached' ? '保存本次修改？' : '跳过预览并直接保存？'}
        closeLabel="关闭保存确认"
        description={commitMode === 'finalize_preview'
          ? '只会保存当前预览对应的本轮任务内容；Local 中已有或之后新增的无关修改不会进入该 Commit。'
          : '将跳过 Local Preview，直接把本轮 Worktree 增量保存为一个 Commit。'}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeCommit}>取消</button>
            <button type="button" className="dsh-wt-button dsh-wt-primary" disabled={submitting !== null || !commitMessage.trim() || commitMessage.trim().length > 500} onClick={() => { void submitCommit() }}>
              {submitting === 'finish' || submitting === 'finalize_preview'
                ? '正在保存…'
                : retainEnvironment ? '确认交付并保留环境' : '确认交付并清理'}
            </button>
          </div>
        )}
      >
        <div className="dsh-wt-commit-dialog">
          <label htmlFor={`${formId}-message`}>Commit Message</label>
          <textarea id={`${formId}-message`} aria-label="Commit Message" rows={6} maxLength={500} value={commitMessage} onChange={event => setCommitMessage(event.target.value)} />
          <div className="dsh-wt-character-count">{commitMessage.length}/500</div>
          <label className="dsh-wt-retention-check">
            <input type="checkbox" checked={retainEnvironment} onChange={event => setRetainEnvironment(event.target.checked)} />
            <span>提交后暂时保留当前运行环境</span>
          </label>
          {retainEnvironment ? (
            <label className="dsh-wt-retention-select">
              <span>保留时长</span>
              <select aria-label="保留时长" value={retention} onChange={event => setRetention(event.target.value as Exclude<WorktreeRetentionMode, 'cleanup'>)}>
                <option value="retain_24h">保留 24 小时</option>
                <option value="retain_3d">保留 3 天</option>
                <option value="retain_manual">手动清理</option>
              </select>
            </label>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={discardOpen}
        onClose={closeDiscard}
        title="放弃本轮任务？"
        closeLabel="关闭放弃确认"
        description={previewActive
          ? '会先安全撤回本次 Local Preview，再清理 Worktree；无法无损撤回时会停止，不会覆盖 Local 修改。'
          : 'Worktree 中尚未交付的修改将被永久丢弃，Local 不受影响。'}
        footer={(
          <div className="dsh-wt-modal-footer">
            <button type="button" className="dsh-wt-button" disabled={submitting !== null} onClick={closeDiscard}>取消</button>
            <button type="button" className="dsh-wt-button dsh-wt-danger" disabled={submitting !== null} onClick={() => { void discard() }}>
              {submitting === 'discard' ? '正在放弃…' : '确认放弃任务'}
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
            <strong>Detached Preview Recovery</strong>
            <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || recoveryPreflight.status === 'loading'} onClick={() => { void refreshRecoveryPreflight() }}>
              重新检查
            </button>
          </div>
          <p>Detached 是交付恢复状态，不是 Git detached HEAD。检查严格只读，写操作会在 Host 锁内再次验证。</p>
          {recoveryPreflight.status === 'loading' ? <p>正在检查 Local HEAD、index、working tree、retained artifacts 与验收槽位…</p> : null}
          {recoveryPreflight.status === 'error' ? <p className="dsh-wt-error">{recoveryPreflight.error.message}</p> : null}
          {recoveryPreflight.status === 'success' && recoveryPreflight.preflight.status === 'blocked' ? (
            <p className="dsh-wt-error">{recoveryPreflight.preflight.message}</p>
          ) : null}
          {recoveryProof ? (
            <>
              <p className="dsh-wt-code">generation {recoveryProof.generation.slice(0, 12)} · HEAD {recoveryProof.localHeadOid.slice(0, 12)} · {recoveryProof.localHeadRef ?? 'detached HEAD'}</p>
              <ul className="dsh-wt-test-list" aria-label="Preview Recovery 结论">
                <li>撤回：{recoveryProof.rollback.status === 'safe' ? '可证明安全' : recoveryProof.rollback.message}</li>
                <li>提交：{recoveryProof.finalize.status === 'safe' ? '可证明安全' : recoveryProof.finalize.message}</li>
              </ul>
              {recoveryProof.rollback.status === 'blocked' && recoveryProof.rollback.conflictingFiles?.length ? (
                <p>撤回冲突：{recoveryProof.rollback.conflictingFiles.join('、')}</p>
              ) : null}
              {recoveryProof.finalize.status === 'blocked' && recoveryProof.finalize.conflictingFiles?.length ? (
                <p>提交冲突：{recoveryProof.finalize.conflictingFiles.join('、')}</p>
              ) : null}
              {recoveryProof.blocker ? (
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void openHolder() }}>
                  打开占用 Local 验收槽位的 Worktree
                </button>
              ) : null}
              <div className="dsh-wt-recovery-actions">
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void analyzeRecovery() }}>
                  让 Agent 只读分析
                </button>
                <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={() => { void handoffRecovery() }}>
                  交接到新 Worktree
                </button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {runtimeConflict ? (
        <div className="dsh-wt-recovery-actions">
          <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null || !services} onClick={recoverRuntimeConflict}>
            让 Agent 解决冲突
          </button>
        </div>
      ) : null}
      {activeRecovery ? (
        <div className="dsh-wt-action-status" data-recovery-status={activeRecovery.status}>
          {activeRecovery.status === 'queued' ? '恢复请求已排队，等待 owner Session 加载完成且停止 streaming。' : null}
          {activeRecovery.status === 'sending' ? '正在通过 Harness 官方 Session API 发送恢复请求…' : null}
          {activeRecovery.status === 'sent'
            ? activeRecovery.request.kind === 'worktree_apply_conflict'
              ? '已交给 Agent 解决冲突；完成后必须生成新的验收卡。'
              : '已交给 Agent 只读重新生成验收结果；不会修改 Worktree。'
            : null}
          {activeRecovery.status === 'cancelled' ? 'Session/checkout 已切换，旧恢复请求已取消。' : null}
          {activeRecovery.status === 'failed' ? (
            <>
              <span>恢复请求发送失败：{activeRecovery.error}</span>
              <button type="button" className="dsh-wt-inline-action" disabled={submitting !== null} onClick={() => retryWorktreeRecovery(activeRecovery.request.sessionId)}>重新发送</button>
            </>
          ) : null}
        </div>
      ) : null}
      {target && (target.state === 'cleanup_pending' || terminal) ? <DeliveryProof target={target} /> : null}
      <div className="dsh-wt-action-status" aria-live="polite">
        {submitting ? '正在处理 Worktree，请稍候…' : message}
      </div>
      {error && !isStale(error) ? (
        <div className="dsh-wt-error" role="alert">
          {error.message}（{worktreeConsoleErrorMeta(error.code).category}；恢复方式：{worktreeConsoleErrorMeta(error.code).recovery}）
        </div>
      ) : null}
    </section>
  )
}
