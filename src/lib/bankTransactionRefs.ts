const STORAGE_KEY = 'stockwise:bank-transaction-refs'

let cachedSupport: boolean | null = null

function readCachedSupport(): boolean | null {
  if (cachedSupport !== null) return cachedSupport
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return null

  const stored = window.sessionStorage.getItem(STORAGE_KEY)
  if (stored === '1') {
    cachedSupport = true
    return cachedSupport
  }
  if (stored === '0') {
    cachedSupport = false
    return cachedSupport
  }
  return null
}

export function getBankTransactionRefSupport() {
  return readCachedSupport()
}

export function setBankTransactionRefSupport(value: boolean) {
  cachedSupport = value
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return
  window.sessionStorage.setItem(STORAGE_KEY, value ? '1' : '0')
}

export function isMissingBankTransactionRefColumns(error: { code?: string | null } | null | undefined) {
  return ['42703', 'PGRST204'].includes(String(error?.code || ''))
}
