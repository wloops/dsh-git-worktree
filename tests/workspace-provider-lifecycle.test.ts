import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, test } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { Group, Loader, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import Include, { applyEntryPatches, entryListSchema, type PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { ClientModuleRegistry } from '@deepseek-ai/dsh-client-modules'
import { mountWorkspaceProviderLifecycle, WORKSPACE_PROVIDER_CONDITION } from '../src/workspace-provider-lifecycle.js'

const require = createRequire(import.meta.url)
const yaml = createRequire(require.resolve('@deepseek-ai/cordis-plugin-include'))('js-yaml') as {
  load(text: string, options: { schema: unknown }): unknown
}
const OFFICIAL = '@deepseek-ai/dsh-client-ui-workspace'
const WORKTREE = 'dsh-git-worktree'
const disposals: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of disposals.splice(0).reverse()) await dispose() })

function entries(disabled: boolean): EntryOptions[] {
  const patch = yaml.load(readFileSync(resolve('cordis.patch.yml'), 'utf8'), { schema: entryListSchema }) as PatchOptions[]
  return applyEntryPatches([{ id: 'ui-workspace', name: OFFICIAL }], [
    ...patch,
    ...(disabled ? [{ id: WORKTREE, disabled: true }] : []),
  ], message => { throw new Error(message) })
}

async function boot(data: EntryOptions[], replayDisabled = false, delayedImport?: string, childEntries?: EntryOptions[], failApply = false) {
  const dir = mkdtempSync(join(tmpdir(), 'workspace-provider-'))
  const paths = new Map<string, string>()
  for (const [index, name] of [OFFICIAL, WORKTREE, 'group-owner', 'fixture-include'].entries()) {
    const root = join(dir, String(index))
    mkdirSync(root)
    const manifest = join(root, 'package.json')
    writeFileSync(manifest, JSON.stringify({ name, exports: { './client': './client.js' }, ...([OFFICIAL, WORKTREE].includes(name) ? { dsh: { client: { platform: 'web' } } } : {}) }))
    writeFileSync(join(root, 'client.js'), `window.__ModuleLoader__.load({id: ${JSON.stringify(name)}, factory: () => ({})});`)
    paths.set(name, manifest)
  }
  if (childEntries) {
    const childPath = join(dir, 'child.json')
    writeFileSync(childPath, JSON.stringify(childEntries))
    data = [...data, { id: 'include', name: 'fixture-include', config: { path: pathToFileURL(childPath).href } }]
  }
  const ctx = new Context()
  disposals.push(async () => { await ctx.fiber.dispose(); rmSync(dir, { recursive: true, force: true }) })
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(join(dir, 'entry.js')).href })
  ctx.loader.internal = {
    version: 'v2',
    import: async (name: string) => {
      if (name === delayedImport) await new Promise(resolve => setTimeout(resolve, 20))
      return name === 'fixture-include' ? Include : name === 'group-owner' ? Group : name === WORKTREE
        ? { inject: { loader: { await: false } }, async apply(ctx: Context) {
          await mountWorkspaceProviderLifecycle(ctx)
          if (failApply) throw new Error('fixture: replacement initialization failed')
        } }
        : { apply() {} }
    },
    resolveSync: (_base: string, request: { specifier: string }) => {
      const path = paths.get(request.specifier.replace(/\/package\.json$/, ''))
      if (!path) throw new Error(`unexpected package ${request.specifier}`)
      return { url: pathToFileURL(path).href }
    },
  } as never
  if (replayDisabled) {
    ctx.on('internal/plugin', fiber => {
      if (fiber.entry?.options.name !== WORKTREE || !fiber.uid) return
      // Market replays its persisted disable list when a bundle entry appears.
      void fiber.entry.update({ disabled: true }, false, true)
    })
  }
  // Register the actual module scanner before Loader entries, as in Web boot.
  ctx.provide('webServer', { register: () => () => {} } as never)
  await ctx.plugin(ClientModuleRegistry)
  await ctx.loader.root.update(data)
  await ctx.loader.await()
  return { ctx, graph: () => ctx.clientModules.graph().entries.map(entry => entry.id) }
}

describe('Workspace provider lifecycle (real Cordis Loader and Web module registry)', () => {
  test('the published patch and lifecycle agree on ownership without replacing user overrides', () => {
    expect(entries(false)[0]!.disabled).toEqual({ __jsExpr: WORKSPACE_PROVIDER_CONDITION })
  })

  test('a disabled Worktree entry with its bundle still installed boots the official Workspace', async () => {
    const legacy = entries(true)
    legacy[0]!.disabled = true
    expect((await boot(legacy)).graph()).toEqual([])

    const { graph } = await boot(entries(true))
    expect(graph()).toEqual([OFFICIAL])
  })

  test.each([false, true])('enabled plugin keeps exactly the Managed provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(false)
    if (replacementFirst) data.reverse()
    expect((await boot(data)).graph()).toEqual([WORKTREE])
  })

  test.each([false, true])('disabled plugin restores the official provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(true)
    if (replacementFirst) data.reverse()
    expect((await boot(data)).graph()).toEqual([OFFICIAL])
  })

  test('a removed replacement entry leaves the official provider enabled', async () => {
    expect((await boot(entries(false).filter(entry => entry.name !== WORKTREE))).graph()).toEqual([OFFICIAL])
  })

  test('a disabled owning group does not suppress the official provider outside that group', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([
      official!,
      { id: 'group-owner', name: 'group-owner', disabled: true, config: [replacement!] },
    ])
    expect(graph()).toEqual([OFFICIAL])
  })

  test.each([false, true])('market disable replay restores the official provider (replacement first: %s)', async (replacementFirst) => {
    const data = entries(false)
    if (replacementFirst) data.reverse()
    expect((await boot(data, true)).graph()).toEqual([OFFICIAL])
  })

  test.each([OFFICIAL, WORKTREE])('provider election tolerates delayed module import: %s', async name => {
    expect((await boot(entries(false), false, name)).graph()).toEqual([WORKTREE])
  })

  test('a replacement discovered in a delayed Include removes the earlier official graph row', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([official!], false, 'fixture-include', [replacement!])
    expect(graph()).toEqual([WORKTREE])
  })

  test('a late official Include cannot create a second provider', async () => {
    const [official, replacement] = entries(false)
    const { graph } = await boot([replacement!], false, 'fixture-include', [official!])
    expect(graph()).toEqual([WORKTREE])
  })

  test('live disable, market replay and re-enable reconcile the Web graph without persisting flags', async () => {
    const { ctx, graph } = await boot(entries(false))
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    const original = structuredClone(official.options)
    for (const disabled of [true, false, true]) {
      await replacement.update({ disabled }, false, true)
      await ctx.loader.await()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(graph()).toEqual([disabled ? OFFICIAL : WORKTREE])
      expect(official.options).toEqual(original)
    }
  })

  test('failed replacement activation restores the official provider', async () => {
    const { ctx, graph } = await boot(entries(true), false, undefined, undefined, true)
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    await expect(replacement.update({ disabled: false }, false, true)).rejects.toThrow('fixture: replacement initialization failed')
    await ctx.loader.await()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(graph()).toEqual([OFFICIAL])
  })

  test('explicit user Workspace disabled overrides are not owned by the replacement lifecycle', async () => {
    const data = entries(false)
    data[0]!.disabled = true
    const { ctx, graph } = await boot(data)
    const replacement = [...ctx.loader.entries()].find(entry => entry.options.name === WORKTREE)!
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    await replacement.update({ disabled: true }, false, true)
    await ctx.loader.await()
    expect(official.options.disabled).toBe(true)
    expect(official.fiber).toBeUndefined()
    expect(graph()).toEqual([])
  })

  test('root disposal does not resurrect the official provider', async () => {
    const { ctx } = await boot(entries(false))
    const official = [...ctx.loader.entries()].find(entry => entry.options.name === OFFICIAL)!
    let restored = 0
    const off = ctx.on('internal/plugin', fiber => {
      if (fiber.uid && fiber.entry?.options.name === OFFICIAL) restored++
    })
    await ctx.fiber.dispose()
    off()
    expect(restored).toBe(0)
    expect(official.fiber?.uid ?? null).toBeNull()
  })

  test('restart after disable and re-enable reselects one provider without baking state into the patch', async () => {
    const original = readFileSync(resolve('cordis.patch.yml'), 'utf8')
    for (const disabled of [false, true, false, true]) {
      expect((await boot(entries(disabled))).graph()).toEqual([disabled ? OFFICIAL : WORKTREE])
    }
    expect(readFileSync(resolve('cordis.patch.yml'), 'utf8')).toBe(original)
  })
})
