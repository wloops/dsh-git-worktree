import { withHostLanguage, languageFromSettings } from '../i18n/host.js'
import type { Language } from '../i18n/core.js'
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
  WorktreeSidebarTopologyResponse,
} from '../console-contract.js'
import type { WorktreePreviewRecoveryProof, WorktreeRetentionMode } from '../types.js'
import type { WorktreeConsoleControlPlane } from './control-plane.js'

/** Official Typert Remote service; the Gateway resolves `agentId` before business code runs. */
export class WorktreeConsoleService extends TypertRemoteService {
  constructor(private readonly hostContext: Context, private readonly controlPlane: WorktreeConsoleControlPlane) {
    super(hostContext, 'gitWorktree')
  }

  @Remote
  sidebarTopology(locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeSidebarTopologyResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(this.hostContext), () => this.controlPlane.sidebarTopology())
  }

  @Remote
  current(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleCurrentResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.current(agent.id))
  }

  @Remote
  list(agent: Agent, needsAttention?: boolean, includeDelivered?: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleListResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.list({ sessionId: agent.id, needsAttention, includeDelivered }))
  }

  @Remote
  create(agent: Agent, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreateResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.create(agent.id))
  }

  @Remote
  inspect(agent: Agent, checkoutId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleInspectResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.inspect(agent.id, checkoutId))
  }

  @Remote
  reviewDiff(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleReviewDiffResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.reviewDiff({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  preflight(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsolePreflightResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preflight({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  previewRecoveryPreflight(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsolePreviewRecoveryPreflightResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.previewRecoveryPreflight({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId,
    }))
  }

  @Remote
  preparePreviewRecoveryAnalysis(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preparePreviewRecoveryAnalysis({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    }))
  }

  @Remote
  createPreviewRecoveryHandoff(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    expectedPreviewId: string,
    recoveryProof: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleCreatePreviewRecoveryHandoffResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.createPreviewRecoveryHandoff({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedPreviewId, recoveryProof,
    }))
  }

  @Remote
  preview(agent: Agent, checkoutId: string, expectedRevision: number, expectedReviewId: string, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.preview({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
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
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.checkpoint({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, expectedGeneration, requestId, commitMessage,
    }))
  }

  @Remote
  prepareReviewRegeneration(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.prepareReviewRegeneration({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId }))
  }

  @Remote
  resumeRevision(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    conflictContinuation?: WorktreeApplyConflictContinuation,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.resumeRevision({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, conflictContinuation,
    }))
  }

  @Remote
  rollbackPreview(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    resumeRevision?: boolean,
    recoveryProof?: WorktreePreviewRecoveryProof,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.rollbackPreview({ sessionId: agent.id, checkoutId, expectedRevision, resumeRevision, recoveryProof }))
  }

  @Remote
  discard(agent: Agent, checkoutId: string, expectedRevision: number, confirmDirty: boolean, rollbackPreview?: boolean, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.discard({ sessionId: agent.id, checkoutId, expectedRevision, confirmDirty, rollbackPreview }))
  }

  @Remote
  finalize(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    commitMessage: string,
    retention: WorktreeRetentionMode,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.finalize({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention }))
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
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.finalizePreview({
      sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, commitMessage, retention, recoveryProof,
    }))
  }

  @Remote
  setRetention(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    retention: Exclude<WorktreeRetentionMode, 'cleanup'>,
    locale?: Language,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.setRetention({ sessionId: agent.id, checkoutId, expectedRevision, retention }))
  }

  @Remote
  retryCleanup(agent: Agent, checkoutId: string, expectedRevision: number, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.retryCleanup({ sessionId: agent.id, checkoutId, expectedRevision }))
  }

  @Remote
  beginNextIteration(agent: Agent, checkoutId: string, expectedRevision: number, locale?: Language): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return withHostLanguage(locale ?? languageFromSettings(agent.ctx ?? this.hostContext), () => this.controlPlane.beginNextIteration({ sessionId: agent.id, checkoutId, expectedRevision }))
  }
}
