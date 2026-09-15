import { createHash } from 'node:crypto'
import { createSkillDirectories, createSkillFiles, readSkillFiles } from './project-skill-io.js'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

export const PROJECT_SKILL_ROOTS = ['.dsh/skills', '.agents/skills', '.claude/skills'] as const
const MAX_FILES = 5000
const MAX_BYTES = 64 * 1024 * 1024
interface Entry { path: string; hash: string; mode: number }
interface Manifest { version: 1; root: string; identity: string; phase: 'copying' | 'ready'; files: Entry[]; directories?: string[] }
export interface SkillSnapshot { directories?: string[]; files: Array<Entry & { content: Buffer }> }
export interface CarriedSkillState { paths: string[]; fingerprint: string; modified: boolean }
const digest = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
const failure = (message: string) => new Error(`Project Skills: ${message}`)
function safePath(path: string): boolean {
  return PROJECT_SKILL_ROOTS.some(root => path.startsWith(`${root}/`))
    && path.split('/').every(part => part.length > 0 && part !== '.' && part !== '..' && !/[\\:\x00-\x1f]/.test(part))
}
async function identity(path: string): Promise<string> {
  const stat = await lstat(path, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure(`unsafe directory: ${path}`)
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`
}
/** Validate every component, not just the final file (junctions also appear as links). */
async function inspectPath(root: string, relative: string): Promise<boolean> {
  let current = root
  for (const segment of relative.split('/')) {
    current = join(current, segment)
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw failure(`unsupported link or special file: ${relative}`)
    } catch (error) { if (missing(error)) return false; throw error }
  }
  return true
}
async function boundedRead(path: string, limit = MAX_BYTES): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > limit) throw failure('file exceeds the Skill read limit')
    const buffer = Buffer.alloc(before.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
      if (!bytesRead) break
      offset += bytesRead
    }
    const after = await handle.stat()
    const named = await lstat(path)
    if (offset !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || named.isSymbolicLink() || named.ino !== before.ino || named.dev !== before.dev) throw failure('file changed during Skill read')
    return buffer.subarray(0, offset)
  } finally { await handle.close() }
}

export async function assertSkillTree(root: string, skillRoot: typeof PROJECT_SKILL_ROOTS[number]): Promise<void> {
  let count = 0
  async function visit(path: string, depth: number): Promise<void> {
    if (++count > 10000 || depth > 64) throw failure('Skill tree exceeds the inspection limit')
    if (!await inspectPath(root, path)) return
    if ((await lstat(join(root, path))).isDirectory()) {
      for (const name of await readdir(join(root, path))) await visit(`${path}/${name}`, depth + 1)
    }
  }
  await visit(skillRoot, 0)
}
function ownedSkillDirectories(files: readonly Entry[], directories: readonly string[] = []): string[] {
  return [...new Set([...files.map(file => file.path), ...directories.map(path => `${path}/.directory-check`)].filter(path => path.split('/').length > 3).map(path => path.split('/').slice(0, 3).join('/')))]
}
async function inventory(root: string, roots: readonly string[] = PROJECT_SKILL_ROOTS, tracked: ReadonlySet<string> = new Set(), emptyDirectories?: string[]): Promise<Array<Entry & { content: Buffer }>> {
  const files: Array<{ path: string; maxBytes: number }> = []
  const rootIdentity = await identity(root)
  let bytes = 0
  let entries = 0
  async function walk(relative: string, depth: number): Promise<void> {
    if (tracked.has(relative)) return
    if (++entries > 10000 || depth > 64) throw failure('Skill directory nesting exceeds the safety limit')
    if (!await inspectPath(root, relative)) return
    const path = join(root, relative)
    const stat = await lstat(path)
    if (stat.isDirectory()) {
      const names = (await readdir(path)).sort()
      if (!names.length) emptyDirectories?.push(relative)
      for (const name of names) await walk(`${relative}/${name}`, depth + 1)
      return
    }
    if (!safePath(relative) || bytes + stat.size > MAX_BYTES || files.length >= MAX_FILES) throw failure('Skill snapshot exceeds the safety limit or contains an unsupported path')
    bytes += stat.size
    files.push({ path: relative, maxBytes: stat.size })
  }
  await identity(root)
  for (const rootPath of roots) await walk(rootPath, 0)
  return (await readSkillFiles(root, rootIdentity, files)).map(file => ({ ...file, hash: digest(file.content) }))
}

/** Host-private provenance: never accept an exclusion list from the managed checkout. */
export class ProjectSkillStore {
  constructor(private readonly directory: string) {}
  private file(root: string): string { return join(this.directory, `${digest(resolve(root))}.json`) }
  async snapshot(source: string): Promise<SkillSnapshot> {
    const directories: string[] = []
    return { files: await inventory(source, PROJECT_SKILL_ROOTS, new Set(), directories), directories }
  }
  private async load(root: string): Promise<Manifest | null> {
    let raw: string
    try {
      const file = this.file(root)
      const stat = await lstat(file)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) throw failure('invalid provenance file')
      raw = (await boundedRead(file, 2 * 1024 * 1024)).toString('utf8')
    } catch (error) { if (missing(error)) return null; throw error }
    const value = JSON.parse(raw) as Manifest
    if (value.version !== 1 || value.root !== await realpath(root) || value.identity !== await identity(root)
      || (value.directories !== undefined && (!Array.isArray(value.directories) || value.directories.length > 10000 || value.directories.some(path => typeof path !== 'string' || !safePath(`${path}/.directory-check`))))
      || value.phase !== 'ready' || !Array.isArray(value.files) || value.files.length > MAX_FILES
      || value.files.some(file => !file || typeof file.path !== 'string' || !safePath(file.path)
        || !/^[0-9a-f]{64}$/.test(file.hash) || !Number.isInteger(file.mode) || file.mode < 0 || file.mode > 0o777)
      || new Set(value.files.map(file => file.path)).size !== value.files.length) throw failure('Skill copy is incomplete or provenance no longer matches this checkout')
    return value
  }
  async carry(snapshot: SkillSnapshot, target: string): Promise<void> {
    if (await this.load(target)) throw failure('Skill provenance already exists for this checkout')
    if (!snapshot.files.length && !snapshot.directories?.length) return
    const root = await realpath(target)
    const rootIdentity = await identity(target)
    const pending: SkillSnapshot['files'] = []
    const existing: SkillSnapshot['files'] = []
    // Complete conflict preflight before creating any auxiliary file.
    for (const file of snapshot.files) {
      if (!safePath(file.path) || digest(file.content) !== file.hash) throw failure('invalid Skill snapshot')
      if (await inspectPath(root, file.path)) {
        if (!(await lstat(join(root, file.path))).isFile()) throw failure(`local Skill conflicts with checked-out content: ${file.path}`)
        existing.push(file)
      } else pending.push(file)
    }
    const existingContent = await readSkillFiles(root, rootIdentity, existing.map(file => ({ path: file.path, maxBytes: MAX_BYTES })))
    for (const [index, file] of existingContent.entries()) {
      if (digest(file.content) !== existing[index]!.hash) throw failure(`local Skill conflicts with checked-out content: ${file.path}`)
    }
    const directories: string[] = []
    for (const directory of snapshot.directories ?? []) {
      if (!safePath(`${directory}/.directory-check`)) throw failure('invalid Skill directory')
      if (!await inspectPath(root, directory)) directories.push(directory)
      else if (!(await lstat(join(root, directory))).isDirectory()) throw failure(`Skill directory conflicts with a file: ${directory}`)
    }
    if (!pending.length && !directories.length) return
    const manifest: Manifest = { version: 1, root, identity: rootIdentity, phase: 'copying', directories, files: pending.map(({ content: _, ...file }) => file) }
    await mkdir(this.directory, { recursive: true })
    const manifestPath = this.file(target)
    // Exclusive publication prevents an earlier uncertain attempt from being overwritten.
    await writeFile(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
    await createSkillDirectories(root, rootIdentity, directories)
    await createSkillFiles(root, rootIdentity, pending)
    const copied = await readSkillFiles(root, rootIdentity, pending.map(file => ({ path: file.path, maxBytes: file.content.length })))
    for (const [index, file] of copied.entries()) {
      if (digest(file.content) !== pending[index]!.hash) throw failure(`Skill copy verification failed: ${file.path}`)
    }
    if (rootIdentity !== await identity(target)) throw failure('checkout identity changed during Skill copy')
    manifest.phase = 'ready'
    const temporary = `${manifestPath}.ready`
    await writeFile(temporary, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 })
    await rename(temporary, manifestPath)
  }
  async scope(root: string): Promise<{ paths: string[]; directories: string[] } | null> {
    const manifest = await this.load(root)
    return manifest ? { paths: manifest.files.map(file => file.path), directories: ownedSkillDirectories(manifest.files, manifest.directories) } : null
  }
  async paths(root: string): Promise<string[] | null> { return (await this.scope(root))?.paths ?? null }
  async state(root: string, tracked: ReadonlySet<string> = new Set()): Promise<CarriedSkillState | null> {
    const manifest = await this.load(root)
    if (!manifest) return null
    const files = manifest.files.filter(file => !tracked.has(file.path))
    const hashes: string[] = []
    let modified = false
    const roots = [...ownedSkillDirectories(manifest.files, manifest.directories), ...files.filter(file => file.path.split('/').length === 3).map(file => file.path)]
    for (const directory of manifest.directories ?? []) {
      const present = await inspectPath(root, directory) && (await lstat(join(root, directory))).isDirectory()
      modified ||= !present
      hashes.push(`${directory} ${present ? 'directory' : 'missing'}`)
    }
    const current = await inventory(root, [...new Set(roots)], tracked)
    const currentByPath = new Map(current.map(file => [file.path, file]))
    for (const file of files) {
      const observed = currentByPath.get(file.path)
      const hash = observed?.hash ?? 'missing'
      const mode = observed?.mode ?? 0
      modified ||= hash !== file.hash || mode !== file.mode
      hashes.push(`${file.path}\0${hash}\0${mode}`)
    }
    const paths = files.map(file => file.path)
    const original = new Set(manifest.files.map(file => file.path))
    for (const file of current) {
      if (original.has(file.path) || tracked.has(file.path)) continue
      paths.push(file.path)
      hashes.push(`${file.path}\0${file.hash}\0${file.mode}`)
      modified = true
    }
    return { paths, fingerprint: digest(hashes.join('\0')), modified }
  }
  async assertRemovable(root: string, tracked: ReadonlySet<string>): Promise<void> {
    const state = await this.state(root, tracked)
    if (!state) return
    if (state.modified) throw failure('carried Skills were modified; retain this Worktree to preserve them')
    const known = new Set([...state.paths, ...tracked])
    for (const file of await inventory(root)) {
      if (!known.has(file.path)) throw failure(`new Skill resource must be preserved: ${file.path}`)
    }
  }
  async forget(root: string): Promise<void> { await rm(this.file(root), { force: true }) }
}

export function trackedSkillPaths(indexEntries: Buffer | string, headPaths: Buffer | string = ''): Set<string> {
  const result = new Set(headPaths.toString().split('\0').filter(Boolean))
  for (const entry of indexEntries.toString().split('\0')) {
    const tab = entry.indexOf('\t')
    if (tab >= 0) result.add(entry.slice(tab + 1))
  }
  return result
}
/** Only ?? records are auxiliary; tracked edits, renames and deletions stay visible. */
export function hasDeliverableStatus(output: string, auxiliary: ReadonlySet<string>, directories: readonly string[] = []): boolean {
  const entries = output.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (!entry) continue
    if (!entry.startsWith('?? ')) return true
    const path = entry.slice(3)
    if (!auxiliary.has(path) && !directories.some(directory => path.startsWith(`${directory}/`))) return true
  }
  return false
}

export async function assertSkillPath(root: string, path: string): Promise<void> {
  if (!safePath(path) || !await inspectPath(root, path)) throw failure('Skill path is missing or unsafe')
}
