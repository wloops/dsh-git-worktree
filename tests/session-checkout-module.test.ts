import { afterEach, describe, expect, test } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import type { SessionCheckoutModule } from '../src/index.js'
import type { SessionCheckoutApplyEngine } from '../src/session-checkout-apply.ts'

import { createSessionCheckoutModule } from '../src/session-checkout-module.ts'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.ts'

interface TestSession {
  id: string
  projectId?: string
  title?: string
}

interface TestProject {
  id: string
  name: string
  root: string
}

interface ManagedInspectPause {
  started: Promise<void>
  resume(): void
}

interface DirectoryMeasurePause {
  started: Promise<void>
  resume(): void
}

interface TestContext {
  root: string
  configDir: string
  projectRoot: string
  repositoryRoot: string
  module: SessionCheckoutModule
  restart(): SessionCheckoutModule
  pauseNextGitInspect(expectedPath?: string): ManagedInspectPause
  failNextGitInspect(expectedPath?: string): void
  pauseNextDirectoryMeasure(): DirectoryMeasurePause
  getRemoveWorktreeCallCount(): number
  getCreateWorktreeCallCount(): number
  getMeasureDirectoryCallCount(): number
  setSessionProject(sessionId: string, projectId: string): void
  setProjectRoot(projectId: string, root: string): void
  addProject(projectId: string, name: string, root: string): void
  addSession(sessionId: string, projectId: string, title?: string): void
  removeSession(sessionId: string): void
  removeProject(projectId: string): void
}

const temporaryRoots: string[] = []

// Real Git/worktree integration is slower; the global timeout lives in vitest.config.ts (60s).

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} 失败: ${result.stderr}`)
  }
  return result.stdout.trim()
}

function createContext(options: {
  projectSubdirectory?: string
  applyEngine?: SessionCheckoutApplyEngine
  crashAfterWorktreeCreate?: boolean
  createWorktreeFailures?: number
  createWorktreeFailureLeavesFile?: boolean
  removeWorktreeFailures?: number
  transientRemoveWorktreeFailures?: number
  removeWorktreeFailureLeavesResidue?: boolean
  removeDirectoryTreeFailures?: number
  outerRepository?: boolean
  checkoutIds?: string[]
} = {}): TestContext {
  const root = mkdtempSync(join(tmpdir(), 'domi-checkout-测试 空格-'))
  temporaryRoots.push(root)
  const repositoryRoot = join(root, '本地 project')
  const projectRoot = options.projectSubdirectory
    ? join(repositoryRoot, options.projectSubdirectory)
    : repositoryRoot
  const configDir = options.outerRepository
    ? mkdtempSync(join(tmpdir(), 'domi-checkout-config-'))
    : join(root, 'config')
  if (options.outerRepository) temporaryRoots.push(configDir)
  const sessions = new Map<string, TestSession>([
    ['session-1', { id: 'session-1', projectId: 'project-1', title: '测试思路' }],
    ['child-session', { id: 'child-session', projectId: 'project-1', title: '测试思路 (worktree)' }],
  ])
  const projects = new Map<string, TestProject>([
    ['project-1', { id: 'project-1', name: '示例 Project', root: projectRoot }],
  ])

  if (options.outerRepository) {
    git(root, 'init', '-b', 'outer')
    git(root, 'config', 'user.name', 'Domi Outer Test')
    git(root, 'config', 'user.email', 'domi-outer@example.test')
    writeFileSync(join(root, 'outer.txt'), 'outer\n')
    git(root, 'add', 'outer.txt')
    git(root, 'commit', '-m', 'outer base')
  }

  git(root, 'init', '-b', 'main', repositoryRoot)
  mkdirSync(projectRoot, { recursive: true })
  git(projectRoot, 'config', 'user.name', 'Domi Test')
  git(projectRoot, 'config', 'user.email', 'domi@example.test')
  writeFileSync(join(projectRoot, 'tracked.txt'), 'base\n')
  git(projectRoot, 'add', 'tracked.txt')
  git(projectRoot, 'commit', '-m', 'base')

  const timingEvents: SessionCheckoutTimingEvent[] = []
  const recordTiming = (event: SessionCheckoutTimingEvent): void => {
    if (options.timingFailure) throw new Error('模拟 timing writer 失败')
    timingEvents.push(event)
  }
  const dependencies = createNodeSessionCheckoutDependencies({
    configDir,
    onTimingEvent: recordTiming,
    lookup: {
      getSession: (sessionId) => sessions.get(sessionId),
      getProject: (projectId) => projects.get(projectId),
      markDelegationCheckoutReleased: (sessionId, releasedAt) => {
        const session = sessions.get(sessionId)
        if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
        session.delegationCheckoutReleasedAt = releasedAt
      },
      getUnboundTargetPolicy: () => 'unselected',
    },
  })
  if (options.checkoutIds !== undefined) {
    const generatedIds = [...options.checkoutIds]
    const defaultCreateCheckoutId = dependencies.createCheckoutId
    dependencies.createCheckoutId = () => generatedIds.shift() ?? defaultCreateCheckoutId()
  }
  const inspectGit = dependencies.git.inspect
  let nextInspectPause: {
    expectedPath?: string
    signalStarted(): void
    waitForResume: Promise<void>
  } | undefined
  let nextInspectFailurePath: string | undefined
  dependencies.git.inspect = async (path) => {
    const canonicalPath = realpathSync.native(path)
    if (nextInspectFailurePath && canonicalPath === nextInspectFailurePath) {
      nextInspectFailurePath = undefined
      throw Object.assign(new Error('模拟 Git inspect 瞬时超时'), { code: 'ETIMEDOUT' })
    }
    const pause = nextInspectPause
    if (pause && (!pause.expectedPath || canonicalPath === pause.expectedPath)) {
      nextInspectPause = undefined
      pause.signalStarted()
      await pause.waitForResume
    }
    return inspectGit(path)
  }
  const removeWorktree = dependencies.git.removeWorktree
  let removeWorktreeCallCount = 0
  let removeWorktreeFailures = options.removeWorktreeFailures ?? 0
  let transientRemoveWorktreeFailures = options.transientRemoveWorktreeFailures ?? 0
  dependencies.git.removeWorktree = async (...args) => {
    removeWorktreeCallCount += 1
    if (transientRemoveWorktreeFailures > 0) {
      transientRemoveWorktreeFailures -= 1
      throw Object.assign(new Error('EPERM: Windows 正在使用 Worktree 目录'), { code: 'EPERM' })
    }
    if (removeWorktreeFailures > 0) {
      removeWorktreeFailures -= 1
      if (options.removeWorktreeFailureLeavesResidue) {
        rmSync(join(args[1], '.git'), { force: true })
        git(args[0], 'worktree', 'prune', '--expire', 'now')
        mkdirSync(join(args[1], 'service', 'node_modules', 'locked-package'), { recursive: true })
        mkdirSync(join(args[1], 'web', 'dist', 'assets'), { recursive: true })
        mkdirSync(join(args[1], 'tmp', 'design-prototypes'), { recursive: true })
        writeFileSync(join(args[1], 'service', 'node_modules', 'locked-package', 'index.js'), 'module.exports = true\n')
        writeFileSync(join(args[1], 'web', 'dist', 'assets', 'bundle.js'), 'console.log("residue")\n')
        writeFileSync(join(args[1], 'tmp', 'design-prototypes', 'notes.md'), '# cleanup residue\n')
      }
      throw new Error('模拟 Worktree 文件占用')
    }
    return removeWorktree(...args)
  }
  const removeDirectoryTree = dependencies.files.removeDirectoryTree
  let removeDirectoryTreeFailures = options.removeDirectoryTreeFailures ?? 0
  dependencies.files.removeDirectoryTree = async (...args) => {
    if (removeDirectoryTreeFailures > 0) {
      removeDirectoryTreeFailures -= 1
      throw new Error('模拟 quarantine 目录仍被占用')
    }
    await removeDirectoryTree(...args)
  }
  if (options.applyEngine) dependencies.applyEngine = options.applyEngine
  const measureDirectoryBytes = dependencies.files.measureDirectoryBytes
  let measureDirectoryCallCount = 0
  let nextDirectoryMeasurePause: {
    signalStarted(): void
    waitForResume: Promise<void>
  } | undefined
  dependencies.files.measureDirectoryBytes = async (...args) => {
    measureDirectoryCallCount += 1
    const pause = nextDirectoryMeasurePause
    if (pause) {
      nextDirectoryMeasurePause = undefined
      pause.signalStarted()
      await pause.waitForResume
    }
    return measureDirectoryBytes(...args)
  }
  const createDetachedWorktree = dependencies.git.createDetachedWorktree
  let createWorktreeCallCount = 0
  let createWorktreeFailures = options.createWorktreeFailures ?? 0
  dependencies.git.createDetachedWorktree = async (localRoot, managedRoot, baseOid) => {
    createWorktreeCallCount += 1
    if (createWorktreeFailures > 0) {
      createWorktreeFailures -= 1
      mkdirSync(join(managedRoot, 'web'), { recursive: true })
      if (options.createWorktreeFailureLeavesFile) {
        writeFileSync(join(managedRoot, 'web', 'unknown.txt'), '保留\n')
      }
      throw new Error('模拟 worktree add 留下半成品目录')
    }
    await createDetachedWorktree(localRoot, managedRoot, baseOid)
    if (options.crashAfterWorktreeCreate) {
      throw new Error('模拟 create 落盘后的进程崩溃')
    }
  }

  return {
    root,
    configDir,
    projectRoot,
    repositoryRoot,
    module: createSessionCheckoutModule(dependencies),
    restart: () => createSessionCheckoutModule(createNodeSessionCheckoutDependencies({
      configDir,
      lookup: dependencies.lookup,
    })),
    pauseNextGitInspect: (expectedPath) => {
      let signalStarted = (): void => undefined
      let resume = (): void => undefined
      const started = new Promise<void>((resolve) => { signalStarted = resolve })
      const waitForResume = new Promise<void>((resolve) => { resume = resolve })
      nextInspectPause = {
        ...(expectedPath ? { expectedPath: realpathSync.native(expectedPath) } : {}),
        signalStarted,
        waitForResume,
      }
      return { started, resume }
    },
    failNextGitInspect: (expectedPath) => {
      nextInspectFailurePath = realpathSync.native(expectedPath ?? projectRoot)
    },
    pauseNextDirectoryMeasure: () => {
      let signalStarted = (): void => undefined
      let resume = (): void => undefined
      const started = new Promise<void>((resolve) => { signalStarted = resolve })
      const waitForResume = new Promise<void>((resolve) => { resume = resolve })
      nextDirectoryMeasurePause = { signalStarted, waitForResume }
      return { started, resume }
    },
    getRemoveWorktreeCallCount: () => removeWorktreeCallCount,
    getCreateWorktreeCallCount: () => createWorktreeCallCount,
    getMeasureDirectoryCallCount: () => measureDirectoryCallCount,
    setSessionProject: (sessionId, projectId) => {
      const session = sessions.get(sessionId)
      if (session) session.projectId = projectId
    },
    setProjectRoot: (projectId, projectRoot) => {
      const project = projects.get(projectId)
      if (project) project.root = projectRoot
    },
    addProject: (projectId, name, projectRoot) => {
      projects.set(projectId, { id: projectId, name, root: projectRoot })
    },
    addSession: (sessionId, projectId, title) => {
      sessions.set(sessionId, { id: sessionId, projectId, title })
    },
    setSessionDelegation: (sessionId, status, delegationId = `delegation-${sessionId}`) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
      session.sourceDelegationId = delegationId
      session.delegationStatus = status as TestSession['delegationStatus']
    },
    markSessionDelegationCheckoutReleased: (sessionId) => {
      const session = sessions.get(sessionId)
      if (!session) throw new Error(`测试会话不存在: ${sessionId}`)
      session.delegationCheckoutReleasedAt = Date.now()
    },
    removeSession: (sessionId) => {
      sessions.delete(sessionId)
    },
    removeProject: (projectId) => {
      projects.delete(projectId)
    },
  }
}

describe('SessionCheckoutModule', () => {
  test('Given a host rewind owns the exclusive session mutation lock When bind starts Then checkout mutation waits until rewind releases', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })
    let signalStarted = (): void => undefined
    let release = (): void => undefined
    const started = new Promise<void>((resolve) => { signalStarted = resolve })
    const gate = new Promise<void>((resolve) => { release = resolve })
    const exclusive = context.module.runExclusiveSessionMutation('session-1', async (target) => {
      signalStarted()
      await gate
      return target.checkout.kind
    })
    await started

    let bindCompleted = false
    const bind = context.module.bind('session-1', { kind: 'local' }).then((view) => {
      bindCompleted = true
      return view
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(bindCompleted).toBe(false)

    release()
    expect(await exclusive).toBe('local')
    expect((await bind).checkout.kind).toBe('local')
  })

  test('Given 一个 Git 项目 When 会话绑定 Local Then inspect 展示项目与实时 branch/HEAD', async () => {
    const context = createContext()
    const expectedOid = git(context.projectRoot, 'rev-parse', 'HEAD')

    await context.module.bind('session-1', { kind: 'local' })
    const target = await context.module.inspect('session-1')

    expect(target).toEqual({
      project: { id: 'project-1', name: '示例 Project' },
      checkout: {
        id: 'local:project-1',
        kind: 'local',
        label: 'Local Checkout',
        phase: 'ready',
      },
      source: { ref: 'refs/heads/main', oid: expectedOid },
      current: { branch: 'main', oid: expectedOid },
      ownership: 'owner',
      dirty: false,
      revision: 1,
    })
  })

  test('Given Local Checkout 在绑定后出现修改 When inspect Then dirty 实时变为 true', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })
    writeFileSync(join(context.projectRoot, 'tracked.txt'), 'local dirty\n')

    const target = await context.module.inspect('session-1')

    expect(target).toMatchObject({ ownership: 'owner', dirty: true })
  })

  test('Given a Local session creates two isolated targets When their sessions open at the managed roots Then targets are unique and Local stays clean', async () => {
    const context = createContext()

    const first = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    const second = await context.module.createIsolatedTarget('session-1', 'target-session-2')

    expect(first.managedRoot).not.toBe(second.managedRoot)
    expect(first.target.checkout.id).not.toBe(second.target.checkout.id)
    expect(basename(dirname(first.managedRoot))).toBe('本地-project--worktrees')
    expect(basename(first.managedRoot)).toMatch(/^本地-project--[a-f0-9]{8}--worktree$/)
    expect(await context.module.inspect('session-1')).toMatchObject({ checkout: { kind: 'local' } })
    expect(git(context.repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all')).toBe('')

    context.addProject('target-workspace-1', 'Target Workspace', first.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1', '测试思路 (worktree)')
    const activated = await context.module.inspect('target-session-1')
    expect(activated).toMatchObject({
      checkout: { id: first.target.checkout.id, kind: 'isolated', phase: 'ready' },
      ownership: 'owner',
    })
  })

  test('Given the Local repository is nested inside another repository When creating a target Then fallback storage avoids polluting the outer repository', async () => {
    const context = createContext({ outerRepository: true })
    const statusBefore = git(context.root, 'status', '--porcelain=v1', '--untracked-files=all')

    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')

    expect(launch.managedRoot.startsWith(join(context.configDir, 'worktrees'))).toBe(true)
    expect(git(context.root, 'status', '--porcelain=v1', '--untracked-files=all')).toBe(statusBefore)
  })

  test('Given an eight-character checkout path already exists in the managed container When creating another target Then the Host extends the identity', async () => {
    const context = createContext({
      checkoutIds: [
        'aaaaaaaa-0000-4000-8000-000000000000', 'operation-1',
        'aaaaaaaa-1111-4111-8111-111111111111', 'operation-2',
      ],
    })
    const first = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    const second = await context.module.createIsolatedTarget('session-1', 'target-session-2')

    expect(basename(first.managedRoot)).toBe('本地-project--aaaaaaaa--worktree')
    expect(basename(second.managedRoot)).toBe('本地-project--aaaaaaaa1111--worktree')
    expect(existsSync(first.managedRoot)).toBe(true)
  })

  test('Given the sibling container has unknown content When creating a target Then the Host falls back without modifying it', async () => {
    const context = createContext()
    const siblingContainer = join(dirname(context.repositoryRoot), '本地-project--worktrees')
    mkdirSync(siblingContainer)
    writeFileSync(join(siblingContainer, 'unknown.txt'), 'foreign owner\n')

    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')

    expect(launch.managedRoot.startsWith(join(context.configDir, 'worktrees'))).toBe(true)
    expect(readFileSync(join(siblingContainer, 'unknown.txt'), 'utf8')).toBe('foreign owner\n')
  })

  test('Given the sibling container is a symlink When creating a target Then the Host uses plugin fallback without touching the link target', async () => {
    const context = createContext()
    const siblingContainer = join(dirname(context.repositoryRoot), '本地-project--worktrees')
    const foreign = join(context.root, 'foreign-worktrees')
    mkdirSync(foreign)
    writeFileSync(join(foreign, 'keep.txt'), 'foreign\n')
    symlinkSync(foreign, siblingContainer, process.platform === 'win32' ? 'junction' : 'dir')

    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')

    expect(launch.managedRoot.startsWith(join(context.configDir, 'worktrees'))).toBe(true)
    expect(readFileSync(join(foreign, 'keep.txt'), 'utf8')).toBe('foreign\n')
  })

  test('Given a reserved target session opens on another cwd When inspected Then identity validation fails closed', async () => {
    const context = createContext()
    await context.module.createIsolatedTarget('session-1', 'target-session-1')
    context.addProject('wrong-workspace', 'Wrong Workspace', context.projectRoot)
    context.addSession('target-session-1', 'wrong-workspace')

    await expect(context.module.inspect('target-session-1')).rejects.toMatchObject({ code: 'project_mismatch' })
  })

  test('Given a target is reserved and later becomes ready When runtime context is assembled Then Local and Isolated instructions remain distinct', async () => {
    const context = createContext()
    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    expect(context.module.runtimeContext('session-1')).toContain('handoff pending')
    expect(context.module.runtimeContext('session-1')).toContain('target-session-1')

    context.addProject('target-workspace-1', 'Target Workspace', launch.managedRoot)
    context.addSession('target-session-1', 'target-workspace-1')
    expect(context.module.runtimeContext('target-session-1')).toContain(`Authoritative cwd: ${launch.managedRoot}`)
    expect(context.module.runtimeContext('target-session-1')).toContain('worktree_ready_for_review')
    expect(context.module.runtimeContext('target-session-1')).toContain('Do not duplicate that report in ordinary assistant prose')

    writeFileSync(join(launch.managedRoot, 'tracked.txt'), 'ready\n')
    await context.module.markReadyForReview('target-session-1', {
      summary: 'ready context',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: ready context',
    })
    expect(context.module.runtimeContext('target-session-1')).toContain('Ready for Review')
    expect(context.module.runtimeContext('target-session-1')).toContain('only the user may preview, directly finish')
  })

  test('Given a source owns an unopened reservation When it removes the checkout Then no Host target Session is required', async () => {
    const context = createContext()
    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    const [summary] = await context.module.listManagedWorktreesForSession('session-1')

    const removed = await context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId: launch.target.checkout.id,
      expectedRevision: summary.revision,
      action: 'discard',
      confirmDirty: true,
    })

    expect(removed.phase).toBe('discarded')
    expect(existsSync(launch.managedRoot)).toBe(false)
    expect(context.module.runtimeContext('session-1')).toContain('No isolated target is active')
  })

  test('Given the reserved owner Session is live When Local source tries management Then owner takeover fails closed', async () => {
    const context = createContext()
    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    context.addSession('target-session-1', 'project-1', 'Live owner')
    const [summary] = await context.module.listManagedWorktreesForSession('session-1')

    await expect(context.module.manageManagedWorktreeForSession('session-1', {
      checkoutId: launch.target.checkout.id,
      expectedRevision: summary.revision,
      action: 'discard',
      confirmDirty: true,
    })).rejects.toMatchObject({ code: 'not_owner' })
    expect(existsSync(launch.managedRoot)).toBe(true)
  })

  test('Given another session in the same project When it lists or manages a checkout Then persisted owner ids do not authorize it', async () => {
    const context = createContext()
    const launch = await context.module.createIsolatedTarget('session-1', 'target-session-1')
    context.addSession('intruder-session', 'project-1')

    expect(await context.module.listManagedWorktreesForSession('intruder-session')).toEqual([])
    const [owned] = await context.module.listManagedWorktreesForSession('session-1')
    expect(owned.checkoutId).toBe(launch.target.checkout.id)
    await expect(context.module.manageManagedWorktreeForSession('intruder-session', {
      checkoutId: owned.checkoutId,
      expectedRevision: owned.revision,
      action: 'discard',
      confirmDirty: true,
    })).rejects.toMatchObject({ code: 'not_owner' })
  })

  test('Given a reviewed Worktree changes after Ready When strict Finish is requested Then unreviewed bytes never reach Local', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'reviewed\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'reviewed snapshot',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: reviewed snapshot',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected review')
    writeFileSync(join(managedRoot, 'tracked.txt'), 'unreviewed\n')

    const result = await context.module.operate({
      action: 'finish',
      sessionId: 'session-1',
      expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId,
      commitMessage: ready.delivery.review.suggestedCommitMessage,
    })

    expect(result).toMatchObject({ status: 'error', code: 'stale_isolated' })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect((await context.module.inspect('session-1')).delivery).toMatchObject({ state: 'working' })
  })

  test('Given a Ready Worktree When the user skips Local review Then receipt-first direct Finish creates exactly one task Commit', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'direct finish task\n')
    writeFileSync(join(context.projectRoot, 'local-note.txt'), 'keep local note\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'direct finish', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: direct finish',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    const before = git(context.projectRoot, 'rev-parse', 'HEAD')

    const finished = await context.module.operate({
      action: 'finish', sessionId: 'session-1', expectedRevision: ready.revision,
      expectedReviewId: ready.delivery.review.reviewId, commitMessage: 'test: direct finish', retention: 'retain_manual',
    })

    expect(finished).toMatchObject({ status: 'finished', cleanup: 'retained', target: { delivery: { state: 'retained' } } })
    expect(git(context.projectRoot, 'rev-list', '--count', `${before}..HEAD`)).toBe('1')
    expect(git(context.projectRoot, 'show', '-s', '--format=%s', 'HEAD')).toBe('test: direct finish')
    expect(git(context.projectRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(readFileSync(join(context.projectRoot, 'local-note.txt'), 'utf8')).toBe('keep local note\n')
  })

  test('Given a Ready Worktree When the owner withdraws Preview Then Local is restored and the Worktree resumes editing', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview task\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'preview review', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: preview review',
    })
    if (ready.delivery?.state !== 'ready_for_review') throw new Error('expected ready review')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })

    expect(preview).toMatchObject({ status: 'previewed', target: { delivery: { state: 'preview_active' } } })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('preview task\n')
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(context.module.runtimeContext('session-1')).toContain('Local Preview active')

    const rolledBack = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview.target.revision, resumeRevision: true,
    })

    expect(rolledBack).toMatchObject({
      status: 'preview_rolled_back',
      target: { delivery: { state: 'working', iteration: ready.delivery.review.iteration } },
    })
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given a Local Preview is accepted When the owner finalizes Then only the task becomes one retained Commit', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'accepted preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'accepted preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: accepted preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    writeFileSync(join(context.projectRoot, 'review-note.txt'), 'keep local review work\n')

    const finalized = await context.module.operate({
      action: 'finalize_preview',
      sessionId: 'session-1',
      expectedRevision: preview.target.revision,
      commitMessage: 'test: accepted preview',
      retention: 'retain_manual',
    })

    expect(finalized).toMatchObject({ status: 'finished', cleanup: 'retained', target: { delivery: { state: 'retained' } } })
    expect(git(context.projectRoot, 'show', '-s', '--format=%s', 'HEAD')).toBe('test: accepted preview')
    expect(git(context.projectRoot, 'show', '--format=', '--name-only', 'HEAD')).toBe('tracked.txt')
    expect(readFileSync(join(context.projectRoot, 'review-note.txt'), 'utf8')).toBe('keep local review work\n')
  })

  test('Given Preview is active When the user abandons the task Then Discard rolls Local back before removing the Worktree', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'abandoned preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'abandon preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: abandon preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('abandoned preview\n')

    const discarded = await context.module.operate({
      action: 'discard', sessionId: 'session-1', expectedRevision: preview.target.revision,
      confirmDirty: true, rollbackPreview: true,
    })

    expect(discarded.status).toBe('discarded')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(existsSync(managedRoot)).toBe(false)
  })

  test('Given a detached Preview and Local only fast-forwarded with disjoint content When rollback is retried Then it preserves the new commit and resumes the Worktree', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview after fast-forward\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'fast-forward recovery', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: fast-forward recovery',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    writeFileSync(join(context.projectRoot, 'external-commit.txt'), 'new Local commit\n')
    git(context.projectRoot, 'add', 'external-commit.txt')
    git(context.projectRoot, 'commit', '--only', 'external-commit.txt', '-m', 'external fast-forward')
    const advancedHead = git(context.projectRoot, 'rev-parse', 'HEAD')

    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[target.checkout.id]
    const previewId = record.delivery.preview.previewId as string
    record.delivery = {
      ...record.delivery,
      state: 'preview_detached',
      detachedAt: Date.now(),
      reason: 'stale_local',
      attemptedAction: 'rollback_preview',
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    const detached = await restarted.inspect('session-1')
    expect(detached.delivery).toMatchObject({ state: 'preview_detached', reason: 'stale_local' })
    const rolledBack = await restarted.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: detached.revision, resumeRevision: true,
    })

    expect(rolledBack).toMatchObject({ status: 'preview_rolled_back', target: { delivery: { state: 'working' } } })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(advancedHead)
    expect(git(context.projectRoot, 'show', 'HEAD:external-commit.txt')).toBe('new Local commit')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').replace(/\r\n/g, '\n')).toBe('base\n')
    expect(git(context.projectRoot, 'for-each-ref', '--format=%(refname)', 'refs/dsh-worktree/session-checkouts')).not.toContain(previewId)
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given Local commits the Preview bytes When rollback is requested Then it fails closed, preserves committed history and releases the acceptance slot', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'preview becomes stale\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'stale preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: stale preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    git(context.projectRoot, 'add', 'tracked.txt')
    git(context.projectRoot, 'commit', '-m', 'local advanced during preview')
    const localHead = git(context.projectRoot, 'rev-parse', 'HEAD')
    const localBytes = readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')

    const detached = await context.module.operate({
      action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview.target.revision,
    })

    expect(detached).toMatchObject({
      status: 'preview_detached', reason: 'preview_modified', attemptedAction: 'rollback_preview',
      target: { delivery: { state: 'preview_detached' } },
    })
    expect(git(context.projectRoot, 'rev-parse', 'HEAD')).toBe(localHead)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
    if (detached.status !== 'preview_detached') throw new Error(`expected detached, got ${detached.status}`)
    const discard = await context.module.operate({
      action: 'discard', sessionId: 'session-1', expectedRevision: detached.target.revision,
      confirmDirty: true, rollbackPreview: true,
    })
    expect(discard).toMatchObject({ status: 'error', code: 'preview_modified' })
    expect(existsSync(managedRoot)).toBe(true)
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8')).toBe(localBytes)
  })

  test('Given one Worktree owns the Local Preview When another target requests acceptance Then it waits until rollback releases the project slot', async () => {
    const context = createContext()
    context.addSession('session-2', 'project-1', 'Second owner')
    context.addSession('local-observer', 'project-1', 'Local observer')
    await context.module.bind('local-observer', { kind: 'local' })
    const first = await context.module.bind('session-1', { kind: 'isolated' })
    const second = await context.module.bind('session-2', { kind: 'isolated' })
    const firstRoot = await context.module.resolveManagedRoot(first.checkout.id)
    const secondRoot = await context.module.resolveManagedRoot(second.checkout.id)
    writeFileSync(join(firstRoot, 'tracked.txt'), 'first preview\n')
    writeFileSync(join(secondRoot, 'tracked.txt'), 'second preview\n')
    const ready1 = await context.module.markReadyForReview('session-1', {
      summary: 'first', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: first',
    })
    const ready2 = await context.module.markReadyForReview('session-2', {
      summary: 'second', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: second',
    })
    const preview1 = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready1.revision })
    if (preview1.status !== 'previewed') throw new Error(`expected previewed, got ${preview1.status}`)
    expect(context.module.runtimeContext('local-observer')).toContain('Worktree Preview active')

    const waiting = await context.module.inspect('session-2')
    expect(waiting).toMatchObject({ reviewSlot: 'waiting', reviewSlotOwnerSessionId: 'session-1' })
    expect(await context.module.preflight?.('session-2', waiting.revision)).toMatchObject({ status: 'blocked', reason: 'project_acceptance_busy' })
    expect(await context.module.operate({ action: 'preview', sessionId: 'session-2', expectedRevision: waiting.revision })).toMatchObject({
      status: 'error', code: 'project_acceptance_busy',
    })

    await context.module.operate({ action: 'rollback_preview', sessionId: 'session-1', expectedRevision: preview1.target.revision })
    const available = await context.module.inspect('session-2')
    expect(available.reviewSlot).toBe('available')
    expect((await context.module.operate({ action: 'preview', sessionId: 'session-2', expectedRevision: available.revision })).status).toBe('previewed')
  })

  test('Given a legacy Apply already wrote Local When Finish or Discard is requested Then the module fails closed', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'applied change\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'legacy apply',
      validationStatus: 'passed',
      tests: [],
      suggestedCommitMessage: 'test: legacy apply',
    })
    const applied = await context.module.operate({
      action: 'apply',
      sessionId: 'session-1',
      expectedRevision: ready.revision,
    })
    expect(applied.status).toBe('applied')
    const afterApply = await context.module.inspect('session-1')

    const finish = await context.module.operate({
      action: 'finish',
      sessionId: 'session-1',
      expectedRevision: afterApply.revision,
      commitMessage: 'must not commit zero delta',
    })
    expect(finish).toMatchObject({ status: 'error', code: 'operation_not_allowed' })
    const discard = await context.module.operate({
      action: 'discard',
      sessionId: 'session-1',
      expectedRevision: afterApply.revision,
      confirmDirty: true,
    })
    expect(discard).toMatchObject({ status: 'error', code: 'operation_not_allowed' })
    expect(git(context.repositoryRoot, 'status', '--porcelain=v1')).toContain('M tracked.txt')
  })

  test('Given worktree add 残余包含未知文件 When 创建 Isolated Then fail closed 并保留恢复现场', async () => {
    const context = createContext({ createWorktreeFailures: 1, createWorktreeFailureLeavesFile: true })

    await expect(context.module.bind('session-1', { kind: 'isolated' })).rejects.toMatchObject({ code: 'recovery_required' })
    const target = await context.module.inspect('session-1')

    expect(target.checkout.phase).toBe('recovery_required')
    expect(target.dirty).toBe(true)
    expect(context.getCreateWorktreeCallCount()).toBe(1)
  })












  test('Given 会话已经选择 Isolated When 重复同一选择 Then 返回同一个 checkout', async () => {
    const context = createContext()
    const first = await context.module.bind('session-1', { kind: 'isolated' })

    const second = await context.module.bind('session-1', { kind: 'isolated' })

    expect(second.checkout.id).toBe(first.checkout.id)
  })

  test('Given 同一会话并发提交相同选择 When 绑定 Isolated Then 只产生一个 checkout 身份', async () => {
    const context = createContext()

    const [first, second] = await Promise.all([
      context.module.bind('session-1', { kind: 'isolated' }),
      context.module.bind('session-1', { kind: 'isolated' }),
    ])

    expect(second.checkout.id).toBe(first.checkout.id)
  })

  test('Given 会话已经选择 Local When 尝试改绑 Isolated Then 拒绝切换', async () => {
    const context = createContext()
    await context.module.bind('session-1', { kind: 'local' })

    const rebind = context.module.bind('session-1', { kind: 'isolated' })

    await expect(rebind).rejects.toMatchObject({ code: 'target_already_bound' })
  })





  test('Given 项目不是 Git 仓库 When 选择 Isolated Then fail closed', async () => {
    const context = createContext()
    rmSync(join(context.repositoryRoot, '.git'), { recursive: true, force: true })

    const binding = context.module.bind('session-1', { kind: 'isolated' })

    await expect(binding).rejects.toMatchObject({ code: 'not_git_repository' })
  })

  test('Given 旧 ready inspect 被可控 deferred 暂停 When owner 并发 Discard Then inspect 与 Discard 串行且 discarded 不会被旧结果覆盖', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const pause = context.pauseNextGitInspect()
    const staleInspect = context.module.inspect('session-1')
    await pause.started

    const discard = context.module.operate({
      action: 'discard',
      sessionId: 'session-1',
      expectedRevision: target.revision,
      confirmDirty: false,
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    try {
      expect(context.getRemoveWorktreeCallCount()).toBe(0)
    } finally {
      pause.resume()
    }
    const [, discarded] = await Promise.all([staleInspect, discard])
    const final = await context.module.inspect('session-1')

    expect(discarded).toMatchObject({ status: 'discarded' })
    expect(final.checkout.phase).toBe('discarded')
    if (discarded.status !== 'discarded') throw new Error(`预期 discarded，实际为 ${discarded.status}`)
    expect(final.revision).toBe(discarded.target.revision)
  }, 15_000)

  test('Given a valid v1 managed checkout registry When the module restarts Then it migrates to v2 without losing the checkout identity', async () => {
    const context = createContext()
    const original = await context.module.bind('session-1', { kind: 'isolated' })
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as {
      version: number
      managedCheckouts: Record<string, Record<string, unknown>>
    }
    registry.version = 1
    for (const record of Object.values(registry.managedCheckouts)) delete record.delivery
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const migrated = await context.restart().inspect('session-1')
    const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as { version: number }

    expect(migrated.checkout.id).toBe(original.checkout.id)
    expect(migrated.checkout.phase).toBe('ready')
    expect(migrated.delivery).toEqual({ state: 'working', iteration: 1 })
    expect(persisted.version).toBe(2)
  })










  test('Given preparing journal 且 worktree 已完整创建 When 重启后 Recover Then 恢复 ready 而不覆盖文件', async () => {
    const context = createContext({ crashAfterWorktreeCreate: true })
    await expect(context.module.bind('session-1', { kind: 'isolated' }))
      .rejects.toThrow('模拟 create 落盘后的进程崩溃')
    const restarted = context.restart()
    const recovery = await restarted.inspect('session-1')

    const result = await restarted.operate({
      action: 'recover',
      sessionId: 'session-1',
      expectedRevision: recovery.revision,
    })

    expect(result.status).toBe('recovered')
    if (result.status !== 'recovered') throw new Error(`预期 recovered，实际为 ${result.status}`)
    expect(result.target.checkout.phase).toBe('ready')
    expect(git(context.repositoryRoot, 'worktree', 'list', '--porcelain')).toContain('-worktrees/')
  })



















































  test('Given process restarts after Preview artifacts were retained When reconcile runs Then receipt survives and Preview remains safely withdrawable', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'crash preview\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'crash preview', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: crash preview',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[preview.target.checkout.id]
    record.phase = 'mutating'
    record.journal = {
      operation: 'preview', operationId: 'crash-preview', step: 'artifacts_retained', startedAt: Date.now(),
      previewId: record.delivery.preview.previewId, reviewId: record.delivery.review.reviewId,
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    await restarted.reconcile()
    const recovered = await restarted.inspect('session-1')
    expect(recovered).toMatchObject({ checkout: { phase: 'ready' }, delivery: { state: 'preview_active' } })
    const rollback = await restarted.operate({ action: 'rollback_preview', sessionId: 'session-1', expectedRevision: recovered.revision })
    expect(rollback.status).toBe('preview_rolled_back')
    expect(readFileSync(join(context.projectRoot, 'tracked.txt'), 'utf8').trim()).toBe('base')
  })

  test('Given process restarts after branch CAS but before Finalize registry update When reconcile runs Then it records the real Commit and preserves the Worktree', async () => {
    const context = createContext()
    const target = await context.module.bind('session-1', { kind: 'isolated' })
    const managedRoot = await context.module.resolveManagedRoot(target.checkout.id)
    writeFileSync(join(managedRoot, 'tracked.txt'), 'crash finalize\n')
    const ready = await context.module.markReadyForReview('session-1', {
      summary: 'crash finalize', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: crash finalize',
    })
    const preview = await context.module.operate({ action: 'preview', sessionId: 'session-1', expectedRevision: ready.revision })
    if (preview.status !== 'previewed') throw new Error(`expected previewed, got ${preview.status}`)
    git(context.projectRoot, 'add', 'tracked.txt')
    git(context.projectRoot, 'commit', '-m', 'test: crash finalize')
    const commitOid = git(context.projectRoot, 'rev-parse', 'HEAD')
    const registryPath = join(context.configDir, 'managed-checkouts.json')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as any
    const record = registry.managedCheckouts[preview.target.checkout.id]
    record.phase = 'mutating'
    record.journal = {
      operation: 'finalize_preview', operationId: 'crash-finalize', step: 'updating_ref', startedAt: Date.now(),
      previewId: record.delivery.preview.previewId, reviewId: record.delivery.review.reviewId, commitOid,
    }
    record.revision += 1
    registry.revision += 1
    writeFileSync(registryPath, JSON.stringify(registry, null, 2))

    const restarted = context.restart()
    await restarted.reconcile()
    const recovered = await restarted.inspect('session-1')
    expect(recovered).toMatchObject({ checkout: { phase: 'finalized' }, delivery: { state: 'finalized', commitOid, cleanup: 'blocked' } })
    expect(existsSync(managedRoot)).toBe(true)
  })

  test('Given Apply engine detects stale Local When module returns operation result Then stale_local remains stable for renderer recompute guidance', async () => {
    const staleEngine: SessionCheckoutApplyEngine = {
      inspectReview: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      preflight: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      plan: async () => ({
        status: 'ready',
        plan: {
          revision: 'plan-1',
          localFingerprint: 'local-1',
          isolatedFingerprint: 'isolated-1',
          effectiveBaseOid: 'a'.repeat(40),
          baseStrategy: 'recorded_base',
          localHeadOid: 'b'.repeat(40),
          localHeadRef: 'refs/heads/main',
          isolatedHeadOid: 'c'.repeat(40),
          changedFiles: ['tracked.txt'],
        },
      }),
      apply: async () => ({
        status: 'error',
        error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' },
      }),
      finish: async () => ({
        status: 'error',
        error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' },
      }),
      preview: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      rollback: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
      finalize: async () => ({ status: 'error', error: { code: 'stale_local', message: '不会执行' } }),
    }
    const context = createContext({ applyEngine: staleEngine })
    const target = await context.module.bind('session-1', { kind: 'isolated' })

    const result = await context.module.operate({
      action: 'apply',
      sessionId: 'session-1',
      expectedRevision: target.revision,
    })

    expect(result).toMatchObject({
      status: 'error',
      code: 'stale_local',
      target: { checkout: { phase: 'ready' } },
    })
  })











})
