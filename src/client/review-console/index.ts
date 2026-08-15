import type { WorktreeConsoleTargetSummary } from '../../console-contract.js'
import type { WorktreeReviewEvidence, WorktreeReviewIdentity } from './WorktreeReviewPanel.js'

export { WorktreeReviewPanel } from './WorktreeReviewPanel.js'
export type {
  WorktreeReviewEvidence,
  WorktreeReviewIdentity,
  WorktreeReviewPanelProps,
} from './WorktreeReviewPanel.js'

/** Integration seam for the future Worktree Console target view. */
export function reviewEvidenceFromTarget(
  target: WorktreeConsoleTargetSummary,
  detailsMarkdown?: string,
): WorktreeReviewEvidence | null {
  if (!target.review) return null
  return {
    ...target.review,
    ...(detailsMarkdown ? { detailsMarkdown } : {}),
  }
}

/** Build the exact CAS identity required by reviewDiff and Finalize. */
export function reviewIdentityFromTarget(
  sessionId: string,
  target: WorktreeConsoleTargetSummary,
): WorktreeReviewIdentity | null {
  if (!target.checkoutId || !target.review) return null
  return {
    sessionId,
    checkoutId: target.checkoutId,
    expectedRevision: target.revision,
    expectedReviewId: target.review.reviewId,
  }
}
