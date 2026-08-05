import * as i18n from "@solid-primitives/i18n"

import { dict as desktopEn } from "./en"
import { dict as appEn } from "../../../../app/src/i18n/en"

export type Locale =
  | "en"
  | "zh"
  | "zht"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "da"
  | "ja"
  | "pl"
  | "ru"
  | "uk"
  | "ar"
  | "no"
  | "br"
  | "bs"
  | "tr"
  | "hi"
  | "nl"
  | "id"
  | "vi"
  | "it"
  | "ur"
  | "pa"
  | "az"
  | "fi"
  | "sv"
  | "th"

type RawDictionary = typeof appEn & typeof desktopEn
type Dictionary = Record<keyof i18n.Flatten<RawDictionary>, string>

const LOCALES: readonly Locale[] = [
  "en",
  "zh",
  "zht",
  "ko",
  "de",
  "es",
  "fr",
  "da",
  "ja",
  "pl",
  "ru",
  "uk",
  "bs",
  "ar",
  "no",
  "br",
  "tr",
  "hi",
  "nl",
  "id",
  "vi",
  "it",
  "ur",
  "pa",
  "az",
  "fi",
  "sv",
  "th",
]

function detectLocale(): Locale {
  if (typeof navigator !== "object") return "en"

  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("en")) return "en"
    if (language.toLowerCase().startsWith("zh")) {
      if (
        language.toLowerCase().includes("hant") ||
        language.toLowerCase().includes("-tw") ||
        language.toLowerCase().includes("-hk") ||
        language.toLowerCase().includes("-mo")
      )
        return "zht"
      return "zh"
    }
    if (language.toLowerCase().startsWith("ko")) return "ko"
    if (language.toLowerCase().startsWith("de")) return "de"
    if (language.toLowerCase().startsWith("es")) return "es"
    if (language.toLowerCase().startsWith("fr")) return "fr"
    if (language.toLowerCase().startsWith("da")) return "da"
    if (language.toLowerCase().startsWith("ja")) return "ja"
    if (language.toLowerCase().startsWith("pl")) return "pl"
    if (language.toLowerCase().startsWith("ru")) return "ru"
    if (language.toLowerCase().startsWith("uk")) return "uk"
    if (language.toLowerCase().startsWith("ar")) return "ar"
    if (
      language.toLowerCase().startsWith("no") ||
      language.toLowerCase().startsWith("nb") ||
      language.toLowerCase().startsWith("nn")
    )
      return "no"
    if (language.toLowerCase().startsWith("pt")) return "br"
    if (language.toLowerCase().startsWith("bs")) return "bs"
    if (language.toLowerCase().startsWith("tr")) return "tr"
    if (language.toLowerCase().startsWith("hi")) return "hi"
    if (language.toLowerCase().startsWith("nl")) return "nl"
    if (language.toLowerCase().startsWith("id")) return "id"
    if (language.toLowerCase().startsWith("vi")) return "vi"
    if (language.toLowerCase().startsWith("it")) return "it"
    if (language.toLowerCase().startsWith("ur")) return "ur"
    if (
      language.toLowerCase().startsWith("pa") &&
      (language.toLowerCase().includes("arab") || language.toLowerCase().includes("-pk"))
    )
      return "pa"
    if (
      language.toLowerCase().startsWith("az") &&
      !language.toLowerCase().includes("arab") &&
      !language.toLowerCase().includes("cyrl")
    )
      return "az"
    if (language.toLowerCase().startsWith("fi")) return "fi"
    if (language.toLowerCase().startsWith("sv")) return "sv"
    if (language.toLowerCase().startsWith("th")) return "th"
  }

  return "en"
}

function parseLocale(value: unknown): Locale | null {
  if (!value) return null
  if (typeof value !== "string") return null
  if ((LOCALES as readonly string[]).includes(value)) return value as Locale
  return null
}

function parseRecord(value: unknown) {
  if (!value || typeof value !== "object") return null
  if (Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseStored(value: unknown) {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function pickLocale(value: unknown): Locale | null {
  const direct = parseLocale(value)
  if (direct) return direct

  const record = parseRecord(value)
  if (!record) return null

  return parseLocale(record.locale)
}

const base = i18n.flatten({ ...appEn, ...desktopEn })

const loaders = {
  zh: () => Promise.all([import("../../../../app/src/i18n/zh"), import("./zh")]),
  zht: () => Promise.all([import("../../../../app/src/i18n/zht"), import("./zht")]),
  ko: () => Promise.all([import("../../../../app/src/i18n/ko"), import("./ko")]),
  de: () => Promise.all([import("../../../../app/src/i18n/de"), import("./de")]),
  es: () => Promise.all([import("../../../../app/src/i18n/es"), import("./es")]),
  fr: () => Promise.all([import("../../../../app/src/i18n/fr"), import("./fr")]),
  da: () => Promise.all([import("../../../../app/src/i18n/da"), import("./da")]),
  ja: () => Promise.all([import("../../../../app/src/i18n/ja"), import("./ja")]),
  pl: () => Promise.all([import("../../../../app/src/i18n/pl"), import("./pl")]),
  ru: () => Promise.all([import("../../../../app/src/i18n/ru"), import("./ru")]),
  uk: () => Promise.all([import("../../../../app/src/i18n/uk"), import("./uk")]),
  ar: () => Promise.all([import("../../../../app/src/i18n/ar"), import("./ar")]),
  no: () => Promise.all([import("../../../../app/src/i18n/no"), import("./no")]),
  br: () => Promise.all([import("../../../../app/src/i18n/br"), import("./br")]),
  bs: () => Promise.all([import("../../../../app/src/i18n/bs"), import("./bs")]),
  tr: () => Promise.all([import("../../../../app/src/i18n/tr"), import("./tr")]),
  hi: () => Promise.all([import("../../../../app/src/i18n/hi"), import("./hi")]),
  nl: () => Promise.all([import("../../../../app/src/i18n/nl"), import("./nl")]),
  id: () => Promise.all([import("../../../../app/src/i18n/id"), import("./id")]),
  vi: () => Promise.all([import("../../../../app/src/i18n/vi"), import("./vi")]),
  it: () => Promise.all([import("../../../../app/src/i18n/it"), import("./it")]),
  ur: () => Promise.all([import("../../../../app/src/i18n/ur"), import("./ur")]),
  pa: () => Promise.all([import("../../../../app/src/i18n/pa"), import("./pa")]),
  az: () => Promise.all([import("../../../../app/src/i18n/az"), import("./az")]),
  fi: () => Promise.all([import("../../../../app/src/i18n/fi"), import("./fi")]),
  sv: () => Promise.all([import("../../../../app/src/i18n/sv"), import("./sv")]),
  th: () => Promise.all([import("../../../../app/src/i18n/th"), import("./th")]),
}

async function build(locale: Locale): Promise<Dictionary> {
  if (locale === "en") return base
  const dictionaries = await loaders[locale]()
  return { ...base, ...i18n.flatten(dictionaries[0].dict), ...i18n.flatten(dictionaries[1].dict) }
}

const state = {
  locale: detectLocale(),
  dict: base as Dictionary,
  init: undefined as Promise<Locale> | undefined,
}

const translate = i18n.translator(() => state.dict, i18n.resolveTemplate)

export function t(key: keyof Dictionary, params?: Record<string, string | number>) {
  return translate(key, params)
}

export function initI18n(): Promise<Locale> {
  const cached = state.init
  if (cached) return cached

  const promise = (async () => {
    const raw = await window.api.storeGet("opencode.global.dat", "language").catch(() => null)
    const value = parseStored(raw)
    const next = pickLocale(value) ?? state.locale

    state.locale = next
    state.dict = await build(next)
    return next
  })().catch(() => state.locale)

  state.init = promise
  return promise
}
