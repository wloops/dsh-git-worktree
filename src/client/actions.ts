/** Browser-side orchestration over Harness Workspace and Session runtime faces. */

export interface IsolatedTargetLocation {
  managedRoot: string
  targetSessionId: string
}

export interface SnapshotStore<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

export interface ClientSessionBinding {
  /** Agent-scoped Client Context; present on real Harness bindings. */
  ctx?: unknown
  session: {
    command(line: string): Promise<
      | { ok: true; value: { matched: boolean } }
      | { ok: false; error: { code: string; message: string } }
    >
  }
}

export interface ClientSessions {
  list: SnapshotStore<{
    current?: string
    ids: string[]
    byId: Record<string, { cwd?: string } | undefined>
  }>
  /** Harness resolves only after the new Session is projected into list/binding. */
  create(input: { workspaceId: string; sessionId: string }): Promise<string>
  open(sessionId: string): void
  binding(sessionId: string): ClientSessionBinding | undefined
}

export interface ClientWorkspaces {
  create(input: { path: string }): Promise<{ workspaceId: string; path: string }>
  openPath(path: string): Promise<void>
}

export interface WorktreeClientServices {
  sessions: ClientSessions
  workspaces: ClientWorkspaces
}

export interface PreSessionInput {
  setDraft(text: string): void
  addImages(ids: readonly string[]): boolean
  removeImage(id: string): void
}

/** Additional public Harness faces used only by the blank-session preparation flow. */
export interface PreSessionWorktreeServices extends WorktreeClientServices {
  sessions: ClientSessions
  workspaces: ClientWorkspaces & {
    archiveSession(sessionId: string): Promise<void>
    delete(workspaceId: string): Promise<void>
  }
  conversation: {
    blocks: {
      set(sessionId: string, block: { reason: string } | undefined): void
      storeFor(sessionId: string): { getSnapshot(): { reason: string } | undefined }
    }
    input: {
      for(ctx: unknown): PreSessionInput
    }
  }
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/u, '').replaceAll('\\', '/')
  const normalizedLeft = normalize(left)
  const normalizedRight = normalize(right)
  return /^[A-Za-z]:\//u.test(normalizedLeft) || /^[A-Za-z]:\//u.test(normalizedRight)
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight
}

/** Open a Session only when the Harness list proves both its identity and cwd. */
export function openExistingSession(
  services: Pick<WorktreeClientServices, 'sessions'>,
  sessionId: string,
  expectedCwd: string,
): boolean {
  const summary = services.sessions.list.getSnapshot().byId[sessionId]
  if (summary?.cwd === undefined || !samePath(summary.cwd, expectedCwd)) return false
  services.sessions.open(sessionId)
  return true
}

async function waitForProjectedSessionPath(
  services: Pick<WorktreeClientServices, 'sessions'>,
  sessionId: string,
  expectedCwd: string,
  isActive: () => boolean,
): Promise<boolean> {
  return new Promise<boolean>((resolvePromise, rejectPromise) => {
    let settled = false
    let unsubscribe: () => void = () => {}
    const settle = (result: boolean, error?: Error): void => {
      if (settled) return
      settled = true
      globalThis.clearTimeout(timer)
      unsubscribe()
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const inspect = (): void => {
      if (!isActive()) {
        settle(false)
        return
      }
      const summary = services.sessions.list.getSnapshot().byId[sessionId]
      if (summary?.cwd === undefined) return
      if (!samePath(summary.cwd, expectedCwd)) {
        settle(false, new Error(`Harness 新建 Session ${sessionId} 的 cwd 与 Host 记录不一致。`))
        return
      }
      settle(true)
    }
    const timer = globalThis.setTimeout(() => {
      settle(false, new Error(`Harness 未投影新建 Session ${sessionId} 的可信 cwd。`))
    }, 2_000)
    const dispose = services.sessions.list.subscribe(inspect)
    unsubscribe = dispose
    if (settled) dispose()
    else inspect()
  })
}

/** Idempotently register the managed root, create the preallocated Session, and navigate. */
export async function openIsolatedTarget(
  services: WorktreeClientServices,
  payload: IsolatedTargetLocation,
  isActive: () => boolean = () => true,
): Promise<void> {
  const existing = services.sessions.list.getSnapshot().byId[payload.targetSessionId]
  if (existing !== undefined) {
    if (!openExistingSession(services, payload.targetSessionId, payload.managedRoot)) {
      throw new Error(`Harness 现有 Session ${payload.targetSessionId} 的 cwd 与 Host 记录不一致。`)
    }
    return
  }
  const workspace = await services.workspaces.create({ path: payload.managedRoot })
  if (!isActive()) return
  if (workspace.path !== payload.managedRoot) {
    throw new Error(`Harness 注册的工作目录与 Host 记录不一致：${workspace.path}`)
  }
  const sessionId = await services.sessions.create({
    workspaceId: workspace.workspaceId,
    sessionId: payload.targetSessionId,
  })
  if (sessionId !== payload.targetSessionId) {
    throw new Error(`Harness 创建了非预期 Session ${sessionId}；应为 ${payload.targetSessionId}`)
  }
  if (!await waitForProjectedSessionPath(services, sessionId, payload.managedRoot, isActive)) return
  if (!isActive()) return
  services.sessions.open(sessionId)
}

/** Submit an exact review-card acceptance as an explicit user command. */
export async function finalizeCurrentSession(
  services: Pick<WorktreeClientServices, 'sessions'>,
  reviewId: string,
  revision: number,
  retention: 'cleanup' | 'retain_24h' | 'retain_3d' | 'retain_manual',
): Promise<void> {
  const sessionId = services.sessions.list.getSnapshot().current
  if (!sessionId) throw new Error('当前没有选中的 Session。')
  const binding = services.sessions.binding(sessionId)
  if (!binding) throw new Error('当前 Session 尚未就绪。')
  const result = await binding.session.command(`/worktree finalize ${reviewId} ${revision} ${retention}`)
  if (!result.ok) throw new Error(`Finalize command failed: ${result.error.code}: ${result.error.message}`)
  if (!result.value.matched) throw new Error('Host 未识别 /worktree 命令。')
}
