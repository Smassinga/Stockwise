import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Brand = { name: string; logoUrl: string | null }

function isAbsUrl(s?: string | null) {
  return !!s && /^(https?:)?\/\//i.test(s)
}
function resolveStorageUrl(path?: string | null): string | null {
  if (!path) return null
  const p = path.replace(/^\/+/, '')
  const slash = p.indexOf('/')
  if (slash <= 0) return null
  const bucket = p.slice(0, slash)
  const objectPath = p.slice(slash + 1)
  const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath)
  return data?.publicUrl ?? null
}

export function useBrandForDocs(companyId: string | null | undefined) {
  const [brand, setBrand] = useState<Brand>({ name: '', logoUrl: null })
  const [loading, setLoading] = useState<boolean>(!!companyId)

  useEffect(() => {
    let cancel = false
    if (!companyId) { setBrand({ name: '', logoUrl: null }); setLoading(false); return }

    ;(async () => {
      try {
        setLoading(true)
        const cs = await supabase
          .from('company_settings')
          .select('data')
          .eq('company_id', companyId)
          .maybeSingle()

        const settingsBrand = cs.data?.data?.documents?.brand as { name?: string; logoUrl?: string } | undefined

        const co = await supabase
          .from('companies')
          .select('name, trade_name, legal_name, logo_path')
          .eq('id', companyId)
          .maybeSingle()

        const fallbackName =
          co.data?.trade_name?.trim() ||
          co.data?.legal_name?.trim() ||
          co.data?.name?.trim() ||
          ''

        const chosenName = (settingsBrand?.name?.trim()) || fallbackName || ''

        let chosenLogo: string | null = null
        const raw = settingsBrand?.logoUrl || co.data?.logo_path
        if (raw) chosenLogo = isAbsUrl(raw) ? raw : resolveStorageUrl(raw)

        if (!cancel) setBrand({ name: chosenName, logoUrl: chosenLogo })
      } finally {
        if (!cancel) setLoading(false)
      }
    })()

    return () => { cancel = true }
  }, [companyId])

  const value = useMemo<Brand>(() => ({
    name: brand.name || '—',
    logoUrl: brand.logoUrl || null,
  }), [brand])

  return { ...value, loading }
}
