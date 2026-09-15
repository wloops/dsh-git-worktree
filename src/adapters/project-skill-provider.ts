import type {} from '@deepseek-ai/dsh-fs'
import type { Context } from '@deepseek-ai/cordis'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import type { SkillCandidate, SkillDefinition, SkillLookupOptions, SkillProvider, SkillProviderControl, SkillProviderObservation } from '@deepseek-ai/dsh-skill'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import type { SessionCheckoutRegistryPort } from '../ports.js'
import { assertSkillPath, assertSkillTree } from './project-skills.js'

const NAME = 'worktree-project-claude'
interface Locator { root: string; candidate: SkillCandidate }
/** Resolve against host-owned records, never a root claimed by a Skill file. */
export function managedSkillRoot(registry: SessionCheckoutRegistryPort): (cwd: string) => Promise<string | null> {
  return async cwd => {
    const canonical = await realpath(cwd)
    for (const record of Object.values(registry.read().managedCheckouts)) {
      if (record.phase !== 'ready') continue
      const root = record.managedGitRoot
      const child = relative(root, canonical)
      if (child.startsWith('..') || isAbsolute(child)) continue
      const marker = join(root, '.git')
      const rootStat = await lstat(root)
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || relative(root, await realpath(root)) !== '') return null
      const stat = await lstat(marker)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) return null
      const text = (await readFile(marker, 'utf8')).trim()
      if (!text.startsWith('gitdir: ') || await realpath(resolve(root, text.slice(8))) !== await realpath(record.gitDir)) return null
      const backlink = join(record.gitDir, 'gitdir')
      const backlinkStat = await lstat(backlink)
      if (!backlinkStat.isFile() || backlinkStat.isSymbolicLink() || backlinkStat.size > 65536) return null
      if (resolve(record.gitDir, (await readFile(backlink, 'utf8')).trim()) !== resolve(marker)) return null
      return root
    }
    return null
  }
}

/** Additional project source only; native .dsh/.agents discovery remains unchanged. */
export class ClaudeProjectSkillProvider implements SkillProvider {
  readonly name = NAME
  private readonly providers = new Map<string, FileSystemSkillProvider>()
  private operations: Promise<void> = Promise.resolve()
  private disposed = false
  private run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.then(() => {}, () => {})
    return result
  }
  constructor(private readonly ctx: Context, private readonly control: SkillProviderControl,
    private readonly resolveRoot: (cwd: string) => Promise<string | null>) {}
  private async provider(root: string): Promise<FileSystemSkillProvider> {
    const existing = this.providers.get(root)
    if (existing) return existing
    if (this.providers.size >= 32) {
      const oldest = this.providers.entries().next().value!
      this.providers.delete(oldest[0])
      await oldest[1].dispose()
    }
    const provider = new FileSystemSkillProvider(this.ctx, this.control, {
      providerName: NAME, includeDefaultRoots: false, customSkillDirs: [join(root, '.claude', 'skills')],
      watch: true, watchFollowSymlinks: false,
    })
    this.providers.set(root, provider)
    return provider
  }
  list(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    return this.run(() => this.listNow(options))
  }
  private async listNow(options: SkillLookupOptions): Promise<SkillCandidate[] | SkillProviderObservation> {
    if (this.disposed || !options.cwd || this.control.signal.aborted || options.signal?.aborted) return []
    const root = await this.resolveRoot(options.cwd)
    if (!root) return []
    await assertSkillTree(root, '.claude/skills')
    const observation = await (await this.provider(root)).list(options)
    const candidates = Array.isArray(observation) ? observation : observation.candidates
    const result: SkillCandidate[] = []
    for (const candidate of candidates) {
      if (!candidate.path) continue
      const path = relative(root, candidate.path).split('\\').join('/')
      await assertSkillPath(root, path)
      result.push({ ...candidate, provider: NAME, source: 'project-claude', rank: 250, locator: { root, candidate } satisfies Locator })
    }
    return Array.isArray(observation) ? result : { ...observation, candidates: result }
  }
  get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    return this.run(() => this.getNow(candidate, options))
  }
  private async getNow(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    if (this.disposed || !options.cwd || this.control.signal.aborted || options.signal?.aborted) return undefined
    const root = await this.resolveRoot(options.cwd)
    const locator = candidate.locator as Locator
    if (!root || locator?.root !== root || !locator.candidate?.path) return undefined
    await assertSkillTree(root, '.claude/skills')
    await assertSkillPath(root, relative(root, locator.candidate.path).split('\\').join('/'))
    const skill = await (await this.provider(root)).get(locator.candidate, options)
    return skill ? { ...skill, provider: NAME, source: 'project-claude' } : undefined
  }
  observeHostMutation(path: string): void {
    if (!this.disposed) for (const provider of this.providers.values()) provider.observeHostMutation(path)
  }
  async dispose(): Promise<void> {
    this.disposed = true
    await this.operations
    const providers = [...this.providers.values()]
    this.providers.clear()
    await Promise.all(providers.map(provider => provider.dispose()))
  }
}

export function mountProjectSkillProvider(ctx: Context, registry: SessionCheckoutRegistryPort): void {
  ctx.inject(['skills'], scoped => {
    let provider: ClaudeProjectSkillProvider
    scoped.skills.registerProvider(control => {
      provider = new ClaudeProjectSkillProvider(scoped, control, managedSkillRoot(registry))
      return provider
    })
    scoped.on('fs/observed', (target, _observation, actor) => {
      if (actor) provider.observeHostMutation(target.displayPath)
    })
    scoped.effect(function* () { yield () => provider.dispose() }, 'worktree project Skill compatibility')
  })
}
