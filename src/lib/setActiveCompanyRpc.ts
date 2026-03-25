import { supabase } from './supabase'

type RpcErrorLike = {
  code?: string
  message?: string
  hint?: string
  details?: string
}

function shouldRetryWithLegacyArg(error: RpcErrorLike | null | undefined) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  const hint = String(error?.hint || '')
  const details = String(error?.details || '')
  const blob = `${message} ${hint} ${details}`.toLowerCase()

  return code === 'PGRST202'
    || blob.includes('could not find the function public.set_active_company')
    || blob.includes('perhaps you meant')
}

export async function setActiveCompanyRpc(companyId: string) {
  const primary = await supabase.rpc('set_active_company', { p_company: companyId })
  if (!primary.error) return primary
  if (!shouldRetryWithLegacyArg(primary.error)) return primary
  return supabase.rpc('set_active_company', { p_company_id: companyId })
}
