import { describe, expect, it } from 'vitest'
import { clientMessages } from '../src/i18n/client-messages.js'
import { hostMessages } from '../src/i18n/host-messages.js'
import { transportMessages } from '../src/i18n/transport-messages.js'

const placeholders = (text: string) => [...new Set([...text.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(match => match[1]))].sort()

describe('translation catalog coverage', () => {
  for (const [name, catalog] of Object.entries({ clientMessages, hostMessages, transportMessages })) {
    it(`${name} has complete bilingual entries and identical named parameters`, () => {
      for (const [key, entry] of Object.entries(catalog)) {
        expect(entry.zh.trim(), `${name}.${key}.zh`).not.toBe('')
        expect(entry.en.trim(), `${name}.${key}.en`).not.toBe('')
        expect(placeholders(entry.en), `${name}.${key} parameters`).toEqual(placeholders(entry.zh))
      }
    })
  }
})
