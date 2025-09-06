// src/lib/currency.ts
import { db } from './db'

const LS_KEY = 'base_currency_code'

export async function getBaseCurrencyCode(): Promise<string> {
  const cached = localStorage.getItem(LS_KEY)
  if (cached) return cached

  try {
    const settings = await db.settings.get('app')
    const code = settings?.baseCurrencyCode || 'MZN'
    localStorage.setItem(LS_KEY, code)
    return code
  } catch {
    return 'MZN'
  }
}

export function setBaseCurrencyCode(code: string) {
  localStorage.setItem(LS_KEY, code)
}

export function formatMoneyBase(amount: number, code = localStorage.getItem(LS_KEY) || 'MZN', locale = 'en-MZ') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount || 0)
}
