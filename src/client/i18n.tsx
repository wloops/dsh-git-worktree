import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { createTranslator, normalizeLanguage, type Language, type Translator } from '../i18n/core.js'
import { clientMessages } from '../i18n/client-messages.js'

export type ClientTranslator = Translator<typeof clientMessages>
export interface ClientLocaleSource {
  getSnapshot(): { active?: unknown }
  subscribe(listener: () => void): () => void
}

function localeSource(locale: unknown): ClientLocaleSource | undefined {
  if (typeof locale !== 'object' || locale === null) return undefined
  const source = locale as Partial<ClientLocaleSource>
  return typeof source.getSnapshot === 'function' && typeof source.subscribe === 'function'
    ? source as ClientLocaleSource : undefined
}

/** DSH LocaleFace resolves preference/browser fallback into snapshot.active. */
export function readClientLanguage(locale: unknown): Language {
  try { return normalizeLanguage(localeSource(locale)?.getSnapshot().active) } catch { return 'zh' }
}

export function clientTranslator(language: Language = 'zh'): ClientTranslator {
  return createTranslator(clientMessages, language)
}
export const defaultClientTranslator = clientTranslator()
const ClientLanguageContext = createContext<Language>('zh')

export function ClientI18nProvider({ locale, language, children }: {
  locale?: unknown
  language?: Language
  children: ReactNode
}) {
  const store = useMemo(() => ({
    subscribe: (listener: () => void) => localeSource(locale)?.subscribe(listener) ?? (() => {}),
    getSnapshot: () => language ?? readClientLanguage(locale),
  }), [locale, language])
  const active = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  return <ClientLanguageContext.Provider value={active}>{children}</ClientLanguageContext.Provider>
}

export function useClientLanguage(): Language { return useContext(ClientLanguageContext) }
export function useClientTranslator(): ClientTranslator {
  const language = useClientLanguage()
  return useMemo(() => clientTranslator(language), [language])
}

/** Imperative services resolve language at invocation time, not at module load. */
export function translatorForServices(services: { locale?: unknown }): ClientTranslator {
  return clientTranslator(readClientLanguage(services.locale))
}
