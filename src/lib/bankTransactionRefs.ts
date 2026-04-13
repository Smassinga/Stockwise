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

function bankErrorText(error: { message?: string | null; details?: string | null; hint?: string | null } | null | undefined) {
  return [error?.message, error?.details, error?.hint]
    .map((value) => String(value || '').toLowerCase())
    .join(' ')
}

export function isLegacyBanksRelationError(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
) {
  return String(error?.code || '') === '42P01' && bankErrorText(error).includes('public.banks')
}

export function getBankTransactionWriteMessage(
  error: { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined,
  t: (key: string, fallback: string) => string,
) {
  if (isMissingBankTransactionRefColumns(error)) {
    return t('settlements.bankMigrationNeeded', 'Bank-linked settlements need the latest migration before they can be posted')
  }
  if (isLegacyBanksRelationError(error)) {
    return t(
      'banks.toast.schemaDependencyOutdated',
      'Bank posting is blocked by an outdated bank-account dependency. Apply the latest bank settlement migration and try again.',
    )
  }
  return null
}
