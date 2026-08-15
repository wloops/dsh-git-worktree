import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import {
  createManagedWorktreeDirectoryName,
  createManagedWorktreePathCandidates,
  sanitizeManagedWorktreeLabel,
} from '../src/managed-worktree-path.ts'

describe('managed worktree path', () => {
  test('保留中文并清理 Windows 非法字符与空格', () => {
    expect(sanitizeManagedWorktreeLabel('  修复 Worktree: 路径/命名？  ')).toBe('修复-Worktree-路径-命名？')
  })

  test('处理 Windows 保留名、默认标题与过长标题', () => {
    expect(sanitizeManagedWorktreeLabel('CON')).toBe('_CON')
    expect(sanitizeManagedWorktreeLabel('新 Agent 会话')).toBe('worktree')
    expect(Array.from(sanitizeManagedWorktreeLabel('很长'.repeat(30))).length).toBe(40)
  })

  test('Worktree owner 目录移除 fork 展示后缀并追加 session 短 ID', () => {
    expect(createManagedWorktreeDirectoryName({
      sessionId: 'c912a341-1234-5678-9012-abcdefabcdef',
      sessionTitle: '测试思路 (worktree)',
    })).toBe('测试思路--c912a341')

    expect(createManagedWorktreeDirectoryName({
      sessionId: '1fde02d4-1234-5678-9012-abcdefabcdef',
      sessionTitle: '修复分叉菜单 (fork)',
    })).toBe('修复分叉菜单--1fde02d4')
  })

  test('每个 iteration 使用 checkout identity 生成唯一目录', () => {
    expect(createManagedWorktreeDirectoryName({
      sessionId: 'c912a341-1234-5678-9012-abcdefabcdef',
      sessionTitle: '测试思路',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      iteration: 2,
    })).toBe('测试思路--c912a341--i2--85846a61')
  })

  test('候选路径优先位于 Git 根目录同级，回退路径保留仓库 key 分组', () => {
    const candidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'domi'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.domi', 'worktrees'),
      repositoryKey: '345d83347b',
      sessionId: 'c912a341-1234-5678-9012-abcdefabcdef',
      sessionTitle: '优化 Worktree 路径与命名',
    })

    expect(candidates.siblingContainer).toBe(join('D:', 'workspace', 'domi-worktrees'))
    expect(candidates.siblingRoot).toBe(join(
      'D:', 'workspace', 'domi-worktrees', '优化-Worktree-路径与命名--c912a341',
    ))
    expect(candidates.fallbackRoot).toBe(join(
      'C:', 'Users', 'A', '.domi', 'worktrees', '345d83347b', '优化-Worktree-路径与命名--c912a341',
    ))
  })
})
