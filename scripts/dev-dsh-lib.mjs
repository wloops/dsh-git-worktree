import { execFileSync, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const FIXTURE_MARKER = '.dsh-git-worktree-fixture.json'
const FIXTURE_IDENTITY = Object.freeze({
  owner: 'dsh-git-worktree',
  schemaVersion: 1,
})
const MODES = new Set(['run', 'install', 'remove', 'smoke'])

export function createDefaultOptions(projectRoot, cacheRoot) {
  return {
    projectRoot: resolve(projectRoot),
    cacheRoot: resolve(cacheRoot),
    profile: 'web',
    port: 3081,
    repo: resolve(cacheRoot, 'fixture'),
  }
}

export function parseDevDshArgs(argv, defaults) {
  const tokens = [...argv]
  const candidateMode = tokens[0] && !tokens[0].startsWith('-') ? tokens.shift() : 'run'
  if (!MODES.has(candidateMode)) {
    throw new Error(`Unknown mode ${candidateMode}. Expected run, install, remove, or smoke.`)
  }

  let profile = defaults.profile
  let port = defaults.port
  let repo = defaults.repo
  let repoExplicit = false
  let harnessRoot = defaults.harnessRoot

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === '--') continue
    if (token === '--profile' || token === '--repo' || token === '--port' || token === '--harness') {
      const value = tokens[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`)
      index += 1
      if (token === '--profile') profile = value
      if (token === '--repo') {
        repo = resolve(defaults.projectRoot, value)
        repoExplicit = true
      }
      if (token === '--port') port = parsePort(value)
      if (token === '--harness') harnessRoot = resolve(defaults.projectRoot, value)
      continue
    }
    if (token?.startsWith('--profile=')) {
      profile = token.slice('--profile='.length)
      continue
    }
    if (token?.startsWith('--repo=')) {
      repo = resolve(defaults.projectRoot, token.slice('--repo='.length))
      repoExplicit = true
      continue
    }
    if (token?.startsWith('--port=')) {
      port = parsePort(token.slice('--port='.length))
      continue
    }
    if (token?.startsWith('--harness=')) {
      harnessRoot = resolve(defaults.projectRoot, token.slice('--harness='.length))
      continue
    }
    throw new Error(`Unknown option ${token}.`)
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(profile)) {
    throw new Error('profile must contain only letters, numbers, dot, underscore, or dash.')
  }
  return {
    mode: candidateMode,
    profile,
    port,
    repo,
    repoExplicit,
    ...(harnessRoot ? { harnessRoot } : {}),
  }
}

function parsePort(value) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('port must be an integer between 1 and 65535.')
  }
  return parsed
}

function normalizedRealPath(path) {
  const value = realpathSync(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function validateGitRoot(repoPath) {
  let root
  try {
    root = git(repoPath, ['rev-parse', '--show-toplevel'])
  } catch {
    throw new Error(`Repository ${repoPath} is not a usable Git worktree.`)
  }
  if (normalizedRealPath(root) !== normalizedRealPath(repoPath)) {
    throw new Error(`Repository ${repoPath} is nested inside another Git worktree; pass its actual root instead.`)
  }
}

/**
 * Create or validate the disposable repository used by the one-command workflow.
 * Existing explicit repositories are read-only here. The default path requires our marker.
 */
export function ensureDevFixture(repoPath, options) {
  const absolute = resolve(repoPath)
  if (existsSync(absolute) && lstatSync(absolute).isSymbolicLink()) {
    throw new Error(`Fixture path ${absolute} is a symbolic link; refusing to manage it.`)
  }

  if (options.explicit) {
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      throw new Error(`Explicit repository ${absolute} must already exist.`)
    }
    validateGitRoot(absolute)
    return { path: absolute, created: false, managed: false }
  }

  let initialize = false
  if (!existsSync(absolute)) {
    mkdirSync(absolute, { recursive: true })
    initialize = true
  } else if (!statSync(absolute).isDirectory()) {
    throw new Error(`Fixture path ${absolute} is not a directory.`)
  } else {
    const entries = readdirSync(absolute)
    if (entries.length === 0) {
      initialize = true
    } else {
      const markerPath = join(absolute, FIXTURE_MARKER)
      if (!existsSync(markerPath)) {
        throw new Error(`Fixture path ${absolute} is not managed by dsh-git-worktree; existing bytes were left untouched.`)
      }
      let marker
      try {
        marker = JSON.parse(readFileSync(markerPath, 'utf8'))
      } catch {
        throw new Error(`Fixture marker at ${markerPath} is invalid; refusing to modify the directory.`)
      }
      if (marker.owner !== FIXTURE_IDENTITY.owner || marker.schemaVersion !== FIXTURE_IDENTITY.schemaVersion) {
        throw new Error(`Fixture marker at ${markerPath} has an unexpected identity.`)
      }
    }
  }

  if (initialize) {
    writeFileSync(join(absolute, FIXTURE_MARKER), `${JSON.stringify(FIXTURE_IDENTITY, null, 2)}\n`)
    writeFileSync(join(absolute, 'tracked.txt'), 'base\n')
    git(absolute, ['init'])
    git(absolute, ['add', FIXTURE_MARKER, 'tracked.txt'])
    git(absolute, [
      '-c', 'user.name=DSH Local Test',
      '-c', 'user.email=dsh-test@example.local',
      'commit', '-m', 'test: initialize disposable DSH worktree fixture',
    ])
  }

  validateGitRoot(absolute)
  const status = git(absolute, ['status', '--porcelain=v1', '--untracked-files=all'])
  if (status !== '') {
    throw new Error(`Managed fixture ${absolute} is not clean. Review it manually; the workflow will never reset or delete it.`)
  }
  const worktreeCount = git(absolute, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .length
  if (worktreeCount !== 1) {
    throw new Error(`Managed fixture ${absolute} still has ${worktreeCount - 1} linked Worktree(s). Finalize or remove them before reusing it.`)
  }
  return { path: absolute, created: initialize, managed: true }
}

function isHarnessRoot(path) {
  return existsSync(join(path, 'package.json'))
    && existsSync(join(path, 'apps', 'cli', 'src', 'bin.ts'))
}

export function discoverHarnessRoot(projectRoot, environment = process.env) {
  if (environment.DSH_HARNESS_ROOT) {
    const configured = resolve(environment.DSH_HARNESS_ROOT)
    if (!isHarnessRoot(configured)) {
      throw new Error(`DSH_HARNESS_ROOT does not point to a DeepSeek Harness checkout: ${configured}`)
    }
    return configured
  }
  try {
    const commonDir = git(projectRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    const localProjectRoot = dirname(resolve(projectRoot, commonDir))
    const parent = dirname(localProjectRoot)
    const candidates = [
      join(parent, 'deepseek-harness'),
      join(parent, 'DeepSeek', 'deepseek-harness'),
    ]
    return candidates.find(isHarnessRoot)
  } catch {
    return undefined
  }
}

export function executable(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.cmd` : name
}

export function createDshInvocation(options) {
  const cwd = options.cwd ?? options.projectRoot
  const args = options.args ?? []
  if (!options.harnessRoot) {
    return {
      command: executable('dsh', options.platform),
      args,
      cwd,
      source: false,
    }
  }
  const harnessRoot = resolve(options.harnessRoot)
  if (!isHarnessRoot(harnessRoot)) {
    throw new Error(`Harness source checkout is invalid: ${harnessRoot}`)
  }
  return {
    command: executable('pnpm', options.platform),
    args: [
      '--dir', harnessRoot,
      'exec', 'node', '--import', 'tsx/esm',
      join(options.projectRoot, 'scripts', 'dsh-source-runner.mjs'),
      cwd,
      join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts'),
      ...args,
    ],
    cwd: options.projectRoot,
    source: true,
  }
}

export function createDshLaunch(options) {
  return createDshInvocation({
    projectRoot: options.projectRoot,
    harnessRoot: options.harnessRoot,
    platform: options.platform,
    cwd: options.workspaceRoot,
    args: ['--profile', options.profile, '--port', String(options.port)],
  })
}

function assertWindowsCommandSafe(command, args) {
  for (const value of [command, ...args]) {
    if (/[\0\r\n"&|<>^%!]/.test(value)) {
      throw new Error(`Windows command argument contains unsupported shell metacharacters: ${value}`)
    }
  }
}

export function runProcess(command, args, options = {}) {
  const capture = options.capture === true
  const windows = process.platform === 'win32'
  if (windows) assertWindowsCommandSafe(command, args)
  const actualCommand = windows ? process.env.ComSpec || 'cmd.exe' : command
  const actualArgs = windows
    ? ['/d', '/v:off', '/c', command, ...args]
    : args
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout || ''}` : ''
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}.${detail}`)
  }
  return { stdout: capture ? result.stdout ?? '' : '' }
}

function copyPackageEntry(source, destination) {
  const info = lstatSync(source)
  if (info.isSymbolicLink()) throw new Error(`Refusing to package symbolic link ${source}.`)
  if (info.isDirectory()) {
    mkdirSync(destination, { recursive: true })
    for (const entry of readdirSync(source)) {
      copyPackageEntry(join(source, entry), join(destination, entry))
    }
    return
  }
  if (!info.isFile()) throw new Error(`Unsupported package entry ${source}.`)
  mkdirSync(resolve(destination, '..'), { recursive: true })
  copyFileSync(source, destination)
}

function dshHomeOf(options) {
  return options.environment?.DSH_HOME ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

function profileManifestOf(options) {
  return options.profileManifestPath ?? join(dshHomeOf(options), 'profiles', options.profile, 'package.json')
}

function archiveReferenceFromManifest(manifestPath, required = false) {
  if (!existsSync(manifestPath)) {
    if (required) throw new Error(`DSH profile manifest is missing: ${manifestPath}`)
    return undefined
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const specifier = manifest.dependencies?.['dsh-git-worktree']
  if (typeof specifier !== 'string' || !specifier.startsWith('file:')) {
    if (required) throw new Error('DSH profile did not record dsh-git-worktree as a local file dependency.')
    return undefined
  }
  let filePath
  try {
    filePath = decodeURIComponent(specifier.slice('file:'.length))
  } catch {
    if (required) throw new Error(`DSH profile recorded an invalid local file dependency: ${specifier}`)
    return undefined
  }
  return resolve(dirname(manifestPath), filePath)
}

function profileArchiveReference(options) {
  return archiveReferenceFromManifest(profileManifestOf(options), true)
}

function comparablePath(path) {
  const normalized = resolve(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function referencedProfileArchives(options) {
  const references = new Set()
  const addManifest = (manifestPath) => {
    try {
      const reference = archiveReferenceFromManifest(manifestPath)
      if (reference !== undefined) references.add(comparablePath(reference))
    } catch {
      // A malformed unrelated profile must not make local snapshot cleanup delete more files.
    }
  }
  addManifest(profileManifestOf(options))
  const profilesRoot = join(dshHomeOf(options), 'profiles')
  if (existsSync(profilesRoot)) {
    for (const entry of readdirSync(profilesRoot)) addManifest(join(profilesRoot, entry, 'package.json'))
  }
  return references
}

function cleanSupersededArchives(cacheRoot, keepPath, options) {
  const preserved = referencedProfileArchives(options)
  preserved.add(comparablePath(keepPath))
  for (const entry of readdirSync(cacheRoot)) {
    if (!/^dsh-git-worktree-\d+\.tgz$/.test(entry)) continue
    const candidate = join(cacheRoot, entry)
    if (!preserved.has(comparablePath(candidate))) rmSync(candidate, { force: true })
  }
}

function repairMissingCurrentProfileArchive(options, archivePath) {
  const previous = archiveReferenceFromManifest(profileManifestOf(options))
  if (previous === undefined || existsSync(previous)) return
  const managedCache = comparablePath(dirname(previous)) === comparablePath(options.cacheRoot)
    && /^dsh-git-worktree-\d+\.tgz$/.test(previous.split(/[\\/]/u).at(-1) ?? '')
  if (!managedCache) {
    throw new Error(`DSH profile references missing local archive outside the managed cache: ${previous}`)
  }
  copyFileSync(archivePath, previous)
}

function assertDshRuntimeAvailable(options) {
  if (options.harnessRoot) {
    createDshInvocation({
      projectRoot: options.projectRoot,
      harnessRoot: options.harnessRoot,
      platform: options.platform,
      args: [],
    })
    return
  }
  if (options.run) return
  try {
    runProcess(executable('dsh', options.platform), ['--version'], { capture: true })
  } catch (cause) {
    throw new Error(
      'No Harness source checkout was selected and the installed dsh CLI is unavailable. Pass --harness <path>, set DSH_HARNESS_ROOT, or install dsh on PATH.',
      { cause },
    )
  }
}

function runDsh(options, args, runOptions = {}) {
  const invocation = createDshInvocation({
    projectRoot: options.projectRoot,
    harnessRoot: options.harnessRoot,
    platform: options.platform,
    cwd: runOptions.cwd ?? options.projectRoot,
    args,
  })
  return (options.run ?? runProcess)(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    ...(runOptions.capture === true ? { capture: true } : {}),
  })
}

/** Build, pack and install only the current local snapshot. No registry publish occurs. */
export function installLocalSnapshot(options) {
  const run = options.run ?? runProcess
  const pnpm = executable('pnpm', options.platform)
  assertDshRuntimeAvailable(options)
  mkdirSync(options.cacheRoot, { recursive: true })

  if (!existsSync(join(options.projectRoot, 'node_modules'))) {
    run(pnpm, ['install', '--frozen-lockfile'], { cwd: options.projectRoot })
  }
  run(pnpm, ['run', 'typecheck'], { cwd: options.projectRoot })
  run(pnpm, ['run', 'build'], { cwd: options.projectRoot })

  const snapshotId = options.now?.() ?? Date.now()
  const archivePath = join(options.cacheRoot, `dsh-git-worktree-${snapshotId}.tgz`)
  const stagingRoot = join(options.cacheRoot, `.staging-${snapshotId}`)
  for (const entry of readdirSync(options.cacheRoot)) {
    if (/^\.staging-\d+$/.test(entry)) rmSync(join(options.cacheRoot, entry), { recursive: true, force: true })
  }
  mkdirSync(stagingRoot, { recursive: true })
  try {
    const manifest = JSON.parse(readFileSync(join(options.projectRoot, 'package.json'), 'utf8'))
    const stagedManifest = {
      ...manifest,
      version: `${manifest.version}-dev.${snapshotId}`,
      scripts: {},
    }
    writeFileSync(join(stagingRoot, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`)
    for (const entry of ['lib', 'cordis.patch.yml', 'README.md', 'README.zh.md', 'LICENSE']) {
      const source = join(options.projectRoot, entry)
      if (existsSync(source)) copyPackageEntry(source, join(stagingRoot, entry))
    }
    run(pnpm, ['pack', '--out', archivePath, '--json'], { cwd: stagingRoot })
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
  if (!existsSync(archivePath)) throw new Error(`pnpm pack did not create ${archivePath}.`)

  // pnpm resolves the profile's existing direct file dependency before it can
  // replace it. Repair only our own missing cache path with the new snapshot;
  // after the add succeeds the obsolete recovery copy becomes collectible.
  repairMissingCurrentProfileArchive(options, archivePath)
  runDsh(options, ['plugin', '--profile', options.profile, 'add', archivePath])
  const referencedArchive = profileArchiveReference(options)
  if (comparablePath(referencedArchive) !== comparablePath(archivePath)) {
    throw new Error(`DSH profile ${options.profile} still references ${referencedArchive}; preserving old and new archives for recovery.`)
  }
  const dump = runDsh(options, ['--profile', options.profile, '--dump-config'], { capture: true }).stdout
  if (!dump.includes('dsh-git-worktree')) {
    throw new Error(`Profile ${options.profile} installed the tarball but did not compose dsh-git-worktree.`)
  }
  cleanSupersededArchives(options.cacheRoot, archivePath, options)
  return { archivePath, dumpConfig: dump }
}

export function removeLocalSnapshot(options) {
  assertDshRuntimeAvailable(options)
  runDsh(options, ['plugin', '--profile', options.profile, 'remove', 'dsh-git-worktree'])
  if (existsSync(options.cacheRoot)) {
    for (const entry of readdirSync(options.cacheRoot)) {
      if (/^dsh-git-worktree-\d+\.tgz$/.test(entry)) rmSync(join(options.cacheRoot, entry), { force: true })
    }
  }
}

export function smokeLocalSnapshot(options) {
  assertDshRuntimeAvailable(options)
  const dump = runDsh(options, ['--profile', options.profile, '--dump-config'], { capture: true }).stdout
  if (!dump.includes('dsh-git-worktree')) {
    throw new Error(`Profile ${options.profile} does not compose dsh-git-worktree.`)
  }
  return dump
}
