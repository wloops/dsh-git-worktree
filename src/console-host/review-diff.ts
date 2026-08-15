import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, posix } from 'node:path'
import type { WorktreeConsoleDiffFile, WorktreeConsoleReviewDiffResponse } from '../console-contract.js'

export const REVIEW_DIFF_MAX_FILES = 200
export const REVIEW_DIFF_MAX_PATCH_BYTES = 100 * 1024
export const REVIEW_DIFF_MAX_PAYLOAD_BYTES = 1024 * 1024

export interface ReviewDiffReadInput {
  managedRoot: string
  baseOid: string
  reviewId: string
  revision: number
  changedFiles: readonly string[]
}

export interface WorktreeReviewDiffReader {
  read(input: ReviewDiffReadInput): Promise<WorktreeConsoleReviewDiffResponse>
}

export class ReviewDiffStaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReviewDiffStaleError'
  }
}

interface GitOutput { stdout: Buffer; truncated: boolean }

async function git(cwd: string, args: readonly string[], env: NodeJS.ProcessEnv, maxBytes: number): Promise<GitOutput> {
  return await new Promise<GitOutput>((resolveResult, reject) => {
    const child = spawn('git', ['-c', 'core.quotePath=false', ...args], {
      cwd,
      env: { ...env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    child.stdout.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, maxBytes - stdoutBytes)
      if (remaining > 0) stdout.push(chunk.subarray(0, remaining))
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > maxBytes) truncated = true
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const remaining = Math.max(0, 64 * 1024 - stderrBytes)
      if (remaining > 0) stderr.push(chunk.subarray(0, remaining))
      stderrBytes += chunk.byteLength
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolveResult({ stdout: Buffer.concat(stdout), truncated })
      else reject(new Error(`git ${args[0] ?? ''} failed (${String(code)}): ${Buffer.concat(stderr).toString('utf8').trim()}`))
    })
  })
}

function projectPath(value: string): boolean {
  if (!value || value.includes('\0') || value.includes('\\') || isAbsolute(value)) return false
  const normalized = posix.normalize(value)
  return normalized === value && normalized !== '..' && !normalized.startsWith('../') && !normalized.startsWith('/')
}

function utf8Prefix(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.byteLength <= maxBytes) return value
  let end = Math.max(0, maxBytes)
  while (end > 0 && end < bytes.byteLength && (bytes[end]! & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

function payloadBytes(response: WorktreeConsoleReviewDiffResponse): number {
  return Buffer.byteLength(JSON.stringify(response), 'utf8')
}

interface ChangedEntry {
  path: string
  previousPath?: string
  status: WorktreeConsoleDiffFile['status']
}

function parseNameStatus(output: Buffer): ChangedEntry[] {
  const fields = output.toString('utf8').split('\0')
  const entries: ChangedEntry[] = []
  let index = 0
  while (index < fields.length) {
    const code = fields[index++]
    if (!code) break
    if (code.startsWith('R') || code.startsWith('C')) {
      const previousPath = fields[index++] ?? ''
      const path = fields[index++] ?? ''
      entries.push({ path, previousPath, status: 'renamed' })
      continue
    }
    const path = fields[index++] ?? ''
    entries.push({
      path,
      status: code.startsWith('A') ? 'added' : code.startsWith('D') ? 'deleted' : 'modified',
    })
  }
  return entries
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function changedPathSet(entries: readonly ChangedEntry[]): string[] {
  return sortedUnique(entries.flatMap(entry => entry.previousPath === undefined ? [entry.path] : [entry.previousPath, entry.path]))
}

export function createGitWorktreeReviewDiffReader(): WorktreeReviewDiffReader {
  return {
    async read(input) {
      const expected = sortedUnique(input.changedFiles)
      if (expected.some(path => !projectPath(path))) throw new Error('review changedFiles contains an unsafe project-relative path')
      const tempRoot = await mkdtemp(join(tmpdir(), 'dsh-worktree-console-diff-'))
      const objectDirectory = join(tempRoot, 'objects')
      await mkdir(objectDirectory, { recursive: true })
      try {
        const objects = (await git(
          input.managedRoot,
          ['rev-parse', '--path-format=absolute', '--git-path', 'objects'],
          process.env,
          32 * 1024,
        )).stdout.toString('utf8').trim()
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          GIT_INDEX_FILE: join(tempRoot, 'index'),
          GIT_OBJECT_DIRECTORY: objectDirectory,
          GIT_ALTERNATE_OBJECT_DIRECTORIES: objects,
          GIT_CONFIG_NOSYSTEM: '1',
        }
        await git(input.managedRoot, ['read-tree', input.baseOid], env, 16 * 1024)
        await git(input.managedRoot, ['add', '-A', '--', '.'], env, 16 * 1024)
        const names = await git(
          input.managedRoot,
          ['diff', '--cached', '--name-status', '-z', '--find-renames', input.baseOid, '--', '.'],
          env,
          4 * 1024 * 1024,
        )
        if (names.truncated) throw new Error('review diff path inventory exceeds the safe read budget')
        const entries = parseNameStatus(names.stdout)
        if (entries.some(entry => !projectPath(entry.path) || (entry.previousPath !== undefined && !projectPath(entry.previousPath)))) {
          throw new Error('git diff returned an unsafe project-relative path')
        }
        const actual = changedPathSet(entries)
        if (actual.length !== expected.length || actual.some((path, index) => path !== expected[index])) {
          throw new ReviewDiffStaleError('review changedFiles no longer matches the isolated snapshot')
        }

        const files: WorktreeConsoleDiffFile[] = []
        let truncated = entries.length > REVIEW_DIFF_MAX_FILES
        for (const entry of entries.slice(0, REVIEW_DIFF_MAX_FILES)) {
          const numstat = await git(
            input.managedRoot,
            ['diff', '--cached', '--numstat', '-z', input.baseOid, '--', entry.path],
            env,
            32 * 1024,
          )
          const binary = numstat.stdout.toString('utf8').startsWith('-\t-\t')
          let patch: string | null = null
          let fileTruncated = false
          if (!binary) {
            const patchResult = await git(
              input.managedRoot,
              ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--find-renames', input.baseOid, '--', entry.path],
              env,
              REVIEW_DIFF_MAX_PATCH_BYTES,
            )
            patch = patchResult.stdout.toString('utf8')
            fileTruncated = patchResult.truncated
          }
          const file: WorktreeConsoleDiffFile = {
            path: entry.path,
            ...(entry.previousPath === undefined ? {} : { previousPath: entry.previousPath }),
            status: binary ? 'binary' : entry.status,
            patch,
            truncated: fileTruncated,
          }
          let candidate: WorktreeConsoleReviewDiffResponse = {
            reviewId: input.reviewId,
            revision: input.revision,
            files: [...files, file],
            truncated: truncated || fileTruncated,
          }
          if (payloadBytes(candidate) > REVIEW_DIFF_MAX_PAYLOAD_BYTES) {
            truncated = true
            if (file.patch !== null) {
              const shell = { ...file, patch: '', truncated: true }
              const overhead = payloadBytes({ ...candidate, files: [...files, shell], truncated: true })
              const reduced = { ...shell, patch: utf8Prefix(file.patch, Math.max(0, REVIEW_DIFF_MAX_PAYLOAD_BYTES - overhead - 16)) }
              candidate = { ...candidate, files: [...files, reduced], truncated: true }
              if (payloadBytes(candidate) <= REVIEW_DIFF_MAX_PAYLOAD_BYTES) files.push(reduced)
            }
            break
          }
          files.push(file)
          if (fileTruncated) truncated = true
        }
        return { reviewId: input.reviewId, revision: input.revision, files, truncated }
      } finally {
        await rm(tempRoot, { recursive: true, force: true })
      }
    },
  }
}
