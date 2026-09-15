import { constants } from 'node:fs'
import { lstat, mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

export interface SkillRead { path: string; maxBytes: number }
export interface SkillBytes { path: string; content: Buffer; mode: number }

// These checks support trusted local creation, not atomic containment against
// another process maliciously replacing ancestors between filesystem calls.
async function checkRoot(root: string, expected: string): Promise<void> {
  const stat = await lstat(root, { bigint: true })
  if (!stat.isDirectory() || stat.isSymbolicLink() || `${stat.dev}:${stat.ino}:${stat.birthtimeNs}` !== expected) {
    throw new Error('Project Skills: checkout directory changed')
  }
}
async function checkPath(root: string, path: string, createParents = false): Promise<void> {
  const parts = path.split('/')
  if (!['.dsh', '.agents', '.claude'].includes(parts[0]!) || parts[1] !== 'skills'
    || parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) throw new Error('Project Skills: invalid path')
  let current = root
  for (const [index, part] of parts.entries()) {
    current = join(current, part)
    if (createParents && index < parts.length - 1) {
      await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error })
    }
    try {
      const stat = await lstat(current)
      if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile() && !stat.isDirectory())) {
        throw new Error('Project Skills: links and special files are not supported')
      }
    } catch (error) {
      if (createParents && index === parts.length - 1 && (error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }
}

export async function readSkillFiles(root: string, identity: string, files: readonly SkillRead[]): Promise<SkillBytes[]> {
  const result: SkillBytes[] = []
  let remaining = 64 * 1024 * 1024
  for (const file of files) {
    await checkRoot(root, identity)
    await checkPath(root, file.path)
    const handle = await open(join(root, file.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const stat = await handle.stat({ bigint: true })
      const pathStat = await lstat(join(root, file.path), { bigint: true })
      const limit = Math.min(file.maxBytes, remaining)
      if (!stat.isFile() || pathStat.isSymbolicLink() || stat.ino !== pathStat.ino || stat.dev !== pathStat.dev || stat.size > BigInt(limit)) throw new Error('Project Skills: file changed or exceeds size limit')
      const buffer = Buffer.alloc(limit + 1)
      let size = 0
      while (size < buffer.length) {
        const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size)
        if (!bytesRead) break
        size += bytesRead
      }
      if (size > limit) throw new Error('Project Skills: file exceeds size limit')
      remaining -= size
      result.push({ path: file.path, content: buffer.subarray(0, size), mode: Number(stat.mode & 0o777n) })
    } finally { await handle.close() }
  }
  await checkRoot(root, identity)
  return result
}

export async function createSkillDirectories(root: string, identity: string, directories: readonly string[]): Promise<void> {
  for (const directory of directories) {
    await checkRoot(root, identity)
    // Validate and create components without a recursive mkdir following links.
    await checkPath(root, `${directory}/.directory-check`, true)
    await checkRoot(root, identity)
  }
}

export async function createSkillFiles(root: string, identity: string, files: readonly SkillBytes[]): Promise<void> {
  for (const file of files) {
    await checkRoot(root, identity)
    await checkPath(root, file.path, true)
    const handle = await open(join(root, file.path), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), file.mode)
    try {
      await handle.writeFile(file.content)
      if (process.platform !== 'win32') await handle.chmod(file.mode)
      await handle.sync()
    } finally { await handle.close() }
    await checkRoot(root, identity)
    await checkPath(root, file.path)
  }
}
