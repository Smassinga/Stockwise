const TEMP_COMPANY_KEY = 'sw:lastCompanyId:temp'

export function rememberCompanyLocally(companyId: string | null) {
  if (!companyId || typeof window === 'undefined') return
  window.localStorage.setItem(TEMP_COMPANY_KEY, companyId)
}
