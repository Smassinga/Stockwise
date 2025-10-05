// src/lib/i18n.tsx
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import en from '../locales/en.json'
import pt from '../locales/pt.json'

export type Locale = 'en' | 'pt'
type Dict = Record<string, string>
type Bundle = Record<Locale, Dict>

const dict: Bundle = { en, pt }

type Ctx = {
  lang: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  setLang: (next: Locale) => void
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
      let s = (dict as any)[lang]?.[key] ?? (dict as any).en?.[key] ?? key
      if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
      return s
    },
    [lang]
  )

  const value = useMemo<Ctx>(() => ({ lang, setLang, t }), [lang, t])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  return useContext(I18nContext)
}
