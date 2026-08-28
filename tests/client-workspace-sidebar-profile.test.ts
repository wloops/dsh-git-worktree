import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { materializeOfficialWorkspaceClientModule } from '../scripts/workspace-sidebar-upstream.mjs'
import { WORKTREE_STYLES } from '../src/client/styles.js'
import { registerManagedWorkspaceSidebar } from '../src/client/workspace-sidebar/index.js'
import { createWorktreeConsoleAdapterFixture } from './support/worktree-console.js'

function strictSlotLedger() {
  const declarations = new Set<string>()
  const descriptors: Record<string, unknown>[] = []
  const context = {
    effect: vi.fn((setup: () => unknown) => { setup() }),
    locale: { register: vi.fn() },
    slots: {
      inject: (_name: string, callback: () => unknown) => { callback() },
      register: (descriptor: Record<string, unknown>) => {
        for (const name of [String(descriptor.name), ...Object.keys((descriptor.children ?? {}) as object)]) {
          if (declarations.has(name)) throw new Error(`slot ${JSON.stringify(name)} is already declared`)
          declarations.add(name)
        }
        descriptors.push(descriptor)
        return () => {}
      },
    },
  }
  return { context, declarations, descriptors }
}

describe('Managed Workspace profile ownership', () => {
  test('disables the original loader and publishes the gated derivative attribution', () => {
    const patch = readFileSync(resolve('cordis.patch.yml'), 'utf8')
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
      dsh: { client: { inject: string[] } }
      files: string[]
    }
    expect(patch).toMatch(/- id: ui-workspace\s+name: ['"]?@deepseek-ai\/dsh-client-ui-workspace['"]?\s+disabled: true/u)
    expect(patch).toMatch(/- insert:\s+- id: dsh-git-worktree\s+name: dsh-git-worktree/u)
    expect(manifest.dsh.client.inject).not.toContain('@deepseek-ai/dsh-client-ui-workspace')
    expect(manifest.files).toContain('NOTICE')
  })

  test('derives a real Branch Icon and independent status Badge without rewriting the session title', () => {
    const source = materializeOfficialWorkspaceClientModule()

    expect(source).toContain('IconBranchOutline16')
    expect(source).toContain('__dshGitWorktree')
    expect(source).toContain('dsh-git-worktree-sidebar-icon')
    expect(source).toContain('dsh-git-worktree-sidebar-badge')
    expect(source).toContain('data-worktree-state')
    expect(source).toContain('dshGitWorktree.state.ready_for_review')
    expect(source).toContain('dshGitWorktree.managed')
    expect(source).toContain('worktreeDecoration.ariaLabel')
    expect(source).toContain('"data-managed-worktree": "true"')
    expect(source).toContain('className: Rows_module_css_default.hoverStatus')
    expect(WORKTREE_STYLES).toContain('.dsh-git-worktree-sidebar-icon')
    expect(WORKTREE_STYLES).toContain('.dsh-git-worktree-sidebar-badge')
    expect(WORKTREE_STYLES).toContain('flex: 0 0 auto')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-warn-label)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-success-primary)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-error-primary)')
    expect(WORKTREE_STYLES).toContain('var(--dsw-alias-state-business-primary) 68%')
  })

  test('declares each official Workspace Slot tree exactly once', () => {
    const { context, declarations, descriptors } = strictSlotLedger()
    registerManagedWorkspaceSidebar(context, createWorktreeConsoleAdapterFixture().adapter)

    expect([...declarations]).toEqual([
      'sidebar.workspaces',
      'sidebar.workspaces.directoryFlow',
      'conversation.hero.workspace',
      'conversation.hero.workspace.directoryFlow',
    ])
    expect(descriptors).toHaveLength(2)
    expect(() => registerManagedWorkspaceSidebar(
      context,
      createWorktreeConsoleAdapterFixture().adapter,
    )).toThrow(/already declared/u)
  })
})
