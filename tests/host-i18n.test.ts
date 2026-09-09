import { describe, expect, it } from 'vitest'
import { createTranslator } from '../src/i18n/core.js'
import { hostMessages, hostPersistedCleanupMessage, hostRegistrationMessage } from '../src/i18n/host-messages.js'
import { hostMessage, withHostLanguage } from '../src/i18n/host.js'
import { consoleFailure, domainError } from '../src/console-host/errors.js'

const placeholders = (text: string) => [...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]).sort()

describe('Host message catalog', () => {
  it('provides both languages and identical interpolation contracts for every message', () => {
    for (const [key, pair] of Object.entries(hostMessages)) {
      expect(pair.zh.trim(), key).not.toBe('')
      expect(pair.en.trim(), key).not.toBe('')
      expect(placeholders(pair.zh), key).toEqual(placeholders(pair.en))
      expect(pair.en, key).not.toMatch(/[\u3400-\u9fff]/u)
    }
  })

  it('renders source-owned errors in the invocation language without changing their codes', () => {
    for (const language of ['zh', 'en'] as const) {
      const result = withHostLanguage(language, () => consoleFailure(domainError(
        'operation_not_allowed', hostMessage('onlyTheOwnerIsolatedSessionCanPrepareAReview'),
      )))
      expect(result).toMatchObject({ ok: false, error: {
        code: 'operation_not_allowed',
        message: hostMessages.onlyTheOwnerIsolatedSessionCanPrepareAReview[language],
      } })
    }
  })

  it('does not translate interpolation data such as user titles or paths', () => {
    const value = '用户路径 C:\项目\English {name} / 分支'
    for (const language of ['zh', 'en'] as const) {
      expect(withHostLanguage(language, () => hostMessage('sessionNotFound', { p0: value })))
        .toBe(hostMessages.sessionNotFound[language].replace('{p0}', value))
    }
  })

  it('localizes only explicitly recognized legacy cleanup messages at projection time', () => {
    const en = createTranslator(hostMessages, 'en')
    const stored = hostMessages.cleanupNewChanges.zh
    expect(hostPersistedCleanupMessage(stored, en)).toBe(hostMessages.cleanupNewChanges.en)
    expect(stored).toBe('Worktree 在提交后出现了新修改，未执行清理。')
    const raw = 'third-party error: 身份 changed / 用户内容'
    expect(hostPersistedCleanupMessage(raw, en)).toBe(raw)
    expect(hostPersistedCleanupMessage(`prefix: ${stored}`, en)).toBe(`prefix: ${stored}`)
  })

  it('exposes shared registration metadata bilingually rather than freezing a Session locale', () => {
    const key = 'inspectAndExplicitlyAcceptManagedWorktreeDelivery'
    expect(withHostLanguage('en', () => hostRegistrationMessage(key)))
      .toBe(`${hostMessages[key].zh} / ${hostMessages[key].en}`)
    expect(withHostLanguage('zh', () => hostRegistrationMessage(key)))
      .toBe(withHostLanguage('en', () => hostRegistrationMessage(key)))
  })

  it('passes through third-party error messages verbatim', () => {
    const raw = 'git custom driver: 用户消息 / no permission'
    expect(withHostLanguage('en', () => consoleFailure(new Error(raw))))
      .toMatchObject({ ok: false, error: { message: raw } })
  })
})
