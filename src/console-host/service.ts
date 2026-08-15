import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  WorktreeConsoleCreateResponse,
  WorktreeConsoleCurrentResponse,
  WorktreeConsoleInspectResponse,
  WorktreeConsoleListResponse,
  WorktreeConsoleMutationResponse,
  WorktreeConsoleOutcome,
  WorktreeConsoleReviewDiffResponse,
} from '../console-contract.js'
import type { WorktreeRetentionMode } from '../types.js'
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
  discard(agent: Agent, checkoutId: string, expectedRevision: number, confirmDirty: boolean): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.discard({ sessionId: agent.id, checkoutId, expectedRevision, confirmDirty })
  }

  @Remote
  finalize(
    agent: Agent,
    checkoutId: string,
    expectedRevision: number,
    expectedReviewId: string,
    retention: WorktreeRetentionMode,
  ): Promise<WorktreeConsoleOutcome<WorktreeConsoleMutationResponse>> {
    return this.controlPlane.finalize({ sessionId: agent.id, checkoutId, expectedRevision, expectedReviewId, retention })
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
}
