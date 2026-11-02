import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectSkillStore } from '../src/adapters/project-skills.js'

const race = vi.hoisted(() => ({ beforeOpen: undefined as undefined | (() => Promise<void>), afterReadlink: undefined as undefined | (() => Promise<void>) }))
vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal<typeof import('node:fs/promises')>()
  return { ...original,
    open: async (...args: Parameters<typeof original.open>) => { await race.beforeOpen?.(); return original.open(...args) },
    readlink: async (...args: Parameters<typeof original.readlink>) => { const result = await original.readlink(...args); await race.afterReadlink?.(); return result },
  }
})
const fixtures: string[] = []
afterEach(async () => {
  race.beforeOpen = undefined; race.afterReadlink = undefined
  await Promise.all(fixtures.splice(0).map(root => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-source-race-'))
  fixtures.push(root)
  const source = join(root, 'repo'), external = join(root, 'external')
  await mkdir(join(source, '.agents/skills'), { recursive: true }); await mkdir(join(source, 'canonical')); await mkdir(external)
  await writeFile(join(source, 'canonical/SKILL.md'), 'private Skill')
  await writeFile(join(external, 'SKILL.md'), 'outside sentinel')
  await symlink('../../canonical', join(source, '.agents/skills/helper'))
  const store = new ProjectSkillStore(join(root, 'state'))
  const snapshot = () => store.snapshot(source, { root: source, metadata: [] })
  return { root, source, external, store, snapshot }
}
it.skipIf(process.platform === 'win32')('rejects a source parent changed into an external link before opening and leaves the target unchanged', async () => {
  const { source, external, snapshot } = await fixture()
  race.beforeOpen = async () => {
    race.beforeOpen = undefined
    await rename(join(source, 'canonical'), join(source, 'saved'))
    await symlink(external, join(source, 'canonical'))
  }
  await expect(snapshot()).rejects.toThrow(/changed during snapshot/)
  expect(await readFile(join(external, 'SKILL.md'), 'utf8')).toBe('outside sentinel')
})
it.skipIf(process.platform === 'win32')('rejects a final file changed into a link before opening', async () => {
  const { source, external, snapshot } = await fixture()
  race.beforeOpen = async () => {
    race.beforeOpen = undefined
    await rm(join(source, 'canonical/SKILL.md'))
    await symlink(join(external, 'SKILL.md'), join(source, 'canonical/SKILL.md'))
  }
  await expect(snapshot()).rejects.toThrow()
})
it.skipIf(process.platform === 'win32')('rejects a link namespace change even if the first resolved target stayed readable', async () => {
  const { source, snapshot } = await fixture()
  race.afterReadlink = async () => {
    race.afterReadlink = undefined
    const link = join(source, '.agents/skills/helper')
    await rm(link); await symlink('../../canonical/.', link)
  }
  await expect(snapshot()).rejects.toThrow(/changed during snapshot/)
})
