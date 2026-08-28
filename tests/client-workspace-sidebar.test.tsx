// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { SessionId, SessionListState, WorkspaceId, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorktreeConsoleAdapter } from '../src/console-contract.js'
import {
  ManagedOfficialWorkspaceBrowser,
  registerManagedWorkspaceSidebar,
} from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

const localSession = 'local-session' as SessionId
const ownerSession = 'owner-session' as SessionId
const localWorkspace = 'project-local' as WorkspaceId
const managedWorkspace = 'managed-workspace' as WorkspaceId

afterEach(() => { cleanup(); vi.restoreAllMocks() })

function state() {
  const sessions = {
    current: localSession,
    ids: [localSession, ownerSession],
    byId: {
      [localSession]: {
        id: localSession, displayTitle: '普通 Local 会话', cwd: 'D:/project', blank: false,
        running: false, updatedAt: 1, origin: 'user' as const,
      },
      [ownerSession]: {
        id: ownerSession, displayTitle: '修复验收卡', cwd: 'D:/project-worktrees/task', blank: false,
        running: false, updatedAt: 2, origin: 'user' as const,
      },
    },
  } as unknown as SessionListState
  const workspaces = {
    items: [
      { workspaceId: localWorkspace, title: 'demo', path: 'D:/project', createdAt: new Date(0).toISOString(), sessionIds: [localSession] },
      { workspaceId: managedWorkspace, title: 'demo--uuid--worktree', path: 'D:/project-worktrees/task', createdAt: new Date(0).toISOString(), sessionIds: [ownerSession] },
    ],
    archivedSessionIds: [], state: 'idle', phase: 'ready', error: null, baselinesReady: true,
  } as unknown as WorkspaceListState
  return { sessions, workspaces }
}

function adapter(): WorktreeConsoleAdapter {
  const fixture = createWorktreeConsoleAdapterFixture().adapter
  return {
    ...fixture,
    sidebarTopology: vi.fn(async () => ({
      ok: true as const,
      value: {
        projects: [{
          project: { id: localWorkspace, name: 'demo' },
          tasks: [{
            checkoutId: 'checkout-1', ownerSessionId: ownerSession, sourceSessionId: localSession,
            iteration: 1, revision: 3, phase: 'ready' as const, state: 'ready_for_review' as const,
          }],
        }],
      },
    })),
  }
}

function browserProps(snapshot = state()): WorkspaceBrowserProps {
  return {
    wide: true,
    expandSidebar: vi.fn(),
    useSessions: selector => selector(snapshot.sessions),
    useWorkspaces: selector => selector(snapshot.workspaces),
    startSession: vi.fn(),
    open: vi.fn(),
    renameSession: vi.fn(),
    forkSession: vi.fn(),
    archiveSession: vi.fn(),
    insertSessionBefore: vi.fn(),
  } as unknown as WorkspaceBrowserProps
}

function InspectBrowser(props: WorkspaceBrowserProps) {
  const workspaces = props.useWorkspaces(value => value.items)
  const sessions = props.useSessions(value => value.byId)
  return <div>
    <button onClick={() => { void props.startSession(managedWorkspace) }}>new managed</button>
    <button onClick={() => { void props.renameSession(ownerSession, '新标题') }}>rename managed</button>
    <button onClick={() => { void props.archiveSession(ownerSession) }}>archive managed</button>
    <button onClick={() => { void props.forkSession(ownerSession) }}>fork managed</button>
    <button onClick={() => { void props.insertSessionBefore(localWorkspace, ownerSession, localSession) }}>move managed</button>
    <button onClick={() => { void props.renameSession(localSession, 'Local 新标题') }}>rename local</button>
    <button onClick={() => { void props.archiveSession(localSession) }}>archive local</button>
    <button onClick={() => { void props.forkSession(localSession) }}>fork local</button>
    {workspaces.map(workspace => <section key={workspace.workspaceId}>
      <h2>{workspace.title}</h2>
      {workspace.sessionIds.map(id => {
        const summary = sessions[id] as typeof sessions[typeof id] & {
          __dshGitWorktree?: { state: string; label: string; kind: string }
        }
        return <button
          key={id}
          data-worktree-kind={summary?.__dshGitWorktree?.kind}
          data-worktree-state={summary?.__dshGitWorktree?.state}
          data-worktree-label={summary?.__dshGitWorktree?.label}
          onClick={() => { props.open(id) }}
        >
          {summary?.displayTitle}
        </button>
      })}
    </section>)}
  </div>
}

describe('Managed Workspace sidebar', () => {
  test('applies one official declaration tree while wrapping only the Browser component', () => {
    const descriptors: Record<string, unknown>[] = []
    const components: unknown[] = []
    const context = {
      effect: vi.fn((setup: () => unknown) => { setup() }),
      locale: { register: vi.fn() },
      slots: {
        inject: (_name: string, callback: () => unknown) => { callback() },
        register: (descriptor: Record<string, unknown>, component: unknown) => {
          descriptors.push(descriptor)
          components.push(component)
          return () => {}
        },
      },
    }

    registerManagedWorkspaceSidebar(context, adapter())

    expect(descriptors).toEqual([
      expect.objectContaining({
        name: 'sidebar.workspaces',
        children: {
          'sidebar.workspaces.directoryFlow': { kind: 'single', scope: 'root' },
        },
      }),
      expect.objectContaining({
        name: 'conversation.hero.workspace',
        children: {
          'conversation.hero.workspace.directoryFlow': { kind: 'single', scope: 'root' },
        },
      }),
    ])
    expect(components[0]).not.toBe(components[1])
    expect(context.locale.register).toHaveBeenCalledWith('workspace', {})
  })

  test('projects one owner Session, allows rename/archive, and silently blocks second-session operations', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const props = browserProps()
    render(<ManagedOfficialWorkspaceBrowser
      {...props}
      adapter={adapter()}
      OfficialBrowser={InspectBrowser}
    />)

    await waitFor(() => expect(screen.getByText('修复验收卡').getAttribute('data-worktree-kind')).toBe('managed-worktree'))
    const owner = screen.getByText('修复验收卡')
    expect(owner.getAttribute('data-worktree-state')).toBe('ready_for_review')
    expect(owner.getAttribute('data-worktree-label')).toBe('待验收')
    expect(screen.getByText('普通 Local 会话').getAttribute('data-worktree-kind')).toBeNull()
    expect(screen.queryByText('修复验收卡 · 待验收')).toBeNull()
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.queryByText('demo--uuid--worktree')).toBeNull()
    fireEvent.click(owner)
    fireEvent.click(screen.getByText('rename managed'))
    fireEvent.click(screen.getByText('archive managed'))
    fireEvent.click(screen.getByText('fork managed'))
    fireEvent.click(screen.getByText('move managed'))
    fireEvent.click(screen.getByText('new managed'))
    fireEvent.click(screen.getByText('rename local'))
    fireEvent.click(screen.getByText('archive local'))
    fireEvent.click(screen.getByText('fork local'))

    expect(props.open).toHaveBeenCalledWith(ownerSession)
    expect(props.renameSession).toHaveBeenCalledWith(ownerSession, '新标题')
    expect(props.archiveSession).toHaveBeenCalledWith(ownerSession)
    expect(props.renameSession).toHaveBeenCalledWith(localSession, 'Local 新标题')
    expect(props.archiveSession).toHaveBeenCalledWith(localSession)
    expect(props.forkSession).toHaveBeenCalledTimes(1)
    expect(props.forkSession).toHaveBeenCalledWith(localSession)
    expect(props.insertSessionBefore).not.toHaveBeenCalled()
    expect(props.startSession).not.toHaveBeenCalled()
    expect(alert).not.toHaveBeenCalled()
  })

  test('falls back to the untouched official projection when topology is unavailable', async () => {
    const props = browserProps()
    const unavailable = {
      ...createWorktreeConsoleAdapterFixture().adapter,
      sidebarTopology: vi.fn(async () => ({
        ok: false as const,
        error: { code: 'transport_unavailable' as const, message: 'offline' },
      })),
    }
    render(<ManagedOfficialWorkspaceBrowser
      {...props}
      adapter={unavailable}
      OfficialBrowser={InspectBrowser}
    />)

    await waitFor(() => expect(unavailable.sidebarTopology).toHaveBeenCalled())
    expect(screen.getByText('demo')).toBeTruthy()
    expect(screen.getByText('demo--uuid--worktree')).toBeTruthy()
    expect(screen.queryByText('修复验收卡 · 待验收')).toBeNull()
  })
})
