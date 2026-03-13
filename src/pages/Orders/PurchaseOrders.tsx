// src/pages/Orders/PurchaseOrders.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/db'
import { useSearchParams } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../../components/ui/sheet'
import { Textarea } from '../../components/ui/textarea'
import toast from 'react-hot-toast'
import MobileAddLineButton from '../../components/MobileAddLineButton'
import { formatMoneyBase, getBaseCurrencyCode } from '../../lib/currency'
import { discountedLineTotal, purchaseOrderAmounts } from '../../lib/orderFinance'
import { buildConvGraph, convertQty, type ConvRow } from '../../lib/uom'
import { useI18n } from '../../lib/i18n'
import { useOrg } from '../../hooks/useOrg'
import { useAuth } from '../../hooks/useAuth'

// NEW: company profile helper (DB companies + storage URL)
import {
  getCompanyProfile as getCompanyProfileDB,
  companyLogoUrl,
  type CompanyProfile as DBCompanyProfile,
} from '../../lib/companyProfile'

type AppSettings = {
  branding?: { companyName?: string; logoUrl?: string }
  brand?: { logoUrl?: string }
  logoUrl?: string
  companyName?: string
  company?: { name?: string; logoUrl?: string }
} & Record<string, any>

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

type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string }
type Currency = { code: string; name: string }
type Supplier = { id: string; code?: string; name: string; email?: string|null; phone?: string|null; tax_id?: string|null; payment_terms?: string|null }
type Warehouse = { id: string; code?: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }

type PO = {
  id: string
  status: string
  order_date?: string | null
  currency_code?: string
  fx_to_base?: number
  due_date?: string | null
  expected_date?: string|null
  reference_no?: string | null
  delivery_terms?: string | null
  notes?: string|null
  internal_notes?: string | null
  prepared_by?: string | null
  approved_by?: string | null
  received_by?: string | null
  supplier?: string
  supplier_id?: string
  supplier_name?: string|null
  supplier_email?: string|null
  supplier_phone?: string|null
  supplier_tax_id?: string|null
  payment_terms?: string|null
  subtotal?: number|null
  tax_total?: number|null
  total?: number|null
  order_no?: string|null
  public_id?: string | null
  created_by?: string | null
  updated_at?: string|null
  created_at?: string|null
}

type POL = {
  id?: string
  po_id: string
  item_id: string
  uom_id: string
  description?: string | null
  line_no?: number
  qty: number
  unit_price: number
  discount_pct?: number|null
  line_total: number
}

const nowISO = () => new Date().toISOString()
const n = (v: string | number | null | undefined, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const fmtAcct = (v: number) => { const neg = v < 0; const s = Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return neg ? `(${s})` : s }
const ts = (row: any) => row?.createdAt ?? row?.created_at ?? row?.createdat ?? row?.updatedAt ?? row?.updated_at ?? row?.updatedat ?? 0

const initials = (s?: string | null) => {
  const t = (s || '').trim()
  if (!t) return '—'
  const parts = t.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || t[0]?.toUpperCase() || '—'
}

type PurchaseLineDraft = {
  itemId: string
  uomId: string
  description: string
  qty: string
  unitPrice: string
  discountPct: string
}

type PoMetaDraft = {
  orderDate: string
  expectedDate: string
  dueDate: string
  paymentTerms: string
  deliveryTerms: string
  referenceNo: string
  notes: string
  internalNotes: string
  preparedBy: string
  approvedBy: string
  receivedBy: string
}

const todayYmd = () => new Date().toISOString().slice(0, 10)
const blankPurchaseLine = (): PurchaseLineDraft => ({ itemId: '', uomId: '', description: '', qty: '', unitPrice: '', discountPct: '0' })
const emptyPoMetaDraft = (): PoMetaDraft => ({
  orderDate: todayYmd(),
  expectedDate: todayYmd(),
  dueDate: todayYmd(),
  paymentTerms: '',
  deliveryTerms: '',
  referenceNo: '',
  notes: '',
  internalNotes: '',
  preparedBy: '',
  approvedBy: '',
  receivedBy: '',
})
const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
const docText = (value: unknown, fallback = '—') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text) : fallback
}
const docMultiline = (value: unknown, fallback = '—') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text).replace(/\r?\n/g, '<br/>') : fallback
}
const docDate = (value: unknown, fallback = '—') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text.slice(0, 10)) : fallback
}
const docName = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text) : '&nbsp;'
}
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
  } catch { return null }
}

export default function PurchaseOrders() {
  const { t } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) => {
    const s = t(key, vars); return s === key ? fallback : s
  }
  const { companyId } = useOrg()

  // masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])

  // brand (company_settings preferred; app_settings fallback)
  const [brandName, setBrandName] = useState<string>('')
  const [brandLogoUrl, setBrandLogoUrl] = useState<string>('')

  // NEW: full company profile (companies table)
  const [companyProfile, setCompanyProfile] = useState<CompanyProfileUI>({})

  // conversions
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const uomById = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])
  const itemById = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  // lists
  const [pos, setPOs] = useState<PO[]>([])
  const [polines, setPOLines] = useState<POL[]>([])

  // create form
  const [poOpen, setPoOpen] = useState(false)
  const [poSupplierId, setPoSupplierId] = useState('')
  const [poCurrency, setPoCurrency] = useState('MZN')
  const [poFx, setPoFx] = useState('1')
  const [poOrderDate, setPoOrderDate] = useState<string>(() => todayYmd())
  const [poDate, setPoDate] = useState<string>(() => todayYmd())
  const [poDueDate, setPoDueDate] = useState<string>(() => todayYmd())
  const [poTaxPct, setPoTaxPct] = useState<string>('0')
  const [poPaymentTerms, setPoPaymentTerms] = useState('')
  const [poDeliveryTerms, setPoDeliveryTerms] = useState('')
  const [poReferenceNo, setPoReferenceNo] = useState('')
  const [poNotes, setPoNotes] = useState('')
  const [poInternalNotes, setPoInternalNotes] = useState('')
  const [poPreparedBy, setPoPreparedBy] = useState('')
  const [poApprovedBy, setPoApprovedBy] = useState('')
  const [poReceivedBy, setPoReceivedBy] = useState('')
  const [poLinesForm, setPoLinesForm] = useState<PurchaseLineDraft[]>([blankPurchaseLine()])

  // view + receive
  const [poViewOpen, setPoViewOpen] = useState(false)
  const [selectedPO, setSelectedPO] = useState<PO | null>(null)
  const [selectedPoMeta, setSelectedPoMeta] = useState<PoMetaDraft>(emptyPoMetaDraft())

  // defaults for receiving
  const [defaultReceiveWhId, setDefaultReceiveWhId] = useState<string>('')
  const [defaultReceiveBinId, setDefaultReceiveBinId] = useState<string>('')

  // per-line plan and receipts map
  const [receivePlan, setReceivePlan] = useState<Record<string, { qty: string; whId: string; binId: string }>>({})
  const [receivedMap, setReceivedMap] = useState<Record<string, number>>({})

  useEffect(() => {
    if (user?.name && !poPreparedBy.trim()) setPoPreparedBy(user.name)
  }, [user?.name, poPreparedBy])

  useEffect(() => {
    const supp = suppliers.find(s => s.id === poSupplierId)
    if (!supp) return
    setPoPaymentTerms(supp.payment_terms ?? '')
  }, [poSupplierId, suppliers])

  // --- Closed/Received POs browser state
  const [browserOpen, setBrowserOpen] = useState(false)
  const [browserRows, setBrowserRows] = useState<PO[]>([])
  const [browserHasMore, setBrowserHasMore] = useState(false)
  const [browserPage, setBrowserPage] = useState(0)
  const [browserQ, setBrowserQ] = useState('')
  const [browserFrom, setBrowserFrom] = useState('')
  const [browserTo, setBrowserTo] = useState('')
  const [browserStatuses, setBrowserStatuses] = useState<Record<string, boolean>>({
    closed: true, partially_received: true,
  })
  const PAGE_SIZE = 100
  const activeStatuses = () => Object.entries(browserStatuses).filter(([,v]) => v).map(([k]) => k)
  function resetBrowserPaging() { setBrowserRows([]); setBrowserPage(0); setBrowserHasMore(false) }

  async function fetchBrowserPage(page = 0) {
    if (!companyId) return
    const statuses = activeStatuses()
    if (statuses.length === 0) { setBrowserRows([]); setBrowserHasMore(false); return }

    let q = supabase
      .from('purchase_orders')
      .select('id,supplier_id,supplier_name,supplier,status,currency_code,fx_to_base,total,updated_at,created_at,order_no')
      .eq('company_id', companyId)
      .in('status', statuses)
      .order('updated_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)

    const term = browserQ.trim()
    if (term) q = q.or(`order_no.ilike.%${term}%,supplier_name.ilike.%${term}%,supplier.ilike.%${term}%`)
    if (browserFrom) q = q.gte('updated_at', browserFrom)
    if (browserTo)   q = q.lte('updated_at', browserTo + ' 23:59:59')

    const { data, error } = await q
    if (error) { console.error(error); toast.error('Failed to load POs'); return }

    const rows = (data || []) as PO[]
    setBrowserRows(prev => page === 0 ? rows : [...prev, ...rows])
    setBrowserHasMore(rows.length === PAGE_SIZE)
    setBrowserPage(page)
  }

  const codeOf = (id?: string) => (id ? (uomById.get(id)?.code || '').toUpperCase() : '')
  const uomIdFromIdOrCode = (v?: string | null): string => {
    if (!v) return ''
    if (uomById.has(v)) return v
    const needle = String(v).toUpperCase()
    for (const u of uoms) if ((u.code || '').toUpperCase() === needle) return u.id
    return ''
  }
  const safeConvert = (qty: number, fromIdOrCode: string, toIdOrCode: string): number | null => {
    const from = uomIdFromIdOrCode(fromIdOrCode), to = uomIdFromIdOrCode(toIdOrCode)
    if (!from || !to) return null
    if (from === to || codeOf(from) === codeOf(to)) return qty
    if (!convGraph) return null
    try { return Number(convertQty(qty, from, to, convGraph)) } catch { return null }
  }

  const poNo = (p: any) => p?.orderNo ?? p?.order_no ?? p?.public_id ?? p?.id
  const fxPO = (p: PO) => n((p as any).fx_to_base ?? (p as any).fxToBase, 1)
  const curPO = (p: PO) => (p as any).currency_code ?? (p as any).currencyCode
  const amountPO = (p: PO) => purchaseOrderAmounts(p, polines.filter(l => l.po_id === p.id))
  const poSupplierLabel = (p: PO) =>
    p.supplier_name ?? p.supplier ?? (p.supplier_id ? (suppliers.find(s => s.id === p.supplier_id)?.name ?? p.supplier_id) : tt('none', '(none)'))
  const buildPoMetaDraft = (po?: PO | null): PoMetaDraft => {
    if (!po) return emptyPoMetaDraft()
    return {
      orderDate: String((po as any).order_date ?? '').slice(0, 10) || todayYmd(),
      expectedDate: String((po as any).expected_date ?? '').slice(0, 10) || '',
      dueDate: String((po as any).due_date ?? '').slice(0, 10) || '',
      paymentTerms: String(po.payment_terms ?? ''),
      deliveryTerms: String((po as any).delivery_terms ?? ''),
      referenceNo: String((po as any).reference_no ?? ''),
      notes: String(po.notes ?? ''),
      internalNotes: String((po as any).internal_notes ?? ''),
      preparedBy: String((po as any).prepared_by ?? ''),
      approvedBy: String((po as any).approved_by ?? ''),
      receivedBy: String((po as any).received_by ?? ''),
    }
  }
  const binsForWH = (whId: string) => bins.filter(b => b.warehouseId === whId)

  // load masters, lists, conversions, defaults, brand fallbacks
  useEffect(() => {
    (async () => {
      try {
        if (!companyId) return

        const [itemsRes, uomsRes, curRes, appRes] = await Promise.all([
          supabase.from('items')
            .select('id,sku,name,base_uom_id')
            .eq('company_id', companyId)
            .order('name', { ascending: true }),
          supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true }),
          supabase.from('currencies').select('code,name').order('code', { ascending: true }),
          supabase.from('app_settings').select('data').eq('id', 'app').maybeSingle(),
        ])

        setItems(((itemsRes.data || []) as any[]).map(x => ({ id: x.id, name: x.name, sku: x.sku, baseUomId: x.base_uom_id || '' })))
        if (uomsRes.error) throw uomsRes.error
        setUoms(((uomsRes.data || []) as any[]).map(u => ({ ...u, code: String(u.code || '').toUpperCase() })))
        setCurrencies((curRes.data || []) as Currency[])
        setBaseCode(await getBaseCurrencyCode())

        const { data: convRows, error: convErr } = await supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        const supps = await supabase
          .from('suppliers')
          .select('id,code,name,email,phone,tax_id,payment_terms')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (supps.error) throw supps.error
        setSuppliers((supps.data || []) as Supplier[])

        // POs + lines for this company
        const [poRes, polRes] = await Promise.all([
          supabase.from('purchase_orders')
            .select('id,status,order_date,currency_code,fx_to_base,total,subtotal,tax_total,due_date,reference_no,delivery_terms,notes,internal_notes,prepared_by,approved_by,received_by,updated_at,created_at,order_no,public_id,created_by,supplier_id,supplier,supplier_name,supplier_email,supplier_phone,supplier_tax_id,payment_terms,expected_date')
            .eq('company_id', companyId),
          supabase.from('purchase_order_lines')
            .select('id,po_id,item_id,uom_id,description,line_no,qty,unit_price,discount_pct,line_total')
            .eq('company_id', companyId),
        ])
        const poRows = (poRes.data || []) as PO[]
        setPOs(poRows.sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
        setPOLines((polRes.data || []) as POL[])

        const [whRes, binRes] = await Promise.all([
          supabase
            .from('warehouses')
            .select('id,name')
            .eq('company_id', companyId)
            .order('name', { ascending: true }),
          supabase
            .from('bins')
            .select('id,code,name,warehouseId')   // ✅ camelCase column
            .eq('company_id', companyId)
            .order('code', { ascending: true }),
        ])
        setWarehouses((whRes.data || []) as Warehouse[])
        setBins(((binRes.data || []) as any[]).map(b => ({ id: b.id, code: b.code, name: b.name, warehouseId: b.warehouseId })) as Bin[])

        if (whRes.data && whRes.data.length) {
          const preferred = whRes.data[0]
          setDefaultReceiveWhId(preferred.id)
          const firstBin = ((binRes.data || []) as any[]).find(b => b.warehouseId === preferred.id)?.id || ''
          setDefaultReceiveBinId(firstBin)
        }

        // GLOBAL brand fallbacks
        try {
          const [brandRes, companyRes] = await Promise.all([
            supabase.from('app_settings').select('data').eq('id', 'brand').maybeSingle(),
            supabase.from('app_settings').select('data').eq('id', 'company').maybeSingle(),
          ])
          const a: AppSettings = (appRes.data as any)?.data ?? {}
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
          
          // NEW: Load company profile
          try {
            const profile = await getCompanyProfileDB(companyId)
            setCompanyProfile(mapDBProfile(profile))
            const nameFromCompanies = (profile?.trade_name || profile?.legal_name || '').trim()
            const logoFromCompanies = companyLogoUrl(profile?.logo_path || undefined)
            if (nameFromCompanies) setBrandName(prev => prev || nameFromCompanies)
            if (logoFromCompanies) setBrandLogoUrl(prev => prev || logoFromCompanies)
          } catch (e) {
            console.warn('company profile load failed:', e)
          }
        } catch {}
      } catch (err: any) {
        console.error(err)
        toast.error(err?.message || tt('orders.loadFailed', 'Failed to load purchase orders'))
      }
    })()
  }, [companyId])

  // per-company brand (highest priority)
  useEffect(() => {
    if (!companyId) return
    ;(async () => {
      try {
        const res = await supabase
          .from('company_settings')
          .select('data')
          .eq('company_id', companyId)
          .maybeSingle()
        const doc = (res.data as any)?.data || {}
        const brand = doc?.documents?.brand || {}
        const csLogo = (brand?.logoUrl || '').trim()
        const csName = (brand?.name || '').trim()
        if (csName) setBrandName(prev => prev || csName)
        if (csLogo) setBrandLogoUrl(prev => prev || csLogo)
      } catch (e) {
        console.warn('brand load (company_settings) failed:', e)
      }
    })()
  }, [companyId])

  // receipts map (company-scoped)
  async function loadReceiptsMap(poId: string) {
    if (!companyId) return {}
    const { data, error } = await supabase
      .from('stock_movements')
      .select('ref_line_id, qty, type, ref_type, ref_id')
      .eq('company_id', companyId)
      .eq('ref_type', 'PO')
      .eq('ref_id', String(poId)) // ref_id is TEXT in DB
    if (error) throw error

    const m: Record<string, number> = {}
    for (const r of (data || [])) {
      if (!r.ref_line_id) continue
      const q = n((r as any).qty, 0)
      m[String(r.ref_line_id)] = (m[String(r.ref_line_id)] || 0) + q
    }
    setReceivedMap(m)
    return m
  }

  // stock helpers
  const num = (v: any, d=0) => (Number.isFinite(Number(v)) ? Number(v) : d)
  async function upsertStockLevel(
    whId: string, binId: string | null, itemId: string, deltaQtyBase: number, unitCostForReceipts?: number
  ) {
    if (!companyId) throw new Error('No company selected')
    let q = supabase.from('stock_levels')
      .select('id,qty,avg_cost')
      .eq('company_id', companyId)
      .eq('warehouse_id', whId)
      .eq('item_id', itemId)
      .limit(1)
    q = binId ? q.eq('bin_id', binId) : q.is('bin_id', null)
    const { data: found, error: selErr } = await q
    if (selErr) throw selErr

    const unitCost = num(unitCostForReceipts, 0)
    if (!found || found.length === 0) {
      if (deltaQtyBase < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))
      const { error: insErr } = await supabase.from('stock_levels').insert({
        company_id: companyId,
        warehouse_id: whId, bin_id: binId, item_id: itemId,
        qty: deltaQtyBase, allocated_qty: 0, avg_cost: unitCost, updated_at: nowISO(),
      } as any)
      if (insErr) throw insErr
      return
    }
    const row = found[0] as { id: string; qty: number | null; avg_cost: number | null }
    const oldQty = num(row.qty, 0), oldAvg = num(row.avg_cost, 0)
    const newQty = oldQty + deltaQtyBase
    if (newQty < 0) throw new Error(tt('orders.insufficientStock', 'Insufficient stock at source bin'))
    const newAvg = deltaQtyBase > 0 ? (newQty > 0 ? ((oldQty * oldAvg) + (deltaQtyBase * unitCost)) / newQty : unitCost) : oldAvg
    const { error: updErr } = await supabase.from('stock_levels').update({ qty: newQty, avg_cost: newAvg, updated_at: nowISO() }).eq('id', row.id)
    if (updErr) throw updErr
  }

  async function tryUpdateStatus(id: string, candidates: string[]) {
    for (const status of candidates) {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('id', id).eq('company_id', companyId!)
      if (!error) return status
      if (!String(error?.message || '').toLowerCase().includes('invalid input value for enum')) throw error
    }
    return null
  }

  async function createPO() {
    try {
      if (!poSupplierId) return toast.error(tt('orders.supplierRequired', 'Supplier is required'))
      if (!companyId) { toast.error('No company selected. Please sign in again or select a company.'); return }

      const cleanLines = poLinesForm
        .map(l => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct), description: (l.description || '').trim() }))
        .filter(l => l.itemId && l.uomId && l.qty > 0 && l.unitPrice >= 0 && l.discountPct >= 0 && l.discountPct <= 100)
      if (!cleanLines.length) return toast.error(tt('orders.addOneLine', 'Add at least one valid line'))

      const fx = n(poFx, 1)
      const supp = suppliers.find(s => s.id === poSupplierId)

      const subtotal = cleanLines.reduce((s, l) => s + discountedLineTotal(l.qty, l.unitPrice, l.discountPct), 0)
      const tax_total = subtotal * (n(poTaxPct, 0) / 100)
      const total = subtotal + tax_total

      const { data: insPO, error: poErr } = await supabase.from('purchase_orders').insert({
        company_id: companyId,
        supplier_id: poSupplierId,
        status: 'draft',
        order_date: poOrderDate || null,
        currency_code: (poCurrency || '').toUpperCase().slice(0, 3),
        fx_to_base: fx,
        due_date: poDueDate || null,
        expected_date: poDate || null,
        notes: poNotes.trim() || null,
        internal_notes: poInternalNotes.trim() || null,
        payment_terms: poPaymentTerms.trim() || supp?.payment_terms || null,
        delivery_terms: poDeliveryTerms.trim() || null,
        reference_no: poReferenceNo.trim() || null,
        prepared_by: (poPreparedBy.trim() || user?.name || '') || null,
        approved_by: poApprovedBy.trim() || null,
        received_by: poReceivedBy.trim() || null,
        supplier_name: supp?.name ?? null,
        supplier_email: supp?.email ?? null,
        supplier_phone: supp?.phone ?? null,
        supplier_tax_id: supp?.tax_id ?? null,
        subtotal, tax_total, total,
      } as any).select('id').single()
      if (poErr) throw poErr
      const poId = insPO!.id as string

      for (let i = 0; i < cleanLines.length; i++) {
        const l = cleanLines[i]
        const lineTotal = discountedLineTotal(l.qty, l.unitPrice, l.discountPct)
        const { error: lineErr } = await supabase.from('purchase_order_lines').insert({
          company_id: companyId,
          po_id: poId, item_id: l.itemId, uom_id: l.uomId, description: l.description || null, line_no: i + 1,
          qty: l.qty, unit_price: l.unitPrice, discount_pct: l.discountPct, line_total: lineTotal
        } as any)
        if (lineErr) throw lineErr
      }

      toast.success(tt('orders.poCreated', 'Purchase Order created'))
      setPoSupplierId(''); setPoCurrency(baseCode); setPoFx('1'); setPoTaxPct('0')
      setPoOrderDate(() => todayYmd()); setPoDate(() => todayYmd()); setPoDueDate(() => todayYmd())
      setPoPaymentTerms(''); setPoDeliveryTerms(''); setPoReferenceNo(''); setPoNotes(''); setPoInternalNotes('')
      setPoPreparedBy(user?.name || ''); setPoApprovedBy(''); setPoReceivedBy('')
      setPoLinesForm([blankPurchaseLine()])
      setPoOpen(false)

      await refreshPOData()
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poCreateFailed', 'Failed to create PO')) }
  }

  async function approvePO(poId: string) {
    try {
      const updated = await tryUpdateStatus(poId, ['approved', 'open', 'authorised', 'authorized'])
      if (user?.name) await supabase.from('purchase_orders').update({ approved_by: user.name }).eq('id', poId).eq('company_id', companyId!)
      if (updated) setPOs(prev => prev.map(p => (p.id === poId ? { ...p, status: updated, approved_by: user?.name || p.approved_by } : p)))
      toast.success(tt('orders.poApproved', 'PO approved'))
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poApproveFailed', 'Failed to approve PO')) }
  }

  async function cancelPO(poId: string) {
    try {
      const updated = await tryUpdateStatus(poId, ['cancelled', 'canceled'])
      if (updated) setPOs(prev => prev.map(p => (p.id === poId ? { ...p, status: updated } : p)))
      toast.success(tt('orders.poCancelled', 'PO cancelled'))
    } catch (err: any) { console.error(err); toast.error(err?.message || tt('orders.poCancelFailed', 'Failed to cancel PO')) }
  }

  async function saveSelectedPOMeta() {
    if (!selectedPO || !companyId) return
    try {
      const patch: Partial<PO> & Record<string, any> = {
        order_date: selectedPoMeta.orderDate || null,
        expected_date: selectedPoMeta.expectedDate || null,
        due_date: selectedPoMeta.dueDate || null,
        payment_terms: selectedPoMeta.paymentTerms.trim() || null,
        delivery_terms: selectedPoMeta.deliveryTerms.trim() || null,
        reference_no: selectedPoMeta.referenceNo.trim() || null,
        notes: selectedPoMeta.notes.trim() || null,
        internal_notes: selectedPoMeta.internalNotes.trim() || null,
        prepared_by: selectedPoMeta.preparedBy.trim() || null,
        approved_by: selectedPoMeta.approvedBy.trim() || null,
        received_by: selectedPoMeta.receivedBy.trim() || null,
      }
      const { error } = await supabase.from('purchase_orders').update(patch).eq('id', selectedPO.id).eq('company_id', companyId)
      if (error) throw error
      const merged = { ...selectedPO, ...patch } as PO
      setSelectedPO(merged)
      setPOs(prev => prev.map(po => po.id === merged.id ? merged : po))
      toast.success(tt('orders.detailsSaved', 'Order details saved'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.detailsSaveFailed', 'Failed to save order details'))
    }
  }

  // ---------------- NEW HELPERS ----------------

  // Refresh all PO + POL company-scoped lists
  async function refreshPOData() {
    if (!companyId) return
    const [poRes, polRes] = await Promise.all([
      supabase
        .from('purchase_orders')
        .select('id,status,order_date,currency_code,fx_to_base,total,subtotal,tax_total,due_date,reference_no,delivery_terms,notes,internal_notes,prepared_by,approved_by,received_by,updated_at,created_at,order_no,public_id,created_by,supplier_id,supplier,supplier_name,supplier_email,supplier_phone,supplier_tax_id,payment_terms,expected_date')
        .eq('company_id', companyId),
      supabase
        .from('purchase_order_lines')
        .select('id,po_id,item_id,uom_id,description,line_no,qty,unit_price,discount_pct,line_total')
        .eq('company_id', companyId),
    ])
    setPOs(((poRes.data || []) as PO[]).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
    setPOLines((polRes.data || []) as POL[])
  }

  // DRY: post one receipt movement for a single line
  async function postReceiptForLine(
    po: PO,
    line: POL,
    qtyRequested: number,
    whId: string,
    binId: string
  ) {
    if (!companyId) throw new Error('No company selected')

    const it = itemById.get(line.item_id); if (!it) throw new Error(`Item not found for line ${line.item_id}`)
    const baseUom = it.baseUomId
    const qtyBase = safeConvert(qtyRequested, line.uom_id, baseUom)
    if (qtyBase == null) {
      const fromCode = uomById.get(uomIdFromIdOrCode(line.uom_id))?.code || line.uom_id
      throw new Error(tt('orders.noConversion', 'No conversion from {from} to base for {sku}')
        .replace('{from}', String(fromCode)).replace('{sku}', String(it.sku)))
    }

    const fxToBase = n(po.fx_to_base ?? (po as any).fxToBase, 1)
    const disc = n(line.discount_pct, 0)
    const totalBase = n(line.unit_price) * qtyRequested * (1 - disc/100) * fxToBase
    const unitCostBase = qtyBase > 0 ? totalBase / qtyBase : 0

    await upsertStockLevel(whId, binId, it.id, qtyBase, unitCostBase)
    await supabase.from('stock_movements').insert({
      company_id: companyId,
      type: 'receive',
      item_id: it.id,
      uom_id: uomIdFromIdOrCode(line.uom_id) || line.uom_id,
      qty: qtyRequested,
      qty_base: qtyBase,
      unit_cost: unitCostBase,
      total_value: totalBase,
      warehouse_to_id: whId,
      bin_to_id: binId,
      notes: `PO ${poNo(po)}`,
      created_by: 'system',
      ref_type: 'PO',
      ref_id: String((po as any).id), // ensure TEXT
      ref_line_id: line.id ?? null,
    } as any)
  }

  // Receive a single line (used by the per-line button)
  async function receiveLine(po: PO, line: POL) {
    try {
      if (!companyId) throw new Error('No company selected')

      const currentMap = await loadReceiptsMap(po.id)
      const lineId = String(line.id || '')
      const ordered = n(line.qty)
      const already = n(currentMap[lineId] || 0)
      const remaining = Math.max(0, ordered - already)
      if (remaining <= 0) {
        // Nothing left — try to trim & possibly close
        let closedViaRpc = false
        try {
          const { data, error } = await supabase.rpc('po_trim_and_close', {
            p_company_id: companyId,
            p_po_id: po.id,
          })
          if (error) {
            const msg = String(error.message || '').toLowerCase()
            // tolerate PostgREST 404/routability while function becomes available
            if (!msg.includes('not found')) throw error
          } else {
            closedViaRpc = !!data?.[0]?.closed
          }
        } catch (e) {
          // swallow: fallback happens via refresh + status check
          console.warn('po_trim_and_close (tolerated):', e)
        }
        if (closedViaRpc) toast.success(tt('orders.poClosed', 'PO closed — all items received'))
        await refreshPOData()
        await loadReceiptsMap(po.id)
        return
      }

      const key = String(line.id ?? `${line.po_id}-${line.line_no}`)
      const plan = receivePlan[key]
      const qtyRequested = clamp(n(plan?.qty ?? 0), 0, remaining)
      if (!plan || qtyRequested <= 0) return toast.error(tt('orders.enterQty', 'Enter a quantity to receive'))
      if (!plan.whId || !plan.binId) return toast.error(tt('orders.selectDestWhBin', 'Select destination warehouse and bin for each line'))

      await postReceiptForLine(po, line, qtyRequested, plan.whId, plan.binId)

      // Trim fully-received lines & possibly close
      let closed = false
      try {
        const { data, error } = await supabase.rpc('po_trim_and_close', {
          p_company_id: companyId,
          p_po_id: po.id,
        })
        if (error) {
          const msg = String(error.message || '').toLowerCase()
          if (!msg.includes('not found')) throw error
        } else {
          closed = !!data?.[0]?.closed
        }
      } catch (e) {
        console.warn('po_trim_and_close (tolerated):', e)
      }

      await refreshPOData()
      await loadReceiptsMap(po.id)
      if (user?.name) {
        await supabase.from('purchase_orders').update({ received_by: user.name }).eq('id', po.id).eq('company_id', companyId)
      }
      if (closed) {
        toast.success(tt('orders.poClosed', 'PO closed — all items received'))
        setPoViewOpen(false)
        setSelectedPO(null)
      } else {
        toast.success(tt('orders.lineReceived', 'Line received'))
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.receiveFailed', 'Failed to receive'))
    }
  }

  // -------------- REPLACE: Receive ALL --------------
  async function doReceivePO(po: PO) {
    try {
      if (!companyId) throw new Error('No company selected')
      const status = String(po.status || '').toLowerCase()
      if (status === 'draft') {
        toast.error(tt('orders.approveBeforeReceive', 'Approve the PO before receiving'))
        return
      }

      const lines = polines.filter(l => l.po_id === po.id)
      if (!lines.length) return toast.error(tt('orders.noLinesToReceive', 'No lines to receive'))

      const currentMap = await loadReceiptsMap(po.id)
      let anyPosted = false

      // Post movements for every line that has a >0 request (clamped to remaining)
      for (const l of lines) {
        const lineId = String(l.id || '')
        if (!lineId) continue

        const ordered = n(l.qty)
        const already = n(currentMap[lineId] || 0)
        const remaining = Math.max(0, ordered - already)
        if (remaining <= 0) continue

        const key = String(l.id ?? `${l.po_id}-${l.line_no}`)
        const p = receivePlan[key]
        if (!p) continue

        const qtyRequested = clamp(n(p.qty ?? 0), 0, remaining)
        if (qtyRequested <= 0) continue
        if (!p.whId || !p.binId) throw new Error(tt('orders.selectDestWhBin', 'Select destination warehouse and bin for each line'))

        await postReceiptForLine(po, l, qtyRequested, p.whId, p.binId)
        anyPosted = true
      }

      // Always call the RPC — delete fully-received lines and close if none left
      let closed = false
      try {
        const { data, error } = await supabase.rpc('po_trim_and_close', {
          p_company_id: companyId,
          p_po_id: po.id,
        })
        if (error) {
          const msg = String(error.message || '').toLowerCase()
          // Ignore PostgREST 404/“not found” which can surface while the function deploys
          if (!msg.includes('not found')) throw error
        } else {
          closed = !!data?.[0]?.closed
        }
      } catch (e) {
        console.warn('po_trim_and_close (tolerated):', e)
      }

      await refreshPOData()
      await loadReceiptsMap(po.id)
      if (user?.name) {
        await supabase.from('purchase_orders').update({ received_by: user.name }).eq('id', po.id).eq('company_id', companyId)
      }

      if (closed) {
        toast.success(tt('orders.poClosed', 'PO closed — all items received'))
        setPoViewOpen(false); setSelectedPO(null); setReceivePlan({})
        return
      }

      if (anyPosted) {
        toast.success(tt('orders.poReceived', 'PO receipts recorded'))
      } else {
        toast(tt('orders.nothingToReceive', 'Nothing left to receive.'))
      }
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.receiveFailed', 'Failed to receive PO'))
    }
  }
  // ---------------------------------------------------

  const poOutstanding = useMemo(
    () => pos.filter(p => ['draft', 'approved', 'open', 'authorised', 'authorized', 'submitted', 'partially_received'].includes(String(p.status).toLowerCase())),
    [pos]
  )
  const poSubtotal = poLinesForm.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct,0)/100), 0)
  const poTax = poSubtotal * (n(poTaxPct, 0) / 100)
  const openPurchaseBase = useMemo(() => poOutstanding.reduce((sum, po) => sum + amountPO(po).totalBase, 0), [poOutstanding, polines])
  const draftPurchaseCount = useMemo(() => poOutstanding.filter(po => String(po.status).toLowerCase() === 'draft').length, [poOutstanding])
  const receivingPurchaseCount = useMemo(() => poOutstanding.filter(po => ['approved', 'open', 'authorised', 'authorized', 'submitted', 'partially_received'].includes(String(po.status).toLowerCase())).length, [poOutstanding])

  function purchaseStatusClass(status?: string) {
    const value = String(status || '').toLowerCase()
    if (value === 'draft') return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200'
    if (value === 'cancelled' || value === 'canceled') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    if (value === 'closed') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
  }

  useEffect(() => {
    const orderId = searchParams.get('orderId')
    if (!orderId) return
    const match = pos.find(po => po.id === orderId)
    if (!match) return
    setSelectedPO(match)
    setPoViewOpen(true)
  }, [searchParams, pos])

  useEffect(() => {
    setSelectedPoMeta(buildPoMetaDraft(selectedPO))
  }, [selectedPO])

  useEffect(() => {
    if (!browserOpen) return
    const t = setTimeout(() => { resetBrowserPaging(); fetchBrowserPage(0) }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [browserOpen, browserQ, browserFrom, browserTo, browserStatuses.closed, browserStatuses.partially_received, companyId])

  // when PO is selected, load receipts and seed per-line plan
  useEffect(() => {
    (async () => {
      if (!selectedPO) return
      try {
        await loadReceiptsMap(selectedPO.id)
        const lines = polines.filter(l => l.po_id === selectedPO.id)
        const next: Record<string, { qty: string; whId: string; binId: string }> = {}
        for (const l of lines) {
          const lineId = String(l.id || '')
          const ordered = n(l.qty)
          const already = n(receivedMap[lineId] || 0)
          const remaining = Math.max(0, ordered - already)
          const key = lineId || `${l.po_id}-${l.line_no}`
          const whId = defaultReceiveWhId || warehouses[0]?.id || ''
          const binId = whId ? (binsForWH(whId)[0]?.id || '') : ''
          next[key] = { qty: String(remaining), whId, binId }
        }
        setReceivePlan(next)
      } catch (e) {
        console.error(e)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPO])

  function applyDefaultsToAll() {
    if (!selectedPO) return
    const lines = polines.filter(l => l.po_id === selectedPO.id)
    setReceivePlan(prev => {
      const next = { ...prev }
      for (const l of lines) {
        const key = String(l.id ?? `${l.po_id}-${l.line_no}`)
        const whId = defaultReceiveWhId
        const binId = defaultReceiveBinId
        const ordered = n(l.qty)
        const already = n(receivedMap[String(l.id || '')] || 0)
        const remaining = Math.max(0, ordered - already)
        if (!next[key]) next[key] = { qty: String(remaining), whId, binId }
        else next[key] = { ...next[key], whId, binId, qty: String(clamp(n(next[key].qty, 0), 0, remaining)) }
      }
      return next
    })
  }

  // ---------- supplier resolve (for print) ----------
  async function resolveSupplierDetails(po: PO): Promise<Partial<Supplier>> {
    if (!companyId) return {}
    const codeUpper = (po.supplier || '').toString().toUpperCase()
    const nameUpper = (po.supplier_name || '').toString().toUpperCase()

    const s: Supplier | undefined =
      (po.supplier_id ? suppliers.find(x => x.id === po.supplier_id) : undefined) ??
      (codeUpper ? suppliers.find(x => (x.code || '').toUpperCase() === codeUpper) : undefined) ??
      (nameUpper ? suppliers.find(x => (x.name || '').toUpperCase() === nameUpper) : undefined)

    if (s) return s

    try {
      if (po.supplier_id) {
        const { data } = await supabase
          .from('suppliers').select('id,code,name,email,phone,tax_id,payment_terms')
          .eq('company_id', companyId)
          .eq('id', po.supplier_id).limit(1)
        if (data && data.length) return data[0] as Supplier
      }
      if (po.supplier) {
        const { data } = await supabase
          .from('suppliers').select('id,code,name,email,phone,tax_id,payment_terms')
          .eq('company_id', companyId)
          .eq('code', po.supplier).limit(1)
        if (data && data.length) return data[0] as Supplier
      }
      if (po.supplier_name) {
        const { data } = await supabase
          .from('suppliers').select('id,code,name,email,phone,tax_id,payment_terms')
          .eq('company_id', companyId)
          .eq('name', po.supplier_name).limit(1)
        if (data && data.length) return data[0] as Supplier
      }
    } catch (e) {
      console.warn('Supplier lookup failed; using PO snapshot where available.', e)
    }
    return {}
  }
  // --------------------------------------------------

  async function printPO(po: PO): Promise<void> {
    const currency = curPO(po) || '—'
    const fx = fxPO(po) || 1
    const lines = polines.filter(l => l.po_id === po.id)

    const rows = lines.map(l => {
      const it = itemById.get(l.item_id)
      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
      const disc = n(l.discount_pct, 0)
      const lineTotal = discountedLineTotal(n(l.qty), n(l.unit_price), disc)
      const detail = (l.description || '').trim()
      return `<tr>
        <td><div class="item-name">${docText(it?.name || l.item_id)}</div>${detail ? `<div class="item-detail">${docMultiline(detail, '')}</div>` : ''}</td>
        <td>${docText(it?.sku || '', '')}</td>
        <td class="right">${fmtAcct(n(l.qty))}</td>
        <td>${docText(uomCode)}</td>
        <td class="right">${fmtAcct(n(l.unit_price))}</td>
        <td class="right">${fmtAcct(disc)}</td>
        <td class="right">${fmtAcct(lineTotal)}</td>
      </tr>`
    }).join('')

    const amounts = amountPO(po)
    const subtotal = amounts.subtotal
    const tax = amounts.tax
    const total = amounts.total
    const number = poNo(po)
    const printedAt = new Date().toLocaleString()

    const live = await resolveSupplierDetails(po)
    const supp = {
      name: po.supplier_name ?? live.name ?? poSupplierLabel(po),
      email: po.supplier_email ?? live.email ?? '—',
      phone: po.supplier_phone ?? live.phone ?? '—',
      tax_id: po.supplier_tax_id ?? live.tax_id ?? '—',
      terms: po.payment_terms ?? live.payment_terms ?? '—',
    }
    ;(supp as any).referenceNo = (po as any).reference_no ?? ''
    ;(supp as any).deliveryTerms = (po as any).delivery_terms ?? ''
    ;(supp as any).preparedBy = (po as any).prepared_by ?? ''
    ;(supp as any).approvedBy = (po as any).approved_by ?? ''
    ;(supp as any).receivedBy = (po as any).received_by ?? ''
    ;(supp as any).notes = po.notes ?? ''

    // Brand & company details
    const companyName = (brandName
      || companyProfile.tradeName
      || companyProfile.legalName
      || ''
    ).trim()
    const logoUrl = (brandLogoUrl || '').trim()
    const logoDataUrl = await fetchDataUrl(logoUrl) // avoid CORS/expiry
    const init = initials(companyName || companyProfile.tradeName || companyProfile.legalName)

    const css = `
      @page { size: A4; margin: 20mm; }
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
        height: 55px; width: auto; border: 1px solid #e5e7eb; border-radius: 8px;
        background: #f8fafc; padding: 4px;
      }
      .logo-fallback {
        height: 55px; width: 50px; border: 1px solid #e5e7eb; border-radius: 8px;
        display: flex; align-items: center; justify-content: center; font-weight: 700; background: #eef2ff;
      }
      .company-name { font-size: 26px; font-weight: 700; letter-spacing: .01em; }
      .doc-meta { text-align: right; }
      .doc-title { font-size: 30px; font-weight: 800; letter-spacing: .01em; margin: 0; }
      .muted { color: #64748b; }
      .cap { text-transform: capitalize; }

      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fff; }
      .card h4 { margin: 0 0 6px; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
      .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; }
      .kv .k { color: #64748b; }
      .addr { white-space: pre-wrap; }
      .section { margin-top: 14px; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; }
      .section-head { padding: 10px 12px; background: #eff6ff; color: #1d4ed8; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .section-body { padding: 12px; }
      .item-name { font-weight: 600; }
      .item-detail { margin-top: 4px; color: #64748b; font-size: 11px; line-height: 1.45; white-space: pre-wrap; }

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
      .terms-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
      .terms-box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 10px; background: #fff; min-height: 100px; }
      .terms-box h4 { margin: 0 0 8px; font-size: 11px; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
      .signatures { margin-top: 18px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; page-break-inside: avoid; }
      .sig { padding-top: 32px; }
      .sig-line { border-top: 1px solid #94a3b8; height: 1px; }
      .sig-label { margin-top: 8px; color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; }
      .sig-name { margin-top: 6px; min-height: 16px; font-size: 12px; font-weight: 600; }

      .footnote {
        margin-top: 18px; padding-top: 8px; border-top: 1px dashed #e5e7eb;
        color: #475569; font-size: 11px;
      }

      @media print {
        .wrap { padding: 0; }
        thead { display: table-header-group; }
        tr, .section, .terms-box { page-break-inside: avoid; }
      }
    `

    const headerBrand = logoDataUrl
      ? `<img src="${logoDataUrl}" alt="${companyName || 'Company logo'}" class="logo">`
      : `<div class="logo-fallback">${init}</div>`

    const cp = companyProfile
    const addrLines = [
      cp.address1,
      cp.address2,
      [cp.city, cp.state, cp.postalCode].filter(Boolean).join(', '),      
      cp.country
    ].filter(Boolean).join('<br/>')
    
    const companyCard = `
      <div class="card">
        <h4>${tt('orders.companyDetails', 'Company Details')}</h4>
        <div class="kv">
          <div class="k">${tt('orders.tradeName', 'Trade name')}</div><div><b>${cp.tradeName || companyName || '—'}</b></div>
          <div class="k">${tt('orders.legalName', 'Legal name')}</div><div>${cp.legalName || '—'}</div>
          <div class="k">${tt('orders.taxId', 'Tax ID')}</div><div>${cp.taxId || '—'}</div>
          <div class="k">${tt('orders.registrationNo', 'Registration No.')}</div><div>${cp.regNo || '—'}</div>
          <div class="k">${tt('orders.phone', 'Phone')}</div><div>${cp.phone || '—'}</div>
          <div class="k">${tt('orders.email', 'Email')}</div><div>${cp.email || '—'}</div>
          <div class="k">${tt('orders.website', 'Website')}</div><div>${cp.website || '—'}</div>
          <div class="k">${tt('orders.address', 'Address')}</div><div class="addr">${addrLines || '—'}</div>
        </div>
        ${cp.printFooterNote ? `<div class="footnote">${cp.printFooterNote}</div>` : ''}
      </div>
    `

    const orderCard = `
      <div class="card">
        <h4>${tt('orders.order', 'Order')}</h4>
        <div class="kv">
          <div class="k">${tt('orders.status', 'Status')}</div><div><b class="cap">${po.status}</b></div>
          <div class="k">${tt('orders.currency', 'Currency')}</div><div><b>${currency}</b></div>
          <div class="k">${tt('orders.fxToBaseShort', 'FX → {baseCode}', { baseCode })}</div><div><b>${fmtAcct(fx)}</b></div>
          <div class="k">${tt('orders.expectedDate', 'Expected Date')}</div><div><b>${(po as any).expected_date || '—'}</b></div>
        </div>
      </div>
    `

    const supplierCard = `
      <div class="card" style="margin-top:8px">
        <h4>${tt('orders.supplier', 'Supplier')}</h4>
        <div><b>${supp.name}</b></div>
        <div class="muted">${tt('orders.email', 'Email')}: ${supp.email} · ${tt('orders.phone', 'Phone')}: ${supp.phone} · ${tt('orders.taxId', 'Tax ID')}: ${supp.tax_id}</div>
        <div class="kv" style="margin-top:6px">
          <div class="k">${tt('orders.paymentTerms', 'Payment Terms')}</div><div>${supp.terms}</div>
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
            <h1 class="doc-title">${tt('orders.purchaseOrder', 'Purchase Order')} ${number}</h1>
            <div class="muted">${tt('orders.printed', 'Printed')}: <b>${printedAt}</b></div>
          </div>
        </div>

        <div class="grid2">
          ${orderCard}
          ${companyCard}
        </div>

        ${supplierCard}

        <div class="section">
          <div class="section-head">${tt('orders.commercialTerms', 'Commercial terms')}</div>
          <div class="section-body">
            <div class="terms-grid">
              <div class="terms-box">
                <h4>${tt('orders.commercialTerms', 'Commercial terms')}</h4>
                <div class="kv">
                  <div class="k">${tt('orders.orderDate', 'Order Date')}</div><div>${docDate((po as any).order_date)}</div>
                  <div class="k">${tt('orders.dueDate', 'Due Date')}</div><div>${docDate((po as any).due_date)}</div>
                  <div class="k">${tt('orders.expectedDate', 'Expected Date')}</div><div>${docDate((po as any).expected_date)}</div>
                  <div class="k">${tt('orders.referenceNo', 'Reference')}</div><div>${docText((supp as any).referenceNo)}</div>
                  <div class="k">${tt('orders.paymentTerms', 'Payment Terms')}</div><div>${docText(supp.terms)}</div>
                  <div class="k">${tt('orders.deliveryTerms', 'Delivery Terms')}</div><div>${docText((supp as any).deliveryTerms)}</div>
                </div>
              </div>
              <div class="terms-box">
                <h4>${tt('orders.notes', 'Notes')}</h4>
                <div>${docMultiline((supp as any).notes)}</div>
              </div>
            </div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>${tt('orders.itemOrService', 'Item / Service')}</th><th>${tt('table.sku', 'SKU')}</th><th class="right">${tt('orders.qty', 'Qty')}</th><th>${tt('orders.uom', 'UoM')}</th>
              <th class="right">${tt('orders.unitPrice', 'Unit Price')}</th><th class="right">${tt('orders.discountPct', 'Disc %')}</th><th class="right">${tt('orders.lineTotal', 'Line Total')} (${currency})</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <div class="totals">
          <div class="label">${tt('orders.subtotal', 'Subtotal')} (${currency})</div><div class="right">${fmtAcct(subtotal)}</div>
          <div class="label">${tt('orders.tax', 'Tax')} (${currency})</div><div class="right">${fmtAcct(tax)}</div>
          <div class="muted">${tt('orders.fxToBaseShort', 'FX to {baseCode}', { baseCode })}</div><div class="right muted">${fmtAcct(fx)}</div>
          <div class="grand">${tt('orders.total', 'Total')} (${currency})</div><div class="right grand">${fmtAcct(total)}</div>
          <div class="grand">${tt('orders.totalBase', 'Total ({baseCode})', { baseCode })}</div><div class="right grand">${fmtAcct(total * fx)}</div>
        </div>

        <div class="signatures">
          <div class="sig">
            <div class="sig-line"></div>
            <div class="sig-label">${tt('orders.preparedBy', 'Prepared by')}</div>
            <div class="sig-name">${docName((supp as any).preparedBy)}</div>
          </div>
          <div class="sig">
            <div class="sig-line"></div>
            <div class="sig-label">${tt('orders.approvedBy', 'Approved by')}</div>
            <div class="sig-name">${docName((supp as any).approvedBy)}</div>
          </div>
          <div class="sig">
            <div class="sig-line"></div>
            <div class="sig-label">${tt('orders.receivedBy', 'Received by')}</div>
            <div class="sig-name">${docName((supp as any).receivedBy)}</div>
          </div>
        </div>
      </div>
    `

    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>PO ${number}</title><meta charset="utf-8"/><style>${css}</style></head><body>${html}</body></html>`)
    w.document.close()
    try { await (w as any).document?.fonts?.ready } catch {}
    const img = w.document.querySelector('img.logo') as HTMLImageElement | null
    if (img && 'decode' in img) { try { await (img as any).decode() } catch {} }
    setTimeout(() => { w.focus(); w.print() }, 50)
  }

  return (
    <div className="mobile-container w-full max-w-full space-y-6 overflow-x-hidden">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.openPurchases', 'Open purchase orders')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{poOutstanding.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('orders.openPurchasesHelp', 'Draft, approved, and partially received orders stay visible until operationally complete.')}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.openPurchaseValue', 'Open purchase value')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{formatMoneyBase(openPurchaseBase, baseCode)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('orders.openPurchaseValueHelp', 'Gross order value in base currency, including tax.')}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.purchaseReadiness', 'Receiving readiness')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-sm font-medium">{tt('orders.purchaseReadyCount', '{count} orders are approved or in receiving.', { count: receivingPurchaseCount })}</div>
            <p className="text-xs text-muted-foreground">{tt('orders.purchaseDrafts', '{count} drafts still need review before stock can be received.', { count: draftPurchaseCount })}</p>
          </CardContent>
        </Card>
      </div>

      {/* Outstanding + Create PO */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{tt('orders.outstandingPOs', 'Open & Approved Purchase Orders')}</CardTitle>

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setBrowserOpen(true)}>
                {tt('orders.poBrowser', 'Closed/Received POs')}
              </Button>

              <Sheet open={poOpen} onOpenChange={setPoOpen}>
                <SheetTrigger asChild>
                  <Button size="sm">{tt('orders.newPO', 'New PO')}</Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
                  <SheetHeader>
                    <SheetTitle>{tt('orders.newPO', 'New Purchase Order')}</SheetTitle>
                    <SheetDescription className="sr-only">{tt('orders.createPO', 'Create a purchase order')}</SheetDescription>
                  </SheetHeader>

                  {/* Header - Responsive grid */}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                      <Label>{tt('orders.supplier', 'Supplier')}</Label>
                      <Select value={poSupplierId} onValueChange={setPoSupplierId}>
                        <SelectTrigger><SelectValue placeholder={tt('orders.selectSupplier', 'Select supplier')} /></SelectTrigger>
                        <SelectContent className="max-h-64 overflow-auto">
                          {suppliers.map((s) => (
                            <SelectItem key={s.id} value={s.id}>{(s.code ? s.code + ' — ' : '') + s.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.currency', 'Currency')}</Label>
                      <Select value={poCurrency} onValueChange={setPoCurrency}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>{tt('orders.fxToBase', 'FX to Base ({code})', { code: baseCode })}</Label>
                      <Input type="number" min="0" step="0.000001" value={poFx} onChange={e => setPoFx(e.target.value)} />
                    </div>
                    <div>
                      <Label>{tt('orders.expectedDate', 'Expected Date')}</Label>
                      <Input type="date" value={poDate} onChange={e => setPoDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                      <div className="flex flex-col gap-1 pb-3">
                        <h3 className="text-sm font-semibold">{tt('orders.documentSetup', 'Document setup')}</h3>
                        <p className="text-xs text-muted-foreground">{tt('orders.purchaseSetupHelp', 'Capture supplier terms, due dates, and sign-off names before you add the received goods or service lines below.')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label>{tt('orders.orderDate', 'Order Date')}</Label>
                          <Input type="date" value={poOrderDate} onChange={e => setPoOrderDate(e.target.value)} />
                        </div>
                        <div>
                          <Label>{tt('orders.dueDate', 'Due Date')}</Label>
                          <Input type="date" value={poDueDate} onChange={e => setPoDueDate(e.target.value)} />
                        </div>
                        <div>
                          <Label>{tt('orders.referenceNo', 'Reference')}</Label>
                          <Input value={poReferenceNo} onChange={e => setPoReferenceNo(e.target.value)} placeholder={tt('orders.referencePlaceholderPO', 'Supplier quote, tender, or procurement reference')} />
                        </div>
                        <div>
                          <Label>{tt('orders.paymentTerms', 'Payment Terms')}</Label>
                          <Input value={poPaymentTerms} onChange={e => setPoPaymentTerms(e.target.value)} placeholder={tt('orders.paymentTermsPlaceholder', '30 days, advance, milestone, etc.')} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>{tt('orders.deliveryTerms', 'Delivery Terms')}</Label>
                          <Input value={poDeliveryTerms} onChange={e => setPoDeliveryTerms(e.target.value)} placeholder={tt('orders.deliveryTermsPlaceholderPO', 'Incoterms, supplier delivery mode, collection, etc.')} />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                      <div className="flex flex-col gap-1 pb-3">
                        <h3 className="text-sm font-semibold">{tt('orders.responsibilityFields', 'Responsibility fields')}</h3>
                        <p className="text-xs text-muted-foreground">{tt('orders.purchaseResponsibilityHelp', 'Prepared, approved, and received names keep the PO usable for both procurement and warehouse control.')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label>{tt('orders.preparedBy', 'Prepared by')}</Label>
                          <Input value={poPreparedBy} onChange={e => setPoPreparedBy(e.target.value)} />
                        </div>
                        <div>
                          <Label>{tt('orders.approvedBy', 'Approved by')}</Label>
                          <Input value={poApprovedBy} onChange={e => setPoApprovedBy(e.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>{tt('orders.receivedBy', 'Received by')}</Label>
                          <Input value={poReceivedBy} onChange={e => setPoReceivedBy(e.target.value)} placeholder={tt('orders.receivedByPlaceholder', 'Warehouse or site receiver')} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-1 pb-3">
                      <h3 className="text-sm font-semibold">{tt('orders.notesAndInstructions', 'Notes and instructions')}</h3>
                      <p className="text-xs text-muted-foreground">{tt('orders.notesAndInstructionsHelp', 'Use notes for supplier-facing instructions and internal notes for procurement or receiving remarks that should stay off the printed document.')}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3">
                      <div>
                        <Label>{tt('orders.notes', 'Notes')}</Label>
                        <Textarea className="min-h-[92px]" value={poNotes} onChange={e => setPoNotes(e.target.value)} placeholder={tt('orders.purchaseNotesPlaceholder', 'Visible on the supplier-facing document. Use this for delivery instructions or procurement scope.')} />
                      </div>
                      <div>
                        <Label>{tt('orders.internalNotes', 'Internal Notes')}</Label>
                        <Textarea className="min-h-[92px]" value={poInternalNotes} onChange={e => setPoInternalNotes(e.target.value)} placeholder={tt('orders.internalNotesPlaceholder', 'Internal remarks for operations or finance. This stays off the printed document.')} />
                      </div>
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="mt-6">
                    <div className="flex flex-col gap-1">
                      <Label>{tt('orders.lines', 'Lines')}</Label>
                      <p className="text-xs text-muted-foreground">{tt('orders.linesHelp', 'Use the description field for service scope, project detail, or product specifics. Quantity and UoM still support stock and non-stock work.')}</p>
                    </div>
                    <div className="mt-2 border rounded-lg overflow-x-auto w-full">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr className="text-left">
                            <th className="py-2 px-3">{tt('orders.itemOrService', 'Item / Service')}</th>
                            <th className="py-2 px-3 w-24">{tt('orders.uom', 'UoM')}</th>
                            <th className="py-2 px-3 w-28">{tt('orders.qty', 'Qty')}</th>
                            <th className="py-2 px-3 w-40">{tt('orders.unitPrice', 'Unit Price')}</th>
                            <th className="py-2 px-3 w-28">{tt('orders.discountPct', 'Disc %')}</th>
                            <th className="py-2 px-3 w-36 text-right">{tt('orders.lineTotal', 'Line Total')}</th>
                            <th className="py-2 px-3 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {poLinesForm.map((ln, idx) => {
                            const lineTotal = n(ln.qty) * n(ln.unitPrice) * (1 - n(ln.discountPct,0)/100)
                            return (
                              <tr key={idx} className="border-t align-top">
                                <td className="py-2 px-3">
                                  <Select
                                    value={ln.itemId}
                                    onValueChange={(v) =>
                                      setPoLinesForm(prev =>
                                        prev.map((x, i) => i === idx ? { ...x, itemId: v, uomId: (itemById.get(v)?.baseUomId || x.uomId) } : x)
                                      )
                                    }
                                  >
                                    <SelectTrigger><SelectValue placeholder={tt('orders.item', 'Item')} /></SelectTrigger>
                                    <SelectContent className="max-h-64 overflow-auto">
                                      {items.map(it => <SelectItem key={it.id} value={it.id}>{it.name} ({it.sku})</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                  <Textarea
                                    className="mt-2 min-h-[74px]"
                                    value={ln.description}
                                    onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                                    placeholder={tt('orders.lineDescriptionPlaceholder', 'Optional line description for service scope, specifications, or deliverables')}
                                  />
                                </td>
                                <td className="py-2 px-3">
                                  <Select value={ln.uomId} onValueChange={(v) => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, uomId: v } : x))}>
                                    <SelectTrigger><SelectValue placeholder={tt('orders.uom', 'UoM')} /></SelectTrigger>
                                    <SelectContent className="max-h-64 overflow-auto">
                                      {uoms.map((u) => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
                                    </SelectContent>
                                  </Select>
                                </td>
                                <td className="py-2 px-3">
                                  <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.qty} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, qty: e.target.value } : x))} />
                                </td>
                                <td className="py-2 px-3">
                                  <Input inputMode="decimal" type="number" min="0" step="0.0001" value={ln.unitPrice} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, unitPrice: e.target.value } : x))} />
                                </td>
                                <td className="py-2 px-3">
                                  <Input type="number" min="0" max="100" step="0.01" value={ln.discountPct} onChange={e => setPoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, discountPct: e.target.value } : x))} />
                                </td>
                                <td className="py-2 px-3 text-right">{fmtAcct(lineTotal)}</td>
                                <td className="py-2 px-3 text-right">
                                  <Button size="icon" variant="ghost" onClick={() => setPoLinesForm(prev => prev.filter((_, i) => i !== idx))}>✕</Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="p-2">
                        <MobileAddLineButton
                          onAdd={() => setPoLinesForm(prev => [...prev, blankPurchaseLine()])}
                          label={tt('orders.addLine', 'Add Line')}
                        />
                      </div>
                    </div>

                    {/* Totals - Responsive layout */}
                    <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4">
                      <div className="p-4 grid grid-cols-1 gap-3 items-center">
                        <div className="flex flex-wrap items-center gap-3">
                          <Label className="whitespace-nowrap">{tt('orders.taxPct', 'Tax %')}</Label>
                          <Input className="w-28" type="number" min="0" step="0.01" value={poTaxPct} onChange={e => setPoTaxPct(e.target.value)} />
                        </div>
                        <div className="flex flex-col items-end text-sm">
                          <div className="w-full grid grid-cols-2 gap-1">
                            <div className="text-muted-foreground">{tt('orders.subtotal', 'Subtotal')} ({poCurrency})</div>
                            <div className="text-right">{fmtAcct(poSubtotal)}</div>
                            <div className="text-muted-foreground">{tt('orders.tax', 'Tax')}</div>
                            <div className="text-right">{fmtAcct(poTax)}</div>
                            <div className="font-medium">{tt('orders.total', 'Total')}</div>
                            <div className="text-right font-medium">{fmtAcct(poSubtotal + poTax)}</div>
                          </div>
                          <div className="mt-3">
                            <Button onClick={createPO}>{tt('orders.createPO', 'Create PO')}</Button>
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

        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.po', 'PO')}</th>
              <th className="py-2 pr-2">{tt('orders.supplier', 'Supplier')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
              <th className="py-2 pr-2">{tt('orders.actions', 'Actions')}</th>
            </tr></thead>
            <tbody>
              {poOutstanding.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.nothingPending', 'Nothing pending.')}</td></tr>}
              {poOutstanding.map(po => {
                const amounts = amountPO(po)
                return (
                  <tr key={po.id} className="border-b align-top">
                    <td className="py-3 pr-2 font-medium">{poNo(po)}</td>
                    <td className="py-3 pr-2">{poSupplierLabel(po)}</td>
                    <td className="py-3 pr-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${purchaseStatusClass(po.status)}`}>
                        {String(po.status).replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 pr-2 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                    <td className="py-3 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setSelectedPO(po); setPoViewOpen(true) }}>{tt('orders.view', 'View')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printPO(po)}>{tt('orders.print', 'Print')}</Button>
                        {String(po.status).toLowerCase() === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approvePO(po.id)}>{tt('orders.approve', 'Approve')}</Button>
                            <Button size="sm" variant="destructive" onClick={() => cancelPO(po.id)}>{tt('orders.cancel', 'Cancel')}</Button>
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
        <CardHeader><CardTitle>{tt('orders.recentPOs', 'Recent Purchase Orders')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.po', 'PO')}</th>
              <th className="py-2 pr-2">{tt('orders.supplier', 'Supplier')}</th>
              <th className="py-2 pr-2">{tt('orders.status', 'Status')}</th>
              <th className="py-2 pr-2">{tt('orders.currency', 'Currency')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
            </tr></thead>
            <tbody>
              {pos.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.noPOsYet', 'No POs yet.')}</td></tr>}
              {pos.map(po => {
                const amounts = amountPO(po)
                return (
                  <tr key={po.id} className="border-b align-top">
                    <td className="py-3 pr-2 font-medium">{poNo(po)}</td>
                    <td className="py-3 pr-2">{poSupplierLabel(po)}</td>
                    <td className="py-3 pr-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${purchaseStatusClass(po.status)}`}>
                        {String(po.status).replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3 pr-2">{curPO(po)}</td>
                    <td className="py-3 pr-2 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* View/Receive Sheet */}
      <Sheet open={poViewOpen} onOpenChange={(o) => {
        if (!o) {
          setSelectedPO(null)
          setReceivePlan({})
          setReceivedMap({})
          if (searchParams.get('orderId')) {
            const next = new URLSearchParams(searchParams)
            next.delete('orderId')
            setSearchParams(next, { replace: true })
          }
        }
        setPoViewOpen(o)
      }}>
        <SheetContent side="right" className="w-full sm:w=[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.poDetails', 'PO Details')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('orders.poDetailsDesc', 'Review and receive by line')}</SheetDescription>
          </SheetHeader>

          {!selectedPO ? (
            <div className="p-4 text-sm text-muted-foreground">{tt('orders.noPOSelected', 'No PO selected.')}</div>
          ) : (
            <div className="mt-4 space-y-4">
              {/* PO Header */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                <div><Label>{tt('orders.po', 'PO')}</Label><div>{poNo(selectedPO)}</div></div>
                <div><Label>{tt('orders.supplier', 'Supplier')}</Label><div>{poSupplierLabel(selectedPO)}</div></div>
                <div><Label>{tt('orders.status', 'Status')}</Label><div className="capitalize">{selectedPO.status}</div></div>
                <div><Label>{tt('orders.orderDate', 'Order Date')}</Label><div>{(selectedPO as any).order_date || tt('none', '(none)')}</div></div>
                <div><Label>{tt('orders.currency', 'Currency')}</Label><div>{curPO(selectedPO)}</div></div>
                <div><Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label><div>{fmtAcct(fxPO(selectedPO))}</div></div>
                <div><Label>{tt('orders.expectedDate', 'Expected Date')}</Label><div>{(selectedPO as any).expected_date || tt('none', '(none)')}</div></div>
                <div><Label>{tt('orders.dueDate', 'Due Date')}</Label><div>{(selectedPO as any).due_date || tt('none', '(none)')}</div></div>
              </div>

              <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-1 pb-4">
                  <h3 className="text-sm font-semibold">{tt('orders.documentDetails', 'Document details')}</h3>
                  <p className="text-xs text-muted-foreground">{tt('orders.purchaseDocumentDetailsHelp', 'Update supplier-facing notes and receiving sign-off details without changing quantities, costs, or receiving logic.')}</p>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <Label>{tt('orders.orderDate', 'Order Date')}</Label>
                    <Input type="date" value={selectedPoMeta.orderDate} onChange={e => setSelectedPoMeta(prev => ({ ...prev, orderDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.expectedDate', 'Expected Date')}</Label>
                    <Input type="date" value={selectedPoMeta.expectedDate} onChange={e => setSelectedPoMeta(prev => ({ ...prev, expectedDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.dueDate', 'Due Date')}</Label>
                    <Input type="date" value={selectedPoMeta.dueDate} onChange={e => setSelectedPoMeta(prev => ({ ...prev, dueDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.referenceNo', 'Reference')}</Label>
                    <Input value={selectedPoMeta.referenceNo} onChange={e => setSelectedPoMeta(prev => ({ ...prev, referenceNo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.paymentTerms', 'Payment Terms')}</Label>
                    <Input value={selectedPoMeta.paymentTerms} onChange={e => setSelectedPoMeta(prev => ({ ...prev, paymentTerms: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.deliveryTerms', 'Delivery Terms')}</Label>
                    <Input value={selectedPoMeta.deliveryTerms} onChange={e => setSelectedPoMeta(prev => ({ ...prev, deliveryTerms: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.preparedBy', 'Prepared by')}</Label>
                    <Input value={selectedPoMeta.preparedBy} onChange={e => setSelectedPoMeta(prev => ({ ...prev, preparedBy: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.approvedBy', 'Approved by')}</Label>
                    <Input value={selectedPoMeta.approvedBy} onChange={e => setSelectedPoMeta(prev => ({ ...prev, approvedBy: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.receivedBy', 'Received by')}</Label>
                    <Input value={selectedPoMeta.receivedBy} onChange={e => setSelectedPoMeta(prev => ({ ...prev, receivedBy: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.notes', 'Notes')}</Label>
                    <Textarea className="min-h-[92px]" value={selectedPoMeta.notes} onChange={e => setSelectedPoMeta(prev => ({ ...prev, notes: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.internalNotes', 'Internal Notes')}</Label>
                    <Textarea className="min-h-[92px]" value={selectedPoMeta.internalNotes} onChange={e => setSelectedPoMeta(prev => ({ ...prev, internalNotes: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3 flex justify-end">
                    <Button variant="secondary" onClick={saveSelectedPOMeta}>{tt('orders.saveDetails', 'Save details')}</Button>
                  </div>
                </div>
              </div>

              {/* Defaults row */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-end">
                <div>
                  <Label>{tt('orders.defaultWarehouse', 'Default Warehouse')}</Label>
                  <Select value={defaultReceiveWhId} onValueChange={(v) => {
                    setDefaultReceiveWhId(v)
                    const first = binsForWH(v)[0]?.id || ''
                    setDefaultReceiveBinId(first)
                  }}>
                    <SelectTrigger><SelectValue placeholder={tt('orders.selectWarehouse', 'Select warehouse')} /></SelectTrigger>
                    <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{tt('orders.defaultBin', 'Default Bin')}</Label>
                  <Select value={defaultReceiveBinId} onValueChange={setDefaultReceiveBinId}>
                    <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                    <SelectContent>
                      {binsForWH(defaultReceiveWhId).map(b => (<SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex flex-wrap gap-2 justify-end md:col-span-2 lg:col-span-1">
                  <Button variant="outline" onClick={() => printPO(selectedPO)}>{tt('orders.print', 'Print')}</Button>
                  <Button variant="secondary" onClick={applyDefaultsToAll}>{tt('orders.applyToAll', 'Apply to all lines')}</Button>
                  <Button onClick={() => doReceivePO(selectedPO)} disabled={String(selectedPO.status).toLowerCase() === 'draft'}>
                    {tt('orders.receiveAll', 'Receive')}
                  </Button>
                </div>
              </div>

              {/* Lines with per-line receive controls */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-left">
                      <th className="py-2 px-3">{tt('orders.itemOrService', 'Item / Service')}</th>
                      <th className="py-2 px-3">{tt('table.sku', 'SKU')}</th>
                      <th className="py-2 px-3">{tt('orders.ordered', 'Ordered')}</th>
                      <th className="py-2 px-3">{tt('orders.received', 'Received')}</th>
                      <th className="py-2 px-3">{tt('orders.remaining', 'Remaining')}</th>
                      <th className="py-2 px-3">{tt('orders.receiveQty', 'Receive Qty')}</th>
                      <th className="py-2 px-3">{tt('orders.toWarehouse', 'To Warehouse')}</th>
                      <th className="py-2 px-3">{tt('orders.toBin', 'To Bin')}</th>
                      <th className="py-2 px-3 text-right">{tt('orders.lineValueBase', 'Line Value (base)')}</th>
                      <th className="py-2 px-3 text-right">{tt('orders.actions', 'Actions')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {polines.filter(l => l.po_id === selectedPO.id).map(l => {
                      const it = itemById.get(l.item_id)
                      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
                      const lineId = String(l.id || '')
                      const ordered = n(l.qty)
                      const received = n(receivedMap[lineId] || 0)
                      const remaining = Math.max(0, ordered - received)
                      const key = lineId || `${l.po_id}-${l.line_no}`
                      const plan = receivePlan[key] || { qty: String(remaining), whId: defaultReceiveWhId, binId: defaultReceiveBinId }
                      const qtyPlan = clamp(n(plan.qty, 0), 0, remaining)
                      const disc = n(l.discount_pct, 0)
                      const valueBase = n(l.unit_price) * qtyPlan * (1 - disc/100) * fxPO(selectedPO)

                      return (
                        <tr key={key} className="border-t align-top">
                          <td className="py-2 px-3">
                            <div className="font-medium">{it?.name || l.item_id}</div>
                            {!!l.description && <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{l.description}</div>}
                          </td>
                          <td className="py-2 px-3">{it?.sku || '—'}</td>
                          <td className="py-2 px-3">{fmtAcct(ordered)} {uomCode}</td>
                          <td className="py-2 px-3">{fmtAcct(received)} {uomCode}</td>
                          <td className="py-2 px-3">{fmtAcct(remaining)} {uomCode}</td>

                          <td className="py-2 px-3">
                            <Input
                              inputMode="decimal"
                              type="number"
                              min="0"
                              max={remaining}
                              step="0.0001"
                              value={plan.qty}
                              onChange={(e) => {
                                const raw = Number(e.target.value)
                                const clamped = Number.isFinite(raw) ? clamp(raw, 0, remaining) : 0
                                setReceivePlan(prev => ({
                                  ...prev,
                                  [key]: { ...(prev[key] || { whId: defaultReceiveWhId, binId: defaultReceiveBinId }), qty: String(clamped) }
                                }))
                              }}
                            />
                          </td>

                          <td className="py-2 px-3">
                            <Select
                              value={plan.whId}
                              onValueChange={(wh) => setReceivePlan(prev => {
                                const firstBin = binsForWH(wh)[0]?.id || ''
                                return { ...prev, [key]: { ...(prev[key] || {}), whId: wh, binId: firstBin } }
                              })}
                            >
                              <SelectTrigger><SelectValue placeholder={tt('orders.selectWarehouse', 'Select warehouse')} /></SelectTrigger>
                              <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}</SelectContent>
                            </Select>
                          </td>

                          <td className="py-2 px-3">
                            <Select
                              value={plan.binId}
                              onValueChange={(bin) => setReceivePlan(prev => ({ ...prev, [key]: { ...(prev[key] || {}), binId: bin } }))}
                            >
                              <SelectTrigger><SelectValue placeholder={tt('orders.selectBin', 'Select bin')} /></SelectTrigger>
                              <SelectContent>
                                {binsForWH(plan.whId).map(b => (<SelectItem key={b.id} value={b.id}>{b.code} — {b.name}</SelectItem>))}
                              </SelectContent>
                            </Select>
                          </td>

                          <td className="py-2 px-3 text-right">{formatMoneyBase(valueBase, baseCode)}</td>

                          <td className="py-2 px-3 text-right">
                            <Button
                              size="sm"
                              onClick={() => receiveLine(selectedPO!, l)}
                              disabled={remaining <= 0 || String(selectedPO.status).toLowerCase() === 'draft'}
                              variant="secondary"
                              className="touch-target"
                            >
                              {tt('orders.receive', 'Receive')}
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Closed/Received POs Browser */}
      <Sheet open={browserOpen} onOpenChange={setBrowserOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl max-w-none p-0 md:p-6">
          <SheetHeader>
            <SheetTitle>{tt('orders.poBrowser', 'Closed/Received POs')}</SheetTitle>
            <SheetDescription className="sr-only">
              {tt('orders.poBrowserDesc', 'Search, filter and print purchase orders')}
            </SheetDescription>
          </SheetHeader>

          {/* Filters */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 p-4 md:p-0">
            <div>
              <Label>{tt('common.search', 'Search')}</Label>
              <Input
                placeholder={tt('orders.searchHintPO', 'PO no. or supplier')}
                value={browserQ}
                onChange={e => setBrowserQ(e.target.value)}
              />
            </div>
            <div>
              <Label>{tt('orders.from', 'From (updated)')}</Label>
              <Input type="date" value={browserFrom} onChange={e => setBrowserFrom(e.target.value)} />
            </div>
            <div>
              <Label>{tt('orders.to', 'To (updated)')}</Label>
              <Input type="date" value={browserTo} onChange={e => setBrowserTo(e.target.value)} />
            </div>
          </div>

          {/* Status checkboxes */}
          <div className="p-4 md:p-0 mt-2 flex flex-wrap gap-4 text-sm">
            <div className="text-muted-foreground">{tt('orders.statuses', 'Statuses')}:</div>
            {(['closed','partially_received'] as const).map(sname => (
              <label key={sname} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!browserStatuses[sname]}
                  onChange={(e) => setBrowserStatuses(prev => ({ ...prev, [sname]: e.target.checked }))}
                />
                <span className="capitalize">{sname.replace('_',' ')}</span>
              </label>
            ))}
          </div>

          {/* Results */}
          <div className="mt-3 border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="py-2 px-3">{tt('orders.po', 'PO')}</th>
                  <th className="py-2 px-3">{tt('orders.supplier', 'Supplier')}</th>
                  <th className="py-2 px-3">{tt('orders.status', 'Status')}</th>
                  <th className="py-2 px-3">{tt('orders.updated', 'Updated')}</th>
                  <th className="py-2 px-3">{tt('orders.total', 'Total')}</th>
                  <th className="py-2 px-3 text-right">{tt('orders.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody>
                {browserRows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-muted-foreground">{tt('orders.noResults', 'No results')}</td></tr>
                )}
                {browserRows.map(po => {
                  const amounts = amountPO(po)
                  const updated = (po.updated_at || po.created_at || '').slice(0, 19).replace('T', ' ')
                  return (
                    <tr key={po.id} className="border-t">
                      <td className="py-2 px-3">{poNo(po)}</td>
                      <td className="py-2 px-3">{poSupplierLabel(po)}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${purchaseStatusClass(po.status)}`}>
                          {String(po.status).replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2 px-3">{updated || '—'}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => printPO(po)}>
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
              {tt('orders.rows', 'Rows')}: {browserRows.length}
            </div>
            {browserHasMore && (
              <Button size="sm" variant="secondary" onClick={() => fetchBrowserPage(browserPage + 1)}>
                {tt('common.loadMore', 'Load more')}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
