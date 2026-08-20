import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SessionCheckoutModule } from '../src/index.js'
import type {
  ManagedCheckoutRecord,
  ManagedCheckoutsRegistry,
  SessionCheckoutFilesPort,
  SessionCheckoutGitPort,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from '../src/ports.js'
import type { SessionTargetView } from '../src/types.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import {
  createGitWorktreeReviewDiffReader,
  REVIEW_DIFF_MAX_PATCH_BYTES,
  REVIEW_DIFF_MAX_PAYLOAD_BYTES,
} from '../src/console-host/review-diff.js'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

function runGit(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

function local(sessionId = 'source-session'): SessionTargetView {
  return {
    project: { id: 'project-1', name: 'Project' },
    checkout: { id: 'local', kind: 'local', label: 'Local', phase: 'ready' },
    source: { ref: 'refs/heads/main', oid: A },
    current: { branch: 'main', oid: A },
    ownership: 'owner', dirty: false, revision: 1,
  }
}

function readyRecord(): ManagedCheckoutRecord {
  return {
    checkoutId: 'checkout-1', projectId: 'project-1', projectName: 'Project',
    ownerSessionId: 'target-session', sourceSessionId: 'source-session',
    localRoot: '/local', managedRoot: '/managed', managedGitRoot: '/managed',
    gitCommonDir: '/git/common', gitDir: '/git/worktrees/one', baseOid: A,
    sourceRef: 'refs/heads/main', phase: 'ready', journal: null, revision: 7,
    delivery: {
      state: 'ready_for_review',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready',
        validationStatus: 'passed', tests: [], changedFiles: ['src/index.ts'],
        suggestedCommitMessage: 'fix: persisted review', isolatedFingerprint: 'fingerprint-1', isolatedHeadOid: B,
      },
    },
  }
}

function registry(record = readyRecord()): SessionCheckoutRegistryPort {
  const value: ManagedCheckoutsRegistry = {
    version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
  }
  return { read: () => structuredClone(value), write: vi.fn() }
}

function moduleDouble(record = readyRecord()): SessionCheckoutModule {
  const isolated: SessionTargetView = {
    project: { id: record.projectId, name: record.projectName },
    checkout: { id: record.checkoutId, kind: 'isolated', label: 'Task', phase: record.phase },
    source: { ref: record.sourceRef, oid: record.baseOid },
    current: { branch: null, oid: B }, ownership: 'owner', dirty: true, revision: record.revision,
    delivery: {
      state: 'ready_for_review',
      review: {
        reviewId: 'review-1', iteration: 1, preparedAt: 1, summary: 'Ready', validationStatus: 'passed',
        tests: [], changedFiles: ['src/index.ts'], suggestedCommitMessage: 'fix: persisted review',
      },
    },
  }
  return {
    inspect: vi.fn(async sessionId => sessionId === 'target-session' ? isolated : local(sessionId)),
    runtimeContext: vi.fn(),
    preflight: vi.fn(async () => ({
      status: 'ready', localModified: false, checkoutId: record.checkoutId, reviewId: 'review-1', revision: 7,
      configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base', localBranch: 'main',
      localHeadOid: A, isolatedHeadOid: B, changedFiles: ['src/index.ts'],
    })),
    runExclusiveSessionMutation: vi.fn(), bind: vi.fn(), beginNextIteration: vi.fn(), resumeRevision: vi.fn(), markReadyForReview: vi.fn(),
    createIsolatedTarget: vi.fn(async (sourceSessionId, targetSessionId) => ({ targetSessionId, managedRoot: '/managed', target: isolated })),
    operate: vi.fn(), listManagedWorktrees: vi.fn(), inspectManagedWorktreeCleanup: vi.fn(), bulkCleanupManagedWorktrees: vi.fn(),
    listManagedWorktreesForSession: vi.fn(async sessionId => sessionId === 'intruder-session' ? [] : [{
      checkoutId: record.checkoutId, revision: record.revision, ownerSessionId: record.ownerSessionId, ownerSessionTitle: 'Task',
      project: { id: record.projectId, name: record.projectName }, iteration: 1, state: 'ready_for_review', phase: record.phase,
      dirty: true, commitOid: null, approximateBytes: null, updatedAt: 1, canCleanup: false,
    }]),
    manageManagedWorktreeForSession: vi.fn(), manageManagedWorktree: vi.fn(),
    resolveManagedRoot: vi.fn(async () => '/managed'), cleanupExpiredRetained: vi.fn(), reconcile: vi.fn(),
  } as unknown as SessionCheckoutModule
}

function lookupDouble(): SessionCheckoutLookupPort {
  return {
    getSession: sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' }),
    getProject: projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' }),
  }
}

function filesDouble(): SessionCheckoutFilesPort {
  return {
    exists: () => true,
    canonicalize: vi.fn(async path => path),
    inspectDirectoryIdentity: vi.fn(), ensureDirectory: vi.fn(), removeEmptyDirectoryTree: vi.fn(),
    quarantineDirectoryTree: vi.fn(), removeDirectoryTree: vi.fn(), measureDirectoryBytes: vi.fn(),
  }
}

function gitDouble(): SessionCheckoutGitPort {
  return {
    inspect: vi.fn(async () => ({ root: '/managed', commonDir: '/git/common', gitDir: '/git/worktrees/one', branch: null, headOid: B, headRef: 'HEAD' })),
    findContainingWorktreeRoot: vi.fn(), status: vi.fn(async () => ({ dirty: true })), createDetachedWorktree: vi.fn(),
    removeWorktree: vi.fn(), retainApplyBase: vi.fn(), releaseApplyBase: vi.fn(), retainInternalArtifact: vi.fn(),
    releaseInternalArtifacts: vi.fn(), isAncestor: vi.fn(),
  }
}

function plane(record = readyRecord(), overrides: {
  lookup?: SessionCheckoutLookupPort
  files?: SessionCheckoutFilesPort
  registry?: SessionCheckoutRegistryPort
} = {}) {
  const module = moduleDouble(record)
  return {
    module,
    control: createWorktreeConsoleControlPlane({
      module,
      lookup: overrides.lookup ?? lookupDouble(),
      files: overrides.files ?? filesDouble(),
      registry: overrides.registry ?? registry(record), git: gitDouble(), createTargetSessionId: () => 'host-target',
      reviewDiff: { read: vi.fn(async input => ({ reviewId: input.reviewId, revision: input.revision, files: [], truncated: false })) },
    }),
  }
}

describe('Worktree Console Host control plane', () => {
  it('projects an unselected live Git Session as Local without mutating its binding', async () => {
    const { module, control } = plane()
    vi.mocked(module.inspect).mockRejectedValueOnce(Object.assign(
      new Error('会话尚未选择 Session Target'),
      { code: 'target_unselected' },
    ))

    const result = await control.current('source-session')

    expect(result).toMatchObject({
      ok: true,
      value: {
        target: {
          state: 'local',
          phase: 'local',
          sourceSessionId: 'source-session',
          managedRoot: null,
          capabilities: { create: true },
        },
      },
    })
    expect(module.bind).not.toHaveBeenCalled()
  })

  it('allocates target identity on Host and never changes the source Session target', async () => {
    const record = readyRecord()
    record.ownerSessionId = 'host-target'
    const { module, control } = plane(record)
    const result = await control.create('source-session')
    expect(result).toMatchObject({ ok: true, value: { targetSessionId: 'host-target', managedRoot: '/managed' } })
    expect(module.createIsolatedTarget).toHaveBeenCalledWith('source-session', 'host-target')
    expect(module.inspect).not.toHaveBeenCalledWith('host-target')
  })

  it('projects a cleaned delivered owner even though its immutable Workspace path is temporarily absent', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' })
    lookup.getProject = projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' })
    const files = filesDouble()
    files.exists = path => path !== '/managed'
    const { module, control } = plane(delivered, { lookup, files })
    vi.mocked(module.inspect).mockResolvedValue({
      project: { id: delivered.projectId, name: delivered.projectName },
      checkout: { id: delivered.checkoutId, kind: 'isolated', label: 'Task', phase: 'discarded' },
      source: { ref: delivered.sourceRef, oid: delivered.baseOid },
      current: { branch: 'main', oid: B }, ownership: 'owner', dirty: false, revision: delivered.revision,
      delivery: { state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10 },
    })

    const result = await control.current('target-session')

    expect(result).toMatchObject({
      ok: true,
      value: { target: { state: 'delivered', managedRoot: null, capabilities: { beginNextIteration: true } } },
    })
  })

  it('resumes the exact unsynced review without writing Local or changing checkout identity', async () => {
    const record = readyRecord()
    let registryValue: ManagedCheckoutsRegistry = {
      version: 2, revision: 1, sessionBindings: {}, managedCheckouts: { [record.checkoutId]: record },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(registryValue),
      write: nextValue => { registryValue = structuredClone(nextValue) },
    }
    const { module, control } = plane(record, { registry: registryPort })
    vi.mocked(module.resumeRevision).mockImplementation(async () => {
      const current = registryValue.managedCheckouts[record.checkoutId]!
      registryValue = {
        ...registryValue,
        revision: registryValue.revision + 1,
        managedCheckouts: {
          ...registryValue.managedCheckouts,
          [record.checkoutId]: { ...current, revision: 8, delivery: { state: 'working', iteration: 1 } },
        },
      }
      return {
        project: { id: record.projectId, name: record.projectName },
        checkout: { id: record.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
        source: { ref: record.sourceRef, oid: record.baseOid }, current: { branch: null, oid: B },
        ownership: 'owner', dirty: true, revision: 8, delivery: { state: 'working', iteration: 1 },
      }
    })

    const result = await control.resumeRevision({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })

    expect(result).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-1', state: 'working', iteration: 1, revision: 8 } },
    })
    expect(module.resumeRevision).toHaveBeenCalledWith('target-session', 7, 'review-1')
  })

  it('rejects a stale review identity before resuming revision', async () => {
    const { module, control } = plane()
    const result = await control.resumeRevision({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-old',
    })
    expect(result).toMatchObject({ ok: false, error: { code: 'stale_target' } })
    expect(module.resumeRevision).not.toHaveBeenCalled()
  })

  it('starts iteration 2 for the exact delivered owner while preserving the immutable cwd identity', async () => {
    const delivered = readyRecord()
    delivered.phase = 'discarded'
    delivered.revision = 9
    delivered.delivery = {
      state: 'delivered', iteration: 1, commitOid: B, deliveredAt: 10,
    }
    const next: ManagedCheckoutRecord = {
      ...delivered,
      checkoutId: 'checkout-2',
      predecessorCheckoutId: delivered.checkoutId,
      phase: 'ready',
      delivery: { state: 'working', iteration: 2 },
      journal: null,
      revision: 11,
      baseOid: B,
      gitDir: '/git/worktrees/two',
    }
    let registryValue: ManagedCheckoutsRegistry = {
      version: 2, revision: 1,
      sessionBindings: {},
      managedCheckouts: { [delivered.checkoutId]: delivered },
    }
    const registryPort: SessionCheckoutRegistryPort = {
      read: () => structuredClone(registryValue),
      write: nextValue => { registryValue = structuredClone(nextValue) },
    }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({ id: sessionId, projectId: sessionId === 'target-session' ? 'workspace-target' : 'project-1' })
    lookup.getProject = projectId => ({ id: projectId, name: 'Project', root: projectId === 'workspace-target' ? '/managed' : '/local' })
    const { module, control } = plane(delivered, { registry: registryPort, lookup })
    vi.mocked(module.beginNextIteration).mockImplementation(async () => {
      registryValue = {
        ...registryValue,
        revision: registryValue.revision + 1,
        managedCheckouts: { ...registryValue.managedCheckouts, [next.checkoutId]: next },
      }
      return {
        project: { id: next.projectId, name: next.projectName },
        checkout: { id: next.checkoutId, kind: 'isolated', label: 'Task', phase: 'ready' },
        source: { ref: next.sourceRef, oid: next.baseOid },
        current: { branch: null, oid: B }, ownership: 'owner', dirty: false, revision: next.revision,
        delivery: { state: 'working', iteration: 2 },
      }
    })

    const result = await control.beginNextIteration({
      sessionId: 'target-session', checkoutId: delivered.checkoutId, expectedRevision: delivered.revision,
    })

    expect(result).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-2', ownerSessionId: 'target-session', state: 'working', iteration: 2 } },
    })
    expect(module.beginNextIteration).toHaveBeenCalledWith('target-session', delivered.revision)
  })

  it('lets an owner list and inspect a same-source sibling without inheriting mutation capabilities', async () => {
    const first = readyRecord()
    const sibling: ManagedCheckoutRecord = {
      ...readyRecord(),
      checkoutId: 'checkout-2',
      ownerSessionId: 'target-session-2',
      managedRoot: '/managed-2',
      managedGitRoot: '/managed-2',
      gitDir: '/git/worktrees/two',
      revision: 8,
    }
    const value: ManagedCheckoutsRegistry = {
      version: 2,
      revision: 1,
      sessionBindings: {},
      managedCheckouts: { [first.checkoutId]: first, [sibling.checkoutId]: sibling },
    }
    const registryPort: SessionCheckoutRegistryPort = { read: () => structuredClone(value), write: vi.fn() }
    const lookup = lookupDouble()
    lookup.getSession = sessionId => ({
      id: sessionId,
      projectId: sessionId === 'target-session'
        ? 'workspace-target'
        : sessionId === 'target-session-2' ? 'workspace-target-2' : 'project-1',
    })
    lookup.getProject = projectId => ({
      id: projectId,
      name: 'Project',
      root: projectId === 'workspace-target'
        ? '/managed'
        : projectId === 'workspace-target-2' ? '/managed-2' : '/local',
    })
    const { module, control } = plane(first, { registry: registryPort, lookup })
    vi.mocked(module.resolveManagedRoot).mockImplementation(async checkoutId => checkoutId === 'checkout-2' ? '/managed-2' : '/managed')
    vi.mocked(module.listManagedWorktreesForSession).mockResolvedValue([
      {
        checkoutId: first.checkoutId, revision: first.revision, ownerSessionId: first.ownerSessionId, ownerSessionTitle: 'Task 1',
        project: { id: first.projectId, name: first.projectName }, iteration: 1, state: 'ready_for_review', phase: first.phase,
        dirty: true, commitOid: null, approximateBytes: null, updatedAt: 1, canCleanup: false,
      },
      {
        checkoutId: sibling.checkoutId, revision: sibling.revision, ownerSessionId: sibling.ownerSessionId, ownerSessionTitle: 'Task 2',
        project: { id: sibling.projectId, name: sibling.projectName }, iteration: 1, state: 'ready_for_review', phase: sibling.phase,
        dirty: true, commitOid: null, approximateBytes: null, updatedAt: 2, canCleanup: false,
      },
    ])

    const listed = await control.list({ sessionId: 'target-session' })
    expect(listed).toMatchObject({
      ok: true,
      value: {
        worktrees: [
          expect.objectContaining({ checkoutId: 'checkout-1' }),
          expect.objectContaining({
            checkoutId: 'checkout-2',
            capabilities: expect.objectContaining({
              open: true,
              inspect: true,
              discard: false,
              preview: false,
              finalize: false,
              retryCleanup: false,
            }),
          }),
        ],
      },
    })
    if (!listed.ok) throw new Error('expected linked list success')
    expect(listed.value.worktrees[1]).not.toHaveProperty('managedRoot')

    const inspected = await control.inspect('target-session', 'checkout-2')
    expect(inspected).toMatchObject({
      ok: true,
      value: { target: { checkoutId: 'checkout-2', managedRoot: '/managed-2' } },
    })

    const preview = await control.preview({
      sessionId: 'target-session', checkoutId: 'checkout-2', expectedRevision: 8, expectedReviewId: 'review-1',
    })
    expect(preview).toMatchObject({ ok: false, error: { code: 'not_owner' } })
  })

  it('rejects a live same-project Session that is neither source nor owner before revealing managedRoot', async () => {
    const { module, control } = plane()
    const result = await control.inspect('intruder-session', 'checkout-1')
    expect(result).toEqual({ ok: false, error: { code: 'not_owner', message: '当前 Session 无权访问该 Worktree' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('fails closed when the live owner Workspace cwd no longer matches managedRoot', async () => {
    const lookup = lookupDouble()
    lookup.getProject = vi.fn(projectId => ({ id: projectId, name: 'Project', root: '/elsewhere' }))
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.inspect('target-session', 'checkout-1')
    expect(result).toMatchObject({ ok: false, error: { code: 'project_mismatch' } })
    expect(module.resolveManagedRoot).not.toHaveBeenCalled()
  })

  it('keeps list rows path-free while authorized detail contains the validated managedRoot', async () => {
    const { control } = plane()
    const listed = await control.list({ sessionId: 'source-session' })
    expect(listed.ok).toBe(true)
    if (!listed.ok) throw new Error('expected list success')
    expect(listed.value.worktrees).toHaveLength(1)
    expect(listed.value.worktrees[0]).not.toHaveProperty('managedRoot')
    const inspected = await control.inspect('source-session', 'checkout-1')
    expect(inspected).toMatchObject({ ok: true, value: { target: { managedRoot: '/managed' } } })
  })

  it('finalizes only the persisted review identity with the bounded user-confirmed commit message', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValue({
      status: 'finished', target: local(), changedFiles: ['src/index.ts'], commitOid: B, cleanup: 'discarded',
    })
    const result = await control.finalize({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
      expectedReviewId: 'review-1', commitMessage: 'feat(review): user confirmed', retention: 'cleanup',
    })
    expect(result.ok).toBe(true)
    expect(module.operate).toHaveBeenCalledWith({
      sessionId: 'target-session', expectedRevision: 7, action: 'finish', expectedReviewId: 'review-1',
      commitMessage: 'feat(review): user confirmed', retention: 'cleanup',
    })
  })

  it('rejects an empty or oversized user Commit Message before any Local operation', async () => {
    const { module, control } = plane()
    for (const commitMessage of ['   ', 'x'.repeat(501)]) {
      const result = await control.finalize({
        sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7,
        expectedReviewId: 'review-1', commitMessage, retention: 'cleanup',
      })
      expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } })
    }
    expect(module.operate).not.toHaveBeenCalled()
  })

  it('rejects source-side Discard after the owner Session is live', async () => {
    const { module, control } = plane()
    const result = await control.discard({
      sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true,
    })
    expect(result).toEqual({
      ok: false,
      error: { code: 'not_owner', message: 'Owner Session 已接管该 Worktree，只有 owner 可以 Discard' },
    })
    expect(module.manageManagedWorktreeForSession).not.toHaveBeenCalled()
  })

  it('allows the Local source to discard only an unopened owner reservation', async () => {
    const lookup = lookupDouble()
    lookup.getSession = vi.fn(sessionId => sessionId === 'target-session'
      ? undefined
      : { id: sessionId, projectId: 'project-1' })
    const { module, control } = plane(readyRecord(), { lookup })
    const result = await control.discard({
      sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true,
    })
    expect(result.ok).toBe(true)
    expect(module.manageManagedWorktreeForSession).toHaveBeenCalledWith('source-session', {
      checkoutId: 'checkout-1', expectedRevision: 7, action: 'discard', confirmDirty: true,
    })
  })

  it('routes owner Discard through the Preview-aware operation and keeps retention/cleanup caller-scoped', async () => {
    const { module, control } = plane()
    vi.mocked(module.operate).mockResolvedValueOnce({ status: 'discarded', checkoutId: 'checkout-1', changedFiles: [] })
    await control.discard({ sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, confirmDirty: true })
    await control.setRetention({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 8, retention: 'retain_manual' })
    await control.retryCleanup({ sessionId: 'source-session', checkoutId: 'checkout-1', expectedRevision: 9 })
    expect(module.operate).toHaveBeenCalledWith({
      action: 'discard', sessionId: 'target-session', expectedRevision: 7, confirmDirty: true,
    })
    expect(module.manageManagedWorktreeForSession).toHaveBeenNthCalledWith(1, 'source-session', {
      checkoutId: 'checkout-1', expectedRevision: 8, action: 'set_retention', retention: 'retain_manual',
    })
    expect(module.manageManagedWorktreeForSession).toHaveBeenNthCalledWith(2, 'source-session', {
      checkoutId: 'checkout-1', expectedRevision: 9, action: 'retry_cleanup',
    })
  })

  it('drops all diff bytes when the reviewed snapshot becomes stale during the read', async () => {
    const { module, control } = plane()
    vi.mocked(module.preflight!).mockResolvedValueOnce({
      status: 'ready', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      configuredBaseOid: A, effectiveBaseOid: A, baseStrategy: 'recorded_base', localBranch: 'main',
      localHeadOid: A, isolatedHeadOid: B, changedFiles: ['src/index.ts'],
    }).mockResolvedValueOnce({
      status: 'blocked', localModified: false, checkoutId: 'checkout-1', reviewId: 'review-1', revision: 7,
      reason: 'stale_isolated', message: 'changed after review',
    })
    const result = await control.reviewDiff({
      sessionId: 'target-session', checkoutId: 'checkout-1', expectedRevision: 7, expectedReviewId: 'review-1',
    })
    expect(result).toEqual({ ok: false, error: { code: 'stale_isolated', message: 'Ready 后 Isolated 内容已变化，Diff bytes 已丢弃' } })
    expect(JSON.stringify(result)).not.toContain('@@')
  })

  it('enforces the complete 1 MiB response budget across individually bounded patches', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-console-total-budget-'))
    try {
      runGit(root, ['init'])
      runGit(root, ['config', 'user.email', 'fixture@example.com'])
      runGit(root, ['config', 'user.name', 'Fixture'])
      writeFileSync(join(root, 'base.txt'), 'base\n')
      runGit(root, ['add', '.'])
      runGit(root, ['commit', '-m', 'base'])
      const baseOid = runGit(root, ['rev-parse', 'HEAD'])
      const changedFiles: string[] = []
      for (let index = 0; index < 12; index += 1) {
        const path = `large-${String(index).padStart(2, '0')}.txt`
        changedFiles.push(path)
        writeFileSync(join(root, path), `${String(index)}${'x'.repeat(REVIEW_DIFF_MAX_PATCH_BYTES + 4096)}`)
      }
      const result = await createGitWorktreeReviewDiffReader().read({
        managedRoot: root, baseOid, reviewId: 'review-total', revision: 8, changedFiles,
      })
      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PAYLOAD_BYTES)
      expect(result.files.length).toBeLessThan(changedFiles.length)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('renders binary and rename entries within the file, patch, and file-count budgets', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-console-diff-test-'))
    try {
      runGit(root, ['init'])
      runGit(root, ['config', 'user.email', 'fixture@example.com'])
      runGit(root, ['config', 'user.name', 'Fixture'])
      writeFileSync(join(root, '000-binary.bin'), Buffer.from([0, 1, 2]))
      writeFileSync(join(root, '001-old.txt'), 'old\n')
      writeFileSync(join(root, 'base.txt'), 'base\n')
      runGit(root, ['add', '.'])
      runGit(root, ['commit', '-m', 'base'])
      const baseOid = runGit(root, ['rev-parse', 'HEAD'])

      writeFileSync(join(root, '000-binary.bin'), Buffer.from([0, 9, 8, 7]))
      runGit(root, ['mv', '001-old.txt', '001-new.txt'])
      writeFileSync(join(root, '002-large.txt'), 'x'.repeat(REVIEW_DIFF_MAX_PATCH_BYTES + 4096))
      const extra: string[] = []
      for (let index = 0; index < 201; index += 1) {
        const path = `100-file-${String(index).padStart(3, '0')}.txt`
        extra.push(path)
        writeFileSync(join(root, path), `${index}\n`)
      }
      const changedFiles = ['000-binary.bin', '001-old.txt', '001-new.txt', '002-large.txt', ...extra].sort()
      const result = await createGitWorktreeReviewDiffReader().read({
        managedRoot: root, baseOid, reviewId: 'review-1', revision: 7, changedFiles,
      })

      expect(result.files).toHaveLength(200)
      expect(result.truncated).toBe(true)
      expect(result.files.find(file => file.path === '000-binary.bin')).toMatchObject({ status: 'binary', patch: null })
      expect(result.files.find(file => file.path === '001-new.txt')).toMatchObject({ status: 'renamed', previousPath: '001-old.txt' })
      const large = result.files.find(file => file.path === '002-large.txt')
      expect(large?.truncated).toBe(true)
      expect(Buffer.byteLength(large?.patch ?? '', 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PATCH_BYTES)
      expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThanOrEqual(REVIEW_DIFF_MAX_PAYLOAD_BYTES)
      expect(result.files.every(file => !file.path.startsWith('/') && !file.path.includes('..'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 60_000)
})
