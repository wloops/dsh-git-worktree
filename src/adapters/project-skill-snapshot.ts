import { constants } from 'node:fs'
import { lstat, open, readdir, readlink, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, parse, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { SkillSnapshot } from './project-skills.js'

export interface SkillBoundary { root: string; metadata: string[] }
const fail = (message: string, path: string) => new Error(`Project Skills: ${message}: ${path}`)
const stamp = (s: Awaited<ReturnType<typeof lstat>>) => `${s.dev}:${s.ino}:${s.mode}:${s.size}:${s.mtimeMs}:${s.ctimeMs}`

/** Source-only resolver. Destination IO deliberately continues to reject links.
 * Like project-skill-io, this detects races in a trusted local filesystem; Node
 * does not offer openat/O_BENEATH for atomic adversarial ancestor containment.
 */
export async function snapshotSkillLinks(source: string, roots: readonly string[], boundary: SkillBoundary): Promise<SkillSnapshot> {
  const root = await realpath(boundary.root)
  if (await realpath(source) !== root) throw fail('snapshot source is not the Git root', source)
  const metadata = await Promise.all(boundary.metadata.map(path => realpath(path)))
  const observed = new Map<string, string>()
  const links: NonNullable<SkillSnapshot['links']> = []
  const files: SkillSnapshot['files'] = []
  const directories: string[] = []
  const sourcePaths = new Set<string>()
  let entries = 0, bytes = 0
  function contained(path: string, container: string): boolean {
    const rel = relative(container, path)
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
  }
  function safe(path: string, logical: string): void {
    if (!contained(path, root)) throw fail('link escapes Git repository', logical)
    const parts = relative(root, path).split(sep)
    if (parts.length > 67) throw fail('source path exceeds depth limit', logical)
    if (parts.some(part => part.toLowerCase() === '.git') || metadata.some(dir => contained(path, dir))) throw fail('link enters Git metadata', logical)
    if (parts.some(part => /[\\:\x00-\x1f]/.test(part))) throw fail('unsupported source path', logical)
  }
  async function observe(path: string, logical: string) {
    let stat
    try { stat = await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw fail('dangling link or missing source', logical)
      throw error
    }
    const value = stamp(stat)
    if (observed.has(path) && observed.get(path) !== value) throw fail('source changed during snapshot', logical)
    observed.set(path, value)
    if (stat.isFile() || stat.isSymbolicLink()) sourcePaths.add(relative(root, path).split(sep).join('/'))
    return stat
  }
  async function resolvePath(path: string, logical: string, chain = new Set<string>()): Promise<string> {
    safe(path, logical)
    let current = root
    for (const part of relative(root, path).split(sep).filter(Boolean)) {
      current = join(current, part)
      safe(current, logical)
      const stat = await observe(current, logical)
      if (stat.isSymbolicLink()) {
        if (chain.has(current) || chain.size >= 64) throw fail('cyclic link or link depth limit', logical)
        const next = new Set(chain).add(current)
        const target = await readlink(current)
        let targetPath = isAbsolute(target) ? parse(target).root : dirname(current)
        // Keep `..` in traversal order; normalizing it before resolving an
        // intermediate link could read a different path or hide a boundary hop.
        for (const segment of target.slice(isAbsolute(target) ? parse(target).root.length : 0).split(sep)) {
          if (!segment || segment === '.') continue
          if (segment === '..') {
            targetPath = dirname(targetPath)
            safe(targetPath, logical)
          } else {
            const candidate = join(targetPath, segment)
            // Absolute targets must enter the root through its literal prefix.
            if (isAbsolute(target) && contained(root, candidate) && !contained(candidate, root)) { targetPath = candidate; continue }
            targetPath = await resolvePath(candidate, logical, next)
          }
        }
        safe(targetPath, logical)
        current = targetPath
      } else if (!stat.isFile() && !stat.isDirectory()) throw fail('special file is not supported', logical)
    }
    return current
  }
  // Record a physically checked-out link only until the first expanded alias.
  async function walk(logical: string, physical: string, depth: number, ancestors: Set<string>, expanded: boolean): Promise<void> {
    if (++entries > 10000 || depth > 64) throw fail('Skill tree exceeds the inspection limit', logical)
    if (logical.split('/').some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) throw fail('unsupported Skill path', logical)
    safe(physical, logical)
    const original = await observe(physical, logical)
    if (original.isSymbolicLink() && !expanded) {
      links.push({ path: logical, target: await readlink(physical) })
      expanded = true
    }
    const path = await resolvePath(physical, logical)
    const stat = await observe(path, logical)
    if (depth === 0 && !stat.isDirectory()) throw fail('Skill root must resolve to a directory', logical)
    if (stat.isDirectory()) {
      if (ancestors.has(path)) throw fail('cyclic directory link', logical)
      const next = new Set(ancestors).add(path)
      const names = (await readdir(path)).sort()
      if (!names.length) directories.push(logical)
      for (const name of names) await walk(`${logical}/${name}`, join(path, name), depth + 1, next, expanded)
      return
    }
    if (!stat.isFile()) throw fail('special file is not supported', logical)
    if (files.length >= 5000 || bytes + stat.size > 64 * 1024 * 1024) throw fail('Skill snapshot exceeds the safety limit', logical)
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
    try {
      const before = await handle.stat()
      if (stamp(before) !== stamp(stat)) throw fail('source changed during snapshot', logical)
      const buffer = Buffer.alloc(stat.size + 1)
      let size = 0
      while (size < buffer.length) {
        const read = await handle.read(buffer, size, buffer.length - size, size)
        if (!read.bytesRead) break
        size += read.bytesRead
      }
      if (size !== stat.size || stamp(await handle.stat()) !== stamp(before) || stamp(await lstat(path)) !== stamp(before)) throw fail('source changed during snapshot', logical)
      bytes += size
      const content = buffer.subarray(0, size)
      files.push({ path: logical, content, hash: createHash('sha256').update(content).digest('hex'), mode: stat.mode & 0o777 })
      sourcePaths.add(relative(root, path).split(sep).join('/'))
    } finally { await handle.close() }
  }
  await observe(root, '.')
  for (const logical of roots) {
    // Only absent roots are optional; missing targets within a root are errors.
    let parent = root
    const parts = logical.split('/')
    let absent = false
    for (const [index, part] of parts.entries()) {
      const path = join(parent, part)
      try {
        const stat = await lstat(path)
        if (stat.isSymbolicLink() && index < parts.length - 1) throw fail('link above Skill root is not supported', logical)
        parent = path
      } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { absent = true; break }; throw error }
    }
    if (!absent) await walk(logical, join(root, logical), 0, new Set(), false)
  }
  for (const [path, expected] of observed) {
    if (stamp(await lstat(path)) !== expected) throw fail('source changed during snapshot', relative(root, path))
  }
  return { files, directories, links, sourcePaths: [...sourcePaths] }
}
