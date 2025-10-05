// src/pages/Orders/SalesOrders.tsx
import { useEffect, useMemo, useState } from 'react'
import { db, supabase } from '../../lib/db'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel
} from '../../components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../../components/ui/sheet'
import toast from 'react-hot-toast'
import MobileAddLineButton from '../../components/MobileAddLineButton'
import { formatMoneyBase, getBaseCurrencyCode } from '../../lib/currency'
import { buildConvGraph, convertQty, type ConvRow } from '../../lib/uom'
import { useI18n } from '../../lib/i18n'
import { useOrg } from '../../hooks/useOrg'

// NEW: company profile helper (DB companies + storage URL)
import {
  getCompanyProfile as getCompanyProfileDB,
  companyLogoUrl,
  type CompanyProfile as DBCompanyProfile,
} from '../../lib/companyProfile'

type AppSettings = {
  sales?: {
    allowLineShip?: boolean
    autoCompleteWhenShipped?: boolean
    defaultFulfilWarehouseId?: string
  }
  // possible branding shapes; we probe defensively
  branding?: { companyName?: string; logoUrl?: string }
  brand?: { logoUrl?: string }
  logoUrl?: string
  companyName?: string
  company?: { name?: string; logoUrl?: string }
} & Record<string, any>

type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string; family?: string }
type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type Customer = {
  id: string
  code?: string
  name: string
  email?: string | null
  phone?: string | null
  tax_id?: string | null
  billing_address?: string | null
  shipping_address?: string | null
  payment_terms?: string | null
}
type Warehouse = { id: string; code?: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }

const VALID_SO_STATUSES = ['draft','submitted','confirmed','allocated','shipped','closed','cancelled'] as const
type SoStatus = typeof VALID_SO_STATUSES[number]

type SO = {
  id: string
  customer?: string
  customer_id?: string
  status: SoStatus | string
  currency_code?: string
  fx_to_base?: number
  expected_ship_date?: string | null
  notes?: string | null
  total_amount?: number | null
  tax_total?: number | null
  payment_terms?: string | null
  bill_to_name?: string | null
  bill_to_email?: string | null
  bill_to_phone?: string | null
  bill_to_tax_id?: string | null
  bill_to_billing_address?: string | null
  bill_to_shipping_address?: string | null

  // browser-only
  order_no?: string | null
  created_at?: string | null
  updated_at?: string | null
  company_id?: string | null
}

type SOL = {
  id?: string
  so_id: string
  item_id: string
  uom_id: string
  line_no?: number
  qty: number
  unit_price: number
  discount_pct?: number | null
  line_total: number
  is_shipped?: boolean
  shipped_at?: string | null
  shipped_qty?: number
}

// NEW: UI mapping for Company Profile
type CompanyProfileUI = {
  tradeName?: string
  legalName?: string
  taxId?: string
  regNo?: string
  phone?: string
  email?: string
  website?: string
  address1?: string
  address2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  printFooterNote?: string
}
const mapDBProfile = (p?: DBCompanyProfile | null): CompanyProfileUI => {
  const norm = (v: any) => (v ?? '').toString().trim() || undefined
  if (!p) return {}
  return {
    tradeName:      norm(p.trade_name),
    legalName:      norm(p.legal_name),
    taxId:          norm(p.tax_id),
    regNo:          norm(p.registration_no),
    phone:          norm(p.phone),
    email:          norm(p.email),
    website:        norm(p.website),
    address1:       norm(p.address_line1),
    address2:       norm(p.address_line2),
    city:           norm(p.city),
    state:          norm(p.state),
    postalCode:     norm(p.postal_code),
    country:        norm(p.country_code),
    printFooterNote:norm(p.print_footer_note),
  }
}

const nowISO = () => new Date().toISOString()
const n = (v: string | number | null | undefined, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v) : d
const fmtAcct = (v: number) => {
  const neg = v < 0
  const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return neg ? `(${s})` : s
}
const ts = (row: any) =>
  row?.createdAt ?? row?.created_at ?? row?.createdat ?? row?.updatedAt ?? row?.updated_at ?? row?.updatedat ?? 0

const initials = (s?: string | null) => {
  const t = (s || '').trim()
  if (!t) return '—'
  const parts = t.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || t[0]?.toUpperCase() || '—'
}

/** Prefetch an image and convert to Data URL to avoid CORS/expiry; returns null on failure. */
async function fetchDataUrl(src?: string | null): Promise<string | null> {
  if (!src || !src.trim()) return null
  try {
    const r = await fetch(src, { mode: 'cors', cache: 'no-store' })
    if (!r.ok) return null
    const b = await r.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = reject
      fr.readAsDataURL(b)
    })
  } catch {
    return null
  }
}

// --- NEW: per-line on-hand state
type OnHandByBin = { bin_id: string | null; qty: number }

export default function SalesOrders() {
  const { t } = useI18n()
  const { companyId } = useOrg()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const s = t(key, vars)
    return s === key ? fallback : s
  }

  // masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])
  const [app, setApp] = useState<AppSettings | null>(null)

  // branding (for print header)
  const [brandName, setBrandName] = useState<string>('')
  const [brandLogoUrl, setBrandLogoUrl] = useState<string>('')

  // NEW: full company profile (companies table)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileUI>({})

  // conversions
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // lists
  const [sos, setSOs] = useState<SO[]>([])
  const [solines, setSOLines] = useState<SOL[]>([])

  // create form
  const [soOpen, setSoOpen] = useState(false)
  const [soCustomerId, setSoCustomerId] = useState('')
  const [soCurrency, setSoCurrency] = useState('MZN')
  const [soFx, setSoFx] = useState('1')
  const [soDate, setSoDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [soTaxPct, setSoTaxPct] = useState<string>('0')
  const [soLinesForm, setSoLinesForm] = useState<
    Array<{ itemId: string; uomId: string; qty: string; unitPrice: string; discountPct: string }>
  >([{ itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])

  // view+ship
  const [soViewOpen, setSoViewOpen] = useState(false)
  const [selectedSO, setSelectedSO] = useState<SO | null>(null)

  // GLOBAL override/default warehouse (optional UX)
  const [shipWhId, setShipWhId] = useState<string>('')

  // --- NEW: per-line warehouse + bin selection and on-hand
  const [whByLine, setWhByLine] = useState<Record<string, string>>({})
  const [binByLine, setBinByLine] = useState<Record<string, string>>({})
  const [onHandByLine, setOnHandByLine] = useState<Record<string, OnHandByBin[]>>({})

  // --- Shipped SOs browser state
  const PAGE_SIZE = 100
  const [shippedOpen, setShippedOpen] = useState(false)
  const [shippedRows, setShippedRows] = useState<SO[]>([])
  const [shippedHasMore, setShippedHasMore] = useState(false)
  const [shippedPage, setShippedPage] = useState(0)
  const [shipQ, setShipQ] = useState('')
  const [shipDateFrom, setShipDateFrom] = useState('')
  const [shipDateTo, setShipDateTo] = useState('')
  const [shipStatuses, setShipStatuses] = useState<Record<'shipped' | 'closed', boolean>>({
    shipped: true, closed: true,
  })
  const shippedStatusList = () =>
    (['shipped','closed'] as const).filter(k => shipStatuses[k])

  function resetShippedPaging() {
    setShippedRows([])
    setShippedPage(0)
    setShippedHasMore(false)
  }

  async function fetchShippedPage(page = 0) {
    if (!companyId) return
    const statuses = shippedStatusList()
    if (statuses.length === 0) { setShippedRows([]); setShippedHasMore(false); return }

    let q = supabase
      .from('sales_orders')
      .select('id,customer_id,customer,status,currency_code,fx_to_base,total_amount,updated_at,created_at,order_no,bill_to_name')
      .eq('company_id', companyId)
      .in('status', statuses as SoStatus[])
      .order('updated_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    const term = shipQ.trim()
    if (term) q = q.or(`order_no.ilike.%${term}%,bill_to_name.ilike.%${term}%,customer.ilike.%${term}%`)
    if (shipDateFrom) q = q.gte('updated_at', shipDateFrom)
    if (shipDateTo)   q = q.lte('updated_at', shipDateTo + ' 23:59:59')

    const { data, error } = await q
    if (error) { console.error(error); toast.error('Failed to load shipped SOs'); return }

    const rows = (data || []) as SO[]
    setShippedRows(prev => page === 0 ? rows : [...prev, ...rows])
    setShippedHasMore(rows.length === PAGE_SIZE)
    setShippedPage(page)
  }

  useEffect(() => {
    if (!shippedOpen || !companyId) return
    const t = setTimeout(() => { resetShippedPaging(); fetchShippedPage(0) }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shippedOpen, shipQ, shipDateFrom, shipDateTo, shipStatuses.shipped, shipStatuses.closed, companyId])

  // helpers
  const codeOf = (id?: string) => (id ? (uomById.get(id)?.code || '').toUpperCase() : '')
  const uomIdFromIdOrCode = (v?: string | null): string => {
    if (!v) return ''
    if (uomById.has(v)) return v
    const needle = String(v).toUpperCase()
    for (const u of uoms) {
      if ((u.code || '').toUpperCase() === needle) return u.id
    }
    return ''
  }
  const idsOrCodesEqual = (aId?: string, bId?: string) => {
    if (!aId || !bId) return false
    if (aId === bId) return true
    const ac = codeOf(aId), bc = codeOf(bId)
    return !!(ac && bc && ac === bc)
  }
  const safeConvert = (qty: number, fromIdOrCode: string, toIdOrCode: string): number | null => {
    const from = uomIdFromIdOrCode(fromIdOrCode)
    const to = uomIdFromIdOrCode(toIdOrCode)
    if (!from || !to) return null
    if (idsOrCodesEqual(from, to)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, from, to, convGraph)) } catch { return null }
  }

  // Group UoMs by family
  const groupedUoms = useMemo(() => {
    const map = new Map<string, Uom[]>()
    for (const u of uoms) {
      const fam = (u.family || 'Other').toString()
      if (!map.has(fam)) map.set(fam, [])
      map.get(fam)!.push(u)
    }
    for (const arr of map.values()) arr.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
    return map
  }, [uoms])

  // Grouped + convertible UoMs for a given item
  function convertibleGroupedUomsForItem(itemId?: string) {
    if (!itemId) return groupedUoms
    const it = itemById.get(itemId)
    if (!it) return groupedUoms
    const base = uomIdFromIdOrCode(it.baseUomId)
    if (!base) return groupedUoms
    if (!convGraph) return groupedUoms

    const out = new Map<string, Uom[]>()
    groupedUoms.forEach((arr, fam) => {
      const filtered = arr.filter(u => idsOrCodesEqual(u.id, base) || safeConvert(1, u.id, base) != null)
      if (filtered.length) out.set(fam, filtered)
    })
    return out
  }

  const soNo = (s: any) => s?.orderNo ?? s?.order_no ?? s?.id
  const fxSO = (s: SO) => n((s as any).fx_to_base ?? (s as any).fxToBase, 1)
  const curSO = (s: SO) => (s as any).currency_code ?? (s as any).currencyCode

  // Prefer bill_to_name; if we can resolve a customer row, show CODE — Name
  const soCustomerLabel = (s: SO) => {
    const cust = s.customer_id ? customers.find(c => c.id === s.customer_id) : undefined
    if (cust) return `${cust.code ? cust.code + ' — ' : ''}${cust.name}`
    return s.bill_to_name ?? s.customer ?? (s.customer_id || tt('none', '(none)'))
  }

  const remaining = (l: SOL) => Math.max(n(l.qty) - n(l.shipped_qty), 0)

  // load masters, conversions, settings, lists, defaults, (global) branding fallbacks
  useEffect(() => {
    ;(async () => {
      try {
        const [it, uu, appRes] = await Promise.all([
          db.items.list({ orderBy: { name: 'asc' } }),
          supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
          supabase.from('app_settings').select('data').eq('id', 'app').maybeSingle(),
        ])
        setApp((appRes.data as any)?.data ?? {})

        setItems((it || []).map((x: any) => ({ ...x, baseUomId: x.baseUomId ?? x.base_uom_id ?? '' })))
        if (uu.error) throw uu.error
        setUoms(((uu.data || []) as any[]).map(u => ({ ...u, code: String(u.code || '').toUpperCase() })))

        const { data: convRows, error: convErr } = await supabase
          .from('uom_conversions')
          .select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        const [so, sol] = await Promise.all([ db.salesOrders.list(), db.salesOrderLines.list() ])
        const withFlags = (sol || []).map((l: any) => ({
          ...l,
          is_shipped: l.is_shipped ?? false,
          shipped_at: l.shipped_at ?? null,
          shipped_qty: Number.isFinite(Number(l.shipped_qty)) ? Number(l.shipped_qty) : 0,
        })) as SOL[]
        setSOs((so || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
        setSOLines(withFlags)

        // GLOBAL fallbacks for brand (used only if company_settings doesn't provide one)
        try {
          const [brandRes, companyRes] = await Promise.all([
            supabase.from('app_settings').select('data').eq('id', 'brand').maybeSingle(),
            supabase.from('app_settings').select('data').eq('id', 'company').maybeSingle(),
          ])
          const a = (appRes.data as any)?.data ?? {}
          const brand = (brandRes.data as any)?.data ?? {}
          const company = (companyRes.data as any)?.data ?? {}
          const nameGuess =
            company?.name ||
            brand?.companyName ||
            a?.company?.name ||
            a?.companyName ||
            a?.branding?.companyName || ''
          const logoGuess =
            brand?.logoUrl ||
            company?.logoUrl ||
            a?.branding?.logoUrl ||
            a?.brand?.logoUrl ||
            a?.logoUrl || ''
          setBrandName(prev => prev || String(nameGuess || ''))
          setBrandLogoUrl(prev => prev || String(logoGuess || ''))
        } catch { /* non-fatal */ }

      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || tt('orders.loadFailed', 'Failed to load sales orders'))
      }
    })()
  }, []) // once

  // Load company-scoped masters when companyId is known (A)
  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        // 0) base currency for this company
        setBaseCode(await getBaseCurrencyCode())

        // 1) currencies scoped to company
        const cs = await supabase
          .from('company_currencies_view')
          .select('code,name,symbol,decimals')
          .order('code', { ascending: true })
        if (cs.error) throw cs.error
        setCurrencies((cs.data || []) as Currency[])

        // 2) items scoped to company
        const itRes = await supabase
          .from('items')
          .select('id,sku,name,base_uom_id')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (itRes.error) throw itRes.error
        setItems(
          (itRes.data || []).map((x: any) => ({
            id: x.id, sku: x.sku, name: x.name, baseUomId: x.base_uom_id ?? x.baseUomId ?? '',
          }))
        )

        // 3) customers
        const custs = await supabase
          .from('customers')
          .select('id,code,name,email,phone,tax_id,billing_address,shipping_address,payment_terms')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (custs.error) throw custs.error
        setCustomers((custs.data || []) as Customer[])

        // 4) warehouses
        const whs = await supabase
          .from('warehouses')
          .select('id,name,code')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (whs.error) throw whs.error
        setWarehouses(((whs.data || []) as any[]).map(w => ({ id:w.id, name:w.name, code:w.code })))

        // 5) bins
        const bns = await supabase
          .from('bins')
          .select('id,code,name,warehouseId')
          .eq('company_id', companyId)
          .order('code', { ascending: true })
        if (bns.error) throw bns.error
        setBins(((bns.data || []) as any[]).map(b => ({ id:b.id, code:b.code, name:b.name, warehouseId:b.warehouseId })))

        // 6) default WH (for the global override)
        const fromSettings = (await supabase
          .from('app_settings').select('data').eq('id', 'app').maybeSingle()
        ).data as any
        const prefId = fromSettings?.data?.sales?.defaultFulfilWarehouseId
        const preferred = (whs.data || []).find((w:any) => w.id === prefId) ?? (whs.data || [])[0]
        setShipWhId(preferred?.id || '')

        // 7) branding—companies table (preferred)
        const row = await getCompanyProfileDB(companyId)
        setCompanyProfile(mapDBProfile(row))
        const nameFromCompanies = (row?.trade_name || row?.legal_name || '').trim()
        const logoFromCompanies = companyLogoUrl(row?.logo_path || undefined)
        if (nameFromCompanies) setBrandName(nameFromCompanies)
        if (logoFromCompanies) setBrandLogoUrl(logoFromCompanies)

        // 8) fallback to company_settings brand
        if (!logoFromCompanies || !nameFromCompanies) {
          const res = await supabase
            .from('company_settings')
            .select('data')
            .eq('company_id', companyId)
            .maybeSingle()
          const doc = (res.data as any)?.data || {}
          const csLogo = (doc?.documents?.brand?.logoUrl || '').trim()
          const csName = (doc?.documents?.brand?.name || '').trim()
          if (!logoFromCompanies && csLogo) setBrandLogoUrl(csLogo)
          if (!nameFromCompanies && csName) setBrandName(csName)
        }
      } catch (e) {
        console.warn('company-scoped masters load failed:', e)
      }
    })()
  }, [companyId])

  // default chosen currency = baseCode (if previous was placeholder)
  useEffect(() => { setSoCurrency((prev) => prev && prev !== 'MZN' ? prev : baseCode) }, [baseCode])
  useEffect(() => {
    if (currencies.length === 0) return
    const exists = currencies.some(c => c.code === soCurrency)
    if (!exists) setSoCurrency(currencies[0].code)
  }, [currencies])

  // Initialize per-line warehouse and bin when opening View
  useEffect(() => {
    if (!soViewOpen || !selectedSO) return
    const lines = solines.filter(l => l.so_id === selectedSO.id && remaining(l) > 0)
    setWhByLine(prev => {
      const next = { ...prev }
      const fallbackWh = shipWhId || warehouses[0]?.id || ''
      for (const ln of lines) {
        const key = String(ln.id)
        if (!next[key]) next[key] = fallbackWh
      }
      return next
    })
  }, [soViewOpen, selectedSO, solines, shipWhId, warehouses])

  // Fetch on-hand per line (group queries by warehouse)
  useEffect(() => {
    async function run() {
      if (!soViewOpen || !selectedSO) { setOnHandByLine({}); return }
      const lines = solines.filter(l => l.so_id === selectedSO.id && remaining(l) > 0)
      if (lines.length === 0) { setOnHandByLine({}); return }

      // Group items by selected warehouse
      const groups = new Map<string, Set<string>>() // whId -> itemIds
      for (const ln of lines) {
        const wh = whByLine[String(ln.id)] || shipWhId
        if (!wh) continue
        if (!groups.has(wh)) groups.set(wh, new Set())
        groups.get(wh)!.add(ln.item_id)
      }

      const result: Record<string, OnHandByBin[]> = {}
      for (const [wh, itemsSet] of groups.entries()) {
        const itemIds = Array.from(itemsSet)
        const { data, error } = await supabase
          .from('stock_levels')
          .select('item_id,bin_id,qty')
          .eq('warehouse_id', wh)
          .in('item_id', itemIds)
        if (error) { console.warn('on-hand fetch failed', error); continue }
        const byItem: Record<string, OnHandByBin[]> = {}
        for (const r of (data || []) as any[]) {
          (byItem[r.item_id] ||= []).push({ bin_id: r.bin_id, qty: Number(r.qty) || 0 })
        }
        // Map back to lines in this warehouse
        for (const ln of lines.filter(l => (whByLine[String(l.id)] || shipWhId) === wh)) {
          result[String(ln.id)] = (byItem[ln.item_id] || []).sort((a,b) => b.qty - a.qty)
        }
      }

      setOnHandByLine(result)

      // Initialize default bin per line (first bin with stock; else first bin in that wh)
      setBinByLine(prev => {
        const next = { ...prev }
        for (const ln of lines) {
          const key = String(ln.id)
          const wh = whByLine[key] || shipWhId
          if (!wh) continue
          if (!next[key]) {
            const choices = result[key] || []
            const withStock = choices.find(c => (c.qty || 0) > 0)?.bin_id
            const firstBinInWh = bins.find(b => b.warehouseId === wh)?.id
            next[key] = (withStock as string | undefined) || firstBinInWh || ''
          }
        }
        return next
      })
    }
    run()
  }, [soViewOpen, selectedSO, solines, whByLine, bins, shipWhId])

  async function avgCostAt(whId: string, binId: string | null, itemId: string) {
    let q = supabase
      .from('stock_levels')
      .select('qty,avg_cost')
      .eq('warehouse_id', whId)
      .eq('item_id', itemId)
      .limit(1)
    q = binId ? q.eq('bin_id', binId) : q.is('bin_id', null)
    const { data } = await q
    const row: any = data && data[0]
    return { onHand: n(row?.qty, 0), avgCost: n(row?.avg_cost, 0) }
  }

  // actions
  async function tryUpdateStatus(id: string, candidates: SoStatus[]) {
    for (const status of candidates) {
      if (!VALID_SO_STATUSES.includes(status)) continue
      const { error } = await supabase.from('sales_orders').update({ status }).eq('id', id)
      if (!error) return status
      if (!String(error?.message || '').toLowerCase().includes('violates')) console.warn('Status update error:', error)
    }
    return null
  }

  const calcFormSubtotal = (rows: Array<{ qty: string; unitPrice: string; discountPct: string }>) =>
    rows.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct, 0) / 100), 0)

  async function createSO() {
    try {
      if (!soCustomerId) return toast.error(tt('orders.customerRequired', 'Customer is required'))
      const cleanLines = soLinesForm
        .map(l => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct) } ))
        .filter(l => l.itemId && l.uomId && l.qty > 0 && l.unitPrice >= 0 && l.discountPct >= 0 && l.discountPct <= 100)

      if (!cleanLines.length) return toast.error(tt('orders.addOneLine', 'Add at least one valid line'))

      const allowed = currencies.map(c => c.code)
      const chosenCurrency = allowed.length === 0 ? baseCode : (allowed.includes(soCurrency) ? soCurrency : allowed[0])

      const fx = n(soFx, 1)
      const cust = customers.find(c => c.id === soCustomerId)
      const headerSubtotal = calcFormSubtotal(soLinesForm)

      const inserted: any = await supabase
        .from('sales_orders')
        .insert({
          customer_id: soCustomerId,
          status: 'draft',
          currency_code: chosenCurrency,
          fx_to_base: fx,
          expected_ship_date: soDate || null,
          notes: null,
          payment_terms: cust?.payment_terms ?? null,
          bill_to_name: cust?.name ?? null,
          bill_to_email: cust?.email ?? null,
          bill_to_phone: cust?.phone ?? null,
          bill_to_tax_id: cust?.tax_id ?? null,
          bill_to_billing_address: cust?.billing_address ?? null,
          bill_to_shipping_address: cust?.shipping_address ?? null,
          total_amount: headerSubtotal,
          tax_total: headerSubtotal * n(soTaxPct, 0) / 100,
        })
        .select('id')
        .single()
      if (inserted.error) throw inserted.error
      const soId = inserted.data.id

      for (let i = 0; i < cleanLines.length; i++) {
        const l = cleanLines[i]; const lineNo = i + 1
        const lineTotal = l.qty * l.unitPrice * (1 - l.discountPct / 100)
        await db.salesOrderLines.create({
          so_id: soId,
          item_id: l.itemId,
          uom_id: l.uomId,
          line_no: lineNo,
          qty: l.qty,
          unit_price: l.unitPrice,
          discount_pct: l.discountPct,
          line_total: lineTotal,
          is_shipped: false,
          shipped_at: null,
          shipped_qty: 0,
        } as any)
      }

      toast.success(tt('orders.soCreated', 'Sales Order created'))
      setSoCustomerId('')
      setSoCurrency(baseCode)
      setSoFx('1')
      setSoTaxPct('0')
      setSoLinesForm([{ itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])
      setSoOpen(false)

      const [so, sol] = await Promise.all([ db.salesOrders.list(), db.salesOrderLines.list() ])
      const withFlags = (sol || []).map((l: any) => ({
        ...l,
        is_shipped: l.is_shipped ?? false,
        shipped_at: l.shipped_at ?? null,
        shipped_qty: Number.isFinite(Number(l.shipped_qty)) ? Number(l.shipped_qty) : 0,
      })) as SOL[]
      setSOs((so || []).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
      setSOLines(withFlags)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soCreateFailed', 'Failed to create SO'))
    }
  }

  async function confirmSO(soId: string) {
    try {
      const lines = solines.filter(l => l.so_id === soId)
      const subtotal = lines.reduce((s, l) => s + n(l.line_total), 0)

      const updated = await tryUpdateStatus(soId, ['confirmed'])
      await supabase.from('sales_orders').update({ total_amount: subtotal }).eq('id', soId)

      setSOs(prev => prev.map(s => (s.id === soId ? { ...s, status: updated || s.status, total_amount: subtotal } : s)))
      toast.success(tt('orders.soConfirmed', 'SO confirmed'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soConfirmFailed', 'Failed to confirm SO'))
    }
  }

  async function cancelSO(soId: string) {
    try {
      const updated = await tryUpdateStatus(soId, ['cancelled'])
      if (updated) setSOs(prev => prev.map(s => (s.id === soId ? { ...s, status: updated } : s)))
      toast.success(tt('orders.soCancelled', 'SO cancelled'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soCancelFailed', 'Failed to cancel SO'))
    }
  }

  async function setSOFinalStatus(soId: string) {
    const allowComplete = !!app?.sales?.autoCompleteWhenShipped
    const targets: SoStatus[] = allowComplete ? ['closed','shipped'] : ['shipped']
    return await tryUpdateStatus(soId, targets)
  }

  // --- Ship a line using the selected WH/BIN; DB trigger updates stock_levels
  async function doShipLineSO(so: SO, line: SOL) {
    try {
      const lineKey = String(line.id)
      const whId = whByLine[lineKey]
      const binId = binByLine[lineKey]
      if (!whId) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
      if (!binId) return toast.error(tt('orders.selectSourceBin', 'Pick a From Bin for this line'))

      const total = n(line.qty)
      const already = n(line.shipped_qty)
      const outstanding = Math.max(total - already, 0)
      if (outstanding <= 0) {
        toast.success(tt('orders.lineAlreadyShipped', 'Line already shipped'))
        return
      }

      const it = itemById.get(line.item_id)
      if (!it) throw new Error(`Item not found for line ${line.item_id}`)
      const baseUom = it.baseUomId

      const qtyBaseOutstanding = safeConvert(outstanding, line.uom_id, baseUom)
      if (qtyBaseOutstanding == null) {
        const fromCode = uomById.get(uomIdFromIdOrCode(line.uom_id))?.code || line.uom_id
        throw new Error(tt('orders.noConversion', 'No conversion from {from} to base for {sku}')
          .replace('{from}', String(fromCode)).replace('{sku}', String(it.sku)))
      }

      // UX guard: verify on-hand snapshot for this line
      const avail = (onHandByLine[lineKey] || []).find(x => x.bin_id === binId)?.qty || 0
      if (avail < qtyBaseOutstanding) {
        throw new Error(tt('orders.insufficientStockBin', 'Insufficient stock in bin for item {sku}')
          .replace('{sku}', String(it?.sku || '')))
      }

      // Movement insert (source of truth) — DB will reject if it would go negative
      const { avgCost } = await avgCostAt(whId, binId, it.id)
      const mvIns = await supabase.from('stock_movements').insert({
        type: 'issue',
        item_id: it.id,
        uom_id: uomIdFromIdOrCode(line.uom_id) || line.uom_id,
        qty: outstanding,
        qty_base: qtyBaseOutstanding,
        unit_cost: avgCost,
        total_value: avgCost * qtyBaseOutstanding,
        warehouse_from_id: whId,
        bin_from_id: binId,
        notes: `SO ${soNo(so)}`,
        created_by: 'system',
        ref_type: 'SO',
        ref_id: (so as any).id,
        ref_line_id: line.id ?? null,
      } as any).select('id').single()
      if (mvIns.error) throw mvIns.error
      const movementId = (mvIns.data as any).id

      // Sales shipment (ignore duplicate if retried)
      const disc = n(line.discount_pct, 0)
      const revenue = outstanding * n(line.unit_price) * (1 - disc / 100)
      const fx = fxSO(so); const code = curSO(so) || 'MZN'
      const shipIns = await supabase.from('sales_shipments').insert({
        movement_id: movementId,
        so_id: (so as any).id,
        so_line_id: line.id ?? null,
        item_id: it.id,
        qty: outstanding,
        qty_base: qtyBaseOutstanding,
        unit_price: n(line.unit_price),
        discount_pct: disc,
        revenue_amount: revenue,
        currency_code: code,
        fx_to_base: fx,
        revenue_base_amount: revenue * fx,
        company_id: (so as any).company_id ?? null
      } as any)
      // If unique violation (23505) occurs, ignore — we consider it idempotent
      if (shipIns.error && String(shipIns.error.code) !== '23505') throw shipIns.error

      // Update line shipped progress in UI
      const newShipped = already + outstanding
      const fully = newShipped >= total - 1e-9
      if (line.id) {
        const { error: updErr } = await supabase
          .from('sales_order_lines')
          .update({ shipped_qty: newShipped, is_shipped: fully, shipped_at: fully ? nowISO() : (line.shipped_at ?? null) })
          .eq('id', line.id)
        if (updErr) throw updErr
      }
      setSOLines(prev => prev.map(l => l.id === line.id
        ? { ...l, shipped_qty: newShipped, is_shipped: fully, shipped_at: fully ? nowISO() : l.shipped_at }
        : l))

      // Decrement the local on-hand cache for the selected line
      setOnHandByLine(prev => {
        const arr = (prev[lineKey] || []).slice()
        const idx = arr.findIndex(x => x.bin_id === binId)
        if (idx >= 0) arr[idx] = { ...arr[idx], qty: Math.max(0, (arr[idx].qty || 0) - qtyBaseOutstanding) }
        return { ...prev, [lineKey]: arr }
      })

      // If everything is shipped, close order per setting
      const outstandingLeft = solines.filter(l => l.so_id === so.id && remaining(l) > 0 && l.id !== line.id).length
      if (outstandingLeft === 0) {
        const final = await setSOFinalStatus(so.id)
        if (final) setSOs(prev => prev.map(s => (s.id === so.id ? { ...s, status: final } : s)))
        setSoViewOpen(false)
        setSelectedSO(null)
      }

      toast.success(tt('orders.lineShipped', 'Line shipped'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipLineFailed', 'Failed to ship line'))
    }
  }

  // Ship all outstanding lines (each uses its own selected warehouse/bin)
  async function doShipSO(so: SO) {
    try {
      const lines = solines.filter(l => l.so_id === so.id && remaining(l) > 0)
      if (!lines.length) return toast.error(tt('orders.noLinesToShip', 'No lines to ship'))

      for (const l of lines) {
        const key = String(l.id)
        if (!whByLine[key]) return toast.error(tt('orders.selectSourceWh', 'Select source warehouse'))
        if (!binByLine[key]) return toast.error(tt('orders.selectSourceBin', 'Pick a From Bin for each line'))
      }
      for (const l of lines) {
        // eslint-disable-next-line no-await-in-loop
        await doShipLineSO(so, l)
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipSoFailed', 'Failed to ship SO'))
    }
  }

  // computed
  const soOutstanding = useMemo(
    () => sos.filter(s => ['draft','submitted','confirmed','allocated'].includes(String(s.status).toLowerCase())),
    [sos]
  )
  const soSubtotal = soLinesForm.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct,0)/100), 0)
  const soTax = soSubtotal * (n(soTaxPct, 0) / 100)

  function soHeaderSubtotal(so: SO): number {
    const header = n((so as any).total_amount, NaN)
    if (Number.isFinite(header)) return header
    return solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
  }

  // ---- Print: uses companies profile (preferred), then company_settings brand as fallback
  async function printSO(so: SO) {
    const currency = curSO(so) || '—'
    const fx = fxSO(so) || 1
    const lines = solines.filter(l => l.so_id === so.id)

    const rows = lines.map(l => {
      const it = itemById.get(l.item_id)
      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
      const disc = n(l.discount_pct, 0)
      const lineTotal = n(l.qty) * n(l.unit_price) * (1 - disc/100)
      const shippedBadge = (n(l.shipped_qty) >= n(l.qty)) || l.is_shipped
        ? ' <span class="pill pill-ok">shipped</span>' : ''
      return `<tr>
        <td>${it?.name || l.item_id}${shippedBadge}</td>
        <td>${it?.sku || ''}</td>
        <td class="right">${fmtAcct(n(l.qty))}</td>
        <td>${uomCode}</td>
        <td class="right">${fmtAcct(n(l.unit_price))}</td>
        <td class="right">${fmtAcct(disc)}</td>
        <td class="right">${fmtAcct(lineTotal)}</td>
      </tr>`
    }).join('')

    const subtotal = soHeaderSubtotal(so)
    const tax = n((so as any).tax_total, 0)
    const total = subtotal + tax
    const number = soNo(so)
    const printedAt = new Date().toLocaleString()

    // Customer block (prefers bill_to_* then customer row)
    const custRow = so.customer_id ? customers.find(c => c.id === so.customer_id) : undefined
    const cust = {
      code: custRow?.code || '',
      name: so.bill_to_name ?? custRow?.name ?? so.customer ?? '—',
      email: so.bill_to_email ?? custRow?.email ?? '—',
      phone: so.bill_to_phone ?? custRow?.phone ?? '—',
      tax_id: so.bill_to_tax_id ?? custRow?.tax_id ?? '—',
      bill_to: (so.bill_to_billing_address ?? custRow?.billing_address ?? '')?.trim() || '—',
      ship_to: (so.bill_to_shipping_address ?? custRow?.shipping_address ?? '')?.trim() || '—',
      terms: so.payment_terms ?? custRow?.payment_terms ?? '—',
    }

    // Brand & company details
    const companyName = (brandName
      || companyProfile.tradeName
      || companyProfile.legalName
      || ''
    ).trim()
    const logoUrl = (brandLogoUrl || '').trim()
    const logoDataUrl = await fetchDataUrl(logoUrl) // avoid CORS/expiry
    const init = initials(companyName || companyProfile.tradeName || companyProfile.legalName)

    const cp = companyProfile
    const addrLines = [
      cp.address1,
      cp.address2,
      [cp.city, cp.state, cp.postalCode].filter(Boolean).join(', '),
      cp.country
    ].filter(Boolean).join('<br/>')

    const css = `
      @page { margin: 20mm; }
      * { box-sizing: border-box; }
      body{
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
        margin: 0; padding: 0; color: #0f172a;
        font: 12px/1.45 ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial;
      }
      .wrap { padding: 8px; }
      .header {
        display: flex; align-items: center; justify-content: space-between; gap: 16px;
        padding-bottom: 12px; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb;
      }
      .brand { display: flex; align-items: center; gap: 12px; min-height: 42px; }
      .logo {
        height: 40px; width: auto; border: 1px solid #e5e7eb; border-radius: 8px;
        background: #f8fafc; padding: 4px;
      }
      .logo-fallback {
        height: 40px; width: 40px; border: 1px solid #e5e7eb; border-radius: 8px;
        display: flex; align-items: center; justify-content: center; font-weight: 700; background: #eef2ff;
      }
      .company-name { font-size: 16px; font-weight: 700; letter-spacing: .01em; }
      .doc-meta { text-align: right; }
      .doc-title { font-size: 26px; font-weight: 800; letter-spacing: .01em; margin: 0; }
      .muted { color: #64748b; }
      .cap { text-transform: capitalize; }

      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fff; }
      .card h4 { margin: 0 0 6px; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
      .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; }
      .kv .k { color: #64748b; }
      .addr { white-space: pre-wrap; }

      table { width: 100%; border-collapse: collapse; margin-top: 6px; font-size: 12px; }
      th, td { border-bottom: 1px solid #eef2f7; padding: 8px 6px; text-align: left; }
      thead th { background: #f8fafc; font-weight: 700; }
      .right { text-align: right; }
      .pill {
        display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 10px; line-height: 18px; vertical-align: middle;
        border: 1px solid #e5e7eb; color: #334155; background: #f1f5f9; margin-left: 6px;
      }
      .pill-ok { border-color: #86efac; background: #ecfdf5; color: #166534; }

      .totals {
        margin-top: 14px; width: 380px; margin-left: auto;
        display: grid; grid-template-columns: 1fr auto; row-gap: 6px;
      }
      .totals .label { color: #475569; }
      .totals .grand { font-weight: 800; }
      .totals .muted { color: #64748b; }

      .footnote {
        margin-top: 18px; padding-top: 8px; border-top: 1px dashed #e5e7eb;
        color: #475569; font-size: 11px;
      }

      @media print { .wrap { padding: 0; } }
    `

    const headerBrand = logoDataUrl
      ? `<img src="${logoDataUrl}" alt="${companyName || 'Company logo'}" class="logo">`
      : `<div class="logo-fallback">${init}</div>`

    const companyCard = `
      <div class="card">
        <h4>Company Details</h4>
        <div class="kv">
          <div class="k">Trade name</div><div><b>${cp.tradeName || companyName || '—'}</b></div>
          <div class="k">Legal name</div><div>${cp.legalName || '—'}</div>
          <div class="k">Tax ID</div><div>${cp.taxId || '—'}</div>
          <div class="k">Registration No.</div><div>${cp.regNo || '—'}</div>
          <div class="k">Phone</div><div>${cp.phone || '—'}</div>
          <div class="k">Email</div><div>${cp.email || '—'}</div>
          <div class="k">Website</div><div>${cp.website || '—'}</div>
          <div class="k">Address</div><div class="addr">${addrLines || '—'}</div>
        </div>
        ${cp.printFooterNote ? `<div class="footnote">${cp.printFooterNote}</div>` : ''}
      </div>
    `

    const orderCard = `
      <div class="card">
        <h4>Order</h4>
        <div class="kv">
          <div class="k">Status</div><div><b class="cap">${so.status}</b></div>
          <div class="k">Currency</div><div><b>${currency}</b></div>
          <div class="k">FX → ${baseCode}</div><div><b>${fmtAcct(fx)}</b></div>
          <div class="k">Expected Ship</div><div><b>${(so as any).expected_ship_date || '—'}</b></div>
        </div>
      </div>
    `

    const customerCard = `
      <div class="card" style="margin-top:8px">
        <h4>Customer</h4>
        <div><b>${cust.code ? cust.code + ' — ' : ''}${cust.name}</b></div>
        <div class="muted">Email: ${cust.email} · Phone: ${cust.phone} · Tax ID: ${cust.tax_id}</div>
        <div class="kv" style="margin-top:6px">
          <div class="k">Bill To</div><div class="addr">${cust.bill_to}</div>
          <div class="k">Ship To</div><div class="addr">${cust.ship_to}</div>
          <div class="k">Terms</div><div>${cust.terms}</div>
        </div>
      </div>
    `

    const html = `
      <div class="wrap">
        <div class="header">
          <div class="brand">
            ${headerBrand}
            <div class="company-name">${companyName || '—'}</div>
          </div>
          <div class="doc-meta">
            <h1 class="doc-title">Sales Order ${number}</h1>
            <div class="muted">Printed: <b>${printedAt}</b></div>
          </div>
        </div>

        <div class="grid2">
          ${orderCard}
          ${companyCard}
        </div>

        ${customerCard}

        <table>
          <thead>
            <tr>
              <th>Item</th><th>SKU</th><th class="right">Qty</th><th>UoM</th>
              <th class="right">Unit Price</th><th class="right">Disc %</th><th class="right">Line Total (${currency})</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          <div class="label">Subtotal (${currency})</div><div class="right">${fmtAcct(subtotal)}</div>
          <div class="label">Tax (${currency})</div><div class="right">${fmtAcct(tax)}</div>
          <div class="muted">FX to ${baseCode}</div><div class="right muted">${fmtAcct(fx)}</div>
          <div class="grand">Total (${currency})</div><div class="right grand">${fmtAcct(total)}</div>
          <div class="grand">Total (${baseCode})</div><div class="right grand">${fmtAcct(total * fx)}</div>
        </div>
      </div>
    `

    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>SO ${number}</title><meta charset="utf-8"/><style>${css}</style></head><body>${html}</body></html>`)
    w.document.close()

    try { await (w as any).document?.fonts?.ready } catch {}
    const img = w.document.querySelector('img.logo') as HTMLImageElement | null
    if (img && 'decode' in img) { try { await (img as any).decode() } catch {} }
    setTimeout(() => { w.focus(); w.print() }, 50)
  }

  return (
    <>
      {/* Outstanding + Create SO */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{tt('orders.outstandingSOs', 'Outstanding Sales Orders')}</CardTitle>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setShippedOpen(true)}>
                {tt('orders.shippedBrowser', 'Shipped SOs')}
              </Button>

              <Sheet open={soOpen} onOpenChange={setSoOpen}>
                <SheetTrigger asChild>
                  <Button size="sm">{tt('orders.newSO', 'New SO')}</Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
                  <SheetHeader>
                    <SheetTitle>{tt('orders.newSO', 'New Sales Order')}</SheetTitle>
                    <SheetDescription className="sr-only">{tt('orders.createSO', 'Create a sales order')}</SheetDescription>
                  </SheetHeader>

                  {/* Header */}
                  <div className="mt-4 grid md:grid-cols-4 gap-3">
                    <div>
                      <Label>{tt('orders.customer', 'Customer')}</Label>
                      <Select value={soCustomerId} onValueChange={setSoCustomerId}>
                        <SelectTrigger><SelectValue placeholder={tt('orders.selectCustomer', 'Select customer')} /></SelectTrigger>
                        <SelectContent className="max-h-64 overflow-auto">
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {(c.code ? c.code + ' — ' : '') + c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.currency', 'Currency')}</Label>
                      <Select value={soCurrency} onValueChange={setSoCurrency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(currencies.length ? currencies : [{ code: baseCode, name: baseCode }]).map(c =>
                            <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.fxToBase', 'FX to Base ({code})', { code: baseCode })}</Label>
                      <Input type="number" min="0" step="0.000001" value={soFx} onChange={e => setSoFx(e.target.value)} />
                    </div>
                    <div>
                      <Label>{tt('orders.expectedShip', 'Expected Ship')}</Label>
                      <Input type="date" value={soDate} onChange={e => setSoDate(e.target.value)} />
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="mt-6">
                    <Label>{tt('orders.lines', 'Lines')}</Label>
                    <div className="mt-2 border rounded-lg overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="py-2 px-3">{tt('table.item', 'Item')}</th>
                            <th className="py-2 px-3 w-24">{tt('orders.uom', 'UoM')}</th>
                            <th className="py-2 px-3 w-28">{tt('orders.qty', 'Qty')}</th>
                            <th className="py-2 px-3 w-40">{tt('orders.unitPrice', 'Unit Price')}</th>
                            <th className="py-2 px-3 w-28">{tt('orders.discountPct', 'Disc %')}</th>
                            <th className="py-2 px-3 w-36 text-right">{tt('orders.lineTotal', 'Line Total')}</th>
                            <th className="py-2 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {soLinesForm.map((ln, idx) => {
                            const it = itemById.get(ln.itemId)
                            const baseUomId = it?.baseUomId || ''
                            const baseUomCode =
                              it?.baseUomId ? (uomById.get(uomIdFromIdOrCode(it.baseUomId))?.code || 'BASE') : 'BASE'
                            const qtyPreviewBase = it ? safeConvert(n(ln.qty), ln.uomId || baseUomId, baseUomId) : null
                            const previewInvalid = it ? (qtyPreviewBase == null && n(ln.qty) > 0) : false

                            const lineTotal = n(ln.qty) * n(ln.unitPrice) * (1 - n(ln.discountPct,0)/100)

                            return (
                              <tr key={idx} className="border-t">
                                <td className="py-2 px-3">
                                  <Select
                                    value={ln.itemId}
                                    onValueChange={(v) =>
                                      setSoLinesForm(prev =>
                                        prev.map((x, i) => i === idx ? { ...x, itemId: v, uomId: (itemById.get(v)?.baseUomId || x.uomId) } : x)
                                      )
                                    }
                                  >
                                    <SelectTrigger><SelectValue placeholder={tt('orders.item', 'Item')} /></SelectTrigger>
                                    <SelectContent className="max-h-64 overflow-auto">
                                      {items.map(it => <SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </td>

                                <td className="py-2 px-3">
                                  <Select
                                    value={ln.uomId}
                                    onValueChange={(v) => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, uomId: v } : x))}
                                    disabled={!ln.itemId}
                                  >
                                    <SelectTrigger><SelectValue placeholder={tt('orders.uom', 'UoM')} /></SelectTrigger>
                                    <SelectContent className="max-h-64 overflow-auto">
                                      {Array.from(convertibleGroupedUomsForItem(ln.itemId).entries()).map(([fam, arr]) => (
                                        <SelectGroup key={fam}>
                                          <SelectLabel>{fam}</SelectLabel>
                                          {arr.map(u => (
                                            <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>
                                          ))}
                                        </SelectGroup>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </td>

                                <td className="py-2 px-3">
                                  <Input
                                    inputMode="decimal"
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    value={ln.qty}
                                    onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))}
                                  />
                                  {!!ln.itemId && (
                                    <div className={`text-xs mt-1 ${previewInvalid ? 'text-red-600' : 'text-muted-foreground'}`}>
                                      {qtyPreviewBase == null
                                        ? tt('orders.previewNoPath', 'No conversion path to base')
                                        : `→ ${fmtAcct(qtyPreviewBase)} ${baseUomCode}`}
                                    </div>
                                  )}
                                </td>

                                <td className="py-2 px-3">
                                  <Input
                                    inputMode="decimal"
                                    type="number"
                                    min="0"
                                    step="0.0001"
                                    value={ln.unitPrice}
                                    onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))}
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    value={ln.discountPct}
                                    onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, discountPct: e.target.value } : x))}
                                  />
                                </td>
                                <td className="py-2 px-3 text-right">{fmtAcct(lineTotal)}</td>
                                <td className="py-2 px-3 text-right">
                                  <Button size="icon" variant="ghost" onClick={() => setSoLinesForm(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="p-2">
                        <MobileAddLineButton
                          onAdd={() => setSoLinesForm(prev => [...prev, { itemId: '', uomId: '', qty: '', unitPrice: '', discountPct: '0' }])}
                          label={tt('orders.addLine', 'Add Line')}
                        />
                      </div>
                    </div>

                    {/* Totals */}
                    <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4">
                      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                        <div className="flex items-center gap-3">
                          <Label className="whitespace-nowrap">{tt('orders.taxPct', 'Tax %')}</Label>
                          <Input className="w-28" type="number" min="0" step="0.01" value={soTaxPct} onChange={e => setSoTaxPct(e.target.value)} />
                        </div>
                        <div className="flex flex-col items-end text-sm">
                          <div className="w-full max-w-sm grid grid-cols-2 gap-1">
                            <div className="text-muted-foreground">{tt('orders.subtotal', 'Subtotal')} ({soCurrency})</div>
                            <div className="text-right">{fmtAcct(soSubtotal)}</div>
                            <div className="text-muted-foreground">{tt('orders.tax', 'Tax')}</div>
                            <div className="text-right">{fmtAcct(soTax)}</div>
                            <div className="font-medium">{tt('orders.total', 'Total')}</div>
                            <div className="text-right font-medium">{fmtAcct(soSubtotal + soTax)}</div>
                          </div>
                          <div className="mt-3">
                            <Button onClick={createSO}>{tt('orders.createSO', 'Create SO')}</Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
              <th className="py-2 pr-2">{tt('orders.actions', 'Actions')}</th>
            </tr></thead>
            <tbody>
              {soOutstanding.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.nothingPending', 'Nothing pending.')}</td></tr>}
              {soOutstanding.map(so => {
                const header = n((so as any).total_amount, NaN)
                const sumLines = solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
                const orderSubtotal = Number.isFinite(header) ? header : sumLines
                const totalBase = orderSubtotal * fxSO(so)
                return (
                  <tr key={so.id} className="border-b">
                    <td className="py-2 pr-2">{soNo(so)}</td>
                    <td className="py-2 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-2 pr-2 capitalize">{so.status}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                    <td className="py-2 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setSelectedSO(so); setSoViewOpen(true) }}>{tt('orders.view', 'View')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printSO(so)}>{tt('orders.print', 'Print')}</Button>
                        {String(so.status).toLowerCase() === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => confirmSO(so.id)}>{tt('orders.confirm', 'Confirm')}</Button>
                            <Button size="sm" variant="destructive" onClick={() => cancelSO(so.id)}>{tt('orders.cancel', 'Cancel')}</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Recent */}
      <Card>
        <CardHeader><CardTitle>{tt('orders.recentSOs', 'Recent Sales Orders')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.currency', 'Currency')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
            </tr></thead>
            <tbody>
              {sos.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.noSOsYet', 'No SOs yet.')}</td></tr>}
              {sos.map(so => {
                const header = n((so as any).total_amount, NaN)
                const sumLines = solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
                const orderSubtotal = Number.isFinite(header) ? header : sumLines
                const totalBase = orderSubtotal * fxSO(so)
                return (
                  <tr key={so.id} className="border-b">
                    <td className="py-2 pr-2">{soNo(so)}</td>
                    <td className="py-2 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-2 pr-2 capitalize">{so.status}</td>
                    <td className="py-2 pr-2">{curSO(so)}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(totalBase, baseCode)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* SO View / Ship */}
      <Sheet open={soViewOpen} onOpenChange={(o) => { if (!o) { setSelectedSO(null) } setSoViewOpen(o) }}>
        <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.soDetails', 'SO Details')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('orders.soDetailsDesc', 'Review, pick source warehouse/bin per line, and ship')}</SheetDescription>
          </SheetHeader>

          {!selectedSO ? (
            <div className="p-4 text-sm text-muted-foreground">{tt('orders.noSOSelected', 'No SO selected.')}</div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="grid md:grid-cols-3 gap-3">
                <div><Label>{tt('orders.so', 'SO')}</Label><div>{soNo(selectedSO)}</div></div>
                <div><Label>{tt('orders.customer', 'Customer')}</Label><div>{soCustomerLabel(selectedSO)}</div></div>
                <div><Label>{tt('orders.status', 'Status')}</Label><div className="capitalize">{selectedSO.status}</div></div>
                <div><Label>{tt('orders.currency', 'Currency')}</Label><div>{curSO(selectedSO)}</div></div>
                <div><Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label><div>{fmtAcct(fxSO(selectedSO))}</div></div>
                <div><Label>{tt('orders.expectedShip', 'Expected Ship')}</Label><div>{(selectedSO as any).expected_ship_date || tt('none', '(none)')}</div></div>
              </div>

              {/* Global "From Warehouse" = quick setter for all lines */}
              <div className="grid md:grid-cols-3 gap-3">
                <div>
                  <Label>{tt('orders.fromWarehouse', 'From Warehouse (set for all lines)')}</Label>
                  <Select
                    value={shipWhId}
                    onValueChange={(v) => {
                      setShipWhId(v)
                      // Set all outstanding lines to this WH and clear their bins (will auto-pick best bin)
                      setWhByLine(prev => {
                        const next = { ...prev }
                        for (const ln of solines.filter(l => l.so_id === selectedSO.id && remaining(l) > 0)) {
                          next[String(ln.id)] = v
                        }
                        return next
                      })
                      setBinByLine({})
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end justify-end gap-2 md:col-span-2">
                  <Button variant="outline" onClick={() => printSO(selectedSO)}>{tt('orders.print', 'Print')}</Button>
                  {String(selectedSO.status).toLowerCase() === 'confirmed' && (
                    <Button onClick={() => doShipSO(selectedSO)}>
                      {tt('orders.shipAll', 'Ship All Outstanding')}
                    </Button>
                  )}
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="py-2 px-3">{tt('table.item', 'Item')}</th>
                      <th className="py-2 px-3">{tt('table.sku', 'SKU')}</th>
                      <th className="py-2 px-3">{tt('orders.qtyUom', 'Qty (UoM)')}</th>
                      <th className="py-2 px-3">{tt('orders.discountPct', 'Disc %')}</th>
                      <th className="py-2 px-3">{tt('table.qtyBase', 'Qty (base)')}</th>
                      <th className="py-2 px-3">{tt('orders.fromWarehouse', 'From Warehouse')}</th>
                      <th className="py-2 px-3">{tt('orders.fromBin', 'From Bin')}</th>
                      <th className="py-2 px-3">{tt('orders.onHandBin', 'On-hand (bin)')}</th>
                      <th className="py-2 px-3">{tt('orders.binHint', 'Bin Hint')}</th>
                      <th className="py-2 px-3 text-right">{tt('orders.action', 'Action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {solines.filter(l => l.so_id === selectedSO.id && remaining(l) > 0).map(l => {
                      const it = itemById.get(l.item_id)
                      const baseU = it?.baseUomId || ''
                      const outstanding = remaining(l)
                      const qtyBase = it ? safeConvert(outstanding, l.uom_id, baseU) : null
                      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
                      const baseUomCode =
                        it?.baseUomId ? (uomById.get(uomIdFromIdOrCode(it.baseUomId))?.code || 'BASE') : 'BASE'

                      const disc = n(l.discount_pct, 0)

                      const key = String(l.id)
                      const lineWh = whByLine[key] || shipWhId
                      const lineOnHands = onHandByLine[key] || []
                      const lineSelectedBin = binByLine[key] || ''
                      const selectedBinQty = (lineOnHands.find(x => x.bin_id === lineSelectedBin)?.qty) ?? 0
                      const enough = qtyBase != null && selectedBinQty >= (qtyBase || 0)

                      const tops = lineOnHands.slice(0, 3)
                      const hint = tops.length
                        ? tops.map(t => {
                            const code = t.bin_id ? (bins.find(b => b.id === t.bin_id)?.code || 'bin') : tt('orders.noBin', '(no bin)')
                            return `${code}: ${fmtAcct(t.qty)} ${baseUomCode}`
                          }).join(', ')
                        : tt('orders.noStockInWh', 'No stock in selected warehouse')

                      return (
                        <tr key={key} className="border-t">
                          <td className="py-2 px-3">{it?.name || l.item_id}</td>
                          <td className="py-2 px-3">{it?.sku || '—'}</td>
                          <td className="py-2 px-3">{fmtAcct(n(l.qty))} {uomCode}</td>
                          <td className="py-2 px-3">{fmtAcct(disc)}</td>
                          <td className="py-2 px-3">{qtyBase == null ? '—' : `${fmtAcct(qtyBase)} ${baseUomCode}`}</td>

                          {/* Per-line Warehouse */}
                          <td className="py-2 px-3">
                            <Select
                              value={lineWh || ''}
                              onValueChange={(v) => {
                                setWhByLine(s => ({ ...s, [key]: v }))
                                // clear bin so it re-picks for new warehouse
                                setBinByLine(s => {
                                  const n = { ...s }; delete n[key]; return n
                                })
                              }}
                            >
                              <SelectTrigger className="w-44"><SelectValue placeholder={tt('orders.selectWh', 'Select warehouse')} /></SelectTrigger>
                              <SelectContent>
                                {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>

                          {/* Per-line From Bin */}
                          <td className="py-2 px-3">
                            <Select
                              value={lineSelectedBin}
                              onValueChange={(v) => setBinByLine(s => ({ ...s, [key]: v }))}
                            >
                              <SelectTrigger className="w-48"><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                              <SelectContent>
                                {(bins
                                  .filter(b => b.warehouseId === lineWh)
                                  .map(b => ({
                                    bin: b,
                                    qty: (lineOnHands.find(x => x.bin_id === b.id)?.qty) ?? 0
                                  }))
                                  .sort((a,b) => (b.qty - a.qty) || a.bin.code.localeCompare(b.bin.code))
                                ).map(({ bin, qty }) => (
                                  <SelectItem key={bin.id} value={bin.id}>
                                    {bin.code} — {fmtAcct(qty)} {baseUomCode}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>

                          <td className={`py-2 px-3 font-medium ${enough ? 'text-green-600' : 'text-red-600'}`}>
                            {fmtAcct(selectedBinQty)} {baseUomCode}
                          </td>

                          <td className="py-2 px-3">{hint}</td>
                          <td className="py-2 px-3 text-right">
                            <Button
                              size="sm"
                              disabled={String(selectedSO.status).toLowerCase() !== 'confirmed'}
                              onClick={() => doShipLineSO(selectedSO, l)}
                            >
                              {tt('orders.ship', 'Ship Outstanding')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                    {solines.filter(l => l.so_id === selectedSO.id && remaining(l) > 0).length === 0 && (
                      <tr><td colSpan={10} className="py-3 text-muted-foreground">{tt('orders.allLinesShipped', 'All lines shipped.')}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Shipped SOs Browser */}
      <Sheet open={shippedOpen} onOpenChange={setShippedOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.shippedBrowser', 'Shipped Sales Orders')}</SheetTitle>
            <SheetDescription className="sr-only">
              {tt('orders.shippedBrowserDesc', 'Search, filter and print shipped/closed orders')}
            </SheetDescription>
          </SheetHeader>

          {/* Filters */}
          <div className="mt-4 grid md:grid-cols-4 gap-3 p-4 md:p-0">
            <div className="md:col-span-2">
              <Label>{tt('common.search', 'Search')}</Label>
              <Input
                placeholder={tt('orders.searchHint', 'Order no. or customer')}
                value={shipQ}
                onChange={e => setShipQ(e.target.value)}
              />
            </div>
            <div>
              <Label>{tt('orders.from', 'From (updated)')}</Label>
              <Input type="date" value={shipDateFrom} onChange={e => setShipDateFrom(e.target.value)} />
            </div>
            <div>
              <Label>{tt('orders.to', 'To (updated)')}</Label>
              <Input type="date" value={shipDateTo} onChange={e => setShipDateTo(e.target.value)} />
            </div>
          </div>

          {/* Status checkboxes */}
          <div className="p-4 md:p-0 mt-2 flex flex-wrap gap-4 text-sm">
            <div className="text-muted-foreground">{tt('orders.statuses', 'Statuses')}:</div>
            {(['shipped','closed'] as const).map(sname => (
              <label key={sname} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!shipStatuses[sname]}
                  onChange={(e) => setShipStatuses(prev => ({ ...prev, [sname]: e.target.checked }))}
                />
                <span className="capitalize">{sname}</span>
              </label>
            ))}
          </div>

          {/* Results */}
          <div className="mt-3 border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="py-2 px-3">{tt('orders.so', 'SO')}</th>
                  <th className="py-2 px-3">{tt('orders.customer', 'Customer')}</th>
                  <th className="py-2 px-3">{tt('orders.status', 'Status')}</th>
                  <th className="py-2 px-3">{tt('orders.updated', 'Updated')}</th>
                  <th className="py-2 px-3">{tt('orders.total', 'Total')}</th>
                  <th className="py-2 px-3 text-right">{tt('orders.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {shippedRows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-muted-foreground">{tt('orders.noResults', 'No results')}</td></tr>
                )}
                {shippedRows.map(so => {
                  const header = n((so as any).total_amount, NaN)
                  const sumLines = solines.filter(l => l.so_id === so.id).reduce((s, l) => s + n(l.line_total), 0)
                  const orderSubtotal = Number.isFinite(header) ? header : sumLines
                  const totalBase = orderSubtotal * fxSO(so)
                  const updated = (so.updated_at || so.created_at || '').slice(0, 19).replace('T', ' ')
                  return (
                    <tr key={so.id} className="border-t">
                      <td className="py-2 px-3">{soNo(so)}</td>
                      <td className="py-2 px-3">{soCustomerLabel(so)}</td>
                      <td className="py-2 px-3 capitalize">{so.status}</td>
                      <td className="py-2 px-3">{updated || '—'}</td>
                      <td className="py-2 px-3">{formatMoneyBase(totalBase, baseCode)}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => printSO(so)}>
                            {tt('orders.print', 'Print')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Paging */}
          <div className="p-4 flex justify-between items-center">
            <div className="text-xs text-muted-foreground">
              {tt('orders.rows', 'Rows')}: {shippedRows.length}
            </div>
            {shippedHasMore && (
              <Button size="sm" variant="secondary" onClick={() => fetchShippedPage(shippedPage + 1)}>
                {tt('common.loadMore', 'Load more')}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
