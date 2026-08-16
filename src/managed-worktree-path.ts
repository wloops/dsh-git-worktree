import { createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'

const WINDOWS_INVALID_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]/g
const WINDOWS_RESERVED_NAME = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i
const REPEATED_DASHES = /-{2,}/g
const MAX_LABEL_LENGTH = 40
const DEFAULT_IDENTITY_LENGTH = 8

function truncateCodePoints(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('')
}

/** Convert a canonical repository basename into one safe, readable path segment. */
export function sanitizeManagedWorktreeLabel(rawName: string | undefined): string {
  let cleaned = (rawName ?? '')
    .trim()
    .normalize('NFC')
    .replace(WINDOWS_INVALID_CHARACTERS, '-')
    .replace(/\s+/g, '-')
    .replace(REPEATED_DASHES, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')

  cleaned = truncateCodePoints(cleaned, MAX_LABEL_LENGTH)
    .replace(/[.\s-]+$/g, '')

  if (!cleaned) return 'repository'
  return WINDOWS_RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned
}

function checkoutIdentity(value: string, length: number): string {
  const normalized = value.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (!normalized) return 'checkout'
  return normalized.slice(0, Math.max(DEFAULT_IDENTITY_LENGTH, length))
}

/** Stable fallback partition that distinguishes repositories sharing one basename. */
export function createManagedWorktreeRepositoryKey(canonicalGitRoot: string): string {
  return createHash('sha256').update(canonicalGitRoot).digest('hex').slice(0, 12)
}

/** Physical basename: repository identity + trusted checkout identity only. */
export function createManagedWorktreeDirectoryName(input: {
  repositoryName: string
  checkoutId: string
  identityLength?: number
}): string {
  const repositoryLabel = sanitizeManagedWorktreeLabel(input.repositoryName)
  const identity = checkoutIdentity(input.checkoutId, input.identityLength ?? DEFAULT_IDENTITY_LENGTH)
  return `${repositoryLabel}--${identity}--worktree`
}

export interface ManagedWorktreePathCandidates {
  siblingContainer: string
  siblingRoot: string
  fallbackContainer: string
  fallbackRoot: string
}

/**
 * Generate one collision-length candidate without touching the filesystem.
 * The caller probes 8/12/full checkout identities and chooses the first path
 * that does not already exist.
 */
export function createManagedWorktreePathCandidates(input: {
  localGitRoot: string
  managedCheckoutsRoot: string
  repositoryKey: string
  checkoutId: string
  identityLength?: number
}): ManagedWorktreePathCandidates {
  const repositoryLabel = sanitizeManagedWorktreeLabel(basename(input.localGitRoot))
  const directoryName = createManagedWorktreeDirectoryName({
    repositoryName: repositoryLabel,
    checkoutId: input.checkoutId,
    ...(input.identityLength === undefined ? {} : { identityLength: input.identityLength }),
  })
  const siblingContainer = join(dirname(input.localGitRoot), `${repositoryLabel}--worktrees`)
  const fallbackContainer = join(input.managedCheckoutsRoot, 'worktrees', input.repositoryKey)
  return {
    siblingContainer,
    siblingRoot: join(siblingContainer, directoryName),
    fallbackContainer,
    fallbackRoot: join(fallbackContainer, directoryName),
  }
}
