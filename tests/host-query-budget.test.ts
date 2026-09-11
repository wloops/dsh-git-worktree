import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { expect, test, vi } from 'vitest'
import { createNodeSessionCheckoutDependencies } from './support/production-adapters.js'
import { createSessionCheckoutModule } from '../src/session-checkout-module.js'
import type { Context } from '@deepseek-ai/cordis'
import { createDshGitPort } from '../src/adapters/git.js'
import { createWorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'

const traces = vi.hoisted(() => ({ calls: [] as { args: string[]; ms: number }[] }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, spawn: (...args: Parameters<typeof actual.spawn>) => {
    const begin = performance.now()
    const child = actual.spawn(...args)
    child.on('close', () => traces.calls.push({ args: args[1] as string[], ms: performance.now() - begin }))
    return child
  } }
})

test.each([1, 3])('bounds real Git queries for a one-file preview and a %i-worktree management list', async count => {
  const root = mkdtempSync(join(tmpdir(), 'wt-host-latency-'))
  try {
    const projectRoot = join(root, 'repo'); mkdirSync(projectRoot)
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' })
      if (result.status) throw Error(result.stderr)
    }
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.test')
    writeFileSync(join(projectRoot, 'hello.txt'), 'Hello\n'); git('add', '.'); git('commit', '-m', 'base')
    const sessions = new Map([['source', { id: 'source', projectId: 'p' }]])
    const projects = new Map([['p', { id: 'p', name: 'Fixture', root: projectRoot }]])
    const lookup = { getSession: (id: string) => sessions.get(id), getProject: (id: string) => projects.get(id), getUnboundTargetPolicy: () => 'unselected' as const }
    const deps = createNodeSessionCheckoutDependencies({ configDir: join(root, 'config'), lookup })
    const ctx = { subprocess: { spawn(options: { argv: string[]; cwd: string; env: Record<string, string | undefined> }) {
      const child = spawn('git', options.argv.slice(1), { cwd: options.cwd, env: { ...process.env, ...options.env } })
      let stdout = '', stderr = ''
      child.stdout.on('data', data => { stdout += data }); child.stderr.on('data', data => { stderr += data })
      return { stdin: child.stdin, done: new Promise(resolve => child.on('close', exitCode => resolve({ exitCode }))), collected: {
        stdout: { readFrom: () => ({ text: stdout }) }, stderr: { readFrom: () => ({ text: stderr }) },
      } }
    } } } as unknown as Context
    deps.git = createDshGitPort(ctx, { hooksPath: join(root, 'no-hooks') })
    const module = createSessionCheckoutModule(deps)
    const launch = await module.createIsolatedTarget('source', 'owner')
    projects.set('owner-p', { id: 'owner-p', name: 'Owner', root: launch.managedRoot })
    sessions.set('owner', { id: 'owner', projectId: 'owner-p' })
    for (let index = 1; index < count; index++) {
      const sibling = await module.createIsolatedTarget('source', `sibling-${index}`)
      projects.set(`p-${index}`, { id: `p-${index}`, name: 'Sibling', root: sibling.managedRoot })
      sessions.set(`sibling-${index}`, { id: `sibling-${index}`, projectId: `p-${index}` })
    }
    writeFileSync(join(launch.managedRoot, 'hello.txt'), 'Hello, Worktree\n')
    await module.markReadyForReview('owner', { summary: 'One line', validationStatus: 'passed', tests: [], suggestedCommitMessage: 'test: line' })
    const plane = createWorktreeConsoleControlPlane({ module, lookup, files: deps.files, registry: deps.registry, git: deps.git })
    async function measure(label: string, fn: () => Promise<unknown>) {
      traces.calls.length = 0
      const start = performance.now(); const result = await fn()
      // Wall-clock timings are diagnostic only; command budgets are deterministic.
      console.log(JSON.stringify({ count, label, ms: Math.round(performance.now() - start), commands: traces.calls.length, gitMs: Math.round(traces.calls.reduce((n,c) => n+c.ms,0)) }))
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
      const budgets: Record<string, number> = { current: 18, list: 18 + 9 * (count - 1), preflight: 60, preview: 142 }
      expect(traces.calls.length).toBeLessThanOrEqual(budgets[label]!)
      return result
    }
    await measure('current', () => plane.current('owner'))
    const listing = await measure('list', () => plane.list({ sessionId: 'owner' })) as { value: { worktrees: unknown[] } }
    expect(listing.value.worktrees).toHaveLength(count)
    // The observation is fresh, not a cache or a path-only authorization shortcut.
    const before = await module.observeManagedCheckout!(launch.target.checkout.id)
    expect(before.dirty).toBe(true)
    const statusSpy = vi.spyOn(deps.git, 'status')
    await module.observeManagedCheckout!(launch.target.checkout.id)
    expect(statusSpy).toHaveBeenCalledWith(launch.managedRoot)
    statusSpy.mockRestore()
    sessions.set('outsider', { id: 'outsider', projectId: 'p' })
    expect(await plane.inspect('outsider', launch.target.checkout.id)).toMatchObject({ ok: false, error: { code: 'not_owner' } })
    const record = deps.registry.read().managedCheckouts[launch.target.checkout.id]!
    if (record.delivery.state !== 'ready_for_review') throw Error('not ready')
    const identity = { sessionId: 'owner', checkoutId: record.checkoutId, expectedRevision: record.revision, expectedReviewId: record.delivery.review.reviewId }
    await measure('preflight', () => plane.preflight(identity))
    await measure('preview', () => plane.preview(identity))
  } finally { rmSync(root, { force: true, recursive: true }) }
}, 120_000)
