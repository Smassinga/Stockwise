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
    window.sessionStorage.removeItem(STORAGE_KEY)
    return null
  }
  return null
}

export function getBankTransactionRefSupport() {
  return readCachedSupport()
}

export function setBankTransactionRefSupport(value: boolean) {
  cachedSupport = value
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') return
  if (value) {
    window.sessionStorage.setItem(STORAGE_KEY, '1')
  } else {
    window.sessionStorage.removeItem(STORAGE_KEY)
  }
}

export function isMissingBankTransactionRefColumns(error: { code?: string | null } | null | undefined) {
  return ['42703', 'PGRST204'].includes(String(error?.code || ''))
}
