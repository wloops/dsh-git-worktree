import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type {
  WorktreeConsoleAdapter,
  WorktreeConsoleError,
  WorktreeConsolePreviewRecoveryPreflightRequest,
} from '../../console-contract.js'
import type { WorktreePreviewRecoveryPreflightView } from '../../types.js'

export type PreviewRecoverySnapshot =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; preflight: WorktreePreviewRecoveryPreflightView }
  | { status: 'error'; error: WorktreeConsoleError }

interface Entry {
  snapshot: PreviewRecoverySnapshot
  listeners: Set<() => void>
  promise?: Promise<PreviewRecoverySnapshot>
  epoch: number
}

const IDLE: PreviewRecoverySnapshot = { status: 'idle' }
const caches = new WeakMap<WorktreeConsoleAdapter, Map<string, Entry>>()

function identityKey(identity: WorktreeConsolePreviewRecoveryPreflightRequest): string {
  return [
    identity.sessionId,
    identity.checkoutId,
    identity.expectedRevision,
    identity.expectedReviewId,
    identity.expectedPreviewId,
  ].join('\u0000')
}

function cacheFor(adapter: WorktreeConsoleAdapter): Map<string, Entry> {
  let cache = caches.get(adapter)
  if (!cache) {
    cache = new Map()
    caches.set(adapter, cache)
  }
  return cache
}

function entryFor(adapter: WorktreeConsoleAdapter, identity: WorktreeConsolePreviewRecoveryPreflightRequest): Entry {
  const cache = cacheFor(adapter)
  const key = identityKey(identity)
  let entry = cache.get(key)
  if (!entry) {
    entry = { snapshot: IDLE, listeners: new Set(), epoch: 0 }
    cache.set(key, entry)
  }
  return entry
}

function publish(entry: Entry, snapshot: PreviewRecoverySnapshot): void {
  entry.snapshot = snapshot
  for (const listener of entry.listeners) listener()
}

/** Identity-keyed, single-flight, read-only recovery assessment. Writes must force refresh. */
export async function readPreviewRecoveryPreflight(
  adapter: WorktreeConsoleAdapter,
  identity: WorktreeConsolePreviewRecoveryPreflightRequest,
  force = false,
): Promise<PreviewRecoverySnapshot> {
  const entry = entryFor(adapter, identity)
  if (entry.promise) return entry.promise
  if (!force && (entry.snapshot.status === 'success' || entry.snapshot.status === 'error')) return entry.snapshot
  publish(entry, { status: 'loading' })
  const epoch = entry.epoch
  const promise = adapter.previewRecoveryPreflight(identity).then((outcome): PreviewRecoverySnapshot => {
    const snapshot: PreviewRecoverySnapshot = outcome.ok
      ? { status: 'success', preflight: outcome.value.preflight }
      : { status: 'error', error: outcome.error }
    if (entry.epoch === epoch) publish(entry, snapshot)
    return snapshot
  }, (reason): PreviewRecoverySnapshot => {
    const snapshot: PreviewRecoverySnapshot = {
      status: 'error',
      error: { code: 'transport_unavailable', message: reason instanceof Error ? reason.message : String(reason) },
    }
    if (entry.epoch === epoch) publish(entry, snapshot)
    return snapshot
  }).finally(() => {
    if (entry.epoch === epoch) entry.promise = undefined
  })
  entry.promise = promise
  return promise
}

export function invalidatePreviewRecoveryPreflight(
  adapter: WorktreeConsoleAdapter,
  identity: WorktreeConsolePreviewRecoveryPreflightRequest,
): void {
  const entry = cacheFor(adapter).get(identityKey(identity))
  if (!entry) return
  entry.epoch += 1
  entry.promise = undefined
  publish(entry, IDLE)
}

export function usePreviewRecoveryPreflight(
  adapter: WorktreeConsoleAdapter | null | undefined,
  identity: WorktreeConsolePreviewRecoveryPreflightRequest | undefined,
  enabled: boolean,
): { snapshot: PreviewRecoverySnapshot; refresh(): Promise<PreviewRecoverySnapshot> } {
  const key = identity ? identityKey(identity) : ''
  const subscribe = useCallback((listener: () => void) => {
    if (!adapter || !identity) return () => undefined
    const entry = entryFor(adapter, identity)
    entry.listeners.add(listener)
    return () => { entry.listeners.delete(listener) }
  }, [adapter, key])
  const getSnapshot = useCallback(() => {
    if (!adapter || !identity) return IDLE
    return entryFor(adapter, identity).snapshot
  }, [adapter, key])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (adapter && identity && enabled) void readPreviewRecoveryPreflight(adapter, identity)
  }, [adapter, enabled, key])

  return {
    snapshot,
    refresh: useCallback(async () => {
      if (!adapter || !identity) return IDLE
      return readPreviewRecoveryPreflight(adapter, identity, true)
    }, [adapter, key]),
  }
}
