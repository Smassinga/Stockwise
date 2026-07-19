import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCommercialTaxConfiguration } from '../lib/commercialTax'
import {
  deriveCompanySetupAreas,
  selectNextSetupArea,
  type CompanySetupCounts,
  type CompanySetupProfile,
  type CompanySetupSettings,
  type CompanySetupSnapshot,
  type SetupArea,
  type SetupResource,
} from '../lib/companySetupReadiness'
import { getCompanyFiscalSettings, listCompanyFiscalSeries } from '../lib/mzFinance'
import type { CompanyRole } from '../lib/permissions'
import { supabase } from '../lib/supabase'

type SetupReadinessState = {
  loading: boolean
  areas: SetupArea[]
  refreshedAt: number | null
}

function available<T>(data: T): SetupResource<T> {
  return { status: 'available', data }
}

function unavailable<T>(): SetupResource<T> {
  return { status: 'unavailable' }
}

async function resource<T>(load: () => Promise<T>): Promise<SetupResource<T>> {
  try {
    return available(await load())
  } catch (error) {
    console.error('[setup-readiness] isolated read failed', error)
    return unavailable()
  }
}

async function companyCount(
  table: string,
  companyId: string,
  apply?: (query: any) => any,
) {
  let query = supabase.from(table).select('*', { count: 'exact', head: true }).eq('company_id', companyId)
  if (apply) query = apply(query)
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

function parseSettings(row: { base_currency_code?: string | null; data?: unknown } | null): CompanySetupSettings {
  const data = row?.data && typeof row.data === 'object' ? row.data as Record<string, any> : {}
  const documents = data.documents && typeof data.documents === 'object' ? data.documents as Record<string, any> : {}
  const brand = documents.brand && typeof documents.brand === 'object' ? documents.brand as Record<string, any> : {}
  const notifications = data.notifications && typeof data.notifications === 'object' ? data.notifications as Record<string, any> : {}
  const dueReminders = data.dueReminders && typeof data.dueReminders === 'object' ? data.dueReminders as Record<string, any> : {}

  return {
    baseCurrencyCode: row?.base_currency_code || null,
    documentBrandName: typeof brand.name === 'string' ? brand.name.trim() || null : null,
    documentBrandLogoUrl: typeof brand.logoUrl === 'string' ? brand.logoUrl.trim() || null : null,
    dailyDigestEnabled: notifications.dailyDigest === true,
    dueRemindersEnabled: dueReminders.enabled === true,
  }
}

async function loadSnapshot(companyId: string): Promise<CompanySetupSnapshot> {
  const profilePromise = resource(async () => {
    const { data, error } = await supabase
      .from('companies')
      .select('name,legal_name,trade_name,tax_id,address_line1,city,country_code,preferred_lang,logo_path')
      .eq('id', companyId)
      .maybeSingle()
    if (error) throw error
    const row = data as Record<string, unknown> | null
    return {
      name: typeof row?.name === 'string' ? row.name : null,
      legalName: typeof row?.legal_name === 'string' ? row.legal_name : null,
      tradeName: typeof row?.trade_name === 'string' ? row.trade_name : null,
      taxId: typeof row?.tax_id === 'string' ? row.tax_id : null,
      addressLine1: typeof row?.address_line1 === 'string' ? row.address_line1 : null,
      city: typeof row?.city === 'string' ? row.city : null,
      countryCode: typeof row?.country_code === 'string' ? row.country_code : null,
      preferredLanguage: typeof row?.preferred_lang === 'string' ? row.preferred_lang : null,
      logoPath: typeof row?.logo_path === 'string' ? row.logo_path : null,
    } satisfies CompanySetupProfile
  })

  const settingsPromise = resource(async () => {
    const { data, error } = await supabase
      .from('company_settings')
      .select('base_currency_code,data')
      .eq('company_id', companyId)
      .maybeSingle()
    if (error) throw error
    return parseSettings(data)
  })

  const countLoads: { [Key in keyof CompanySetupCounts]: Promise<SetupResource<number>> } = {
    allowedCurrencies: resource(() => companyCount('company_currencies', companyId)),
    uoms: resource(async () => {
      const { count, error } = await supabase.from('uoms').select('id', { count: 'exact', head: true })
      if (error) throw error
      return count ?? 0
    }),
    activeWarehouses: resource(() => companyCount('warehouses', companyId, (query) => query.eq('status', 'active'))),
    activeBins: resource(() => companyCount('bins', companyId, (query) => query.eq('status', 'active'))),
    items: resource(() => companyCount('items', companyId)),
    inventoryItems: resource(() => companyCount('items', companyId, (query) => query.eq('track_inventory', true))),
    serviceItems: resource(() => companyCount('items', companyId, (query) => query.eq('primary_role', 'service'))),
    sellableItems: resource(() => companyCount('items', companyId, (query) => query.eq('can_sell', true))),
    customers: resource(() => companyCount('customers', companyId)),
    suppliers: resource(() => companyCount('suppliers', companyId)),
    openingImports: resource(() => companyCount('posting_requests', companyId, (query) => query.eq('operation_type', 'opening_stock.import').eq('status', 'succeeded'))),
    activeMembers: resource(() => companyCount('company_members', companyId, (query) => query.eq('status', 'active'))),
    pendingInvitations: resource(() => companyCount('company_members', companyId, (query) => query.eq('status', 'invited'))),
    disabledMembers: resource(() => companyCount('company_members', companyId, (query) => query.eq('status', 'disabled'))),
    bankAccounts: resource(() => companyCount('bank_accounts', companyId)),
  }

  const [profile, settings, commercialTax, fiscalSettings, fiscalSeries, ...countResults] = await Promise.all([
    profilePromise,
    settingsPromise,
    resource(() => loadCommercialTaxConfiguration(companyId)),
    resource(() => getCompanyFiscalSettings(companyId)),
    resource(() => listCompanyFiscalSeries(companyId)),
    ...Object.values(countLoads),
  ])

  const countKeys = Object.keys(countLoads) as Array<keyof CompanySetupCounts>
  const counts = Object.fromEntries(countKeys.map((key, index) => [key, countResults[index]])) as CompanySetupSnapshot['counts']

  return { profile, settings, commercialTax, fiscalSettings, fiscalSeries, counts }
}

export function useCompanySetupReadiness(companyId: string | null, roleValue: string | null | undefined) {
  const role = (roleValue || null) as CompanyRole | null
  const [state, setState] = useState<SetupReadinessState>({ loading: Boolean(companyId), areas: [], refreshedAt: null })

  const refresh = useCallback(async () => {
    if (!companyId) {
      setState({ loading: false, areas: [], refreshedAt: null })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    const snapshot = await loadSnapshot(companyId)
    setState({ loading: false, areas: deriveCompanySetupAreas(snapshot, role), refreshedAt: Date.now() })
  }, [companyId, role])

  useEffect(() => {
    let active = true
    if (!companyId) {
      setState({ loading: false, areas: [], refreshedAt: null })
      return
    }
    setState((current) => ({ ...current, loading: true }))
    void loadSnapshot(companyId).then((snapshot) => {
      if (active) setState({ loading: false, areas: deriveCompanySetupAreas(snapshot, role), refreshedAt: Date.now() })
    })
    return () => { active = false }
  }, [companyId, role])

  const summary = useMemo(() => ({
    ready: state.areas.filter((area) => area.group === 'core' && area.readiness === 'ready').length,
    needsAction: state.areas.filter((area) => area.group === 'core' && ['needs_action', 'in_progress'].includes(area.readiness)).length,
    unavailable: state.areas.filter((area) => area.readiness === 'unavailable').length,
  }), [state.areas])

  return {
    ...state,
    summary,
    nextArea: selectNextSetupArea(state.areas),
    refresh,
  }
}
