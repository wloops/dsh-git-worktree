import { describe, expect, it } from 'vitest'
import { createTranslator, normalizeLanguage, type MessageCatalog } from '../src/i18n/core.js'

const messages = {
  plain: { zh: '就绪', en: 'Ready' },
  path: { zh: '路径 {path}：{count}', en: 'Path {path}: {count}' },
} as const satisfies MessageCatalog

describe('shared translation contract', () => {
  it.each(['en', 'en-US', 'EN-gb'])('recognizes English %s', value => {
    expect(normalizeLanguage(value)).toBe('en')
  })
  it.each([undefined, null, '', 'zh', 'zh-CN', 'fr', 'english', {}, 1])('defaults unknown language %j to Chinese', value => {
    expect(normalizeLanguage(value)).toBe('zh')
  })
  it('interpolates once and preserves user content verbatim', () => {
    const path = 'D:/中文/{count}/$&/<tag>'
    expect(createTranslator(messages, 'en')('path', { path, count: 2 })).toBe(`Path ${path}: 2`)
    expect(createTranslator(messages, 'zh')('path', { path, count: 2 })).toBe(`路径 ${path}：2`)
    expect(createTranslator(messages, 'en')('plain')).toBe('Ready')
  })
  it('keeps keys and interpolation parameters typed', () => {
    const t = createTranslator(messages, 'en')
    if (false) {
      // @ts-expect-error unknown catalog key
      t('unknown')
      // @ts-expect-error required placeholder parameters
      t('path')
      // @ts-expect-error missing count
      t('path', { path: 'x' })
    }
  })
})
