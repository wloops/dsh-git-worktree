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

  test('fails open when a Managed Workspace contains an unexpected second Session', () => {
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
    expect(result.workspaces[0]?.sessionIds).toEqual(['local-session'])
    expect(result.managedBySessionId['owner-session']).toBeUndefined()
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
