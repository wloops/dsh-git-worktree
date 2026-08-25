import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve } from 'node:path'
import type { ApplyBaseStrategy } from './types.js'

export interface ApplyPlanInput {
  baseOid: string
  isolatedPath: string
  localPath: string
}

export interface ApplyPlan {
  revision: string
  localFingerprint: string
  isolatedFingerprint: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  localHeadOid: string
  /** null 表示 Local 当前为 detached HEAD；Apply 允许，Finish 会拒绝自动提交。 */
  localHeadRef: string | null
  isolatedHeadOid: string
  changedFiles: string[]
}

export interface ReviewSnapshotResult {
  status: 'ready'
  isolatedFingerprint: string
  isolatedHeadOid: string
  changedFiles: string[]
}

export type InspectReviewResult = ReviewSnapshotResult | ApplyPlanErrorResult

export interface ApplyReadyPlanResult {
  status: 'ready'
  plan: ApplyPlan
}

export interface ApplyConflictPlanResult {
  status: 'conflict'
  revision: string
  localFingerprint: string
  isolatedFingerprint: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  /** 冲突计算时的真实 Local HEAD，供 Isolated Agent 在当前 Worktree 内同步并解决冲突。 */
  localHeadOid: string
  isolatedHeadOid: string
  conflictingFiles: string[]
}

export interface ApplyPlanErrorResult {
  status: 'error'
  error: ApplyError
}

export type ApplyPlanResult = ApplyReadyPlanResult | ApplyConflictPlanResult | ApplyPlanErrorResult

export interface ApplySuccessResult {
  status: 'applied'
  changedFiles: string[]
  /** 本次已整合的 Isolated 快照 commit；不创建 ref，仅供后续 Apply 作为内部基线。 */
  nextBaseOid: string
}

export interface ApplyErrorResult {
  status: 'error'
  error: ApplyError
}

export type ApplyResult = ApplySuccessResult | ApplyErrorResult

export interface FinishSuccessResult {
  status: 'finished'
  changedFiles: string[]
  /** null 表示 Worktree 与 Local 已一致，没有创建空提交。 */
  commitOid: string | null
  /** 本次已整合的 Isolated 快照，供清理未完成时后续 Apply 去重。 */
  nextBaseOid: string
}

export type FinishResult = FinishSuccessResult | ApplyErrorResult

export interface PreviewReceipt {
  previewId: string
  reviewId: string
  iteration: number
  previewedAt: number
  configuredBaseOid: string
  effectiveBaseOid: string
  baseStrategy: ApplyBaseStrategy
  localHeadOid: string
  localHeadRef: string | null
  localFingerprintBefore: string
  localFingerprintPreview: string
  localWorkingTreeOid: string
  localIndexTreeOid: string
  previewWorkingTreeOid: string
  isolatedHeadOid: string
  isolatedFingerprint: string
  isolatedSnapshotOid: string
  changedFiles: string[]
}

export interface PreviewSuccessResult {
  status: 'previewed'
  receipt: PreviewReceipt
  changedFiles: string[]
}

export type PreviewResult = PreviewSuccessResult | ApplyErrorResult

export interface RollbackSuccessResult {
  status: 'preview_rolled_back'
  changedFiles: string[]
}

export type RollbackResult = RollbackSuccessResult | ApplyErrorResult

export interface CheckpointInput {
  isolatedPath: string
  expectedFingerprint: string
  expectedHeadOid: string
  commitMessage: string
  /** Persist the prepared commit and Host journal before detached HEAD/index mutation. */
  beforeCommit?(prepared: { commitOid: string; parentOid: string; indexTreeOid: string; changedFiles: string[] }): Promise<void>
}

export interface CheckpointSuccessResult {
  status: 'checkpointed'
  commitOid: string
  parentOid: string
  changedFiles: string[]
  isolatedFingerprint: string
}

export type CheckpointResult = CheckpointSuccessResult | ApplyErrorResult

export interface CheckpointRecoverySuccessResult {
  status: 'checkpoint_recovered' | 'checkpoint_aborted'
  isolatedFingerprint: string
}

export type CheckpointRecoveryResult = CheckpointRecoverySuccessResult | ApplyErrorResult

export type PreviewRecoveryActionBlockCode =
  | 'stale_local'
  | 'preview_modified'
  | 'commit_isolation_conflict'
  | 'operation_not_allowed'

export interface PreviewRecoveryBlockedAction {
  status: 'blocked'
  code: PreviewRecoveryActionBlockCode
  message: string
  conflictingFiles?: string[]
}

export interface PreviewRecoverySafeRollback {
  status: 'safe'
  targetTreeOid: string
}

export interface PreviewRecoverySafeFinalize {
  status: 'safe'
  taskTreeOid: string
  finalIndexTreeOid: string
  expectedWorkingTreeOid: string
  commitRequired: boolean
}

export interface PreviewRecoveryAssessment {
  localFingerprint: string
  localHeadOid: string
  localHeadRef: string | null
  localHeadTreeOid: string
  localIndexTreeOid: string
  localWorkingTreeOid: string
  rollback: PreviewRecoverySafeRollback | PreviewRecoveryBlockedAction
  finalize: PreviewRecoverySafeFinalize | PreviewRecoveryBlockedAction
}

export interface InvalidInputApplyError {
  code: 'invalid_input'
  message: string
}

export interface InvalidPlanApplyError {
  code: 'invalid_plan'
  message: string
}

export interface StaleLocalApplyError {
  code: 'stale_local'
  message: string
}

export interface StaleIsolatedApplyError {
  code: 'stale_isolated'
  message: string
}

export interface GitApplyError {
  code: 'git_error'
  message: string
  /** Host may clear only a planning journal when the engine proved Local was restored exactly. */
  recoveryState?: 'unchanged' | 'uncertain'
}

export interface CommitIsolationApplyError {
  code: 'commit_isolation_conflict'
  message: string
}

export interface OperationNotAllowedApplyError {
  code: 'operation_not_allowed'
  message: string
}

export interface PreviewModifiedApplyError {
  code: 'preview_modified'
  message: string
}

export type ApplyError =
  | InvalidInputApplyError
  | InvalidPlanApplyError
  | StaleLocalApplyError
  | StaleIsolatedApplyError
  | GitApplyError
  | CommitIsolationApplyError
  | OperationNotAllowedApplyError
  | PreviewModifiedApplyError

export interface SessionCheckoutApplyEngine {
  inspectReview(input: ApplyPlanInput): Promise<InspectReviewResult>
  checkpoint(input: CheckpointInput): Promise<CheckpointResult>
  recoverCheckpoint(input: { isolatedPath: string; commitOid: string; parentOid: string; expectedIndexTreeOid: string }): Promise<CheckpointRecoveryResult>
  /** 复用真实 Apply merge 计算，但不持久化可执行 plan，也不修改任一 checkout。 */
  preflight(input: ApplyPlanInput): Promise<ApplyPlanResult>
  plan(input: ApplyPlanInput): Promise<ApplyPlanResult>
  apply(plan: ApplyPlan): Promise<ApplyResult>
  finish(plan: ApplyPlan, options: { commitMessage: string }): Promise<FinishResult>
  preview(plan: ApplyPlan, options: {
    previewId: string
    reviewId: string
    iteration: number
    /** Local 写入前持久化 receipt artifacts/journal；失败时不得触碰 Local。 */
    beforeWrite?(receipt: PreviewReceipt): Promise<void>
  }): Promise<PreviewResult>
  /** Strictly read-only detached Preview recovery assessment; it persists no executable plan. */
  assessPreviewRecovery(input: { localPath: string; receipt: PreviewReceipt }): Promise<PreviewRecoveryAssessment | ApplyErrorResult>
  rollback(input: {
    localPath: string
    receipt: PreviewReceipt
    /** Persists the mutation journal before the final Local CAS; no Local write may happen before it resolves. */
    beforeWrite?(): Promise<void>
  }): Promise<RollbackResult>
  finalize(input: {
    localPath: string
    receipt: PreviewReceipt
    commitMessage: string
    /** Commit object 已创建但 branch ref 尚未更新时持久化恢复信息。 */
    beforeCommit?(commitOid: string): Promise<void>
  }): Promise<FinishResult>
}

export interface SessionCheckoutApplyEngineOptions {
  /** 测试/宿主 seam：在最后一次 Local fingerprint 校验前执行。 */
  beforeFinalLocalValidation?(): Promise<void> | void
  /** 测试/宿主 seam：在 Local 写入完成、独立写后验证开始前执行。 */
  afterLocalWriteBeforeVerification?(): Promise<void> | void
  /** Test seam immediately before the authoritative managed-Worktree checkpoint CAS. */
  beforeFinalIsolatedValidation?(): Promise<void> | void
  /** Test seam after checkpoint HEAD/index writes and before independent verification. */
  afterIsolatedWriteBeforeVerification?(): Promise<void> | void
}

interface GitResult {
  exitCode: number
  stdout: Buffer
  stderr: string
}

interface CheckoutSnapshot {
  fingerprint: string
  headOid: string
  headRef: string | null
  headTreeOid: string
  indexTreeOid: string
  treeOid: string
  indexEntries: Buffer
}

interface ApplyScope {
  isolatedGitRoot: string
  localGitRoot: string
  projectPrefix: string
  sourceObjects: string
}

interface StoredPlan {
  input: ApplyPlanInput
  patch: Buffer
  plan: ApplyPlan
  scope: ApplyScope
}

interface MergeReadyResult {
  status: 'ready'
  changedFiles: string[]
  patch: Buffer
  mergedTreeOid: string
}

interface MergeConflictResult {
  status: 'conflict'
  conflictingFiles: string[]
}

type MergeResult = MergeReadyResult | MergeConflictResult

interface TreeMergeReadyResult {
  status: 'ready'
  treeOid: string
}

type TreeMergeResult = TreeMergeReadyResult | MergeConflictResult

class GitCommandFailure extends Error {
  constructor(
    readonly args: string[],
    readonly result: GitResult,
  ) {
    super(result.stderr || `git 命令退出码为 ${result.exitCode}`)
  }
}

const GIT_TIMEOUT_MS = 30_000
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

async function runGit(
  cwd: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: Buffer | string; allowedExitCodes?: number[] } = {},
): Promise<GitResult> {
  return await new Promise<GitResult>((resolveResult, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        ...options.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let settled = false

    const finish = (error: Error | null, result?: GitResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else if (result) resolveResult(result)
    }

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
    child.on('error', (error) => finish(error))
    child.on('close', (exitCode) => {
      const result: GitResult = {
        exitCode: exitCode ?? -1,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks).toString('utf8').trim(),
      }
      const allowed = options.allowedExitCodes ?? [0]
      finish(allowed.includes(result.exitCode) ? null : new GitCommandFailure(args, result), result)
    })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error(`git 命令超时：${args[0] ?? 'unknown'}`))
    }, GIT_TIMEOUT_MS)

    if (options.input !== undefined) child.stdin.end(options.input)
    else child.stdin.end()
  })
}

function stdoutText(result: GitResult): string {
  return result.stdout.toString('utf8').trim()
}

function parseNullSeparated(output: Buffer): string[] {
  return output
    .toString('utf8')
    .split('\0')
    .filter((value) => value.length > 0)
}

function gitObjectEnvironment(objectDirectory: string, sourceObjectDirectory: string): NodeJS.ProcessEnv {
  const existingAlternates = process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES
  return {
    GIT_OBJECT_DIRECTORY: objectDirectory,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [sourceObjectDirectory, existingAlternates]
      .filter((value): value is string => Boolean(value))
      .join(delimiter),
  }
}

async function sourceObjectDirectory(checkoutPath: string): Promise<string> {
  const output = stdoutText(await runGit(checkoutPath, ['rev-parse', '--path-format=absolute', '--git-path', 'objects']))
  return resolve(checkoutPath, output)
}

async function resolveGitRoot(checkoutPath: string): Promise<string> {
  const output = stdoutText(await runGit(checkoutPath, ['rev-parse', '--show-toplevel']))
  return resolve(checkoutPath, output)
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync.native(resolve(path))
  } catch {
    return resolve(path)
  }
}

function projectPrefix(gitRoot: string, projectRoot: string): string | null {
  const prefix = relative(canonicalExistingPath(gitRoot), canonicalExistingPath(projectRoot))
    .replace(/\\/g, '/')
    .replace(/\/$/, '')
  if (prefix === '..' || prefix.startsWith('../') || isAbsolute(prefix)) return null
  return prefix
}

function isProjectPath(repoPath: string, prefix: string): boolean {
  return !prefix || repoPath.startsWith(`${prefix}/`)
}

function toProjectPath(repoPath: string, prefix: string): string {
  return prefix ? repoPath.slice(prefix.length + 1) : repoPath
}

interface EffectiveApplyBase {
  oid: string
  strategy: ApplyBaseStrategy
}

async function isAncestor(checkoutPath: string, olderOid: string, newerOid: string): Promise<boolean> {
  const result = await runGit(
    checkoutPath,
    ['merge-base', '--is-ancestor', olderOid, newerOid],
    { allowedExitCodes: [0, 1] },
  )
  return result.exitCode === 0
}

async function selectEffectiveApplyBase(
  checkoutPath: string,
  recordedBaseOid: string,
  localHeadOid: string,
  isolatedHeadOid: string,
): Promise<EffectiveApplyBase> {
  // recorded base 必须能证明位于两侧真实提交历史中，才允许利用 ancestry 前移。
  // 上次 Apply 的内部 snapshot 通常不在任一分支历史中，因此第二次 Apply 会保守使用 recorded base。
  const recordedInLocal = await isAncestor(checkoutPath, recordedBaseOid, localHeadOid)
  const recordedInIsolated = await isAncestor(checkoutPath, recordedBaseOid, isolatedHeadOid)
  if (!recordedInLocal || !recordedInIsolated) {
    return { oid: recordedBaseOid, strategy: 'recorded_base' }
  }

  if (await isAncestor(checkoutPath, localHeadOid, isolatedHeadOid)) {
    return { oid: localHeadOid, strategy: 'isolated_contains_local_head' }
  }
  if (await isAncestor(checkoutPath, isolatedHeadOid, localHeadOid)) {
    return { oid: isolatedHeadOid, strategy: 'local_contains_isolated_head' }
  }
  return { oid: recordedBaseOid, strategy: 'recorded_base' }
}

async function changedTreePaths(
  checkoutPath: string,
  baseOid: string,
  treeOid: string,
  objectDirectory: string | null,
  sourceObjects: string | null,
): Promise<string[]> {
  const result = await runGit(
    checkoutPath,
    ['diff', '--name-only', '-z', '--no-ext-diff', '--no-renames', baseOid, treeOid, '--'],
    { env: objectDirectory && sourceObjects ? gitObjectEnvironment(objectDirectory, sourceObjects) : undefined },
  )
  return parseNullSeparated(result.stdout)
}

function snapshotFingerprint(
  headOid: string,
  headRef: string | null,
  indexEntries: Buffer,
  treeOid: string,
): string {
  return createHash('sha256')
    .update(headOid)
    .update('\0')
    .update(headRef ?? 'DETACHED')
    .update('\0')
    .update(indexEntries)
    .update('\0')
    .update(treeOid)
    .digest('hex')
}

async function captureSnapshot(
  checkoutPath: string,
  indexPath: string,
  objectDirectory: string | null,
  sourceObjects: string | null,
): Promise<CheckoutSnapshot> {
  const headOid = stdoutText(await runGit(checkoutPath, ['rev-parse', 'HEAD']))
  const headTreeOid = stdoutText(await runGit(checkoutPath, ['rev-parse', `${headOid}^{tree}`]))
  const symbolic = await runGit(checkoutPath, ['symbolic-ref', '--quiet', 'HEAD'], { allowedExitCodes: [0, 1] })
  const headRef = symbolic.exitCode === 0 ? stdoutText(symbolic) : null
  const indexEntries = (await runGit(checkoutPath, ['ls-files', '--stage', '-z'])).stdout
  const stagedPatch = (
    await runGit(checkoutPath, [
      'diff',
      '--cached',
      '--binary',
      '--full-index',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      headOid,
      '--',
    ])
  ).stdout
  const env: NodeJS.ProcessEnv = {
    ...(objectDirectory && sourceObjects ? gitObjectEnvironment(objectDirectory, sourceObjects) : {}),
    GIT_INDEX_FILE: indexPath,
  }

  await runGit(checkoutPath, ['read-tree', headOid], { env })
  if (stagedPatch.length > 0) {
    await runGit(checkoutPath, ['apply', '--cached', '--binary', '--whitespace=nowarn'], {
      env,
      input: stagedPatch,
    })
  }
  const indexTreeOid = stdoutText(await runGit(checkoutPath, ['write-tree'], { env }))
  // 先还原真实 index 的 staged 语义，再叠加 working tree，得到完整最终状态。
  await runGit(checkoutPath, ['add', '-A', '--', '.'], { env })
  const treeOid = stdoutText(await runGit(checkoutPath, ['write-tree'], { env }))
  const fingerprint = snapshotFingerprint(headOid, headRef, indexEntries, treeOid)

  return { fingerprint, headOid, headRef, headTreeOid, indexTreeOid, treeOid, indexEntries }
}

async function createSnapshotCommit(
  checkoutPath: string,
  treeOid: string,
  parentOid: string | null,
  objectDirectory: string | null,
  sourceObjects: string | null,
  label: string,
): Promise<string> {
  const args = ['commit-tree', treeOid, ...(parentOid ? ['-p', parentOid] : [])]
  const result = await runGit(checkoutPath, args, {
    env: {
      ...(objectDirectory && sourceObjects ? gitObjectEnvironment(objectDirectory, sourceObjects) : {}),
      GIT_AUTHOR_NAME: 'Domi Apply',
      GIT_AUTHOR_EMAIL: 'domi-apply@localhost',
      GIT_COMMITTER_NAME: 'Domi Apply',
      GIT_COMMITTER_EMAIL: 'domi-apply@localhost',
    },
    input: `${label}\n`,
  })
  return stdoutText(result)
}

async function computeMerge(
  tempRoot: string,
  sourceObjects: string,
  objectDirectory: string,
  baseOid: string,
  local: CheckoutSnapshot,
  isolated: CheckoutSnapshot,
  checkoutPath: string,
  projectPathPrefix: string,
): Promise<MergeResult> {
  const localCommit = await createSnapshotCommit(
    checkoutPath,
    local.treeOid,
    baseOid,
    objectDirectory,
    sourceObjects,
    'Local snapshot',
  )
  const isolatedCommit = await createSnapshotCommit(
    checkoutPath,
    isolated.treeOid,
    baseOid,
    objectDirectory,
    sourceObjects,
    'Isolated snapshot',
  )
  const mergePath = join(tempRoot, 'merge checkout')
  const hooksPath = join(tempRoot, 'disabled hooks')
  await mkdir(mergePath, { recursive: true })
  await mkdir(hooksPath, { recursive: true })
  await runGit(mergePath, ['init', '--template='])
  await runGit(mergePath, ['config', 'core.autocrlf', 'false'])
  await runGit(mergePath, ['config', 'core.hooksPath', hooksPath])
  await runGit(mergePath, ['config', 'user.name', 'Domi Apply'])
  await runGit(mergePath, ['config', 'user.email', 'domi-apply@localhost'])

  const mergeEnv: NodeJS.ProcessEnv = {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [objectDirectory, sourceObjects].join(delimiter),
  }
  await runGit(mergePath, ['checkout', '--detach', localCommit], { env: mergeEnv })
  const merge = await runGit(mergePath, ['merge', '--no-commit', '--no-ff', isolatedCommit], {
    env: mergeEnv,
    allowedExitCodes: [0, 1],
  })

  if (merge.exitCode === 1) {
    const conflicts = await runGit(mergePath, ['diff', '--name-only', '--diff-filter=U', '-z'], { env: mergeEnv })
    const conflictingFiles = parseNullSeparated(conflicts.stdout)
      .filter((path) => isProjectPath(path, projectPathPrefix))
      .map((path) => toProjectPath(path, projectPathPrefix))
      .sort()
    if (conflictingFiles.length === 0) throw new GitCommandFailure(['merge'], merge)
    return { status: 'conflict', conflictingFiles }
  }

  const mergedTree = stdoutText(await runGit(mergePath, ['write-tree'], { env: mergeEnv }))
  const changed = await runGit(
    mergePath,
    ['diff', '--name-only', '-z', '--no-ext-diff', '--no-renames', local.treeOid, mergedTree, '--'],
    { env: mergeEnv },
  )
  const patch = (
    await runGit(
      mergePath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        local.treeOid,
        mergedTree,
        '--',
      ],
      { env: mergeEnv },
    )
  ).stdout
  const changedFiles = parseNullSeparated(changed.stdout)
    .filter((path) => isProjectPath(path, projectPathPrefix))
    .map((path) => toProjectPath(path, projectPathPrefix))
    .sort()
  const centralIndex = join(tempRoot, 'merged-central.index')
  const centralEnv: NodeJS.ProcessEnv = {
    ...gitObjectEnvironment(objectDirectory, sourceObjects),
    GIT_INDEX_FILE: centralIndex,
  }
  await runGit(checkoutPath, ['read-tree', local.treeOid], { env: centralEnv })
  if (patch.length > 0) {
    await runGit(checkoutPath, ['apply', '--cached', '--binary', '--whitespace=nowarn'], {
      env: centralEnv,
      input: patch,
    })
  }
  const centralMergedTree = stdoutText(await runGit(checkoutPath, ['write-tree'], { env: centralEnv }))
  return { status: 'ready', changedFiles, patch, mergedTreeOid: centralMergedTree }
}

async function computeTreeMerge(
  tempRoot: string,
  sourceObjects: string,
  objectDirectory: string,
  checkoutPath: string,
  label: string,
  baseTreeOid: string,
  oursTreeOid: string,
  theirsTreeOid: string,
): Promise<TreeMergeResult> {
  const baseCommit = await createSnapshotCommit(
    checkoutPath,
    baseTreeOid,
    null,
    objectDirectory,
    sourceObjects,
    `${label} base`,
  )
  const oursCommit = await createSnapshotCommit(
    checkoutPath,
    oursTreeOid,
    baseCommit,
    objectDirectory,
    sourceObjects,
    `${label} ours`,
  )
  const theirsCommit = await createSnapshotCommit(
    checkoutPath,
    theirsTreeOid,
    baseCommit,
    objectDirectory,
    sourceObjects,
    `${label} theirs`,
  )
  const mergePath = join(tempRoot, label.replace(/[^a-z0-9_-]+/gi, '-'))
  const hooksPath = join(tempRoot, `${label}-disabled-hooks`.replace(/[^a-z0-9_-]+/gi, '-'))
  await mkdir(mergePath, { recursive: true })
  await mkdir(hooksPath, { recursive: true })
  await runGit(mergePath, ['init', '--template='])
  await runGit(mergePath, ['config', 'core.autocrlf', 'false'])
  await runGit(mergePath, ['config', 'core.hooksPath', hooksPath])
  await runGit(mergePath, ['config', 'user.name', 'Domi Apply'])
  await runGit(mergePath, ['config', 'user.email', 'domi-apply@localhost'])

  const env: NodeJS.ProcessEnv = {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [objectDirectory, sourceObjects].join(delimiter),
  }
  await runGit(mergePath, ['checkout', '--detach', oursCommit], { env })
  const merge = await runGit(mergePath, ['merge', '--no-commit', '--no-ff', theirsCommit], {
    env,
    allowedExitCodes: [0, 1],
  })
  if (merge.exitCode === 1) {
    const conflicts = await runGit(mergePath, ['diff', '--name-only', '--diff-filter=U', '-z'], { env })
    const conflictingFiles = parseNullSeparated(conflicts.stdout).sort()
    if (conflictingFiles.length === 0) throw new GitCommandFailure(['merge'], merge)
    return { status: 'conflict', conflictingFiles }
  }
  const mergedTreeOid = stdoutText(await runGit(mergePath, ['write-tree'], { env }))
  const mergedPatch = (
    await runGit(
      mergePath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        oursTreeOid,
        mergedTreeOid,
        '--',
      ],
      { env },
    )
  ).stdout
  const centralIndex = join(tempRoot, `${label}-central.index`.replace(/[^a-z0-9_.-]+/gi, '-'))
  const centralEnv: NodeJS.ProcessEnv = {
    ...gitObjectEnvironment(objectDirectory, sourceObjects),
    GIT_INDEX_FILE: centralIndex,
  }
  await runGit(checkoutPath, ['read-tree', oursTreeOid], { env: centralEnv })
  if (mergedPatch.length > 0) {
    await runGit(checkoutPath, ['apply', '--cached', '--binary', '--whitespace=nowarn'], {
      env: centralEnv,
      input: mergedPatch,
    })
  }
  return { status: 'ready', treeOid: stdoutText(await runGit(checkoutPath, ['write-tree'], { env: centralEnv })) }
}

async function treePatch(
  checkoutPath: string,
  fromTreeOid: string,
  toTreeOid: string,
  objectDirectory: string,
  sourceObjects: string,
): Promise<Buffer> {
  return (
    await runGit(
      checkoutPath,
      [
        'diff',
        '--binary',
        '--full-index',
        '--no-ext-diff',
        '--no-textconv',
        '--no-renames',
        fromTreeOid,
        toTreeOid,
        '--',
      ],
      { env: gitObjectEnvironment(objectDirectory, sourceObjects) },
    )
  ).stdout
}

function pathsMatch(left: string, right: string): boolean {
  const normalizedLeft = canonicalExistingPath(left)
  const normalizedRight = canonicalExistingPath(right)
  return process.platform === 'win32'
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

function planMatches(stored: ApplyPlan, supplied: ApplyPlan): boolean {
  return stored.revision === supplied.revision
    && stored.localFingerprint === supplied.localFingerprint
    && stored.isolatedFingerprint === supplied.isolatedFingerprint
    && stored.effectiveBaseOid === supplied.effectiveBaseOid
    && stored.baseStrategy === supplied.baseStrategy
    && stored.localHeadOid === supplied.localHeadOid
    && stored.localHeadRef === supplied.localHeadRef
    && stored.isolatedHeadOid === supplied.isolatedHeadOid
    && stored.changedFiles.length === supplied.changedFiles.length
    && stored.changedFiles.every((path, index) => path === supplied.changedFiles[index])
}

async function prepareIndexFromPatch(
  checkoutPath: string,
  indexPath: string,
  baseOid: string,
  patch: Buffer,
): Promise<string> {
  const env = { GIT_INDEX_FILE: indexPath }
  await runGit(checkoutPath, ['read-tree', baseOid], { env })
  if (patch.length > 0) {
    await runGit(checkoutPath, ['apply', '--cached', '--binary', '--whitespace=nowarn'], { env, input: patch })
  }
  return stdoutText(await runGit(checkoutPath, ['write-tree'], { env }))
}

async function createUserCommit(
  checkoutPath: string,
  treeOid: string,
  parentOid: string,
  commitMessage: string,
): Promise<string> {
  return stdoutText(await runGit(
    checkoutPath,
    ['commit-tree', treeOid, '-p', parentOid],
    { input: `${commitMessage.trim()}\n` },
  ))
}

async function prepareRollbackAssessment(
  tempRoot: string,
  sourceObjects: string,
  objectDirectory: string,
  localGitRoot: string,
  current: CheckoutSnapshot,
  receipt: PreviewReceipt,
): Promise<PreviewRecoverySafeRollback | PreviewRecoveryBlockedAction> {
  if (current.headRef !== receipt.localHeadRef) {
    return { status: 'blocked', code: 'stale_local', message: 'Local branch 已变化，不能自动撤回 Preview' }
  }
  if (current.headOid !== receipt.localHeadOid && !await isAncestor(localGitRoot, receipt.localHeadOid, current.headOid)) {
    return { status: 'blocked', code: 'stale_local', message: 'Local HEAD 不是 Preview 基线的安全快进，不能自动撤回' }
  }

  let rollbackBaselineTreeOid = receipt.localWorkingTreeOid
  let expectedPreviewTreeOid = receipt.previewWorkingTreeOid
  if (current.headOid !== receipt.localHeadOid) {
    const receiptHeadTreeOid = stdoutText(await runGit(localGitRoot, ['rev-parse', `${receipt.localHeadOid}^{tree}`]))
    const advancedBaseline = await computeTreeMerge(
      tempRoot, sourceObjects, objectDirectory, localGitRoot,
      'preview-rollback-advanced-baseline', receiptHeadTreeOid, current.headTreeOid, receipt.localWorkingTreeOid,
    )
    if (advancedBaseline.status === 'conflict') {
      return {
        status: 'blocked', code: 'preview_modified',
        message: `Local 新提交与 Preview 前的本地修改冲突，无法安全撤回：${advancedBaseline.conflictingFiles.join('、')}`,
        conflictingFiles: [...advancedBaseline.conflictingFiles],
      }
    }
    const previewAbsence = await computeTreeMerge(
      tempRoot, sourceObjects, objectDirectory, localGitRoot,
      'preview-rollback-preview-absence', receipt.previewWorkingTreeOid, advancedBaseline.treeOid, receipt.localWorkingTreeOid,
    )
    if (previewAbsence.status === 'conflict') {
      return {
        status: 'blocked', code: 'preview_modified',
        message: `Local 新提交与 Preview 任务增量冲突，无法安全撤回：${previewAbsence.conflictingFiles.join('、')}`,
        conflictingFiles: [...previewAbsence.conflictingFiles],
      }
    }
    if (previewAbsence.treeOid !== advancedBaseline.treeOid) {
      return {
        status: 'blocked', code: 'preview_modified',
        message: 'Local 新提交已经包含部分或全部 Preview 增量，不能通过撤回工作区改动来改写已提交历史',
      }
    }
    const advancedPreview = await computeTreeMerge(
      tempRoot, sourceObjects, objectDirectory, localGitRoot,
      'preview-rollback-advanced-preview', receipt.localWorkingTreeOid, advancedBaseline.treeOid, receipt.previewWorkingTreeOid,
    )
    if (advancedPreview.status === 'conflict') {
      return {
        status: 'blocked', code: 'preview_modified',
        message: `Local 新提交与 Preview 任务增量冲突，无法安全撤回：${advancedPreview.conflictingFiles.join('、')}`,
        conflictingFiles: [...advancedPreview.conflictingFiles],
      }
    }
    rollbackBaselineTreeOid = advancedBaseline.treeOid
    expectedPreviewTreeOid = advancedPreview.treeOid
  }
  const rollbackTree = await computeTreeMerge(
    tempRoot, sourceObjects, objectDirectory, localGitRoot,
    'preview-rollback', expectedPreviewTreeOid, current.treeOid, rollbackBaselineTreeOid,
  )
  if (rollbackTree.status === 'conflict') {
    return {
      status: 'blocked', code: 'preview_modified',
      message: `Local 在 Preview 区域出现额外修改，无法安全撤回：${rollbackTree.conflictingFiles.join('、')}`,
      conflictingFiles: [...rollbackTree.conflictingFiles],
    }
  }
  return { status: 'safe', targetTreeOid: rollbackTree.treeOid }
}

async function prepareFinalizeAssessment(
  tempRoot: string,
  sourceObjects: string,
  objectDirectory: string,
  localGitRoot: string,
  current: CheckoutSnapshot,
  receipt: PreviewReceipt,
): Promise<PreviewRecoverySafeFinalize | PreviewRecoveryBlockedAction> {
  if (!receipt.localHeadRef?.startsWith('refs/heads/')) {
    return { status: 'blocked', code: 'operation_not_allowed', message: 'Local 当前不是普通分支，不能自动创建任务提交' }
  }
  if (current.headRef !== receipt.localHeadRef) {
    return { status: 'blocked', code: 'stale_local', message: 'Local branch 已变化，不能完成 Preview 提交' }
  }
  if (current.headOid !== receipt.localHeadOid && !await isAncestor(localGitRoot, receipt.localHeadOid, current.headOid)) {
    return { status: 'blocked', code: 'stale_local', message: 'Local HEAD 不是 Preview 基线的安全快进，不能完成 Preview 提交' }
  }
  const previewRemoval = await computeTreeMerge(
    tempRoot, sourceObjects, objectDirectory, localGitRoot,
    'preview-finalize-separation', receipt.previewWorkingTreeOid, current.treeOid, receipt.localWorkingTreeOid,
  )
  if (previewRemoval.status === 'conflict') {
    return {
      status: 'blocked', code: 'preview_modified',
      message: `Local 在 Preview 区域出现额外修改，无法可靠提交：${previewRemoval.conflictingFiles.join('、')}`,
      conflictingFiles: [...previewRemoval.conflictingFiles],
    }
  }
  const taskTree = await computeTreeMerge(
    tempRoot, sourceObjects, objectDirectory, localGitRoot,
    'preview-task-isolation', receipt.localWorkingTreeOid, current.headTreeOid, receipt.previewWorkingTreeOid,
  )
  if (taskTree.status === 'conflict') {
    return {
      status: 'blocked', code: 'commit_isolation_conflict',
      message: `Preview 任务增量无法与最新 Local HEAD 可靠拆分：${taskTree.conflictingFiles.join('、')}`,
      conflictingFiles: [...taskTree.conflictingFiles],
    }
  }
  if (taskTree.treeOid === current.headTreeOid && receipt.changedFiles.length > 0) {
    return {
      status: 'blocked', code: 'preview_modified',
      message: 'Preview 任务增量已经进入 Local HEAD；不会创建重复或空提交',
    }
  }
  const finalIndexTree = await computeTreeMerge(
    tempRoot, sourceObjects, objectDirectory, localGitRoot,
    'preview-index-preservation', current.headTreeOid, taskTree.treeOid, current.indexTreeOid,
  )
  if (finalIndexTree.status === 'conflict') {
    return {
      status: 'blocked', code: 'commit_isolation_conflict',
      message: `Preview 提交与 Local staged 修改无法可靠分离：${finalIndexTree.conflictingFiles.join('、')}`,
      conflictingFiles: [...finalIndexTree.conflictingFiles],
    }
  }
  return {
    status: 'safe', taskTreeOid: taskTree.treeOid, finalIndexTreeOid: finalIndexTree.treeOid,
    expectedWorkingTreeOid: current.treeOid,
    commitRequired: receipt.changedFiles.length > 0 && taskTree.treeOid !== current.headTreeOid,
  }
}

async function resolveIndexPath(checkoutPath: string): Promise<string> {
  return resolve(checkoutPath, stdoutText(await runGit(
    checkoutPath,
    ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
  )))
}

async function inspectIndexFileTree(checkoutPath: string, indexPath: string): Promise<{ exists: false } | { exists: true; treeOid: string | null }> {
  try {
    const handle = await open(indexPath, 'r')
    await handle.close()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false }
    throw error
  }
  try {
    const treeOid = stdoutText(await runGit(checkoutPath, ['write-tree'], { env: { GIT_INDEX_FILE: indexPath } }))
    return { exists: true, treeOid }
  } catch {
    return { exists: true, treeOid: null }
  }
}

async function checkpointLockMarkerOwned(markerPath: string, commitOid: string): Promise<boolean> {
  try {
    return (await readFile(markerPath, 'utf8')).trim() === commitOid
  } catch {
    return false
  }
}

async function removeBestEffort(path: string | null): Promise<void> {
  if (!path) return
  try {
    await unlink(path)
  } catch {
    // 临时 index 不存在或已完成 rename 时无需处理。
  }
}

async function writeIndexLock(indexPath: string, contents: Buffer): Promise<string> {
  const lockPath = `${indexPath}.lock`
  let handle: Awaited<ReturnType<typeof open>> | null = null
  try {
    handle = await open(lockPath, 'wx')
    await handle.writeFile(contents)
    await handle.sync()
    await handle.close()
    handle = null
    return lockPath
  } catch (error) {
    try {
      await handle?.close()
    } catch {
      // 原始错误优先；finally 会清理由本次调用创建的 lock。
    }
    if (handle) await removeBestEffort(lockPath)
    throw error
  }
}

function isIndexLockContention(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST'
}

class DefaultSessionCheckoutApplyEngine implements SessionCheckoutApplyEngine {
  private readonly plans = new Map<string, StoredPlan>()

  constructor(private readonly options: SessionCheckoutApplyEngineOptions) {}

  async checkpoint(input: CheckpointInput): Promise<CheckpointResult> {
    const commitMessage = input.commitMessage.trim()
    if (!commitMessage || commitMessage.length > 500 || !OID_PATTERN.test(input.expectedHeadOid) || !input.expectedFingerprint.trim()) {
      return { status: 'error', error: { code: 'invalid_input', message: 'Checkpoint 输入无效' } }
    }

    let tempRoot: string | null = null
    let adjacentIndex: string | null = null
    let indexLockMarker: string | null = null
    let preserveRecoveryEvidence = false
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-'))
      const isolatedGitRoot = await resolveGitRoot(input.isolatedPath)
      const projectPathPrefix = projectPrefix(isolatedGitRoot, input.isolatedPath)
      if (projectPathPrefix === null) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Checkpoint 项目目录不属于当前 Worktree' } }
      }
      const snapshot = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'checkpoint.index'), null, null)
      if (snapshot.headRef !== null) {
        return { status: 'error', error: { code: 'operation_not_allowed', message: 'Checkpoint 只允许写入 detached managed Worktree' } }
      }
      if (snapshot.headOid !== input.expectedHeadOid || snapshot.fingerprint !== input.expectedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Worktree 在准备验收后发生变化，不能保存阶段' } }
      }
      const changedPaths = await changedTreePaths(isolatedGitRoot, snapshot.headOid, snapshot.treeOid, null, null)
      if (changedPaths.some((path) => !isProjectPath(path, projectPathPrefix))) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Worktree 包含项目根目录外的变更，不能保存阶段' } }
      }
      const changedFiles = changedPaths.map((path) => toProjectPath(path, projectPathPrefix)).sort()
      if (changedFiles.length === 0) {
        return { status: 'error', error: { code: 'operation_not_allowed', message: '当前阶段没有可保存的新修改' } }
      }

      const commitOid = await createUserCommit(isolatedGitRoot, snapshot.treeOid, snapshot.headOid, commitMessage)
      await input.beforeCommit?.({ commitOid, parentOid: snapshot.headOid, indexTreeOid: snapshot.indexTreeOid, changedFiles })

      const finalIndexPath = join(tempRoot, 'clean.index')
      await prepareIndexFromPatch(isolatedGitRoot, finalIndexPath, commitOid, Buffer.alloc(0))
      const realIndexPath = await resolveIndexPath(isolatedGitRoot)
      const indexLockPath = `${realIndexPath}.lock`
      indexLockMarker = `${indexLockPath}.dsh-${commitOid}`
      await writeFile(indexLockMarker, `${commitOid}\n`, { flag: 'wx' })
      const indexLock = await open(indexLockPath, 'wx')
      adjacentIndex = indexLockPath
      await indexLock.close()
      await copyFile(finalIndexPath, adjacentIndex)

      await this.options.beforeFinalIsolatedValidation?.()
      const finalSnapshot = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'final-checkpoint.index'), null, null)
      if (finalSnapshot.headOid !== snapshot.headOid || finalSnapshot.fingerprint !== snapshot.fingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Worktree 在保存阶段前发生变化，请重新准备验收' } }
      }

      let headUpdated = false
      try {
        await runGit(isolatedGitRoot, ['update-ref', '--no-deref', 'HEAD', commitOid, snapshot.headOid])
        headUpdated = true
        await rename(adjacentIndex, realIndexPath)
        adjacentIndex = null
        await removeBestEffort(indexLockMarker)
        indexLockMarker = null
      } catch (error) {
        if (headUpdated) {
          try {
            await runGit(isolatedGitRoot, ['update-ref', '--no-deref', 'HEAD', snapshot.headOid, commitOid])
          } catch (rollbackError) {
            preserveRecoveryEvidence = true
            return {
              status: 'error',
              error: {
                code: 'git_error',
                message: `Checkpoint index 写入失败且 HEAD 无法回滚：${this.errorMessage(error)}；${this.errorMessage(rollbackError)}`,
                recoveryState: 'uncertain',
              },
            }
          }
        }
        return {
          status: 'error',
          error: {
            code: 'git_error',
            message: `Checkpoint 写入失败，已回滚：${this.errorMessage(error)}`,
            recoveryState: 'unchanged',
          },
        }
      }

      try {
        await this.options.afterIsolatedWriteBeforeVerification?.()
        const completed = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'completed.index'), null, null)
        if (
          completed.headOid !== commitOid
          || completed.headRef !== null
          || completed.headTreeOid !== snapshot.treeOid
          || completed.indexTreeOid !== snapshot.treeOid
          || completed.treeOid !== snapshot.treeOid
        ) {
          return {
            status: 'error',
            error: { code: 'git_error', message: 'Checkpoint 已写入，但 Worktree 未收敛到 clean 状态', recoveryState: 'uncertain' },
          }
        }
        return {
          status: 'checkpointed',
          commitOid,
          parentOid: snapshot.headOid,
          changedFiles,
          isolatedFingerprint: completed.fingerprint,
        }
      } catch (error) {
        return {
          status: 'error',
          error: {
            code: 'git_error',
            message: `Checkpoint 写后无法完成验证，需要保留现场确认：${this.errorMessage(error)}`,
            recoveryState: 'uncertain',
          },
        }
      }
    } catch (error) {
      const stale = isIndexLockContention(error)
      return {
        status: 'error',
        error: stale
          ? { code: 'stale_isolated', message: 'Worktree index 正在被其他 Git 操作更新，请重试' }
          : { code: 'git_error', message: this.errorMessage(error) },
      }
    } finally {
      if (!preserveRecoveryEvidence) {
        await removeBestEffort(adjacentIndex)
        await removeBestEffort(indexLockMarker)
      }
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async recoverCheckpoint(input: { isolatedPath: string; commitOid: string; parentOid: string; expectedIndexTreeOid: string }): Promise<CheckpointRecoveryResult> {
    if (!OID_PATTERN.test(input.commitOid) || !OID_PATTERN.test(input.parentOid) || !OID_PATTERN.test(input.expectedIndexTreeOid)) {
      return { status: 'error', error: { code: 'invalid_input', message: 'Checkpoint 恢复 OID 无效' } }
    }
    let tempRoot: string | null = null
    let ownedIndexLock: string | null = null
    let ownedLockMarker: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'dsh-checkpoint-recovery-'))
      const isolatedGitRoot = await resolveGitRoot(input.isolatedPath)
      const realIndexPath = await resolveIndexPath(isolatedGitRoot)
      const indexLockPath = `${realIndexPath}.lock`
      const indexLockMarker = `${indexLockPath}.dsh-${input.commitOid}`
      const targetTreeOid = stdoutText(await runGit(isolatedGitRoot, ['rev-parse', `${input.commitOid}^{tree}`]))
      const existingLock = await inspectIndexFileTree(isolatedGitRoot, indexLockPath)
      const markerOwned = await checkpointLockMarkerOwned(indexLockMarker, input.commitOid)
      const snapshot = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'current.index'), null, null)
      if (snapshot.headRef !== null) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Worktree 已不再是 detached HEAD' } }
      }

      if (snapshot.headOid === input.parentOid) {
        if (existingLock.exists) {
          if (!markerOwned || (existingLock.treeOid !== null && existingLock.treeOid !== targetTreeOid)) {
            return { status: 'error', error: { code: 'stale_isolated', message: '遗留 index.lock 无法证明属于当前 Checkpoint，已保留现场' } }
          }
          await unlink(indexLockPath)
        }
        if (markerOwned) await unlink(indexLockMarker)
        return { status: 'checkpoint_aborted', isolatedFingerprint: snapshot.fingerprint }
      }
      if (snapshot.headOid !== input.commitOid) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Worktree HEAD 与待恢复 Checkpoint 不一致' } }
      }
      if (snapshot.treeOid !== snapshot.headTreeOid) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Worktree 在 Checkpoint 中断后出现新修改，不能自动恢复 index' } }
      }
      if (snapshot.indexTreeOid !== input.expectedIndexTreeOid && snapshot.indexTreeOid !== snapshot.headTreeOid) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Checkpoint 中断后 index 出现新 staged 修改，不能自动覆盖' } }
      }

      const cleanIndexPath = join(tempRoot, 'clean.index')
      await prepareIndexFromPatch(isolatedGitRoot, cleanIndexPath, input.commitOid, Buffer.alloc(0))
      if (existingLock.exists) {
        if (!markerOwned || (existingLock.treeOid !== null && existingLock.treeOid !== targetTreeOid)) {
          return { status: 'error', error: { code: 'stale_isolated', message: '遗留 index.lock 与 Checkpoint 目标不一致，已保留现场' } }
        }
        if (existingLock.treeOid === null) await copyFile(cleanIndexPath, indexLockPath)
      } else {
        if (!markerOwned) {
          await writeFile(indexLockMarker, `${input.commitOid}\n`, { flag: 'wx' })
          ownedLockMarker = indexLockMarker
        }
        const indexLock = await open(indexLockPath, 'wx')
        ownedIndexLock = indexLockPath
        await indexLock.close()
        await copyFile(cleanIndexPath, indexLockPath)
      }

      await this.options.beforeFinalIsolatedValidation?.()
      const lockedSnapshot = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'locked-current.index'), null, null)
      if (
        lockedSnapshot.headOid !== snapshot.headOid
        || lockedSnapshot.fingerprint !== snapshot.fingerprint
        || (lockedSnapshot.indexTreeOid !== input.expectedIndexTreeOid && lockedSnapshot.indexTreeOid !== lockedSnapshot.headTreeOid)
      ) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Checkpoint 恢复加锁前 Worktree 或 index 已变化' } }
      }
      await rename(indexLockPath, realIndexPath)
      ownedIndexLock = null
      await removeBestEffort(indexLockMarker)
      ownedLockMarker = null
      const completed = await captureSnapshot(isolatedGitRoot, join(tempRoot, 'completed.index'), null, null)
      if (
        completed.headOid !== input.commitOid
        || completed.headRef !== null
        || completed.indexTreeOid !== completed.headTreeOid
        || completed.treeOid !== completed.headTreeOid
      ) {
        return { status: 'error', error: { code: 'git_error', message: 'Checkpoint index 恢复后仍未收敛到 clean 状态', recoveryState: 'uncertain' } }
      }
      return { status: 'checkpoint_recovered', isolatedFingerprint: completed.fingerprint }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error), recoveryState: 'uncertain' } }
    } finally {
      await removeBestEffort(ownedIndexLock)
      await removeBestEffort(ownedLockMarker)
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async inspectReview(input: ApplyPlanInput): Promise<InspectReviewResult> {
    if (!OID_PATTERN.test(input.baseOid)) {
      return { status: 'error', error: { code: 'invalid_input', message: 'Session Base OID 格式无效' } }
    }
    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-review-snapshot-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const localGitRoot = await resolveGitRoot(input.localPath)
      const isolatedGitRoot = await resolveGitRoot(input.isolatedPath)
      const localObjects = await sourceObjectDirectory(localGitRoot)
      const isolatedObjects = await sourceObjectDirectory(isolatedGitRoot)
      if (!pathsMatch(localObjects, isolatedObjects)) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Local 与 Isolated 不属于同一 Git 仓库' } }
      }
      const localPrefix = projectPrefix(localGitRoot, input.localPath)
      const isolatedPrefix = projectPrefix(isolatedGitRoot, input.isolatedPath)
      if (localPrefix === null || isolatedPrefix === null || localPrefix !== isolatedPrefix) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Local 与 Isolated 的项目子目录不一致' } }
      }
      await runGit(localGitRoot, ['cat-file', '-e', `${input.baseOid}^{commit}`])
      const isolated = await captureSnapshot(
        isolatedGitRoot,
        join(tempRoot, 'isolated.index'),
        objectDirectory,
        localObjects,
      )
      const changedFiles = await changedTreePaths(
        isolatedGitRoot,
        input.baseOid,
        isolated.treeOid,
        objectDirectory,
        localObjects,
      )
      if (changedFiles.some((path) => !isProjectPath(path, localPrefix))) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Isolated 包含项目根目录外的变更，不能准备验收' } }
      }
      return {
        status: 'ready',
        isolatedFingerprint: isolated.fingerprint,
        isolatedHeadOid: isolated.headOid,
        changedFiles: changedFiles.map((path) => toProjectPath(path, localPrefix)).sort(),
      }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async preflight(input: ApplyPlanInput): Promise<ApplyPlanResult> {
    return this.calculatePlan(input, false)
  }

  async plan(input: ApplyPlanInput): Promise<ApplyPlanResult> {
    return this.calculatePlan(input, true)
  }

  private async calculatePlan(input: ApplyPlanInput, persistPlan: boolean): Promise<ApplyPlanResult> {
    if (!OID_PATTERN.test(input.baseOid)) {
      return { status: 'error', error: { code: 'invalid_input', message: 'Session Base OID 格式无效' } }
    }

    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-apply-plan-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const localGitRoot = await resolveGitRoot(input.localPath)
      const isolatedGitRoot = await resolveGitRoot(input.isolatedPath)
      const localObjects = await sourceObjectDirectory(localGitRoot)
      const isolatedObjects = await sourceObjectDirectory(isolatedGitRoot)
      if (!pathsMatch(localObjects, isolatedObjects)) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Local 与 Isolated 不属于同一 Git 仓库' } }
      }
      const localPrefix = projectPrefix(localGitRoot, input.localPath)
      const isolatedPrefix = projectPrefix(isolatedGitRoot, input.isolatedPath)
      if (localPrefix === null || isolatedPrefix === null || localPrefix !== isolatedPrefix) {
        return { status: 'error', error: { code: 'invalid_input', message: 'Local 与 Isolated 的项目子目录不一致' } }
      }
      await runGit(localGitRoot, ['cat-file', '-e', `${input.baseOid}^{commit}`])

      const local = await captureSnapshot(
        localGitRoot,
        join(tempRoot, 'local.index'),
        objectDirectory,
        localObjects,
      )
      const isolated = await captureSnapshot(
        isolatedGitRoot,
        join(tempRoot, 'isolated.index'),
        objectDirectory,
        localObjects,
      )
      const effectiveBase = await selectEffectiveApplyBase(
        localGitRoot,
        input.baseOid,
        local.headOid,
        isolated.headOid,
      )
      const isolatedChangedPaths = await changedTreePaths(
        isolatedGitRoot,
        effectiveBase.oid,
        isolated.treeOid,
        objectDirectory,
        localObjects,
      )
      if (isolatedChangedPaths.some((path) => !isProjectPath(path, localPrefix))) {
        return {
          status: 'error',
          error: { code: 'invalid_input', message: 'Isolated 包含项目根目录外的变更，已拒绝 Apply' },
        }
      }
      const merge = await computeMerge(
        tempRoot,
        localObjects,
        objectDirectory,
        effectiveBase.oid,
        local,
        isolated,
        localGitRoot,
        localPrefix,
      )
      const revision = randomUUID()
      if (merge.status === 'conflict') {
        return {
          status: 'conflict',
          revision,
          localFingerprint: local.fingerprint,
          isolatedFingerprint: isolated.fingerprint,
          effectiveBaseOid: effectiveBase.oid,
          baseStrategy: effectiveBase.strategy,
          localHeadOid: local.headOid,
          isolatedHeadOid: isolated.headOid,
          conflictingFiles: merge.conflictingFiles,
        }
      }

      const plan: ApplyPlan = {
        revision,
        localFingerprint: local.fingerprint,
        isolatedFingerprint: isolated.fingerprint,
        effectiveBaseOid: effectiveBase.oid,
        baseStrategy: effectiveBase.strategy,
        localHeadOid: local.headOid,
        localHeadRef: local.headRef,
        isolatedHeadOid: isolated.headOid,
        changedFiles: merge.changedFiles,
      }
      if (persistPlan) {
        this.plans.set(revision, {
          input: { ...input },
          patch: merge.patch,
          plan: { ...plan, changedFiles: [...plan.changedFiles] },
          scope: {
            isolatedGitRoot,
            localGitRoot,
            projectPrefix: localPrefix,
            sourceObjects: localObjects,
          },
        })
      }
      return { status: 'ready', plan: { ...plan, changedFiles: [...plan.changedFiles] } }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async apply(plan: ApplyPlan): Promise<ApplyResult> {
    const stored = this.plans.get(plan.revision)
    if (!stored || !planMatches(stored.plan, plan)) {
      return { status: 'error', error: { code: 'invalid_plan', message: 'Apply plan 不存在、已使用或已被修改' } }
    }

    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-apply-check-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(stored.scope.localGitRoot)
      if (!pathsMatch(sourceObjects, stored.scope.sourceObjects)) {
        return { status: 'error', error: { code: 'invalid_plan', message: 'Apply plan 的 Git 仓库身份已变化' } }
      }
      const local = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (local.headOid !== stored.plan.localHeadOid || local.fingerprint !== stored.plan.localFingerprint) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' } }
      }

      const isolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'isolated.index'),
        objectDirectory,
        sourceObjects,
      )
      if (isolated.headOid !== stored.plan.isolatedHeadOid || isolated.fingerprint !== stored.plan.isolatedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Isolated 在 plan 后发生变化，请重新计算' } }
      }

      // 将已审核的 Isolated 最终状态写成无 ref 的内部 commit，供同一 checkout 后续 Apply 去重。
      // 使用独立 index，不改变 Isolated 的真实 staged/working tree。
      const persistentIsolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'persistent-isolated.index'),
        null,
        null,
      )
      if (persistentIsolated.fingerprint !== stored.plan.isolatedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Isolated 在 plan 后发生变化，请重新计算' } }
      }
      const nextBaseOid = await createSnapshotCommit(
        stored.scope.isolatedGitRoot,
        persistentIsolated.treeOid,
        stored.plan.effectiveBaseOid,
        null,
        null,
        'Applied Isolated snapshot',
      )

      await this.options.beforeFinalLocalValidation?.()
      const finalLocal = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'final-local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (finalLocal.headOid !== stored.plan.localHeadOid || finalLocal.fingerprint !== stored.plan.localFingerprint) {
        return {
          status: 'error',
          error: { code: 'stale_local', message: 'Local 在 Apply 写入前发生变化，请重新计算' },
        }
      }

      if (stored.patch.length > 0) {
        await runGit(stored.scope.localGitRoot, ['apply', '--binary', '--whitespace=nowarn'], { input: stored.patch })
      }
      this.plans.delete(plan.revision)
      return { status: 'applied', changedFiles: [...stored.plan.changedFiles], nextBaseOid }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async preview(
    plan: ApplyPlan,
    options: {
      previewId: string
      reviewId: string
      iteration: number
      beforeWrite?(receipt: PreviewReceipt): Promise<void>
    },
  ): Promise<PreviewResult> {
    const stored = this.plans.get(plan.revision)
    if (!stored || !planMatches(stored.plan, plan)) {
      return { status: 'error', error: { code: 'invalid_plan', message: 'Preview plan 不存在、已使用或已被修改' } }
    }
    if (!options.previewId.trim() || !options.reviewId.trim() || !Number.isSafeInteger(options.iteration) || options.iteration < 1) {
      return { status: 'error', error: { code: 'invalid_input', message: 'Preview identity 无效' } }
    }

    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-preview-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(stored.scope.localGitRoot)
      if (!pathsMatch(sourceObjects, stored.scope.sourceObjects)) {
        return { status: 'error', error: { code: 'invalid_plan', message: 'Preview plan 的 Git 仓库身份已变化' } }
      }
      const local = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (
        local.headOid !== stored.plan.localHeadOid
        || local.headRef !== stored.plan.localHeadRef
        || local.fingerprint !== stored.plan.localFingerprint
      ) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' } }
      }
      const isolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'isolated.index'),
        objectDirectory,
        sourceObjects,
      )
      if (isolated.headOid !== stored.plan.isolatedHeadOid || isolated.fingerprint !== stored.plan.isolatedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Isolated 在 plan 后发生变化，请重新计算' } }
      }

      const persistentLocal = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'persistent-local.index'),
        null,
        null,
      )
      const persistentIsolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'persistent-isolated.index'),
        null,
        null,
      )
      if (
        persistentLocal.fingerprint !== stored.plan.localFingerprint
        || persistentIsolated.fingerprint !== stored.plan.isolatedFingerprint
      ) {
        return { status: 'error', error: { code: 'invalid_plan', message: 'Preview 持久快照与审核 plan 不一致' } }
      }
      const previewWorkingTreeOid = await prepareIndexFromPatch(
        stored.scope.localGitRoot,
        join(tempRoot, 'preview-working.index'),
        persistentLocal.treeOid,
        stored.patch,
      )
      const isolatedSnapshotOid = await createSnapshotCommit(
        stored.scope.isolatedGitRoot,
        persistentIsolated.treeOid,
        stored.plan.effectiveBaseOid,
        null,
        null,
        'Previewed Isolated snapshot',
      )
      const preparedReceipt: PreviewReceipt = {
        previewId: options.previewId,
        reviewId: options.reviewId,
        iteration: options.iteration,
        previewedAt: Date.now(),
        configuredBaseOid: stored.input.baseOid,
        effectiveBaseOid: stored.plan.effectiveBaseOid,
        baseStrategy: stored.plan.baseStrategy,
        localHeadOid: persistentLocal.headOid,
        localHeadRef: persistentLocal.headRef,
        localFingerprintBefore: persistentLocal.fingerprint,
        localFingerprintPreview: '',
        localWorkingTreeOid: persistentLocal.treeOid,
        localIndexTreeOid: persistentLocal.indexTreeOid,
        previewWorkingTreeOid,
        isolatedHeadOid: persistentIsolated.headOid,
        isolatedFingerprint: persistentIsolated.fingerprint,
        isolatedSnapshotOid,
        changedFiles: [...stored.plan.changedFiles],
      }

      await this.options.beforeFinalLocalValidation?.()
      const finalLocal = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'final-local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (finalLocal.headOid !== stored.plan.localHeadOid || finalLocal.fingerprint !== stored.plan.localFingerprint) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 Preview 写入前发生变化，请重新计算' } }
      }
      await options.beforeWrite?.(preparedReceipt)
      if (stored.patch.length > 0) {
        await runGit(stored.scope.localGitRoot, ['apply', '--binary', '--whitespace=nowarn'], { input: stored.patch })
      }
      const previewedLocal = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'previewed-local.index'),
        null,
        null,
      )
      if (previewedLocal.treeOid !== previewWorkingTreeOid) {
        return {
          status: 'error',
          error: { code: 'git_error', message: 'Preview 写入后的 Local snapshot 与准备结果不一致，需要恢复确认' },
        }
      }

      this.plans.delete(plan.revision)
      const receipt: PreviewReceipt = {
        ...preparedReceipt,
        localFingerprintPreview: previewedLocal.fingerprint,
      }
      return { status: 'previewed', receipt, changedFiles: [...receipt.changedFiles] }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async assessPreviewRecovery(input: { localPath: string; receipt: PreviewReceipt }): Promise<PreviewRecoveryAssessment | ApplyErrorResult> {
    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-preview-recovery-preflight-'))
      const localGitRoot = await resolveGitRoot(input.localPath)
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(localGitRoot)
      const current = await captureSnapshot(localGitRoot, join(tempRoot, 'current.index'), objectDirectory, sourceObjects)
      const rollback = await prepareRollbackAssessment(tempRoot, sourceObjects, objectDirectory, localGitRoot, current, input.receipt)
      const finalize = await prepareFinalizeAssessment(tempRoot, sourceObjects, objectDirectory, localGitRoot, current, input.receipt)
      return {
        localFingerprint: current.fingerprint,
        localHeadOid: current.headOid,
        localHeadRef: current.headRef,
        localHeadTreeOid: current.headTreeOid,
        localIndexTreeOid: current.indexTreeOid,
        localWorkingTreeOid: current.treeOid,
        rollback,
        finalize,
      }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async rollback(input: {
    localPath: string
    receipt: PreviewReceipt
    beforeWrite?(): Promise<void>
  }): Promise<RollbackResult> {
    let tempRoot: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-preview-rollback-'))
      const localGitRoot = await resolveGitRoot(input.localPath)
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(localGitRoot)
      const current = await captureSnapshot(
        localGitRoot,
        join(tempRoot, 'current.index'),
        objectDirectory,
        sourceObjects,
      )
      const assessment = await prepareRollbackAssessment(
        tempRoot,
        sourceObjects,
        objectDirectory,
        localGitRoot,
        current,
        input.receipt,
      )
      if (assessment.status === 'blocked') {
        return { status: 'error', error: { code: assessment.code, message: assessment.message } }
      }
      const rollbackPatch = await treePatch(
        localGitRoot,
        current.treeOid,
        assessment.targetTreeOid,
        objectDirectory,
        sourceObjects,
      )
      // Journal persistence may await registry I/O, so it must happen before the authoritative
      // final Local CAS. From the snapshot below to git apply there is no callback/yield seam.
      await input.beforeWrite?.()
      await this.options.beforeFinalLocalValidation?.()
      const finalLocal = await captureSnapshot(
        localGitRoot,
        join(tempRoot, 'final-local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (
        finalLocal.fingerprint !== current.fingerprint
        || finalLocal.headOid !== current.headOid
        || finalLocal.headRef !== current.headRef
      ) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在撤回 Preview 前发生变化，请重试' } }
      }
      if (rollbackPatch.length > 0) {
        await runGit(localGitRoot, ['apply', '--binary', '--whitespace=nowarn'], { input: rollbackPatch })
      }
      let rolledBack: CheckoutSnapshot
      try {
        await this.options.afterLocalWriteBeforeVerification?.()
        rolledBack = await captureSnapshot(
          localGitRoot,
          join(tempRoot, 'rolled-back.index'),
          null,
          null,
        )
      } catch (error) {
        return {
          status: 'error',
          error: {
            code: 'git_error',
            message: `Preview 撤回写后无法完成验证，需要保留现场确认：${this.errorMessage(error)}`,
            recoveryState: 'uncertain',
          },
        }
      }
      const expectedFingerprint = snapshotFingerprint(
        current.headOid,
        current.headRef,
        current.indexEntries,
        assessment.targetTreeOid,
      )
      if (
        rolledBack.headOid !== current.headOid
        || rolledBack.headRef !== current.headRef
        || rolledBack.indexTreeOid !== current.indexTreeOid
        || rolledBack.treeOid !== assessment.targetTreeOid
        || rolledBack.fingerprint !== expectedFingerprint
      ) {
        return {
          status: 'error',
          error: {
            code: 'git_error',
            message: 'Preview 撤回后的 Local snapshot 与安全恢复结果不一致，需要保留现场确认',
            recoveryState: 'uncertain',
          },
        }
      }
      return { status: 'preview_rolled_back', changedFiles: [...input.receipt.changedFiles] }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async finalize(input: {
    localPath: string
    receipt: PreviewReceipt
    commitMessage: string
    beforeCommit?(commitOid: string): Promise<void>
  }): Promise<FinishResult> {
    const commitMessage = input.commitMessage.trim()
    if (!commitMessage) {
      return { status: 'error', error: { code: 'invalid_input', message: '提交信息不能为空' } }
    }

    let tempRoot: string | null = null
    let ownedIndexLock: string | null = null
    let backupIndex: string | null = null
    let preserveBackup = false
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-preview-finalize-'))
      const localGitRoot = await resolveGitRoot(input.localPath)
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(localGitRoot)
      const current = await captureSnapshot(
        localGitRoot,
        join(tempRoot, 'current.index'),
        objectDirectory,
        sourceObjects,
      )
      const realIndexPath = await resolveIndexPath(localGitRoot)
      const originalIndexBytes = await readFile(realIndexPath)
      const assessment = await prepareFinalizeAssessment(
        tempRoot,
        sourceObjects,
        objectDirectory,
        localGitRoot,
        current,
        input.receipt,
      )
      if (assessment.status === 'blocked') {
        return { status: 'error', error: { code: assessment.code, message: assessment.message } }
      }

      if (!assessment.commitRequired) {
        await this.options.beforeFinalLocalValidation?.()
        const finalLocal = await captureSnapshot(
          localGitRoot,
          join(tempRoot, 'final-empty.index'),
          objectDirectory,
          sourceObjects,
        )
        if (
          finalLocal.headOid !== current.headOid
          || finalLocal.headRef !== current.headRef
          || finalLocal.fingerprint !== current.fingerprint
        ) {
          return { status: 'error', error: { code: 'stale_local', message: 'Local 在完成 Preview 前发生变化，请重试' } }
        }
        return {
          status: 'finished',
          changedFiles: [],
          commitOid: null,
          nextBaseOid: input.receipt.isolatedSnapshotOid,
        }
      }

      const taskPatch = await treePatch(
        localGitRoot,
        current.headTreeOid,
        assessment.taskTreeOid,
        objectDirectory,
        sourceObjects,
      )
      const finalIndexPatch = await treePatch(
        localGitRoot,
        assessment.taskTreeOid,
        assessment.finalIndexTreeOid,
        objectDirectory,
        sourceObjects,
      )
      const actualTaskTreeOid = await prepareIndexFromPatch(
        localGitRoot,
        join(tempRoot, 'task.index'),
        current.headOid,
        taskPatch,
      )
      if (actualTaskTreeOid !== assessment.taskTreeOid) {
        return { status: 'error', error: { code: 'git_error', message: 'Preview 任务提交 tree 与恢复评估不一致' } }
      }
      const commitOid = await createUserCommit(localGitRoot, actualTaskTreeOid, current.headOid, commitMessage)
      const finalIndexPath = join(tempRoot, 'final.index')
      const actualFinalIndexTreeOid = await prepareIndexFromPatch(
        localGitRoot,
        finalIndexPath,
        commitOid,
        finalIndexPatch,
      )
      if (actualFinalIndexTreeOid !== assessment.finalIndexTreeOid) {
        return { status: 'error', error: { code: 'git_error', message: 'Preview 最终 index tree 与恢复评估不一致' } }
      }
      const expectedIndexEntries = (
        await runGit(localGitRoot, ['ls-files', '--stage', '-z'], { env: { GIT_INDEX_FILE: finalIndexPath } })
      ).stdout
      const intendedIndexBytes = await readFile(finalIndexPath)
      const expectedFingerprint = snapshotFingerprint(
        commitOid,
        current.headRef,
        expectedIndexEntries,
        assessment.expectedWorkingTreeOid,
      )
      await input.beforeCommit?.(commitOid)

      const branchRef = current.headRef
      if (!branchRef?.startsWith('refs/heads/')) {
        return { status: 'error', error: { code: 'operation_not_allowed', message: 'Local 当前不是普通分支，不能自动创建任务提交' } }
      }
      backupIndex = `${realIndexPath}.domi-backup-${randomUUID()}`
      await copyFile(realIndexPath, backupIndex)
      await this.options.beforeFinalLocalValidation?.()
      try {
        // Use Git's canonical index.lock protocol. While this lock exists, concurrent git add/reset
        // cannot mutate the real index between the authoritative snapshot and our atomic replacement.
        ownedIndexLock = await writeIndexLock(realIndexPath, intendedIndexBytes)
      } catch (error) {
        if (isIndexLockContention(error)) {
          return { status: 'error', error: { code: 'stale_local', message: 'Local index 正在被其他 Git 操作更新，请重试' } }
        }
        throw error
      }
      const finalLocal = await captureSnapshot(
        localGitRoot,
        join(tempRoot, 'final-local.index'),
        objectDirectory,
        sourceObjects,
      )
      const finalIndexBytes = await readFile(realIndexPath)
      if (
        finalLocal.headOid !== current.headOid
        || finalLocal.headRef !== current.headRef
        || finalLocal.fingerprint !== current.fingerprint
        || !finalIndexBytes.equals(originalIndexBytes)
      ) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 Preview 提交写入前发生变化，请重试' } }
      }

      let refUpdated = false
      let indexReplaced = false
      let writeError: unknown = null
      try {
        await runGit(localGitRoot, ['update-ref', branchRef, commitOid, current.headOid])
        refUpdated = true
        await rename(ownedIndexLock, realIndexPath)
        ownedIndexLock = null
        indexReplaced = true
      } catch (error) {
        writeError = error
      }

      if (!writeError) {
        try {
          await this.options.afterLocalWriteBeforeVerification?.()
          const committed = await captureSnapshot(
            localGitRoot,
            join(tempRoot, 'committed.index'),
            null,
            null,
          )
          const committedIndexBytes = await readFile(realIndexPath)
          if (
            committed.headOid === commitOid
            && committed.headRef === branchRef
            && committed.indexTreeOid === assessment.finalIndexTreeOid
            && committed.treeOid === assessment.expectedWorkingTreeOid
            && committed.fingerprint === expectedFingerprint
            && committedIndexBytes.equals(intendedIndexBytes)
          ) {
            await removeBestEffort(backupIndex)
            backupIndex = null
            return {
              status: 'finished',
              changedFiles: [...input.receipt.changedFiles],
              commitOid,
              nextBaseOid: input.receipt.isolatedSnapshotOid,
            }
          }
          writeError = new Error('Preview 提交写后验证失败')
        } catch (error) {
          writeError = error
        }
      }

      const rollbackErrors: string[] = []
      if (refUpdated && !indexReplaced && ownedIndexLock) {
        // The ref moved but the index replacement did not. We still own index.lock, so no Git
        // index writer can race the ref CAS rollback; the real index is already the original one.
        try {
          await runGit(localGitRoot, ['update-ref', branchRef, current.headOid, commitOid])
          refUpdated = false
          await removeBestEffort(ownedIndexLock)
          ownedIndexLock = null
        } catch (error) {
          rollbackErrors.push(`ref: ${this.errorMessage(error)}`)
        }
      } else if (refUpdated && indexReplaced && backupIndex) {
        // Compensation is itself a CAS transaction. Never restore the old backup over an index
        // that changed after Domi's write; preserve both the user's index and our backup instead.
        try {
          const backupBytes = await readFile(backupIndex)
          ownedIndexLock = await writeIndexLock(realIndexPath, backupBytes)
          const currentIndexBytes = await readFile(realIndexPath)
          if (!currentIndexBytes.equals(intendedIndexBytes)) {
            rollbackErrors.push('index: Local index 在 Preview 写入后发生变化，拒绝覆盖并发 staged 状态')
          } else {
            await runGit(localGitRoot, ['update-ref', branchRef, current.headOid, commitOid])
            refUpdated = false
            await rename(ownedIndexLock, realIndexPath)
            ownedIndexLock = null
            indexReplaced = false
          }
        } catch (error) {
          rollbackErrors.push(`compensation: ${this.errorMessage(error)}`)
        }
      } else if (refUpdated) {
        rollbackErrors.push('ref: 缺少可验证的 index 补偿证据，拒绝部分回滚')
      }

      let restored = false
      if (rollbackErrors.length === 0) {
        try {
          const restoredLocal = await captureSnapshot(
            localGitRoot,
            join(tempRoot, 'restored.index'),
            null,
            null,
          )
          const restoredIndexBytes = await readFile(realIndexPath)
          restored = restoredLocal.headOid === current.headOid
            && restoredLocal.headRef === current.headRef
            && restoredLocal.indexTreeOid === current.indexTreeOid
            && restoredLocal.treeOid === current.treeOid
            && restoredLocal.fingerprint === current.fingerprint
            && restoredIndexBytes.equals(originalIndexBytes)
        } catch (error) {
          rollbackErrors.push(`verification: ${this.errorMessage(error)}`)
        }
      }
      if (restored) {
        await removeBestEffort(backupIndex)
        backupIndex = null
        return {
          status: 'error',
          error: {
            code: 'git_error',
            message: `Preview 提交写入未能验证，已完整回滚：${this.errorMessage(writeError)}`,
            recoveryState: 'unchanged',
          },
        }
      }

      preserveBackup = true
      const rollbackDetail = rollbackErrors.length > 0 ? `；${rollbackErrors.join('；')}` : ''
      return {
        status: 'error',
        error: {
          code: 'git_error',
          message: `Preview 提交写入后无法证明成功或完整回滚，需要保留现场确认：${this.errorMessage(writeError)}${rollbackDetail}`,
          recoveryState: 'uncertain',
        },
      }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      await removeBestEffort(ownedIndexLock)
      if (!preserveBackup) await removeBestEffort(backupIndex)
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  async finish(plan: ApplyPlan, options: { commitMessage: string }): Promise<FinishResult> {
    const stored = this.plans.get(plan.revision)
    if (!stored || !planMatches(stored.plan, plan)) {
      return { status: 'error', error: { code: 'invalid_plan', message: 'Finish plan 不存在、已使用或已被修改' } }
    }
    const commitMessage = options.commitMessage.trim()
    if (!commitMessage) {
      return { status: 'error', error: { code: 'invalid_input', message: '提交信息不能为空' } }
    }
    if (!stored.plan.localHeadRef?.startsWith('refs/heads/')) {
      return {
        status: 'error',
        error: { code: 'operation_not_allowed', message: 'Local 当前不是普通分支，不能自动创建任务提交' },
      }
    }

    let tempRoot: string | null = null
    let adjacentIndex: string | null = null
    try {
      tempRoot = await mkdtemp(join(tmpdir(), 'domi-finish-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      const sourceObjects = await sourceObjectDirectory(stored.scope.localGitRoot)
      if (!pathsMatch(sourceObjects, stored.scope.sourceObjects)) {
        return { status: 'error', error: { code: 'invalid_plan', message: 'Finish plan 的 Git 仓库身份已变化' } }
      }

      const local = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'local.index'),
        objectDirectory,
        sourceObjects,
      )
      if (
        local.headOid !== stored.plan.localHeadOid
        || local.headRef !== stored.plan.localHeadRef
        || local.fingerprint !== stored.plan.localFingerprint
      ) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 plan 后发生变化，请重新计算' } }
      }
      const isolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'isolated.index'),
        objectDirectory,
        sourceObjects,
      )
      if (isolated.headOid !== stored.plan.isolatedHeadOid || isolated.fingerprint !== stored.plan.isolatedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Isolated 在 plan 后发生变化，请重新计算' } }
      }

      const merge = await computeMerge(
        tempRoot,
        sourceObjects,
        objectDirectory,
        stored.plan.effectiveBaseOid,
        local,
        isolated,
        stored.scope.localGitRoot,
        stored.scope.projectPrefix,
      )
      if (merge.status === 'conflict') {
        return {
          status: 'error',
          error: { code: 'invalid_plan', message: 'Finish 复验得到与已审核 plan 不一致的冲突' },
        }
      }
      if (
        merge.changedFiles.length !== stored.plan.changedFiles.length
        || merge.changedFiles.some((path, index) => path !== stored.plan.changedFiles[index])
      ) {
        return { status: 'error', error: { code: 'invalid_plan', message: 'Finish 复验的文件集合已变化' } }
      }

      const persistentIsolated = await captureSnapshot(
        stored.scope.isolatedGitRoot,
        join(tempRoot, 'persistent-isolated.index'),
        null,
        null,
      )
      if (persistentIsolated.fingerprint !== stored.plan.isolatedFingerprint) {
        return { status: 'error', error: { code: 'stale_isolated', message: 'Isolated 在 plan 后发生变化，请重新计算' } }
      }
      const nextBaseOid = await createSnapshotCommit(
        stored.scope.isolatedGitRoot,
        persistentIsolated.treeOid,
        stored.plan.effectiveBaseOid,
        null,
        null,
        'Finished Isolated snapshot',
      )

      if (merge.changedFiles.length === 0) {
        await this.options.beforeFinalLocalValidation?.()
        const finalLocal = await captureSnapshot(
          stored.scope.localGitRoot,
          join(tempRoot, 'final-local.index'),
          objectDirectory,
          sourceObjects,
        )
        if (finalLocal.fingerprint !== stored.plan.localFingerprint) {
          return { status: 'error', error: { code: 'stale_local', message: 'Local 在 Finish 前发生变化，请重新计算' } }
        }
        this.plans.delete(plan.revision)
        return { status: 'finished', changedFiles: [], commitOid: null, nextBaseOid }
      }

      // C = H + (M - L)：把任务增量从完整 Local 快照 L 中剥离，重放到旧 HEAD H。
      const taskTree = await computeTreeMerge(
        tempRoot,
        sourceObjects,
        objectDirectory,
        stored.scope.localGitRoot,
        'finish-task-isolation',
        local.treeOid,
        local.headTreeOid,
        merge.mergedTreeOid,
      )
      if (taskTree.status === 'conflict') {
        return {
          status: 'error',
          error: {
            code: 'commit_isolation_conflict',
            message: `任务增量无法与 Local 原有修改可靠拆分：${taskTree.conflictingFiles.join('、')}`,
          },
        }
      }

      // S' = C + (S - H)：在任务提交 C 上恢复用户原有 staged 状态。
      const finalIndexTree = await computeTreeMerge(
        tempRoot,
        sourceObjects,
        objectDirectory,
        stored.scope.localGitRoot,
        'finish-index-preservation',
        local.headTreeOid,
        taskTree.treeOid,
        local.indexTreeOid,
      )
      if (finalIndexTree.status === 'conflict') {
        return {
          status: 'error',
          error: {
            code: 'commit_isolation_conflict',
            message: `任务提交与 Local 原有 staged 修改无法可靠分离：${finalIndexTree.conflictingFiles.join('、')}`,
          },
        }
      }

      const taskPatch = await treePatch(
        stored.scope.localGitRoot,
        local.headTreeOid,
        taskTree.treeOid,
        objectDirectory,
        sourceObjects,
      )
      const finalIndexPatch = await treePatch(
        stored.scope.localGitRoot,
        taskTree.treeOid,
        finalIndexTree.treeOid,
        objectDirectory,
        sourceObjects,
      )
      const taskIndexPath = join(tempRoot, 'task-commit.index')
      const actualTaskTreeOid = await prepareIndexFromPatch(
        stored.scope.localGitRoot,
        taskIndexPath,
        local.headOid,
        taskPatch,
      )
      const commitOid = await createUserCommit(
        stored.scope.localGitRoot,
        actualTaskTreeOid,
        local.headOid,
        commitMessage,
      )
      const finalIndexPath = join(tempRoot, 'preserved-local.index')
      await prepareIndexFromPatch(
        stored.scope.localGitRoot,
        finalIndexPath,
        commitOid,
        finalIndexPatch,
      )

      await this.options.beforeFinalLocalValidation?.()
      const finalLocal = await captureSnapshot(
        stored.scope.localGitRoot,
        join(tempRoot, 'final-local-validation.index'),
        objectDirectory,
        sourceObjects,
      )
      if (
        finalLocal.headOid !== stored.plan.localHeadOid
        || finalLocal.headRef !== stored.plan.localHeadRef
        || finalLocal.fingerprint !== stored.plan.localFingerprint
      ) {
        return { status: 'error', error: { code: 'stale_local', message: 'Local 在 Finish 写入前发生变化，请重新计算' } }
      }

      const realIndexPath = await resolveIndexPath(stored.scope.localGitRoot)
      adjacentIndex = `${realIndexPath}.domi-${randomUUID()}`
      await copyFile(finalIndexPath, adjacentIndex)

      let worktreePatched = false
      let refUpdated = false
      try {
        if (merge.patch.length > 0) {
          await runGit(stored.scope.localGitRoot, ['apply', '--binary', '--whitespace=nowarn'], { input: merge.patch })
          worktreePatched = true
        }
        await runGit(stored.scope.localGitRoot, [
          'update-ref',
          stored.plan.localHeadRef,
          commitOid,
          local.headOid,
        ])
        refUpdated = true
        await rename(adjacentIndex, realIndexPath)
        adjacentIndex = null
      } catch (error) {
        const rollbackErrors: string[] = []
        if (refUpdated) {
          try {
            await runGit(stored.scope.localGitRoot, [
              'update-ref',
              stored.plan.localHeadRef,
              local.headOid,
              commitOid,
            ])
          } catch (rollbackError) {
            rollbackErrors.push(`ref: ${this.errorMessage(rollbackError)}`)
          }
        }
        if (worktreePatched) {
          try {
            await runGit(stored.scope.localGitRoot, ['apply', '-R', '--binary', '--whitespace=nowarn'], { input: merge.patch })
          } catch (rollbackError) {
            rollbackErrors.push(`worktree: ${this.errorMessage(rollbackError)}`)
          }
        }
        const detail = this.errorMessage(error)
        if (rollbackErrors.length > 0) {
          return {
            status: 'error',
            error: {
              code: 'git_error',
              message: `Finish 写入失败且无法证明完整回滚：${detail}；${rollbackErrors.join('；')}`,
            },
          }
        }
        return { status: 'error', error: { code: 'git_error', message: `Finish 写入失败，已回滚：${detail}` } }
      }

      this.plans.delete(plan.revision)
      return {
        status: 'finished',
        changedFiles: [...stored.plan.changedFiles],
        commitOid,
        nextBaseOid,
      }
    } catch (error) {
      return { status: 'error', error: { code: 'git_error', message: this.errorMessage(error) } }
    } finally {
      await removeBestEffort(adjacentIndex)
      if (tempRoot) await this.cleanup(tempRoot)
    }
  }

  private errorMessage(error: unknown): string {
    if (error instanceof GitCommandFailure) {
      return `Git 操作失败（${error.args[0] ?? 'unknown'}）：${error.message}`
    }
    return error instanceof Error ? error.message : '未知 Git 错误'
  }

  private async cleanup(path: string): Promise<void> {
    try {
      await rm(path, { recursive: true, force: true, maxRetries: 2 })
    } catch (error) {
      // 清理失败不能掩盖 plan/apply 的主结果。
      console.warn('[session-checkout-apply] 临时目录清理失败：', error)
    }
  }
}

export function createSessionCheckoutApplyEngine(
  options: SessionCheckoutApplyEngineOptions = {},
): SessionCheckoutApplyEngine {
  return new DefaultSessionCheckoutApplyEngine(options)
}
