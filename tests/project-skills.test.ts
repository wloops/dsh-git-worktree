import { afterEach, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { ProjectSkillStore } from '../src/adapters/project-skills.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-copy-'))
  roots.push(root)
  const source = join(root, 'source'), target = join(root, 'target'), state = join(root, 'private-state')
  await mkdir(source); await mkdir(target)
  const path = '.agents/skills/helper/SKILL.md'
  await mkdir(dirname(join(source, path)), { recursive: true })
  await writeFile(join(source, path), 'original')
  return { root, source, target, state, path, store: new ProjectSkillStore(state) }
}
it('persists exact auxiliary provenance across restart and detects edits and deletions', async () => {
  const { source, target, state, path, store } = await fixture()
  for (const name of ['.dsh', '.claude']) {
    const resource = join(source, name, 'skills/helper/scripts/data.txt')
    await mkdir(dirname(resource), { recursive: true }); await writeFile(resource, 'resource')
  }
  await store.carry(await store.snapshot(source), target)
  const restarted = new ProjectSkillStore(state)
  expect((await restarted.paths(target))?.length).toBe(3)
  const before = await restarted.state(target)
  await writeFile(join(target, path), 'modified')
  expect(await restarted.state(target)).toMatchObject({ modified: true })
  expect((await restarted.state(target))?.fingerprint).not.toBe(before?.fingerprint)
  await expect(restarted.assertRemovable(target, new Set())).rejects.toThrow(/modified/)
  await rm(join(target, path))
  await expect(restarted.assertRemovable(target, new Set())).rejects.toThrow(/modified/)
  expect(await readFile(join(source, path), 'utf8')).toBe('original')
})
it('never excludes or silently overwrites pre-existing conflicting target files', async () => {
  const { source, target, path, store } = await fixture()
  await mkdir(dirname(join(target, path)), { recursive: true })
  await writeFile(join(target, path), 'different')
  await expect(store.carry(await store.snapshot(source), target)).rejects.toThrow(/conflicts/)
  expect(await store.paths(target)).toBeNull()
  expect(await readFile(join(target, path), 'utf8')).toBe('different')
})
it('retains a completed copy when final provenance publication fails', async () => {
  const { source, target, state, path, store } = await fixture()
  await mkdir(state)
  const key = createHash('sha256').update(resolve(target)).digest('hex')
  await mkdir(join(state, `${key}.json.ready`))
  await expect(store.carry(await store.snapshot(source), target)).rejects.toThrow()
  expect(await readFile(join(target, path), 'utf8')).toBe('original')
  await expect(store.assertRemovable(target, new Set())).rejects.toThrow(/incomplete/)
  await expect(store.carry(await store.snapshot(source), target)).rejects.toThrow(/incomplete/)
  await expect(store.paths(target)).rejects.toThrow(/incomplete/)
})
it('does not permit provenance reuse after replacement of the checkout directory', async () => {
  const { root, source, target, store } = await fixture()
  await store.carry(await store.snapshot(source), target)
  await rename(target, join(root, 'saved-target')); await mkdir(target)
  await expect(store.paths(target)).rejects.toThrow(/provenance/)
})
it('refuses new unknown resources even when they would be ignored by Git', async () => {
  const { source, target, store } = await fixture()
  await store.carry(await store.snapshot(source), target)
  await writeFile(join(target, '.agents/skills/helper/new-resource'), 'keep')
  expect((await store.state(target))?.paths).toContain('.agents/skills/helper/new-resource')
  await expect(store.assertRemovable(target, new Set())).rejects.toThrow(/modified/)
})
it('rejects source and later resource directory junctions without modifying their targets', async () => {
  const { root, source, target, store } = await fixture()
  const external = join(root, 'external')
  await mkdir(external); await writeFile(join(external, 'keep'), 'outside')
  const link = join(source, '.agents/skills/helper/resources')
  await symlink(external, link, process.platform === 'win32' ? 'junction' : 'dir')
  await expect(store.snapshot(source)).rejects.toThrow(/unsupported link/)
  await rm(link)
  await store.carry(await store.snapshot(source), target)
  await symlink(external, join(target, '.agents/skills/helper/resources'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(store.assertRemovable(target, new Set())).rejects.toThrow(/unsupported link/)
  expect(await readFile(join(external, 'keep'), 'utf8')).toBe('outside')
})
it('bounds source resource size before allocating its contents', async () => {
  const { source, path, store } = await fixture()
  await truncate(join(source, path), 64 * 1024 * 1024 + 1)
  await expect(store.snapshot(source)).rejects.toThrow(/limit/)
})
it.skipIf(process.platform === 'win32')('preserves executable resources and protects subsequent permission changes', async () => {
  const { source, target, path, store } = await fixture()
  await chmod(join(source, path), 0o755)
  await store.carry(await store.snapshot(source), target)
  expect(await store.state(target)).toMatchObject({ modified: false })
  await chmod(join(target, path), 0o644)
  await expect(store.assertRemovable(target, new Set())).rejects.toThrow(/modified/)
})

it('carries empty resource directories and preserves later content instead of discarding it', async () => {
  const { source, target, store } = await fixture()
  const directory = '.claude/skills/helper/cache'
  await mkdir(join(source, directory), { recursive: true })
  await store.carry(await store.snapshot(source), target)
  expect((await lstat(join(target, directory))).isDirectory()).toBe(true)
  expect((await store.state(target))?.modified).toBe(false)
  await writeFile(join(target, directory, 'result.txt'), 'keep')
  expect((await store.state(target))?.paths).toContain(`${directory}/result.txt`)
  await expect(store.assertRemovable(target, new Set())).rejects.toThrow(/modified/)
})
