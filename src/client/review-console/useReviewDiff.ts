import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsoleReviewDiffResponse,
} from '../../console-contract.js'
import type { WorktreeReviewIdentity } from './WorktreeReviewPanel.js'

export type ReviewDiffState =
  | { status: 'idle'; value: null; error: null }
  | { status: 'loading'; value: null; error: null }
  | { status: 'loaded'; value: WorktreeConsoleReviewDiffResponse; error: null }
  | { status: 'error'; value: null; error: WorktreeConsoleError }

const IDLE: ReviewDiffState = { status: 'idle', value: null, error: null }

export function useReviewDiff(
  adapter: WorktreeConsoleAdapter | null | undefined,
  identity: WorktreeReviewIdentity | undefined,
  onStale: (error: WorktreeConsoleError) => void,
) {
  const [state, setState] = useState<ReviewDiffState>(IDLE)
  const loadingRef = useRef(false)
  const requestGeneration = useRef(0)
  const identityKey = identity
    ? `${identity.sessionId}\u0000${identity.checkoutId}\u0000${identity.expectedRevision}\u0000${identity.expectedReviewId}`
    : ''

  useEffect(() => {
    requestGeneration.current += 1
    loadingRef.current = false
    setState(IDLE)
  }, [adapter, identityKey])

  const load = useCallback(async () => {
    if (!adapter || !identity || loadingRef.current || state.status === 'loaded') return
    loadingRef.current = true
    const generation = requestGeneration.current
    setState({ status: 'loading', value: null, error: null })
    const outcome = await adapter.reviewDiff(identity)
    if (generation !== requestGeneration.current) return
    loadingRef.current = false
    if (outcome.ok) {
      setState({ status: 'loaded', value: outcome.value, error: null })
      return
    }
    if (outcome.error.code === 'stale_target'
      || outcome.error.code === 'stale_isolated'
      || outcome.error.code === 'stale_local') {
      onStale(outcome.error)
    }
    setState({ status: 'error', value: null, error: outcome.error })
  }, [adapter, identity, onStale, state.status])

  const retry = useCallback(() => {
    setState(IDLE)
  }, [])

  const reset = useCallback(() => {
    requestGeneration.current += 1
    loadingRef.current = false
    setState(IDLE)
  }, [])

  return { state, load, retry, reset }
}
