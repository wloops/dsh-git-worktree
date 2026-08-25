import { createHash } from 'node:crypto'
import type { ManagedCheckoutRecord } from './ports.js'

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

/** Host-derived CAS generation for the exact active Review and checkpoint chain. */
export function checkpointGenerationForRecord(record: ManagedCheckoutRecord): string | undefined {
  const delivery = record.delivery
  if (delivery.state !== 'ready_for_review' && delivery.state !== 'preview_active') return undefined
  return createHash('sha256').update(canonicalJson({
    checkoutId: record.checkoutId,
    revision: record.revision,
    reviewId: delivery.review.reviewId,
    isolatedHeadOid: delivery.review.isolatedHeadOid,
    isolatedFingerprint: delivery.review.isolatedFingerprint,
    checkpointCount: record.checkpoints?.length ?? 0,
    previewId: delivery.state === 'preview_active' ? delivery.preview.previewId : null,
    phase: record.phase,
  })).digest('hex')
}
