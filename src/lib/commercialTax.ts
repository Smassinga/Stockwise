import { supabase } from './supabase'

export type CommercialTaxTreatment = 'standard' | 'zero' | 'exempt'

export type CommercialTaxOption = {
  id: string
  company_id: string
  code: string
  display_name: string
  treatment_type: CommercialTaxTreatment
  rate: number
  requires_exemption_reason: boolean
  is_active: boolean
  effective_from: string
  effective_until: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

export type CommercialTaxSettings = {
  company_id: string
  default_sales_tax_option_id: string | null
  default_purchase_tax_option_id: string | null
  created_by: string
  created_at: string
  updated_by: string
  updated_at: string
}

export type CommercialTaxConfiguration = {
  options: CommercialTaxOption[]
  activeOptions: CommercialTaxOption[]
  settings: CommercialTaxSettings | null
  salesDefault: CommercialTaxOption | null
  purchaseDefault: CommercialTaxOption | null
}

export type CommercialTaxOrderReadiness = {
  ready: boolean
  mode: 'line' | 'legacy_header'
  blockers: string[]
  line_count?: number
  unconfigured_line_count?: number
  inactive_line_count?: number
  subtotal?: number
  tax_total?: number
  total?: number
}

const TAX_OPTION_FIELDS = [
  'id',
  'company_id',
  'code',
  'display_name',
  'treatment_type',
  'rate',
  'requires_exemption_reason',
  'is_active',
  'effective_from',
  'effective_until',
  'created_by',
  'created_at',
  'updated_by',
  'updated_at',
].join(',')

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function isCommercialTaxOptionEffective(option: CommercialTaxOption, date = todayIso()) {
  return option.is_active
    && option.effective_from <= date
    && (!option.effective_until || option.effective_until >= date)
}

export function commercialTaxOptionLabel(option: CommercialTaxOption) {
  return `${option.display_name} (${Number(option.rate).toLocaleString(undefined, { maximumFractionDigits: 4 })}%)`
}

export function roundCommercialMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function commercialTaxLinePreview(taxableBase: number, option?: CommercialTaxOption | null) {
  if (!option) return null
  return roundCommercialMoney(taxableBase * Number(option.rate || 0) / 100)
}

export async function loadCommercialTaxConfiguration(companyId: string): Promise<CommercialTaxConfiguration> {
  const [optionsResult, settingsResult] = await Promise.all([
    supabase
      .from('company_tax_options')
      .select(TAX_OPTION_FIELDS)
      .eq('company_id', companyId)
      .order('is_active', { ascending: false })
      .order('display_name', { ascending: true }),
    supabase
      .from('company_tax_settings')
      .select('company_id,default_sales_tax_option_id,default_purchase_tax_option_id,created_by,created_at,updated_by,updated_at')
      .eq('company_id', companyId)
      .maybeSingle(),
  ])

  if (optionsResult.error) throw optionsResult.error
  if (settingsResult.error) throw settingsResult.error

  const options = (optionsResult.data || []) as unknown as CommercialTaxOption[]
  const settings = (settingsResult.data || null) as unknown as CommercialTaxSettings | null
  const activeOptions = options.filter((option) => isCommercialTaxOptionEffective(option))
  const byId = new Map(options.map((option) => [option.id, option]))

  return {
    options,
    activeOptions,
    settings,
    salesDefault: settings?.default_sales_tax_option_id
      ? byId.get(settings.default_sales_tax_option_id) || null
      : null,
    purchaseDefault: settings?.default_purchase_tax_option_id
      ? byId.get(settings.default_purchase_tax_option_id) || null
      : null,
  }
}

export async function getCommercialTaxOrderReadiness(
  documentType: 'sales_order' | 'purchase_order',
  documentId: string,
) {
  const { data, error } = await supabase.rpc('get_commercial_tax_order_readiness', {
    p_document_type: documentType,
    p_document_id: documentId,
  })
  if (error) throw error
  return data as CommercialTaxOrderReadiness
}

export function commercialTaxErrorCode(error: unknown) {
  const candidate = error as { message?: string; details?: string; hint?: string }
  const haystack = [candidate?.message, candidate?.details, candidate?.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return haystack.match(/commercial_tax_[a-z0-9_]+/)?.[0] || null
}
