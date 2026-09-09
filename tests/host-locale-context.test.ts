import { Context } from '@deepseek-ai/cordis'
import { registerTools } from '../src/tools.js'
import { registerWorktreeCommand } from '../src/commands.js'
import { hostMessage } from '../src/i18n/host.js'
import { describe, expect, it, vi } from 'vitest'
import { currentHostLanguage, languageFromSettings, withHostLanguage } from '../src/i18n/host.js'
import { WorktreeConsoleService } from '../src/console-host/service.js'
import type { WorktreeConsoleControlPlane } from '../src/console-host/control-plane.js'
import { WORKTREE_CONSOLE_DESCRIPTORS } from '../src/console-remote/descriptors.js'
import { createWorktreeConsoleRemoteAdapter } from '../src/client/console-remote/adapter.js'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

function settingsContext(preference: unknown) {
  return { get: (name: string) => name === 'settings' ? { get: (namespace: string) => namespace === 'locale' ? { preference } : undefined } : undefined }
}

describe('Host locale snapshots', () => {
  it('reads only the public context settings and falls back when unavailable', () => {
    expect(languageFromSettings(settingsContext('en-US'))).toBe('en')
    expect(languageFromSettings(settingsContext('zh-CN'))).toBe('zh')
    expect(languageFromSettings(settingsContext(undefined))).toBe('zh')
    expect(languageFromSettings({})).toBe('zh')
    expect(languageFromSettings({ get() { throw new Error('service unavailable') } })).toBe('zh')
  })

  it('isolates overlapping invocations and restores nesting even after failures', async () => {
    const english = deferred()
    const chinese = deferred()
    const en = withHostLanguage('en', async () => {
      expect(currentHostLanguage()).toBe('en')
      await english.promise
      expect(currentHostLanguage()).toBe('en')
      expect(() => withHostLanguage('zh', () => { throw new Error('nested') })).toThrow('nested')
      expect(currentHostLanguage()).toBe('en')
      return currentHostLanguage()
    })
    const zh = withHostLanguage('zh', async () => {
      await chinese.promise
      expect(currentHostLanguage()).toBe('zh')
      english.resolve()
      return currentHostLanguage()
    })
    chinese.resolve()
    expect(await Promise.all([en, zh])).toEqual(['en', 'zh'])
    expect(currentHostLanguage()).toBe('zh')
  })

  it('snapshots a preference for an invocation instead of observing later changes', async () => {
    let preference = 'en'
    const ctx = { get: () => ({ get: () => ({ preference }) }) }
    await withHostLanguage(languageFromSettings(ctx), async () => {
      preference = 'zh'
      await Promise.resolve()
      expect(currentHostLanguage()).toBe('en')
    })
    expect(languageFromSettings(ctx)).toBe('zh')
  })
})

describe('Console locale wire compatibility', () => {
  it('adds only an optional validated trailing locale to every descriptor', () => {
    for (const descriptor of WORKTREE_CONSOLE_DESCRIPTORS) {
      const last = descriptor.parameters.at(-1)!
      expect(last.name).toBe('locale')
      expect(last.acceptsUndefined).toBe(true)
      expect(last.source).toBe('json')
      expect(last.codec.mode).toBe('strict')
      if (last.codec.mode !== 'strict') throw new Error('strict codec required')
      expect(last.codec.schema.parse(undefined)).toBeUndefined()
      expect(last.codec.schema.parse('en')).toBe('en')
      expect(() => last.codec.schema.parse('invalid')).toThrow()
    }
  })

  it('captures each Client request language and keeps error codes stable', async () => {
    let language: 'zh' | 'en' = 'en'
    const remote = { current: vi.fn().mockResolvedValue({ ok: true, value: {} }) }
    const adapter = createWorktreeConsoleRemoteAdapter(remote as never, () => language)
    const first = await adapter.current({ sessionId: 'session-1' })
    expect(first).toEqual({ ok: false, error: { code: 'malformed_response', message: 'Remote current returned a payload that does not match the strict contract' } })
    language = 'zh'
    const second = await adapter.current({ sessionId: 'session-2' })
    expect(second).toEqual({ ok: false, error: { code: 'malformed_response', message: 'Remote current 返回了不符合 strict contract 的 payload' } })
    expect(remote.current.mock.calls).toEqual([['session-1', 'en'], ['session-2', 'zh']])
  })

  it('uses explicit locale without changing the business request or bleeding into concurrent service calls', async () => {
    const ctx = new Context()
    const gate = deferred()
    const seen: string[] = []
    const control = { current: async (sessionId: string) => {
      await gate.promise
      seen.push(`${sessionId}:${currentHostLanguage()}`)
      return { ok: false as const, error: { code: 'operation_not_allowed' as const, message: currentHostLanguage() } }
    } } as unknown as WorktreeConsoleControlPlane
    const service = new WorktreeConsoleService(ctx, control)
    const a = service.current({ id: 'one' } as never, 'en')
    const b = service.current({ id: 'two' } as never, 'zh')
    const c = service.current({ id: 'legacy' } as never)
    const d = service.current({ id: 'scoped', ctx: settingsContext('en') } as never)
    const e = service.current({ id: 'override', ctx: settingsContext('en') } as never, 'zh')
    gate.resolve()
    const results = await Promise.all([a, b, c, d, e])
    expect(seen).toEqual(['one:en', 'two:zh', 'legacy:zh', 'scoped:en', 'override:zh'])
    expect(results.map(result => result.ok ? '' : result.error.code)).toEqual(Array(5).fill('operation_not_allowed'))
    expect(currentHostLanguage()).toBe('zh')
  })
})

describe('registered Host entry points', () => {
  it('snapshots each tool Agent context across overlapping requests', async () => {
    const tools: any[] = []
    const gate = deferred()
    const seen: string[] = []
    const module = { listManagedWorktreesForSession: async (id: string) => {
      await gate.promise
      seen.push(`${id}:${currentHostLanguage()}`)
      return []
    } }
    registerTools({ tools: { register: (tool: unknown) => tools.push(tool) } } as never, module as never)
    const tool = tools.find(item => item.name === 'worktree_list')
    const first = tool.execute({}, { agent: { session: { id: 'english' }, ctx: settingsContext('en') } })
    const second = tool.execute({}, { agent: { session: { id: 'chinese' }, ctx: settingsContext('zh') } })
    gate.resolve()
    await Promise.all([first, second])
    expect(seen).toEqual(['english:en', 'chinese:zh'])
    expect(currentHostLanguage()).toBe('zh')
  })

  it('localizes command output and fallback errors at invocation, not registration', async () => {
    let command: any
    const module = { listManagedWorktreesForSession: async () => [] }
    registerWorktreeCommand({ commands: { register: (value: unknown) => { command = value } } } as never, module as never)
    const invoke = (preference?: string) => command.handler({ rawInput: 'list', agent: { session: { id: 'same' }, ctx: settingsContext(preference) } })
    const en = await invoke('en')
    const zh = await invoke('zh')
    expect(en.text).toBe(withHostLanguage('en', () => hostMessage('noManagedWorktreesVisibleToThisSession')))
    expect(zh.text).toBe(withHostLanguage('zh', () => hostMessage('noManagedWorktreesVisibleToThisSession')))
    expect(en.text).not.toBe(zh.text)
    expect(await invoke()).toEqual(zh)
  })
})
