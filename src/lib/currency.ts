// src/lib/currency.ts
import { db } from './db'
import { supabase } from './supabase'

const LS_KEY = 'base_currency_code'
const LS_PREFIX = 'base_currency_code:'
const LAST_COMPANY_PREFIX = 'sw:lastCompanyId:'

function currencyKey(companyId?: string | null) {
  return companyId ? `${LS_PREFIX}${companyId}` : LS_KEY
}

function readStoredActiveCompanyId() {
  if (typeof localStorage === 'undefined') return null

  const temp = localStorage.getItem(`${LAST_COMPANY_PREFIX}temp`)
  if (temp) return temp

  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !key.startsWith(LAST_COMPANY_PREFIX) || key === `${LAST_COMPANY_PREFIX}anon`) continue
    const value = localStorage.getItem(key)
    if (value) return value
  }

  return null
}

function writeCurrencyCache(code: string, companyId?: string | null) {
  localStorage.setItem(LS_KEY, code)
  const resolvedCompanyId = companyId || readStoredActiveCompanyId()
  if (resolvedCompanyId) {
    localStorage.setItem(currencyKey(resolvedCompanyId), code)
  }
}

export async function getBaseCurrencyCode(companyId?: string | null): Promise<string> {
  const resolvedCompanyId = companyId || readStoredActiveCompanyId()
  const scopedKey = currencyKey(resolvedCompanyId)
  const scopedCached = localStorage.getItem(scopedKey)
  if (scopedCached) return scopedCached

  try {
    const { data, error } = await supabase
      .from('company_settings_view')
      .select('base_currency_code')
      .limit(1)
      .maybeSingle()

    if (!error && data?.base_currency_code) {
      const code = String(data.base_currency_code)
      writeCurrencyCache(code, resolvedCompanyId)
      return code
    }
  } catch {
    // Fall back to legacy settings lookup.
  }

  const cached = localStorage.getItem(LS_KEY)
  if (cached) {
    writeCurrencyCache(cached, resolvedCompanyId)
    return cached
  }

  try {
    const settings = await db.settings.get('app')
    const code = settings?.baseCurrencyCode || 'MZN'
    writeCurrencyCache(code, resolvedCompanyId)
    return code
  } catch {
    return 'MZN'
  }
}

export function setBaseCurrencyCode(code: string, companyId?: string | null) {
  writeCurrencyCache(code, companyId)
}

export function formatMoneyBase(
  amount: number,
  code = localStorage.getItem(LS_KEY) || 'MZN',
  locale = 'en-MZ'
) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: code }).format(amount || 0)
}
