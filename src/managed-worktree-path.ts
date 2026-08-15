import { basename, dirname, join } from 'node:path'

const DEFAULT_SESSION_TITLES = new Set(['新 Agent 会话', '新会话'])
const WINDOWS_INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const DISPLAY_SUFFIX = /\s*\((?:worktree|fork)\)\s*$/i
const REPEATED_DASHES = /-{2,}/g
const MAX_LABEL_LENGTH = 40

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

/** 将会话标题转换为跨平台安全、可读的单个目录名片段。 */
export function sanitizeManagedWorktreeLabel(rawTitle: string | undefined): string {
  const withoutDisplaySuffix = (rawTitle ?? '').replace(DISPLAY_SUFFIX, '').trim()
  const source = DEFAULT_SESSION_TITLES.has(withoutDisplaySuffix) ? '' : withoutDisplaySuffix
  let cleaned = source
    .normalize('NFC')
    .replace(WINDOWS_INVALID_CHARACTERS, '-')
    .replace(/\s+/g, '-')
    .replace(REPEATED_DASHES, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')

  cleaned = truncateCodePoints(cleaned, MAX_LABEL_LENGTH)
    .replace(/[.\s-]+$/g, '')

  if (!cleaned) return 'worktree'
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned
}

function shortIdentity(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || fallback
}

export function createManagedWorktreeDirectoryName(input: {
  sessionId: string
  sessionTitle?: string
  checkoutId?: string
  iteration?: number
}): string {
  const sessionIdentity = shortIdentity(input.sessionId, 'session')
  if (!input.checkoutId || !input.iteration) {
    return `${sanitizeManagedWorktreeLabel(input.sessionTitle)}--${sessionIdentity}`
  }
  const checkoutIdentity = shortIdentity(input.checkoutId, 'checkout')
  return `${sanitizeManagedWorktreeLabel(input.sessionTitle)}--${sessionIdentity}--i${input.iteration}--${checkoutIdentity}`
}

export interface ManagedWorktreePathCandidates {
  siblingContainer: string
  siblingRoot: string
  fallbackRoot: string
}

/**
 * 只生成候选路径，不访问文件系统：
 * - siblingRoot：Git 根目录同级的可读容器；
 * - fallbackRoot：原 Domi 数据目录下、按 repository key 分组的安全回退。
 */
export function createManagedWorktreePathCandidates(input: {
  localGitRoot: string
  managedCheckoutsRoot: string
  repositoryKey: string
  sessionId: string
  sessionTitle?: string
  checkoutId?: string
  iteration?: number
}): ManagedWorktreePathCandidates {
  const repositoryLabel = sanitizeManagedWorktreeLabel(basename(input.localGitRoot))
  const directoryName = createManagedWorktreeDirectoryName(input)
  const siblingContainer = join(dirname(input.localGitRoot), `${repositoryLabel}-worktrees`)
  return {
    siblingContainer,
    siblingRoot: join(siblingContainer, directoryName),
    fallbackRoot: join(input.managedCheckoutsRoot, input.repositoryKey, directoryName),
  }
}
