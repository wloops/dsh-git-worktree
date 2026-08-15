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
    const candidate = join(dirname(localProjectRoot), 'DeepSeek', 'deepseek-harness')
    return isHarnessRoot(candidate) ? candidate : undefined
  } catch {
    return undefined
  }
}

export function executable(name, platform = process.platform) {
  return platform === 'win32' ? `${name}.cmd` : name
}

export function createDshLaunch(options) {
  if (!options.harnessRoot) {
    return {
      command: executable('dsh', options.platform),
      args: ['--profile', options.profile, '--port', String(options.port)],
      cwd: options.workspaceRoot,
      source: false,
    }
  }
  if (!isHarnessRoot(options.harnessRoot)) {
    throw new Error(`Harness source checkout is invalid: ${options.harnessRoot}`)
  }
  return {
    command: executable('pnpm', options.platform),
    args: [
      '--dir', options.harnessRoot,
      'exec', 'node', '--import', 'tsx/esm',
      join(options.projectRoot, 'scripts', 'dsh-source-runner.mjs'),
      options.workspaceRoot,
      join(options.harnessRoot, 'apps', 'cli', 'src', 'bin.ts'),
      '--profile', options.profile,
      '--port', String(options.port),
    ],
    cwd: options.projectRoot,
    source: true,
  }
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

function cleanSupersededArchives(cacheRoot, keepPath) {
  for (const entry of readdirSync(cacheRoot)) {
    if (!/^dsh-git-worktree-\d+\.tgz$/.test(entry)) continue
    const candidate = join(cacheRoot, entry)
    if (candidate !== keepPath) rmSync(candidate, { force: true })
  }
}

/** Build, pack and install only the current local snapshot. No registry publish occurs. */
export function installLocalSnapshot(options) {
  const run = options.run ?? runProcess
  const pnpm = executable('pnpm', options.platform)
  const dsh = executable('dsh', options.platform)
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

  run(dsh, ['plugin', '--profile', options.profile, 'add', archivePath], { cwd: options.projectRoot })
  const dump = run(dsh, ['--profile', options.profile, '--dump-config'], {
    cwd: options.projectRoot,
    capture: true,
  }).stdout
  if (!dump.includes('dsh-git-worktree')) {
    throw new Error(`Profile ${options.profile} installed the tarball but did not compose dsh-git-worktree.`)
  }
  cleanSupersededArchives(options.cacheRoot, archivePath)
  return { archivePath, dumpConfig: dump }
}

export function removeLocalSnapshot(options) {
  const run = options.run ?? runProcess
  run(executable('dsh', options.platform), [
    'plugin', '--profile', options.profile, 'remove', 'dsh-git-worktree',
  ], { cwd: options.projectRoot })
  if (existsSync(options.cacheRoot)) {
    for (const entry of readdirSync(options.cacheRoot)) {
      if (/^dsh-git-worktree-\d+\.tgz$/.test(entry)) rmSync(join(options.cacheRoot, entry), { force: true })
    }
  }
}

export function smokeLocalSnapshot(options) {
  const run = options.run ?? runProcess
  const dump = run(executable('dsh', options.platform), [
    '--profile', options.profile, '--dump-config',
  ], { cwd: options.projectRoot, capture: true }).stdout
  if (!dump.includes('dsh-git-worktree')) {
    throw new Error(`Profile ${options.profile} does not compose dsh-git-worktree.`)
  }
  return dump
}
