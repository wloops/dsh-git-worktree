import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs'
import { lstat, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { readJsonFileSafe, writeJsonFileAtomic } from '../../src/adapters/safe-file.js'
import { SessionCheckoutError } from '../../src/index.js'
import { createSessionCheckoutApplyEngine } from '../../src/session-checkout-apply.ts'
import type {
  DirectoryIdentity,
  GitCheckoutSnapshot,
  ManagedCheckoutsRegistry,
  SessionCheckoutDependencies,
  SessionCheckoutLookupPort,
  SessionCheckoutRegistryPort,
} from '../../src/ports.js'

/** Domi 宿主审计事件的测试替身；插件版没有审计管线，仅测试基建保留。 */
export interface SessionCheckoutTimingEvent {
  phase: 'worktree_create' | 'checkout_bind'
  sessionId: string
  iteration: number
  attempt: number
  outcome: 'success' | 'error'
  timestamp: string
  durationMs: number
}

interface NodeSessionCheckoutOptions {
  configDir: string
  lookup: SessionCheckoutLookupPort
  onTimingEvent?: (event: SessionCheckoutTimingEvent) => void | Promise<void>
}

interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
}

interface GitCommandOptions {
  hooksPath: string
}

/**
 * Git 子进程超时。普通命令保持 10 秒；删除含大型私有依赖的 managed Worktree
 * 使用单独的 5 分钟硬上限，避免 Windows 正常清理被误杀，同时仍防止无限挂起。
 */
const GIT_COMMAND_TIMEOUT_MS = 10_000
const WORKTREE_REMOVE_TIMEOUT_MS = 5 * 60_000

/** Windows 删除约 1GB / 6 万文件的私有依赖树时，10 秒不足以完成正常 Worktree 清理。 */
export function getSessionCheckoutGitTimeoutMs(args: readonly string[]): number {
  return args[0] === 'worktree' && args[1] === 'remove'
    ? WORKTREE_REMOVE_TIMEOUT_MS
    : GIT_COMMAND_TIMEOUT_MS
}

async function measureDirectoryBytes(path: string): Promise<number> {
  if (!existsSync(path)) return 0
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) return 0
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const entry of await readdir(path)) total += await measureDirectoryBytes(join(path, entry))
  return total
}

function removeEmptyDirectoryTree(path: string): boolean {
  if (!existsSync(path)) return true
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false
  for (const entry of readdirSync(path)) {
    if (!removeEmptyDirectoryTree(join(path, entry))) return false
  }
  rmdirSync(path)
  return true
}

async function inspectDirectoryIdentity(path: string): Promise<DirectoryIdentity | null> {
  if (!existsSync(path)) return null
  const stat = await lstat(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) return null
  return {
    device: stat.dev.toString(),
    inode: stat.ino.toString(),
    birthtimeNs: stat.birthtimeNs.toString(),
  }
}

function directoryIdentitiesEqual(left: DirectoryIdentity, right: DirectoryIdentity): boolean {
  return left.device === right.device && left.inode === right.inode && left.birthtimeNs === right.birthtimeNs
}

async function quarantineDirectoryTree(
  path: string,
  expectedIdentity: DirectoryIdentity,
  quarantinePath: string,
): Promise<void> {
  const sourceParent = resolve(dirname(path))
  const quarantineParent = resolve(dirname(quarantinePath))
  const sameParent = process.platform === 'win32'
    ? sourceParent.toLowerCase() === quarantineParent.toLowerCase()
    : sourceParent === quarantineParent
  if (!sameParent || existsSync(quarantinePath)) {
    throw new SessionCheckoutError('checkout_mismatch', 'Worktree quarantine 路径无效或已被占用')
  }
  await rename(path, quarantinePath)
  const actualIdentity = await inspectDirectoryIdentity(quarantinePath)
  if (actualIdentity && directoryIdentitiesEqual(actualIdentity, expectedIdentity)) return
  if (!existsSync(path)) {
    try { await rename(quarantinePath, path) } catch { /* 保留 quarantine，绝不删除身份不符对象。 */ }
  }
  throw new SessionCheckoutError('checkout_mismatch', 'Worktree 目录对象已被替换，未执行递归清理')
}

async function removeDirectoryTree(path: string): Promise<void> {
  if (!existsSync(path)) return
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new SessionCheckoutError('checkout_mismatch', '拒绝删除非目录或符号链接形式的 Worktree 残余')
  }
  await rm(path, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 6 : 2,
    retryDelay: 150,
  })
}

function runGit(cwd: string, args: string[], options: GitCommandOptions): Promise<GitCommandResult> {
  const timeoutMs = getSessionCheckoutGitTimeoutMs(args)
  return new Promise((resolveCommand) => {
    let settled = false
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn('git', [
        '--no-pager',
        '--no-optional-locks',
        '-c',
        'core.quotePath=false',
        '-c',
        'core.fsmonitor=false',
        '-c',
        `core.hooksPath=${options.hooksPath}`,
        ...args,
      ], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          GIT_TERMINAL_PROMPT: '0',
          LC_ALL: 'C',
          LANG: 'C',
        },
        windowsHide: true,
      })
    } catch (error) {
      // 同步 spawn 失败（如 git 不在 PATH）：按命令失败返回，不抛异常。
      resolveCommand({ code: -1, stdout: '', stderr: error instanceof Error ? error.message : String(error) })
      return
    }
    child.stdout.setEncoding('utf-8')
    child.stderr.setEncoding('utf-8')
    let stdout = ''
    let stderr = ''
    const finish = (result: GitCommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolveCommand(result)
    }
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.once('error', (error) => {
      finish({ code: -1, stdout, stderr: error.message })
    })
    child.once('close', (code) => {
      finish({ code: code ?? -1, stdout: stdout.trim(), stderr: stderr.trim() })
    })
    // 超时保护：git 卡死（如 Worktree 被占用）时强杀进程并以失败返回，避免会话检查永久挂起。
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // 进程可能已退出，忽略
      }
      finish({ code: -1, stdout, stderr: `git ${args.join(' ')} 超时（${timeoutMs}ms），已终止` })
    }, timeoutMs)
    timeout.unref?.()
  })
}

async function runGitChecked(cwd: string, args: string[], options: GitCommandOptions): Promise<string> {
  const result = await runGit(cwd, args, options)
  if (result.code !== 0) {
    throw new SessionCheckoutError(
      'git_operation_failed',
      `Git 操作失败: git ${args.join(' ')}${result.stderr ? `: ${result.stderr}` : ''}`,
    )
  }
  return result.stdout
}

function checkoutRefRoot(checkoutId: string): string {
  const key = createHash('sha256').update(checkoutId).digest('hex').slice(0, 24)
  return `refs/dsh-worktree/session-checkouts/${key}`
}

function assertArtifactName(artifactName: string): void {
  const segments = artifactName.split('/')
  if (
    segments.length === 0
    || segments.some((segment) => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  ) {
    throw new SessionCheckoutError('invalid_input', '内部 Git artifact 名称无效')
  }
}

function internalArtifactRef(checkoutId: string, artifactName: string): string {
  assertArtifactName(artifactName)
  return `${checkoutRefRoot(checkoutId)}/${artifactName}`
}

function applyBaseRef(checkoutId: string): string {
  return internalArtifactRef(checkoutId, 'apply-base')
}

function emptyRegistry(): ManagedCheckoutsRegistry {
  return {
    version: 2,
    revision: 0,
    sessionBindings: {},
    managedCheckouts: {},
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isTargetRef(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  return value.kind === 'unselected'
    || value.kind === 'local'
    || (value.kind === 'isolated' && typeof value.checkoutId === 'string')
}

function isSessionBinding(value: unknown): boolean {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.projectId === 'string'
    && typeof value.projectName === 'string'
    && isTargetRef(value.target)
    && typeof value.ownerSessionId === 'string'
    && typeof value.sourceRef === 'string'
    && typeof value.sourceOid === 'string'
    && typeof value.revision === 'number'
}

function isReview(value: unknown): boolean {
  return isRecord(value)
    && typeof value.reviewId === 'string'
    && typeof value.iteration === 'number'
    && typeof value.preparedAt === 'number'
    && (value.detailsMarkdown === undefined || typeof value.detailsMarkdown === 'string')
    && typeof value.summary === 'string'
    && (value.validationStatus === 'passed' || value.validationStatus === 'failed' || value.validationStatus === 'partial' || value.validationStatus === 'not_run')
    && (value.validationSummary === undefined || typeof value.validationSummary === 'string')
    && Array.isArray(value.tests)
    && value.tests.every((test) => isRecord(test)
      && typeof test.command === 'string'
      && (test.status === 'passed' || test.status === 'failed' || test.status === 'not_run')
      && (test.summary === undefined || typeof test.summary === 'string'))
    && isStringArray(value.changedFiles)
    && typeof value.suggestedCommitMessage === 'string'
    && typeof value.isolatedFingerprint === 'string'
    && typeof value.isolatedHeadOid === 'string'
}

function isPreviewReceipt(value: unknown): boolean {
  return isRecord(value)
    && typeof value.previewId === 'string'
    && typeof value.reviewId === 'string'
    && typeof value.iteration === 'number'
    && typeof value.previewedAt === 'number'
    && typeof value.configuredBaseOid === 'string'
    && typeof value.effectiveBaseOid === 'string'
    && (value.baseStrategy === 'recorded_base' || value.baseStrategy === 'isolated_contains_local_head' || value.baseStrategy === 'local_contains_isolated_head')
    && typeof value.localHeadOid === 'string'
    && (value.localHeadRef === null || typeof value.localHeadRef === 'string')
    && typeof value.localFingerprintBefore === 'string'
    && typeof value.localFingerprintPreview === 'string'
    && typeof value.localWorkingTreeOid === 'string'
    && typeof value.localIndexTreeOid === 'string'
    && typeof value.previewWorkingTreeOid === 'string'
    && typeof value.isolatedHeadOid === 'string'
    && typeof value.isolatedFingerprint === 'string'
    && typeof value.isolatedSnapshotOid === 'string'
    && isStringArray(value.changedFiles)
}

function isDeliveryProof(value: unknown): boolean {
  return isRecord(value)
    && (value.localBranch === null || typeof value.localBranch === 'string')
    && typeof value.localHeadBefore === 'string'
    && typeof value.localHeadAfter === 'string'
    && isStringArray(value.changedFiles)
}

function isDelivery(value: unknown): boolean {
  if (!isRecord(value) || typeof value.state !== 'string') return false
  if (value.state === 'working') return typeof value.iteration === 'number'
  if (value.state === 'ready_for_review') return isReview(value.review)
  if (value.state === 'preview_active') return isReview(value.review) && isPreviewReceipt(value.preview)
  if (value.state === 'preview_detached') {
    return isReview(value.review)
      && isPreviewReceipt(value.preview)
      && typeof value.detachedAt === 'number'
      && (value.reason === 'stale_local' || value.reason === 'preview_modified')
      && (value.attemptedAction === 'rollback_preview' || value.attemptedAction === 'finalize_preview' || value.attemptedAction === 'discard')
  }
  if (value.state === 'finalized') {
    return isReview(value.review)
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.isolatedFingerprint === 'string'
      && typeof value.finalizedAt === 'number'
      && (value.cleanup === 'pending' || value.cleanup === 'blocked')
      && (value.cleanupMessage === undefined || typeof value.cleanupMessage === 'string')
  }
  if (value.state === 'retained') {
    return isReview(value.review)
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.isolatedFingerprint === 'string'
      && (value.retention === 'retain_24h' || value.retention === 'retain_3d' || value.retention === 'retain_manual')
      && typeof value.retainedAt === 'number'
      && (value.expiresAt === null || typeof value.expiresAt === 'number')
      && (value.cleanup === 'scheduled' || value.cleanup === 'blocked')
      && (value.cleanupMessage === undefined || typeof value.cleanupMessage === 'string')
  }
  if (value.state === 'delivered') {
    return typeof value.iteration === 'number'
      && (value.commitOid === null || typeof value.commitOid === 'string')
      && (value.proof === undefined || isDeliveryProof(value.proof))
      && typeof value.deliveredAt === 'number'
  }
  return false
}

function isJournal(value: unknown): boolean {
  if (value === null) return true
  if (
    !isRecord(value)
    || typeof value.operationId !== 'string'
    || typeof value.step !== 'string'
    || typeof value.startedAt !== 'number'
  ) return false
  if (value.operation === 'create') return value.step === 'creating_worktree'
  const validOperation = value.operation === 'apply'
    || value.operation === 'preview'
    || value.operation === 'rollback_preview'
    || value.operation === 'finish'
    || value.operation === 'finalize_preview'
    || value.operation === 'cleanup'
  const validStep = value.step === 'planning'
    || value.step === 'artifacts_retained'
    || value.step === 'writing_local'
    || value.step === 'updating_ref'
    || value.step === 'replacing_index'
    || value.step === 'removing_worktree'
  return validOperation
    && validStep
    && (value.baseOid === undefined || typeof value.baseOid === 'string')
    && (value.planRevision === undefined || typeof value.planRevision === 'string')
    && (value.previewId === undefined || typeof value.previewId === 'string')
    && (value.reviewId === undefined || typeof value.reviewId === 'string')
    && (value.localFingerprint === undefined || typeof value.localFingerprint === 'string')
    && (value.isolatedFingerprint === undefined || typeof value.isolatedFingerprint === 'string')
    && (value.effectiveBaseOid === undefined || typeof value.effectiveBaseOid === 'string')
    && (value.baseStrategy === undefined || value.baseStrategy === 'recorded_base' || value.baseStrategy === 'isolated_contains_local_head' || value.baseStrategy === 'local_contains_isolated_head')
    && (value.localHeadOid === undefined || typeof value.localHeadOid === 'string')
    && (value.isolatedHeadOid === undefined || typeof value.isolatedHeadOid === 'string')
    && (value.commitOid === undefined || typeof value.commitOid === 'string')
    && (value.retention === undefined || value.retention === 'cleanup' || value.retention === 'retain_24h' || value.retention === 'retain_3d' || value.retention === 'retain_manual')
    && (value.resumeRevision === undefined || typeof value.resumeRevision === 'boolean')
    && (value.changedFiles === undefined || isStringArray(value.changedFiles))
}

function isManagedCheckout(value: unknown): boolean {
  return isRecord(value)
    && typeof value.checkoutId === 'string'
    && typeof value.projectId === 'string'
    && typeof value.projectName === 'string'
    && typeof value.ownerSessionId === 'string'
    && typeof value.localRoot === 'string'
    && typeof value.managedRoot === 'string'
    && typeof value.managedGitRoot === 'string'
    && typeof value.gitCommonDir === 'string'
    && typeof value.gitDir === 'string'
    && typeof value.baseOid === 'string'
    && (value.applyBaseOid === undefined || typeof value.applyBaseOid === 'string')
    && typeof value.sourceRef === 'string'
    && (value.phase === 'preparing' || value.phase === 'ready' || value.phase === 'mutating' || value.phase === 'recovery_required' || value.phase === 'finalized' || value.phase === 'retained' || value.phase === 'discarded')
    && isDelivery(value.delivery)
    && isJournal(value.journal)
    && typeof value.revision === 'number'
}

function isRegistry(value: unknown): value is ManagedCheckoutsRegistry {
  if (
    !isRecord(value)
    || value.version !== 2
    || typeof value.revision !== 'number'
    || !isRecord(value.sessionBindings)
    || !isRecord(value.managedCheckouts)
  ) return false
  return Object.values(value.sessionBindings).every(isSessionBinding)
    && Object.values(value.managedCheckouts).every(isManagedCheckout)
}

function migrateLegacyRegistry(value: unknown): ManagedCheckoutsRegistry | null {
  if (
    !isRecord(value)
    || value.version !== 1
    || typeof value.revision !== 'number'
    || !isRecord(value.sessionBindings)
    || !isRecord(value.managedCheckouts)
    || !Object.values(value.sessionBindings).every(isSessionBinding)
  ) return null
  const managedCheckouts: ManagedCheckoutsRegistry['managedCheckouts'] = {}
  for (const [checkoutId, raw] of Object.entries(value.managedCheckouts)) {
    if (
      !isRecord(raw)
      || typeof raw.checkoutId !== 'string'
      || typeof raw.projectId !== 'string'
      || typeof raw.projectName !== 'string'
      || typeof raw.ownerSessionId !== 'string'
      || typeof raw.localRoot !== 'string'
      || typeof raw.managedRoot !== 'string'
      || typeof raw.managedGitRoot !== 'string'
      || typeof raw.gitCommonDir !== 'string'
      || typeof raw.gitDir !== 'string'
      || typeof raw.baseOid !== 'string'
      || typeof raw.sourceRef !== 'string'
      || typeof raw.revision !== 'number'
    ) return null
    const legacyPhase = raw.phase
    const phase = legacyPhase === 'ready' || legacyPhase === 'discarded'
      ? legacyPhase
      : 'recovery_required'
    managedCheckouts[checkoutId] = {
      checkoutId: raw.checkoutId,
      projectId: raw.projectId,
      projectName: raw.projectName,
      ownerSessionId: raw.ownerSessionId,
      localRoot: raw.localRoot,
      managedRoot: raw.managedRoot,
      managedGitRoot: raw.managedGitRoot,
      gitCommonDir: raw.gitCommonDir,
      gitDir: raw.gitDir,
      baseOid: raw.baseOid,
      ...(typeof raw.applyBaseOid === 'string' ? { applyBaseOid: raw.applyBaseOid } : {}),
      sourceRef: raw.sourceRef,
      phase,
      delivery: { state: 'working', iteration: 1 },
      journal: null,
      revision: raw.revision + (phase === legacyPhase ? 0 : 1),
    }
  }
  return {
    version: 2,
    revision: value.revision + 1,
    sessionBindings: value.sessionBindings as ManagedCheckoutsRegistry['sessionBindings'],
    managedCheckouts,
  }
}

class AtomicJsonCheckoutRegistry implements SessionCheckoutRegistryPort {
  constructor(private readonly path: string) {}

  read(): ManagedCheckoutsRegistry {
    const value = readJsonFileSafe<unknown>(this.path)
    if (value && isRegistry(value)) return value
    const migrated = migrateLegacyRegistry(value)
    if (migrated) {
      this.write(migrated)
      return migrated
    }
    if (!existsSync(this.path)) return emptyRegistry()
    throw new SessionCheckoutError('registry_corrupt', 'managed-checkouts.json 损坏，已停止访问 checkout')
  }

  write(registry: ManagedCheckoutsRegistry): void {
    mkdirSync(dirname(this.path), { recursive: true })
    writeJsonFileAtomic(this.path, registry)
  }
}

export function createNodeSessionCheckoutDependencies(
  options: NodeSessionCheckoutOptions,
): SessionCheckoutDependencies {
  const managedCheckoutsRoot = join(options.configDir, 'worktrees')
  const disabledGitHooksRoot = join(options.configDir, 'disabled-git-hooks', randomUUID())
  mkdirSync(disabledGitHooksRoot, { recursive: true })
  const gitOptions: GitCommandOptions = { hooksPath: disabledGitHooksRoot }
  const runSessionGit = (cwd: string, args: string[]) => runGit(cwd, args, gitOptions)
  const runSessionGitChecked = (cwd: string, args: string[]) => runGitChecked(cwd, args, gitOptions)

  return {
    lookup: options.lookup,
    applyEngine: createSessionCheckoutApplyEngine(),
    managedCheckoutsRoot,
    createCheckoutId: randomUUID,
    ...(options.onTimingEvent && { onTimingEvent: options.onTimingEvent }),
    registry: new AtomicJsonCheckoutRegistry(join(options.configDir, 'managed-checkouts.json')),
    files: {
      exists: existsSync,
      canonicalize: async (path) => realpath(resolve(path)),
      inspectDirectoryIdentity,
      ensureDirectory: (path) => mkdirSync(path, { recursive: true }),
      removeEmptyDirectoryTree,
      quarantineDirectoryTree,
      removeDirectoryTree,
      measureDirectoryBytes,
    },
    git: {
      inspect: async (root): Promise<GitCheckoutSnapshot | null> => {
        if (!existsSync(root)) return null
        const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
        if (topLevel.code !== 0 || !topLevel.stdout) return null
        const commonDir = await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
        const gitDir = await runSessionGitChecked(root, ['rev-parse', '--path-format=absolute', '--absolute-git-dir'])
        const headOid = await runSessionGitChecked(root, ['rev-parse', 'HEAD'])
        const symbolic = await runSessionGit(root, ['symbolic-ref', '--quiet', 'HEAD'])
        const headRef = symbolic.code === 0 && symbolic.stdout ? symbolic.stdout : 'HEAD'
        const branch = headRef.startsWith('refs/heads/') ? headRef.slice('refs/heads/'.length) : null
        return {
          root: await realpath(resolve(topLevel.stdout)),
          commonDir: await realpath(resolve(commonDir)),
          gitDir: await realpath(resolve(gitDir)),
          branch,
          headOid,
          headRef,
        }
      },
      findContainingWorktreeRoot: async (root) => {
        if (!existsSync(root)) return null
        const topLevel = await runSessionGit(root, ['rev-parse', '--show-toplevel'])
        if (topLevel.code !== 0 || !topLevel.stdout) return null
        return realpath(resolve(topLevel.stdout))
      },
      status: async (root) => {
        const output = await runSessionGitChecked(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
        return { dirty: output.length > 0 }
      },
      createDetachedWorktree: async (localRoot, managedRoot, baseOid) => {
        await runSessionGitChecked(localRoot, [
          'worktree',
          'add',
          '--detach',
          managedRoot,
          baseOid,
        ])
      },
      removeWorktree: async (localRoot, managedRoot) => {
        // Git 将已审核但未提交在 Isolated 分支中的最终快照视为 modified/untracked；
        // caller 已先验证 checkout identity 与完整 fingerprint（含 untracked）后才允许到达此处。
        await runSessionGitChecked(localRoot, ['worktree', 'remove', '--force', managedRoot])
      },
      retainApplyBase: async (localRoot, checkoutId, oid) => {
        await runSessionGitChecked(localRoot, ['update-ref', applyBaseRef(checkoutId), oid])
      },
      releaseApplyBase: async (localRoot, checkoutId) => {
        await runSessionGitChecked(localRoot, ['update-ref', '-d', applyBaseRef(checkoutId)])
      },
      retainInternalArtifact: async (localRoot, checkoutId, artifactName, oid) => {
        await runSessionGitChecked(localRoot, ['update-ref', internalArtifactRef(checkoutId, artifactName), oid])
      },
      readInternalArtifact: async (localRoot, checkoutId, artifactName) => {
        const result = await runSessionGit(localRoot, ['rev-parse', '--verify', '--quiet', internalArtifactRef(checkoutId, artifactName)])
        if (result.code === 0 && result.stdout) return result.stdout
        if (result.code === 1) return null
        throw new Error(result.stderr || '无法读取内部 Git artifact')
      },
      releaseInternalArtifacts: async (localRoot, checkoutId, artifactPrefix) => {
        const prefix = artifactPrefix
          ? internalArtifactRef(checkoutId, artifactPrefix)
          : `${checkoutRefRoot(checkoutId)}/`
        const output = await runSessionGitChecked(localRoot, ['for-each-ref', '--format=%(refname)', prefix])
        const refs = output.split(/\r?\n/).map((ref) => ref.trim()).filter(Boolean)
        for (const ref of refs) await runSessionGitChecked(localRoot, ['update-ref', '-d', ref])
      },
      isAncestor: async (root, ancestorOid, descendantOid) => {
        const result = await runSessionGit(root, ['merge-base', '--is-ancestor', ancestorOid, descendantOid])
        if (result.code === 0) return true
        if (result.code === 1) return false
        throw new Error(result.stderr || '无法证明 Git commit ancestry')
      },
    },
  }
}
