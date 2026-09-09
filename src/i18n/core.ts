/** Shared translation primitives; never imports browser or Host-only modules. */
export type Language = 'zh' | 'en'

export function normalizeLanguage(value: unknown): Language {
  return typeof value === 'string' && /^en(?:-|$)/i.test(value) ? 'en' : 'zh'
}

export type MessageCatalog = Record<string, { readonly zh: string; readonly en: string }>
type Placeholders<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Placeholders<Rest> : never
type MessageArgs<S extends string> = [Placeholders<S>] extends [never]
  ? [params?: Record<string, string | number>]
  : [params: Record<Placeholders<S>, string | number>]

export type Translator<C extends MessageCatalog> = <K extends keyof C & string>(
  key: K,
  ...args: MessageArgs<C[K]['zh'] | C[K]['en']>
) => string

export function createTranslator<const C extends MessageCatalog>(catalog: C, language: Language): Translator<C> {
  return ((key: keyof C & string, params?: Record<string, string | number>) => {
    const template = catalog[key]![language]
    return template.replace(/\{([^{}]+)\}/g, (match, name: string) =>
      params && Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
  }) as Translator<C>
}
