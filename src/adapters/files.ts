/**
 * Node fs adapter for the session-checkout files port: directory identity
 * (device/inode/birthtime) for quarantine CAS, empty-tree residue collection,
 * symlink-guarded recursive removal, and byte measurement. Ported from Domi's
 * production-adapters unchanged.
 * @module dsh-git-worktree/adapters/files
 */

import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync } from 'node:fs'
import { lstat, readdir, realpath, rename, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DirectoryIdentity, SessionCheckoutFilesPort } from '../ports.js'
import { SessionCheckoutError } from '../index.js'

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
    try { await rename(quarantinePath, path) } catch { /* Keep the quarantine; never delete an identity-mismatched object. */ }
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

/** Build the node-fs-backed files port. */
export function createNodeFilesPort(): SessionCheckoutFilesPort {
  return {
    exists: existsSync,
    canonicalize: async (path) => realpath(resolve(path)),
    inspectDirectoryIdentity,
    ensureDirectory: (path) => mkdirSync(path, { recursive: true }),
    removeEmptyDirectoryTree,
    quarantineDirectoryTree,
    removeDirectoryTree,
    measureDirectoryBytes,
  }
}
