import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ProjectSkillStore } from '../src/adapters/project-skills.js'

const race = vi.hoisted(() => ({ beforeCreate: undefined as undefined | (() => Promise<void>) }))
vi.mock('../src/adapters/project-skill-io.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/adapters/project-skill-io.js')>()
  return { ...original, createSkillFiles: async (...args: Parameters<typeof original.createSkillFiles>) => {
    await race.beforeCreate?.()
    return original.createSkillFiles(...args)
  } }
})
const fixtures: string[] = []
afterEach(async () => {
  race.beforeCreate = undefined
  await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('rejects a parent junction already present when the copy helper begins', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-parent-race-'))
  fixtures.push(root)
  const source = join(root, 'source'), target = join(root, 'managed'), external = join(root, 'external')
  const skill = '.agents/skills/helper/SKILL.md'
  await mkdir(dirname(join(source, skill)), { recursive: true })
  await mkdir(target); await mkdir(external)
  await writeFile(join(source, skill), 'private Skill')
  await writeFile(join(external, 'sentinel'), 'unchanged')
  const store = new ProjectSkillStore(join(root, 'host-private-state'))
  const snapshot = await store.snapshot(source)
  let replaced = false
  race.beforeCreate = async () => {
    replaced = true
    race.beforeCreate = undefined
    const parent = dirname(join(target, skill))
    await mkdir(parent, { recursive: true })
    await rename(parent, `${parent}.saved`)
    await symlink(external, parent, process.platform === 'win32' ? 'junction' : 'dir')
  }
  await expect(store.carry(snapshot, target)).rejects.toThrow()
  expect(replaced).toBe(true)
  expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('unchanged')
  await expect(readFile(join(external, 'SKILL.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
})

