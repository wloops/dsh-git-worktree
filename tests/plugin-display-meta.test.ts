import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { describe, expect, test } from 'vitest'

const require = createRequire(import.meta.url)
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))

describe('official plugin display resources', () => {
  test('exports complete English and Chinese metadata without changing npm fallback', () => {
    expect(manifest.exports['./locale/*.json']).toBe('./locale/*.json')
    const locales = Object.fromEntries(['en', 'zh'].map(language => {
      const path = require.resolve(`dsh-git-worktree/locale/${language}.json`)
      expect(path).toBe(resolve(`locale/${language}.json`))
      return [language, JSON.parse(readFileSync(path, 'utf8')).meta]
    }))
    expect(locales.zh).toEqual({ title: 'Git Worktree', description: '隔离开发会话，聚合工作树，支持改动验收、安全交付与恢复。' })
    expect(locales.en.title).toBe('Git Worktree')
    expect(locales.en.description).toContain('safe delivery')
    expect(manifest.description).toMatch(/^Experimental Git worktree/)
  })

  test('declares a small self-contained package-owned SVG icon', () => {
    const root = realpathSync('.')
    const path = realpathSync(resolve(manifest.icon))
    const local = relative(root, path)
    expect(isAbsolute(local) || local.startsWith('..')).toBe(false)
    expect(statSync(path).size).toBeLessThanOrEqual(256 * 1024)
    const svg = readFileSync(path, 'utf8')
    expect(svg).toContain('viewBox="0 0 64 64"')
    expect(svg).not.toMatch(/<script|<foreignObject|\bon\w+=|(?:href|src)=/i)
  })

  test('real npm tarball contains resolvable translations and the declared icon', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-display-pack-'))
    try {
      const result = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      const packed = JSON.parse(result)[0]
      const paths = packed.files.map((entry: { path: string }) => entry.path)
      for (const file of ['locale/en.json', 'locale/zh.json', 'assets/icon.svg']) expect(paths).toContain(file)
      const archive = join(directory, packed.filename)
      const packedManifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }))
      expect(packedManifest.icon).toBe('./assets/icon.svg')
      expect(packedManifest.exports['./locale/*.json']).toBe('./locale/*.json')
      for (const language of ['en', 'zh']) {
        const locale = JSON.parse(execFileSync('tar', ['-xOf', archive, `package/locale/${language}.json`], { encoding: 'utf8' }))
        expect(locale.meta.title).toBeTruthy()
        expect(locale.meta.description).toBeTruthy()
      }
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
