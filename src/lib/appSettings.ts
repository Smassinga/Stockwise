// src/lib/appSettings.ts
import { supabase } from './supabase'

export type AppSettings = {
  locale: { language: 'en' | 'pt' }
  dashboard: { defaultWindowDays: number; defaultWarehouseId: string; hideZeros: boolean }
  sales: {
    allowLineShip: boolean
    autoCompleteWhenShipped: boolean
    revenueRule: 'order_total_first' | 'lines_only'
    allocateMissingRevenueBy: 'cogs_share' | 'line_share'
    defaultFulfilWarehouseId?: string
  }
  documents: { brand: { name: string; logoUrl: string }; packingSlipShowsPrices: boolean }
  notifications: { dailyDigest: boolean; lowStock: { channel: 'email' | 'slack' | 'whatsapp' | 'none' } }
}

export const SETTINGS_DEFAULTS: AppSettings = {
  locale: { language: 'en' },
  dashboard: { defaultWindowDays: 30, defaultWarehouseId: 'ALL', hideZeros: false },
  sales: {
    allowLineShip: true,
    autoCompleteWhenShipped: true,
    revenueRule: 'order_total_first',
    allocateMissingRevenueBy: 'cogs_share',
    defaultFulfilWarehouseId: '',
  },
  documents: { brand: { name: '', logoUrl: '' }, packingSlipShowsPrices: false },
  notifications: { dailyDigest: false, lowStock: { channel: 'email' } },
}

function deepMerge<T extends Record<string, any>>(a: T, b: Partial<T>): T {
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || typeof b !== 'object') return (b as T) ?? a
  const out: any = { ...a }
  for (const k of Object.keys(b ?? {})) out[k] = deepMerge(a?.[k], (b as any)[k])
  return out
}

export async function getAppSettings(): Promise<AppSettings> {
  // Array mode avoids 406 when the row doesn't exist
  const { data, error } = await supabase
    .from('app_settings')
    .select('data')
    .eq('id', 'app')
    .limit(1)

  if (error) throw error

  const row = Array.isArray(data) && data.length > 0 ? data[0] : null
  const payload = (row?.data as Partial<AppSettings>) ?? {}
  return deepMerge(SETTINGS_DEFAULTS, payload)
}

export async function saveAppSettings(next: AppSettings): Promise<AppSettings> {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ id: 'app', data: next }, { onConflict: 'id' })
  if (error) throw error
  return next
}
