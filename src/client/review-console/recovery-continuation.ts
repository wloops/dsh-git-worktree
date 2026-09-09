import { defaultClientTranslator, translatorForServices, type ClientTranslator } from '../i18n.js'
import { useCallback, useSyncExternalStore } from 'react'
import type { WorktreeConsoleAdapter, WorktreeConsoleTargetDetails } from '../../console-contract.js'
import type { WorktreeClientServices } from '../actions.js'

export interface WorktreeApplyConflictRecoveryRequest {
  kind: 'worktree_apply_conflict'
  sessionId: string
  requestId: string
  checkoutId: string
  /** Review that the user's explicit recovery action invalidated. */
  reviewId: string
  /** Authoritative Working revision returned by resumeRevision. */
  revision: number
  localHeadOid: string
  conflictingFiles: string[]
}

export interface WorktreeReviewRegenerationRequest {
  kind: 'worktree_review_regeneration'
  sessionId: string
  requestId: string
  checkoutId: string
  reviewId: string
  /** Ready revision that must remain unchanged because this path is read-only. */
  revision: number
}

export type WorktreeRecoveryRequest = WorktreeApplyConflictRecoveryRequest | WorktreeReviewRegenerationRequest
export type WorktreeRecoveryStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled'

export interface WorktreeRecoverySnapshot {
  status: WorktreeRecoveryStatus
  request: WorktreeRecoveryRequest
  error?: string
}

interface RecoveryEntry {
  snapshot: WorktreeRecoverySnapshot
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  isActive: () => boolean
  claimed: boolean
  abort?: AbortController
  unsubscribers: Array<() => void>
  listeners: Set<() => void>
}

const entries = new Map<string, RecoveryEntry>()
const listenerSets = new Map<string, Set<() => void>>()
const STORAGE_PREFIX = 'dsh-git-worktree:recovery:v1:'

type PersistedRecoveryStatus = Extract<WorktreeRecoveryStatus, 'queued' | 'sending' | 'failed'>
interface PersistedRecovery {
  version: 1
  status: PersistedRecoveryStatus
  request: WorktreeRecoveryRequest
  error?: string
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

function persistSnapshot(snapshot: WorktreeRecoverySnapshot): void {
  const storage = browserStorage()
  if (!storage) return
  try {
    if (snapshot.status === 'sent' || snapshot.status === 'cancelled') {
      storage.removeItem(storageKey(snapshot.request.sessionId))
      return
    }
    const persisted: PersistedRecovery = {
      version: 1,
      status: snapshot.status,
      request: snapshot.request,
      ...(snapshot.error === undefined ? {} : { error: snapshot.error }),
    }
    storage.setItem(storageKey(snapshot.request.sessionId), JSON.stringify(persisted))
  } catch {
    // Browser persistence is best-effort context only; Host identity checks remain authoritative.
  }
}

function readPersisted(sessionId: string): PersistedRecovery | undefined {
  const storage = browserStorage()
  if (!storage) return undefined
  try {
    const raw = storage.getItem(storageKey(sessionId))
    if (!raw) return undefined
    const value = JSON.parse(raw) as Partial<PersistedRecovery>
    if (
      !hasExactKeys(value, value.error === undefined ? ['version', 'status', 'request'] : ['version', 'status', 'request', 'error'])
      || value.version !== 1
      || !['queued', 'sending', 'failed'].includes(value.status ?? '')
      || value.error !== undefined && typeof value.error !== 'string'
      || typeof value.request !== 'object'
      || value.request === null
      || value.request.sessionId !== sessionId
      || !validRequest(value.request)
    ) {
      storage.removeItem(storageKey(sessionId))
      return undefined
    }
    return value as PersistedRecovery
  } catch {
    try { storage.removeItem(storageKey(sessionId)) } catch { /* best effort */ }
    return undefined
  }
}

function listenersFor(sessionId: string): Set<() => void> {
  let listeners = listenerSets.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    listenerSets.set(sessionId, listeners)
  }
  return listeners
}

function safeConflictFile(file: string): boolean {
  if (!file || file.length > 1000 || /[\0-\x1f\x7f]/u.test(file)) return false
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(file)) return false
  return !file.split(/[\\/]/u).some(segment => segment === '' || segment === '.' || segment === '..')
}

function hasExactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every(key => allowed.includes(key))
}

function validRequest(request: unknown): request is WorktreeRecoveryRequest {
  if (typeof request !== 'object' || request === null) return false
  const value = request as Record<string, unknown>
  const common = typeof value.sessionId === 'string'
    && value.sessionId.length > 0 && value.sessionId.length <= 200 && !/[\0\r\n]/u.test(value.sessionId)
    && typeof value.requestId === 'string'
    && value.requestId.length > 0 && value.requestId.length <= 500 && !/[\0\r\n]/u.test(value.requestId)
    && typeof value.checkoutId === 'string'
    && value.checkoutId.length > 0 && value.checkoutId.length <= 200
    && !value.checkoutId.includes('..') && !/[\\/\0\r\n]/u.test(value.checkoutId)
    && typeof value.reviewId === 'string'
    && value.reviewId.length > 0 && value.reviewId.length <= 200 && !/[\0\r\n]/u.test(value.reviewId)
    && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
  if (!common) return false
  switch (value.kind) {
    case 'worktree_review_regeneration':
      return hasExactKeys(value, ['kind', 'sessionId', 'requestId', 'checkoutId', 'reviewId', 'revision'])
    case 'worktree_apply_conflict':
      return hasExactKeys(value, ['kind', 'sessionId', 'requestId', 'checkoutId', 'reviewId', 'revision', 'localHeadOid', 'conflictingFiles'])
        && typeof value.localHeadOid === 'string'
        && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(value.localHeadOid)
        && Array.isArray(value.conflictingFiles)
        && value.conflictingFiles.length <= 500
        && value.conflictingFiles.every(file => typeof file === 'string' && safeConflictFile(file))
    default:
      return false
  }
}

function publish(entry: RecoveryEntry, snapshot: WorktreeRecoverySnapshot): void {
  entry.snapshot = snapshot
  persistSnapshot(snapshot)
  for (const listener of entry.listeners) listener()
}

function stopWatching(entry: RecoveryEntry): void {
  for (const unsubscribe of entry.unsubscribers.splice(0)) unsubscribe()
}

function cancel(entry: RecoveryEntry): void {
  entry.abort?.abort()
  entry.claimed = false
  stopWatching(entry)
  publish(entry, { status: 'cancelled', request: entry.snapshot.request })
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[A-Za-z]:\//u.test(normalizedLeft) || /^[A-Za-z]:\//u.test(normalizedRight)
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function targetMatchesRequest(target: WorktreeConsoleTargetDetails, request: WorktreeRecoveryRequest): boolean {
  if (
    target.checkoutId !== request.checkoutId
    || target.ownerSessionId !== request.sessionId
    || target.targetSessionId !== request.sessionId
    || target.revision !== request.revision
    || target.managedRoot === null
  ) return false
  if (request.kind === 'worktree_apply_conflict') {
    const proof = target.recoveryContinuation
    return target.state === 'working'
      && target.review === undefined
      && proof?.kind === request.kind
      && proof.requestId === request.requestId
      && proof.checkoutId === request.checkoutId
      && proof.reviewId === request.reviewId
      && proof.revision === request.revision
      && proof.localHeadOid === request.localHeadOid
      && proof.conflictingFiles.length === request.conflictingFiles.length
      && proof.conflictingFiles.every((file, index) => file === request.conflictingFiles[index])
  }
  const proof = target.recoveryContinuation
  return target.state === 'ready_for_review'
    && target.review?.reviewId === request.reviewId
    && target.capabilities.preflight
    && proof?.kind === request.kind
    && proof.requestId === request.requestId
    && proof.checkoutId === request.checkoutId
    && proof.reviewId === request.reviewId
    && proof.revision === request.revision
}

function activeSessionState(entry: RecoveryEntry): 'active' | 'pending' | 'mismatch' {
  const current = entry.services.sessions.list.getSnapshot().current
  if (current === undefined) return 'pending'
  return current === entry.snapshot.request.sessionId ? 'active' : 'mismatch'
}

function sessionReady(
  entry: RecoveryEntry,
  target: WorktreeConsoleTargetDetails,
  binding: ReturnType<WorktreeClientServices['sessions']['binding']>,
): boolean {
  const request = entry.snapshot.request
  if (!binding?.session.prompt || !binding.session.getSnapshot || !binding.session.subscribe) return false
  if (binding.session.sessionId !== request.sessionId) return false
  const sessions = entry.services.sessions.list.getSnapshot()
  const summary = sessions.byId[request.sessionId]
  if (sessions.current !== request.sessionId) return false
  if (summary?.cwd === undefined || target.managedRoot === null || !samePath(summary.cwd, target.managedRoot)) return false
  const snapshot = binding.session.getSnapshot()
  return snapshot.openState === 'open' && !snapshot.running && !snapshot.removed
}

function isCurrent(entry: RecoveryEntry): boolean {
  return entries.get(entry.snapshot.request.sessionId) === entry
    && entry.snapshot.status !== 'cancelled'
    && entry.isActive()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function waitForSession(entry: RecoveryEntry, binding: ReturnType<WorktreeClientServices['sessions']['binding']>): void {
  const request = entry.snapshot.request
  entry.claimed = false
  publish(entry, { status: 'queued', request })
  stopWatching(entry)
  entry.unsubscribers.push(entry.services.sessions.list.subscribe(() => {
    if (activeSessionState(entry) === 'mismatch') cancel(entry)
    else void attempt(entry)
  }))
  if (binding?.session.subscribe) {
    entry.unsubscribers.push(binding.session.subscribe(() => { void attempt(entry) }))
  }
  const timer = setInterval(() => { void attempt(entry) }, 250)
  entry.unsubscribers.push(() => clearInterval(timer))
}

async function attempt(entry: RecoveryEntry): Promise<void> {
  const t = translatorForServices(entry.services)

  if (!entry.isActive()) {
    cancel(entry)
    return
  }
  if (!isCurrent(entry) || entry.claimed || entry.snapshot.status === 'sent') return
  entry.claimed = true
  if (activeSessionState(entry) === 'mismatch') {
    cancel(entry)
    return
  }
  const request = entry.snapshot.request
  const inspected = await entry.adapter.inspect({ sessionId: request.sessionId, checkoutId: request.checkoutId })
  if (!isCurrent(entry)) return
  if (activeSessionState(entry) === 'mismatch') {
    cancel(entry)
    return
  }
  if (!inspected.ok) {
    entry.claimed = false
    stopWatching(entry)
    publish(entry, { status: 'failed', request, error: `${inspected.error.code}: ${inspected.error.message}` })
    return
  }
  if (!targetMatchesRequest(inspected.value.target, request)) {
    cancel(entry)
    return
  }
  const binding = entry.services.sessions.binding(request.sessionId)
  if (!sessionReady(entry, inspected.value.target, binding) || !binding?.session.prompt) {
    waitForSession(entry, binding)
    return
  }

  stopWatching(entry)
  const abort = new AbortController()
  entry.abort = abort
  publish(entry, { status: 'sending', request })
  let stopOnSessionSwitch: () => void = () => undefined
  let stopOnInactiveScope: () => void = () => undefined
  try {
    // Re-inspect immediately before the outward prompt. The first inspect may have waited on Session readiness.
    const current = await entry.adapter.inspect({ sessionId: request.sessionId, checkoutId: request.checkoutId })
    if (!isCurrent(entry)) return
    if (activeSessionState(entry) !== 'active') {
      cancel(entry)
      return
    }
    if (!current.ok) {
      entry.claimed = false
      publish(entry, { status: 'failed', request, error: `${current.error.code}: ${current.error.message}` })
      return
    }
    if (!targetMatchesRequest(current.value.target, request)) {
      cancel(entry)
      return
    }
    const sendBinding = entry.services.sessions.binding(request.sessionId)
    if (!sessionReady(entry, current.value.target, sendBinding) || !sendBinding?.session.prompt) {
      waitForSession(entry, sendBinding)
      return
    }
    stopOnSessionSwitch = entry.services.sessions.list.subscribe(() => {
      if (activeSessionState(entry) !== 'active') cancel(entry)
    })
    const inactiveTimer = setInterval(() => {
      if (!entry.isActive()) cancel(entry)
    }, 100)
    stopOnInactiveScope = () => clearInterval(inactiveTimer)
    const result = await sendBinding.session.prompt([{ type: 'text', text: buildWorktreeRecoveryPrompt(request, t) }], 'queue', abort.signal)
    if (!isCurrent(entry)) return
    if (activeSessionState(entry) !== 'active') {
      cancel(entry)
      return
    }
    if (!result.ok) {
      entry.claimed = false
      publish(entry, { status: 'failed', request, error: `${result.error.code}: ${result.error.message}` })
      return
    }
    publish(entry, { status: 'sent', request })
  } catch (error) {
    if (!isCurrent(entry)) return
    if (abort.signal.aborted || activeSessionState(entry) !== 'active') {
      cancel(entry)
      return
    }
    entry.claimed = false
    publish(entry, { status: 'failed', request, error: errorMessage(error) })
  } finally {
    stopOnSessionSwitch()
    stopOnInactiveScope()
    entry.abort = undefined
  }
}

export function buildWorktreeRecoveryPrompt(request: WorktreeRecoveryRequest, t: ClientTranslator = defaultClientTranslator): string {
  if (request.kind === 'worktree_review_regeneration') {
    return t("the.current.managed.worktree.review.snapshot.is.stale", { p0: request.checkoutId, p1: request.reviewId, p2: request.revision })
  }
  const files = request.conflictingFiles.length > 0
    ? request.conflictingFiles.map(file => `- ${JSON.stringify(file)}`).join('\n')
    : t("no.conflicting.files.provided.rerun.the.read.only")
  return t("the.user.approved.worktree.sync.encountered.real.conflicts", { p0: request.checkoutId, p1: request.reviewId, p2: request.revision, p3: request.localHeadOid, p4: files })
}

/** Durable context queue only; browser state is untrusted and every send revalidates Host + Harness identity. */
export function enqueueWorktreeRecovery(input: {
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  request: WorktreeRecoveryRequest
  isActive: () => boolean
}): WorktreeRecoverySnapshot {
  const t = translatorForServices(input.services)

  const existing = entries.get(input.request.sessionId)
  if (existing?.snapshot.request.requestId === input.request.requestId) {
    existing.adapter = input.adapter
    existing.services = input.services
    existing.isActive = input.isActive
    if (!input.isActive()) cancel(existing)
    return existing.snapshot
  }
  if (existing) cancel(existing)
  const entry: RecoveryEntry = {
    snapshot: { status: 'queued', request: input.request },
    adapter: input.adapter,
    services: input.services,
    isActive: input.isActive,
    claimed: false,
    unsubscribers: [],
    listeners: listenersFor(input.request.sessionId),
  }
  entries.set(input.request.sessionId, entry)
  if (!input.isActive()) {
    publish(entry, { status: 'cancelled', request: input.request })
    return entry.snapshot
  }
  if (!validRequest(input.request)) {
    publish(entry, { status: 'failed', request: input.request, error: t("the.recovery.request.failed.client.identity.and.boundary") })
    return entry.snapshot
  }
  publish(entry, entry.snapshot)
  void attempt(entry)
  return entry.snapshot
}

export function restoreWorktreeRecovery(input: {
  sessionId: string
  adapter: WorktreeConsoleAdapter
  services: WorktreeClientServices
  isActive?: () => boolean
}): WorktreeRecoverySnapshot | null {
  const t = translatorForServices(input.services)

  const isActive = input.isActive ?? (() => true)
  const existing = entries.get(input.sessionId)
  if (existing) {
    const runtimeUnchanged = existing.adapter === input.adapter && existing.services === input.services
    existing.adapter = input.adapter
    existing.services = input.services
    if (runtimeUnchanged) {
      if (!existing.isActive()) cancel(existing)
      return existing.snapshot
    }
    existing.isActive = isActive
    if (!isActive()) {
      cancel(existing)
      return existing.snapshot
    }
    if (existing.snapshot.status === 'sending') {
      existing.abort?.abort()
      existing.claimed = false
      publish(existing, {
        status: 'failed', request: existing.snapshot.request,
        error: t("the.session.runtime.was.rebuilt.during.sending.the"),
      })
      return existing.snapshot
    }
    stopWatching(existing)
    existing.claimed = false
    if (existing.snapshot.status === 'queued') void attempt(existing)
    return existing.snapshot
  }
  const persisted = readPersisted(input.sessionId)
  if (!persisted) return null
  const restoredStatus = persisted.status === 'queued' ? 'queued' : 'failed'
  const restoredError = persisted.status === 'sending'
    ? t("the.recovery.request.was.being.sent.when.the")
    : persisted.error
  const entry: RecoveryEntry = {
    snapshot: {
      status: restoredStatus,
      request: persisted.request,
      ...(restoredError === undefined ? {} : { error: restoredError }),
    },
    adapter: input.adapter,
    services: input.services,
    isActive,
    claimed: false,
    unsubscribers: [],
    listeners: listenersFor(input.sessionId),
  }
  entries.set(input.sessionId, entry)
  publish(entry, entry.snapshot)
  if (entry.snapshot.status === 'queued') void attempt(entry)
  return entry.snapshot
}

export function retryWorktreeRecovery(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (!entry || entry.snapshot.status !== 'failed') return
  if (activeSessionState(entry) !== 'active') {
    cancel(entry)
    return
  }
  publish(entry, { status: 'queued', request: entry.snapshot.request })
  void attempt(entry)
}

export function getWorktreeRecoverySnapshot(sessionId: string): WorktreeRecoverySnapshot | null {
  return entries.get(sessionId)?.snapshot ?? null
}

export function subscribeWorktreeRecovery(sessionId: string, listener: () => void): () => void {
  const listeners = listenersFor(sessionId)
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useWorktreeRecoverySnapshot(sessionId: string | undefined): WorktreeRecoverySnapshot | null {
  const subscribe = useCallback((listener: () => void) => {
    if (!sessionId) return () => undefined
    return subscribeWorktreeRecovery(sessionId, listener)
  }, [sessionId])
  const getSnapshot = useCallback(() => sessionId ? getWorktreeRecoverySnapshot(sessionId) : null, [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Drop renderer-lifetime evidence after a new review supersedes it or in deterministic tests. */
export function cancelWorktreeRecovery(sessionId: string, requestId?: string): void {
  const entry = entries.get(sessionId)
  if (!entry || requestId !== undefined && entry.snapshot.request.requestId !== requestId) return
  if (entry.snapshot.status === 'sent' || entry.snapshot.status === 'failed') return
  cancel(entry)
}

/** Simulate renderer/module teardown while retaining durable unsent context. */
export function detachWorktreeRecoveryRuntime(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (!entry) return
  entry.abort?.abort()
  stopWatching(entry)
  entries.delete(sessionId)
  for (const listener of entry.listeners) listener()
}

export function clearWorktreeRecovery(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (entry) {
    entry.abort?.abort()
    stopWatching(entry)
    entries.delete(sessionId)
    for (const listener of entry.listeners) listener()
  }
  try { browserStorage()?.removeItem(storageKey(sessionId)) } catch { /* best effort */ }
}
