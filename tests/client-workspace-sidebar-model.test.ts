import { describe, expect, test } from 'vitest'
import {
  projectManagedWorkspaceSidebar,
  type SidebarSessionSummary,
  type SidebarWorkspaceView,
} from '../src/client/workspace-sidebar/model.js'
import type { WorktreeSidebarTopologyResponse } from '../src/console-contract.js'

function workspace(
  workspaceId: string,
  title: string,
  sessionIds: string[],
): SidebarWorkspaceView {
  return { workspaceId, title, path: `D:/workspace/${workspaceId}`, sessionIds }
}

function session(id: string, title: string): SidebarSessionSummary {
  return { id, displayTitle: title }
}

function topology(
  tasks: WorktreeSidebarTopologyResponse['projects'][number]['tasks'],
): WorktreeSidebarTopologyResponse {
  return {
    projects: [{ project: { id: 'project-local', name: 'demo' }, tasks }],
  }
}

describe('Managed Workspace sidebar projection', () => {
  test('projects one Managed owner Session directly into its Local project and removes the UUID Workspace row', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [
        workspace('project-local', 'demo', ['local-session']),
        workspace('managed-workspace', 'demo--checkout-uuid--worktree', ['owner-session']),
      ],
      sessions: {
        'local-session': session('local-session', '普通 Local 会话'),
        'owner-session': session('owner-session', '修复验收卡'),
      },
      topology: topology([{
        checkoutId: 'checkout-1',
        ownerSessionId: 'owner-session',
        sourceSessionId: 'source-session',
        iteration: 1,
        revision: 4,
        phase: 'ready',
        state: 'ready_for_review',
      }]),
    })

    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local'])
    expect(result.workspaces[0]?.sessionIds).toEqual(['local-session', 'owner-session'])
    expect(result.managedBySessionId['owner-session']).toMatchObject({
      checkoutId: 'checkout-1',
      label: '待验收',
      state: 'ready_for_review',
    })
    expect([...result.protectedWorkspaceIds]).toEqual(['managed-workspace'])
  })

  test('keeps non-managed Workspaces unchanged and maps every delivery state to concise copy', () => {
    const states = [
      ['working', '进行中'],
      ['ready_for_review', '待验收'],
      ['preview_active', '预览中'],
      ['preview_detached', '待恢复'],
      ['recovery_required', '需要恢复'],
      ['finalized', '已完成'],
      ['discarded', '已放弃'],
    ] as const
    const tasks = states.map(([state], index) => ({
      checkoutId: `checkout-${index}`,
      ownerSessionId: `owner-${index}`,
      sourceSessionId: `source-${index}`,
      iteration: 1,
      revision: index,
      phase: state === 'discarded' ? 'discarded' as const : 'ready' as const,
      state,
    }))
    const result = projectManagedWorkspaceSidebar({
      workspaces: [
        workspace('project-local', 'demo', ['local-session']),
        workspace('ordinary-workspace', 'ordinary', ['ordinary-session']),
      ],
      sessions: {
        'local-session': session('local-session', 'Local'),
        'ordinary-session': session('ordinary-session', 'Ordinary'),
        ...Object.fromEntries(tasks.map(task => [task.ownerSessionId, session(task.ownerSessionId, task.ownerSessionId)])),
      },
      topology: topology(tasks),
    })

    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local', 'ordinary-workspace'])
    expect(result.workspaces[1]?.sessionIds).toEqual(['ordinary-session'])
    expect(states.map(([,], index) => result.managedBySessionId[`owner-${index}`]?.label)).toEqual(states.map(([, label]) => label))
  })

  test('collapses a Managed Workspace while suppressing a provably blank launcher Session', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [
        workspace('project-local', 'demo', ['local-session']),
        workspace('managed-workspace', 'demo--checkout', ['blank-launcher', 'owner-session']),
      ],
      sessions: {
        'local-session': session('local-session', 'Local'),
        'owner-session': session('owner-session', 'Managed owner'),
        'blank-launcher': { ...session('blank-launcher', '新会话'), blank: true },
      },
      topology: topology([{
        checkoutId: 'checkout-1', ownerSessionId: 'owner-session', sourceSessionId: 'source-session',
        iteration: 1, revision: 1, phase: 'ready', state: 'working',
      }]),
    })

    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local'])
    expect(result.workspaces[0]?.sessionIds).toEqual(['local-session', 'owner-session'])
    expect([...result.protectedWorkspaceIds]).toEqual(['managed-workspace'])
    expect([...result.suppressedSessionIds]).toEqual(['blank-launcher'])
    expect(result.managedBySessionId['owner-session']?.label).toBe('进行中')
  })

  test('projects the owner without hiding an unexpected second Session', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [
        workspace('project-local', 'demo', ['local-session']),
        workspace('managed-workspace', 'demo--checkout', ['owner-session', 'unexpected-session']),
      ],
      sessions: {
        'local-session': session('local-session', 'Local'),
        'owner-session': session('owner-session', 'Managed owner'),
        'unexpected-session': session('unexpected-session', 'Unexpected'),
      },
      topology: topology([{
        checkoutId: 'checkout-1', ownerSessionId: 'owner-session', sourceSessionId: 'source-session',
        iteration: 1, revision: 1, phase: 'ready', state: 'working',
      }]),
    })

    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local', 'managed-workspace'])
    expect(result.workspaces[0]?.sessionIds).toEqual(['local-session', 'owner-session'])
    expect(result.workspaces[1]?.sessionIds).toEqual(['unexpected-session'])
    expect(result.managedBySessionId['owner-session']?.label).toBe('进行中')
  })

  test.each([
    { name: 'archived owner missing from the live list', ownerVisible: false, extra: undefined, current: undefined, hidden: true },
    { name: 'archived owner still in the live list', ownerVisible: true, extra: undefined, current: undefined, hidden: true },
    { name: 'selected blank launcher', ownerVisible: true, extra: { ...session('extra', ''), blank: true }, current: 'extra', hidden: false },
    { name: 'unresolved member', ownerVisible: true, extra: undefined, current: 'extra', hidden: false },
  ])('handles $name without losing session visibility', ({ ownerVisible, extra, current, hidden }) => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [
        workspace('project-local', 'demo', []),
        workspace('managed', 'checkout', current ? ['owner', 'extra'] : ['owner']),
      ],
      sessions: { ...(ownerVisible ? { owner: session('owner', 'Task') } : {}), ...(extra ? { extra } : {}) },
      archivedSessionIds: ['owner'],
      currentSessionId: current,
      topology: topology([{
        checkoutId: 'checkout', ownerSessionId: 'owner', sourceSessionId: 'source',
        iteration: 1, revision: 1, phase: 'discarded', state: 'discarded',
      }]),
    })
    expect(result.workspaces.map(item => item.workspaceId)).toEqual(hidden ? ['project-local'] : ['project-local', 'managed'])
    expect(result.workspaces[0]?.sessionIds).toEqual(['owner'])
    expect([...result.suppressedSessionIds]).toEqual([])
  })

  test.each([undefined, false])('does not let an unknown blank flag (%s) block owner grouping', blank => {
    const workspaces = [workspace('project-local', 'demo', []), workspace('managed', 'checkout', ['owner', 'extra'])]
    const result = projectManagedWorkspaceSidebar({
      workspaces,
      sessions: { owner: session('owner', 'Task'), extra: { ...session('extra', 'Launcher'), blank } },
      topology: topology([{
        checkoutId: 'checkout', ownerSessionId: 'owner', sourceSessionId: 'source',
        iteration: 1, revision: 1, phase: 'ready', state: 'working',
      }]),
    })
    expect(result.workspaces[0]?.sessionIds).toEqual(['owner'])
    expect(result.workspaces[1]?.sessionIds).toEqual(['extra'])
    expect([...result.suppressedSessionIds]).toEqual([])
    expect(workspaces[1]?.sessionIds).toEqual(['owner', 'extra'])
  })

  test('projects multiple owners in one workspace without creating ambiguous membership', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [workspace('project-local', 'demo', []), workspace('managed', 'checkout', ['a', 'b'])],
      sessions: { a: session('a', 'A'), b: session('b', 'B') },
      topology: topology(['a', 'b'].map(ownerSessionId => ({
        checkoutId: ownerSessionId, ownerSessionId, sourceSessionId: 'source',
        iteration: 1, revision: 1, phase: 'ready', state: 'working',
      }))),
    })
    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local'])
    expect(result.workspaces[0]?.sessionIds).toEqual(['a', 'b'])
    expect(Object.keys(result.managedBySessionId)).toEqual(['a', 'b'])
  })

  test('keeps a cleaned historical owner under the Local project when its Workspace is already absent', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [workspace('project-local', 'demo', ['local-session'])],
      sessions: {
        'local-session': session('local-session', '普通 Local 会话'),
        'owner-session': session('owner-session', '已完成任务'),
      },
      topology: topology([{
        checkoutId: 'checkout-delivered',
        ownerSessionId: 'owner-session',
        sourceSessionId: 'source-session',
        iteration: 2,
        revision: 10,
        phase: 'discarded',
        state: 'finalized',
      }]),
    })

    expect(result.workspaces[0]?.sessionIds).toEqual(['local-session', 'owner-session'])
    expect(result.managedBySessionId['owner-session']?.label).toBe('已完成')
  })
})


describe('Host-proven historical directory membership', () => {
  const task = { checkoutId: 'checkout', ownerSessionId: 'owner', sourceSessionId: 'source', iteration: 1, revision: 1, phase: 'ready' as const, state: 'working' as const }
  test('coalesces a filtered empty Workspace, an unknown launcher, and an unaccounted cold session without deleting summaries', () => {
    const sessions = { owner: session('owner', 'Task'), launcher: session('launcher', 'Unknown launcher'), cold: session('cold', 'Historical task') }
    const input = {
      workspaces: [workspace('project-local', 'demo', []), workspace('empty', 'cleaned', []), workspace('managed', 'checkout', ['owner', 'launcher'])],
      sessions,
      topology: { projects: [{ project: { id: 'project-local', name: 'demo' }, tasks: [task], memberships: { workspaceIds: ['empty', 'managed'], sessionIds: ['owner', 'launcher', 'cold'] } }] },
    }
    const result = projectManagedWorkspaceSidebar(input)
    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local'])
    expect(new Set(result.workspaces[0]?.sessionIds)).toEqual(new Set(['owner', 'launcher', 'cold']))
    expect(result.relocatedSessionIds.has('launcher')).toBe(true)
    expect(result.managedBySessionId.launcher).toBeUndefined()
    expect(result.managedBySessionId.cold).toBeUndefined()
    expect([...result.suppressedSessionIds]).toEqual([])
    expect(input.workspaces[2]?.sessionIds).toEqual(['owner', 'launcher'])
    expect(Object.keys(sessions)).toEqual(['owner', 'launcher', 'cold'])
  })

  test('retains the selected blank session in the Local group', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [workspace('project-local', 'demo', []), workspace('managed', 'checkout', ['owner', 'launcher'])],
      sessions: { owner: session('owner', 'Task'), launcher: { ...session('launcher', ''), blank: true } },
      currentSessionId: 'launcher',
      topology: { projects: [{ project: { id: 'project-local', name: 'demo' }, tasks: [task], memberships: { workspaceIds: ['managed'], sessionIds: ['owner', 'launcher'] } }] },
    })
    expect(result.workspaces).toHaveLength(1)
    expect(result.workspaces[0]?.sessionIds).toContain('launcher')
    expect(result.suppressedSessionIds.has('launcher')).toBe(false)
  })

  test('does not steal manually accounted sessions or guess an empty directory from its name', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [workspace('project-local', 'demo', []), workspace('other', 'other', ['cold']), workspace('lookalike', 'demo--checkout--worktree', [])],
      sessions: { cold: session('cold', 'Historical task') },
      topology: { projects: [{ project: { id: 'project-local', name: 'demo' }, tasks: [], memberships: { workspaceIds: [], sessionIds: ['cold'] } }] },
    })
    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['project-local', 'other', 'lookalike'])
    expect(result.workspaces[0]?.sessionIds).toEqual([])
    expect(result.workspaces[1]?.sessionIds).toEqual(['cold'])
  })

  test('fails open when multiple projects claim the same directory or session', () => {
    const result = projectManagedWorkspaceSidebar({
      workspaces: [workspace('a', 'A', []), workspace('b', 'B', []), workspace('managed', 'checkout', ['extra'])],
      sessions: { extra: session('extra', 'Task') },
      topology: { projects: ['a', 'b'].map(id => ({ project: { id, name: id }, tasks: [], memberships: { workspaceIds: ['managed'], sessionIds: ['extra'] } })) },
    })
    expect(result.workspaces.map(item => item.workspaceId)).toEqual(['a', 'b', 'managed'])
    expect(result.workspaces[2]?.sessionIds).toEqual(['extra'])
  })
})
