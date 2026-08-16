/** Pure replay-stable ToolView models derived only from logged call/result slices. */

export interface ToolContentBlock {
  type: string
  text?: string
  [key: string]: unknown
}

export interface ToolCallBlockLike {
  callId: string
  argsRaw?: string
  call?: { argsRaw?: string }
  content?: ToolContentBlock[]
  kind?: string
  isError?: boolean
  error?: { name?: string; code?: string }
}

export interface ToolCallViewPropsLike {
  callId: string
  /** Supplied by Harness for every session-scoped ToolView. */
  sessionId?: string
  toolName: string
  block: ToolCallBlockLike
  cwd?: string
  openFile?: (path: string) => void
  inspect?: () => void
}

export interface WorktreeCreatePayload {
  kind: 'worktree_target_created'
  checkoutId: string
  targetSessionId: string
  managedRoot: string
  phase: string
  currentOid: string
  sourceSessionId: string
}

export interface WorktreeReviewPayload {
  kind: 'worktree_ready_for_review'
  state: 'ready_for_review'
  reviewId: string
  revision: number
  iteration: number
  changedFiles: string[]
}

export interface ReviewArgs {
  summary: string
  details?: string
  validationStatus: 'passed' | 'failed' | 'partial' | 'not_run'
  validationSummary?: string
  tests: Array<{ command: string; status: 'passed' | 'failed' | 'not_run'; summary?: string }>
  suggestedCommitMessage: string
}

export type ToolLifecycle = 'running' | 'ok' | 'error' | 'stopped'

export interface ParsedTool<TPayload, TArgs = Record<string, never>> {
  lifecycle: ToolLifecycle
  payload: TPayload | null
  args: TArgs | null
  error: string | null
}

function textContent(block: ToolCallBlockLike): string | null {
  if (!block.kind) return null
  const parts = (block.content ?? []).map((item) => item.type === 'text'
    ? String(item.text ?? '')
    : JSON.stringify(item))
  if (parts.length === 0 && block.error) parts.push(`${block.error.name ?? 'Error'}: ${block.error.code ?? 'unknown'}`)
  return parts.join('\n') || null
}

function parseJson(value: string | undefined): unknown {
  if (!value) return null
  try { return JSON.parse(value) as unknown } catch { return null }
}

function lifecycle(block: ToolCallBlockLike): ToolLifecycle {
  if (!block.kind) return 'running'
  if (block.error?.code === 'interrupted') return 'stopped'
  return block.isError ? 'error' : 'ok'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' && record[key] !== '' ? record[key] : null
}

export function parseCreateTool(block: ToolCallBlockLike): ParsedTool<WorktreeCreatePayload> {
  const state = lifecycle(block)
  const raw = textContent(block)
  const parsed = parseJson(raw ?? undefined)
  if (state === 'running') return { lifecycle: state, payload: null, args: null, error: null }
  if (state !== 'ok') return { lifecycle: state, payload: null, args: null, error: raw ?? 'Worktree creation failed.' }
  if (!isRecord(parsed)
    || parsed.kind !== 'worktree_target_created'
    || !stringField(parsed, 'checkoutId')
    || !stringField(parsed, 'targetSessionId')
    || !stringField(parsed, 'managedRoot')
    || !stringField(parsed, 'phase')
    || !stringField(parsed, 'currentOid')
    || !stringField(parsed, 'sourceSessionId')) {
    return { lifecycle: 'error', payload: null, args: null, error: 'Malformed Worktree create result.' }
  }
  return { lifecycle: state, payload: parsed as unknown as WorktreeCreatePayload, args: null, error: null }
}

function reviewArgs(value: unknown): ReviewArgs | null {
  if (!isRecord(value)) return null
  const summary = stringField(value, 'summary')
  const validationStatus = value.validationStatus
  const suggestedCommitMessage = stringField(value, 'suggestedCommitMessage')
  if (!summary
    || (validationStatus !== 'passed' && validationStatus !== 'failed' && validationStatus !== 'partial' && validationStatus !== 'not_run')
    || !suggestedCommitMessage
    || !Array.isArray(value.tests)) return null
  const tests: ReviewArgs['tests'] = []
  for (const item of value.tests) {
    if (!isRecord(item)
      || !stringField(item, 'command')
      || (item.status !== 'passed' && item.status !== 'failed' && item.status !== 'not_run')
      || (item.summary !== undefined && typeof item.summary !== 'string')) return null
    tests.push({
      command: item.command as string,
      status: item.status,
      ...(typeof item.summary === 'string' && item.summary !== '' ? { summary: item.summary } : {}),
    })
  }
  if ((value.details !== undefined && typeof value.details !== 'string')
    || (value.validationSummary !== undefined && typeof value.validationSummary !== 'string')) return null
  return {
    summary,
    validationStatus,
    tests,
    suggestedCommitMessage,
    ...(typeof value.details === 'string' && value.details !== '' ? { details: value.details } : {}),
    ...(typeof value.validationSummary === 'string' && value.validationSummary !== '' ? { validationSummary: value.validationSummary } : {}),
  }
}

export function parseReviewTool(block: ToolCallBlockLike): ParsedTool<WorktreeReviewPayload, ReviewArgs> {
  const state = lifecycle(block)
  const raw = textContent(block)
  const parsed = parseJson(raw ?? undefined)
  const argsRaw = block.kind ? block.call?.argsRaw : block.argsRaw
  const parsedArgs = reviewArgs(parseJson(argsRaw))
  if (state === 'running') return { lifecycle: state, payload: null, args: parsedArgs, error: null }
  if (state !== 'ok') return { lifecycle: state, payload: null, args: parsedArgs, error: raw ?? 'Ready for Review failed.' }
  if (!isRecord(parsed)
    || parsed.kind !== 'worktree_ready_for_review'
    || parsed.state !== 'ready_for_review'
    || !stringField(parsed, 'reviewId')
    || typeof parsed.revision !== 'number'
    || !Array.isArray(parsed.changedFiles)
    || parsed.changedFiles.some((item) => typeof item !== 'string')) {
    return { lifecycle: 'error', payload: null, args: null, error: 'Malformed Ready for Review result.' }
  }
  if (!parsedArgs) {
    return { lifecycle: 'error', payload: null, args: null, error: 'Malformed Ready for Review arguments.' }
  }
  return {
    lifecycle: state,
    payload: {
      kind: 'worktree_ready_for_review',
      state: 'ready_for_review',
      reviewId: parsed.reviewId as string,
      revision: parsed.revision,
      iteration: typeof parsed.iteration === 'number' && Number.isInteger(parsed.iteration) && parsed.iteration >= 0 ? parsed.iteration : 0,
      changedFiles: [...parsed.changedFiles] as string[],
    },
    args: parsedArgs,
    error: null,
  }
}
