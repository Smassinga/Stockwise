// src/lib/i18n.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import en from '../locales/en.json'
import pt from '../locales/pt.json'

export type Locale = 'en' | 'pt'
type Dict = Record<string, string>
type Bundle = Record<Locale, Dict>

const dict: Bundle = { en, pt }

// Product terminology that must stay consistent while older locale files still
// contain bank-only wording. Keep the override narrow and remove entries once
// the locale catalogue is regenerated from the maintained product vocabulary.
const productCopyOverrides: Bundle = {
  en: { 'banks.title': 'Banks & wallets', 'nav.banks': 'Banks & wallets' },
  pt: { 'banks.title': 'Bancos e carteiras móveis', 'nav.banks': 'Bancos e carteiras móveis' },
}

type Ctx = {
  lang: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  setLang: (next: Locale) => void
}

export function interpolateMessage(template: string, vars?: Record<string, string | number>) {
  let s = template
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  }
  return s
}

export function withI18nFallback(
  t: (key: string, vars?: Record<string, string | number>) => string,
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
) {
  const value = t(key, vars)
  return value === key ? interpolateMessage(fallback, vars) : value
}

const I18nContext = createContext<Ctx>({
  lang: 'en',
  t: (k: string) => k,
  setLang: () => {},
})

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLang] = useState<Locale>(() => {
    const fromLS = localStorage.getItem('app:lang') as Locale | null
    return fromLS === 'pt' ? 'pt' : 'en'
  })

  useEffect(() => {
    localStorage.setItem('app:lang', lang)
    document.documentElement.setAttribute('lang', lang)
  }, [lang])

  const t = useMemo(
    () => (key: string, vars?: Record<string, string | number>) => {
      const s = productCopyOverrides[lang]?.[key] ?? (dict as any)[lang]?.[key] ?? (dict as any).en?.[key] ?? key
      return interpolateMessage(s, vars)
    },
    [lang]
  )

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}