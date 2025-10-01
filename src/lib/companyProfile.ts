// src/lib/companyProfile.ts
import { supabase } from './supabase'

export type CompanyProfile = {
  id: string
  legal_name: string | null
  trade_name: string | null
  tax_id: string | null
  registration_no: string | null
  phone: string | null
  email: string | null
  website: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  country_code: string | null
  print_footer_note: string | null
  logo_path: string | null
  logo_updated_at: string | null
}

export async function getCompanyProfile(companyId: string) {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .eq('id', companyId)
    .maybeSingle<CompanyProfile>()
  if (error) throw error
  return data
}

export function companyLogoUrl(logo_path?: string | null) {
  if (!logo_path) return null
  const { data } = supabase.storage.from('brand-logos').getPublicUrl(logo_path)
  // cache-bust so a fresh upload shows immediately
  return data?.publicUrl ? `${data.publicUrl}?v=${Date.now()}` : null
}
