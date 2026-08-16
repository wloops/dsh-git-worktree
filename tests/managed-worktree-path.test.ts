import { describe, expect, test } from 'vitest'
import { join } from 'node:path'
import {
  createManagedWorktreeDirectoryName,
  createManagedWorktreePathCandidates,
  createManagedWorktreeRepositoryKey,
  sanitizeManagedWorktreeLabel,
} from '../src/managed-worktree-path.ts'

describe('managed worktree path', () => {
  test('保留中文并清理 Windows 非法字符与空格', () => {
    expect(sanitizeManagedWorktreeLabel('  修复 Worktree: 路径/命名？  ')).toBe('修复-Worktree-路径-命名？')
  })

  test('处理 Windows 保留名、空名称与过长仓库名', () => {
    expect(sanitizeManagedWorktreeLabel('CON')).toBe('_CON')
    expect(sanitizeManagedWorktreeLabel('')).toBe('repository')
    expect(Array.from(sanitizeManagedWorktreeLabel('很长'.repeat(30))).length).toBe(40)
  })

  test('物理目录只包含可信仓库名、Checkout 短 ID 和 worktree 后缀', () => {
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
    })).toBe('dsh-git-worktree--85846a61--worktree')
  })

  test('短 ID 路径冲突时可以确定性扩展到更长 identity', () => {
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      identityLength: 12,
    })).toBe('dsh-git-worktree--85846a614a12--worktree')
    expect(createManagedWorktreeDirectoryName({
      repositoryName: 'dsh-git-worktree',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
      identityLength: 32,
    })).toBe('dsh-git-worktree--85846a614a1241cf8ecc1e3f2fef7e40--worktree')
  })

  test('候选路径集中到仓库同级容器，并在插件 worktrees 根按仓库 key 回退', () => {
    const candidates = createManagedWorktreePathCandidates({
      localGitRoot: join('D:', 'workspace', 'dsh-git-worktree'),
      managedCheckoutsRoot: join('C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree'),
      repositoryKey: '345d83347b',
      checkoutId: '85846a61-4a12-41cf-8ecc-1e3f2fef7e40',
    })

    const directoryName = 'dsh-git-worktree--85846a61--worktree'
    expect(candidates.siblingContainer).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees'))
    expect(candidates.siblingRoot).toBe(join('D:', 'workspace', 'dsh-git-worktree--worktrees', directoryName))
    expect(candidates.fallbackRoot).toBe(join(
      'C:', 'Users', 'A', '.dsh', 'plugins', 'dsh-git-worktree', 'worktrees', '345d83347b', directoryName,
    ))
  })

  test('fallback repository key 绑定 canonical Git root 而不是可冲突的 basename', () => {
    expect(createManagedWorktreeRepositoryKey('D:/workspace/team-a/repo'))
      .not.toBe(createManagedWorktreeRepositoryKey('D:/workspace/team-b/repo'))
    expect(createManagedWorktreeRepositoryKey('D:/workspace/team-a/repo')).toMatch(/^[a-f0-9]{12}$/)
  })
})
