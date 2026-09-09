import { AsyncLocalStorage } from 'node:async_hooks'
import { createTranslator, normalizeLanguage, type Language, type Translator } from './core.js'
import { hostMessages } from './host-messages.js'

/** One immutable locale snapshot per invocation, isolated across async continuations. */
const languages = new AsyncLocalStorage<Language>()

export function currentHostLanguage(): Language {
  return languages.getStore() ?? 'zh'
}

export function withHostLanguage<T>(language: unknown, operation: () => T): T {
  return languages.run(normalizeLanguage(language), operation)
}

/** Read only the public, context-owned DSH settings seam; never persist browser preferences. */
export function languageFromSettings(ctx: unknown): Language {
  const context = ctx as { get?: (name: string) => unknown } | undefined
  try {
    const settings = context?.get?.('settings') as { get?: (namespace: string) => unknown } | undefined
    const locale = settings?.get?.('locale') as { preference?: unknown } | undefined
    return normalizeLanguage(locale?.preference)
  } catch {
    // The optional service/namespace can be absent during composition or teardown.
    return 'zh'
  }
}

/** Prefer the invocation's Agent context so scoped settings do not leak between users. */
export function languageForInvocation(agent: unknown, fallbackContext: unknown): Language {
  const context = (agent as { ctx?: unknown } | undefined)?.ctx ?? fallbackContext
  return languageFromSettings(context)
}

export const hostMessage: Translator<typeof hostMessages> = ((key: keyof typeof hostMessages, ...args: unknown[]) => {
  const translate = createTranslator(hostMessages, currentHostLanguage()) as (key: keyof typeof hostMessages, params?: unknown) => string
  return translate(key, args[0])
}) as Translator<typeof hostMessages>
