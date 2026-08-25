import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleCreatePreviewRecoveryHandoffResponse,
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsolePreflightResponse,
  WorktreeConsolePreviewRecoveryPreflightResponse,
  WorktreeConsoleReviewDiffResponse,
  WorktreeApplyConflictContinuation,
} from '../console-contract.js'
import type { WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../types.js'
import type { WorktreeConsoleControlPlane } from './control-plane.js'

/** Official Typert Remote service; the Gateway resolves `agentId` before business code runs. */
export class WorktreeConsoleService extends TypertRemoteService {
  constructor(ctx: Context, private readonly controlPlane: WorktreeConsoleControlPlane) {
    super(ctx, 'gitWorktree')
  }

  @Remote
  current(agent: Agent): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>> {
    return this.controlPlane.current(agent.id)
  }

  @Remote
  list(agent: Agent, needsAttention?: boolean, includeDelivered?: boolean): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>> {
    return this.controlPlane.list({ sessionId: agent.id, needsAttention, includeDelivered })
  }

  @Remote
  create(agent: Agent): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>> {
    return this.controlPlane.create(agent.id)
  }

  @Remote
  inspect(agent: Agent, checkoutId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>> {
    return this.controlPlane.inspect(agent.id, checkoutId)
  }

  @Remote
  reviewDiff(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>> {
    return this.controlPlane.reviewDiff({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId })
  }

  @Remote
  preflight(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>> {
    return this.controlPlane.preflight({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId })
  }

  @Remote
  previewRecoveryPreflight(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>> {
    return this.controlPlane.previewRecoveryPreflight({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId,
    })
  }

  @Remote
  preparePreviewRecoveryAnalysis(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.preparePreviewRecoveryAnalysis({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    })
  }

  @Remote
  createPreviewRecoveryHandoff(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>> {
    return this.controlPlane.createPreviewRecoveryHandoff({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    })
  }

  @Remote
  preview(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.preview({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId })
  }

  @Remote
  checkpoint(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedGeneration: string,
    requestId: string,
    commitMessage: string,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.checkpoint({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage,
    })
  }

  @Remote
  prepareReviewRegeneration(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.prepareReviewRegeneration({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId })
  }

  @Remote
  resumeRevision(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    conflictContinuation?: WorktreeApplyConflictContinuation,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.resumeRevision({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, conflictContinuation,
    })
  }

  @Remote
  rollbackPreview(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    resumeRevision?: boolean,
    recoveryProof?: WorktreePreviewRecoveryProof,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.rollbackPreview({ sessionId: agent.id, checkoutId, expectedRevision, resumeRevision, recoveryProof })
  }

  @Remote
  discard(agent: Agent, checkoutId: string, expectedRevision: number, confirmDirty: boolean, rollbackPreview?: boolean): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.discard({ sessionId: agent.id, checkoutId, expectedRevision, confirmDirty, rollbackPreview })
  }

  @Remote
  finalize(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    commitMessage: string,
    retention: WorktreeRetentionMode,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.finalize({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention })
  }

  @Remote
  finalizePreview(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    commitMessage: string,
    retention: WorktreeRetentionMode,
    recoveryProof?: WorktreePreviewRecoveryProof,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.finalizePreview({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof,
    })
  }

  @Remote
  setRetention(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    retention: Exclude<WorktreeRetentionMode, 'cleanup'>,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.setRetention({ sessionId: agent.id, checkoutId, expectedRevision, retention })
  }

  @Remote
  retryCleanup(agent: Agent, checkoutId: string, expectedRevision: number): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.retryCleanup({ sessionId: agent.id, checkoutId, expectedRevision })
  }

  @Remote
  beginNextIteration(agent: Agent, checkoutId: string, expectedRevision: number): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.beginNextIteration({ sessionId: agent.id, checkoutId, expectedRevision })
  }
}
