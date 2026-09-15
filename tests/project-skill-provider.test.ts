import { afterEach, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { ClaudeProjectSkillProvider } from '../src/adapters/project-skill-provider.js'

const roots: string[] = []
const providers: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(providers.splice(0).map(provider => provider.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-skill-load-'))
  roots.push(root)
  const abort = new AbortController()
  const control = { signal: abort.signal, invalidate() {} }
  const provider = new ClaudeProjectSkillProvider(new Context(), control, async cwd => resolve(cwd) === root ? root : null)
  providers.push(provider)
  return { root, provider, control }
}
async function list(provider: ClaudeProjectSkillProvider, cwd: string) {
  const observed = await provider.list({ cwd })
  return Array.isArray(observed) ? observed : observed.candidates
}
const text = '---\nname: local-helper\ndescription: A local helper\ndisable-model-invocation: true\n---\nUse scripts/data.txt.\n'
it('loads Claude project Skills with real upstream parsing, resource bases and cwd isolation', async () => {
  const { root, provider } = await fixture()
  const directory = join(root, '.claude', 'skills', 'local-helper')
  await mkdir(join(directory, 'scripts'), { recursive: true })
  await writeFile(join(directory, 'SKILL.md'), text)
  await writeFile(join(directory, 'scripts', 'data.txt'), 'resource')
  const candidates = await list(provider, root)
  expect(candidates).toHaveLength(1)
  const skill = await provider.get(candidates[0]!, { cwd: root })
  expect(skill).toMatchObject({ name: 'local-helper', source: 'project-claude', resourceBase: { kind: 'directory', path: directory } })
  expect(await readFile(join(directory, 'scripts', 'data.txt'), 'utf8')).toBe('resource')
  expect(await provider.get(candidates[0]!, { cwd: join(root, 'other-session') })).toBeUndefined()
  expect(await provider.list({})).toEqual([])
})
it('keeps native project precedence ahead of Claude fallback', async () => {
  const { root, provider, control } = await fixture()
  await mkdir(join(root, '.git'))
  for (const namespace of ['.dsh', '.agents', '.claude']) {
    const path = join(root, namespace, 'skills', 'local-helper')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'SKILL.md'), text)
  }
  const native = new FileSystemSkillProvider(new Context(), control, { dshHome: join(root, 'empty-home'), agentsHome: join(root, 'empty-agents'), watch: false })
  providers.push(native)
  const observed = await native.list({ cwd: root })
  const candidates = [...(Array.isArray(observed) ? observed : observed.candidates), ...await list(provider, root)]
  expect(candidates.sort((a, b) => a.rank - b.rank).map(candidate => candidate.source)).toEqual(['project-dsh', 'project-agents', 'project-claude'])
})
it('refuses project-external linked Skill roots before discovery', async () => {
  const { root, provider } = await fixture()
  const external = await mkdtemp(join(tmpdir(), 'dsh-external-skill-'))
  roots.push(external)
  await mkdir(join(root, '.claude'))
  await mkdir(join(external, 'local-helper'))
  await writeFile(join(external, 'local-helper', 'SKILL.md'), text)
  await symlink(external, join(root, '.claude', 'skills'), process.platform === 'win32' ? 'junction' : 'dir')
  await expect(provider.list({ cwd: root })).rejects.toThrow(/unsafe|unsupported/)
})

it('serializes pending lookups with disposal and rejects later lookups', async () => {
  const { root, provider } = await fixture()
  await mkdir(join(root, '.claude/skills/helper'), { recursive: true })
  await writeFile(join(root, '.claude/skills/helper/SKILL.md'), text)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const blocked = new Promise<void>(resolve => { release = resolve })
  const original = FileSystemSkillProvider.prototype.list
  const spy = vi.spyOn(FileSystemSkillProvider.prototype, 'list').mockImplementationOnce(async function(options) {
    entered(); await blocked
    return original.call(this, options)
  })
  try {
    const pending = provider.list({ cwd: root })
    await started
    let disposed = false
    const disposing = provider.dispose().then(() => { disposed = true })
    await Promise.resolve()
    expect(disposed).toBe(false)
    release(); await pending; await disposing
    expect(await provider.list({ cwd: root })).toEqual([])
  } finally { release(); spy.mockRestore() }
})
