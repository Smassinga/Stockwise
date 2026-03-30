// src/pages/Orders/SalesOrders.tsx
import { useEffect, useMemo, useState } from 'react'
import { db, supabase } from '../../lib/db'
import { useNavigate, useSearchParams } from 'react-router-dom'


import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
  SelectGroup, SelectLabel
} from '../../components/ui/select'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../../components/ui/sheet'
import { Textarea } from '../../components/ui/textarea'
import toast from 'react-hot-toast'
import MobileAddLineButton from '../../components/MobileAddLineButton'
import { formatMoneyBase, getBaseCurrencyCode } from '../../lib/currency'
import { addDaysIso, deriveDueDate, discountedLineTotal, salesOrderAmounts } from '../../lib/orderFinance'
import { buildConvGraph, convertQty, type ConvRow } from '../../lib/uom'
import { useI18n, withI18nFallback } from '../../lib/i18n'
import { useOrg } from '../../hooks/useOrg'
import { useAuth } from '../../hooks/useAuth'
import { useSalesOrderState } from '../../hooks/useOrderState'
import {
  legacySalesFulfilmentStatus,
  legacySalesWorkflowStatus,
  salesFulfilmentLabelKey,
  salesWorkflowLabelKey,
  settlementLabelKey,
} from '../../lib/orderState'
import { OrderAuditGrid, OrderDetailSection, OrderWorkflowStrip } from './components/OrderDetailSections'
import { createDraftSalesInvoiceFromOrder } from '../../lib/mzFinance'

// NEW: company profile helper (DB companies + storage URL)
import {
  getCompanyProfile as getCompanyProfileDB,
  companyLogoUrl,
  type CompanyProfile as DBCompanyProfile,
} from '../../lib/companyProfile'

type Item = { id: string; name: string; sku: string; baseUomId: string }
type Uom = { id: string; code: string; name: string; family?: string }
type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type PaymentTerm = { id: string; code: string; name: string; net_days: number }
type Customer = {
  id: string
  code?: string
  name: string
  email?: string | null
  phone?: string | null
  tax_id?: string | null
  billing_address?: string | null
  shipping_address?: string | null
  payment_terms_id?: string | null
  payment_terms?: string | null
}
type Warehouse = { id: string; code?: string; name: string }
type Bin = { id: string; code: string; name: string; warehouseId: string }
type StockSourceOption = {
  warehouseId: string
  warehouseName: string
  binId: string | null
  binLabel: string
  qtyBase: number
}
type IssueAllocationDraft = {
  id: string
  warehouseId: string
  binId: string
  qty: string
}

const VALID_SO_STATUSES = ['draft','submitted','confirmed','allocated','shipped','closed','cancelled'] as const
type SoStatus = typeof VALID_SO_STATUSES[number]

type SO = {
  id: string
  customer?: string
  customer_id?: string
  status: SoStatus | string
  order_date?: string | null
  currency_code?: string
  fx_to_base?: number
  expected_ship_date?: string | null
  reference_no?: string | null
  delivery_terms?: string | null
  notes?: string | null
  internal_notes?: string | null
  total_amount?: number | null
  tax_total?: number | null
  due_date?: string | null
  payment_terms_id?: string | null
  payment_terms?: string | null
  prepared_by?: string | null
  approved_by?: string | null
  confirmed_by?: string | null
  bill_to_name?: string | null
  bill_to_email?: string | null
  bill_to_phone?: string | null
  bill_to_tax_id?: string | null
  bill_to_billing_address?: string | null
  bill_to_shipping_address?: string | null
  created_by?: string | null
  public_id?: string | null

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
  description?: string | null
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
  const norm = (v: any) => {
    if (v === null || v === undefined) return undefined
    const str = String(v).trim()
    return str === '' ? undefined : str
  }
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
  if (!t) return '-'
  const parts = t.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() || '').join('') || t[0]?.toUpperCase() || '-'
}

/** Prefetch an image and convert to Data URL to avoid CORS/expiry; returns null on failure. */
async function fetchDataUrl(src?: string | null): Promise<string | null> {
  if (!src || !src.trim()) return null
  try {
    // Add a timeout to prevent hanging
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    
    const r = await fetch(src, { 
      mode: 'cors', 
      cache: 'no-store',
      signal: controller.signal
    })
    clearTimeout(timeoutId)
    
    if (!r.ok) return null
    const b = await r.blob()
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = reject
      fr.readAsDataURL(b)
    })
  } catch (error) {
    console.warn('Failed to fetch logo:', error)
    return null
  }
}

type SalesLineDraft = {
  itemId: string
  uomId: string
  description: string
  qty: string
  unitPrice: string
  discountPct: string
}

type SoMetaDraft = {
  orderDate: string
  expectedShipDate: string
  dueDate: string
  paymentTermsId: string
  paymentTerms: string
  deliveryTerms: string
  referenceNo: string
  notes: string
  internalNotes: string
  preparedBy: string
  approvedBy: string
  confirmedBy: string
  billToName: string
  billToEmail: string
  billToPhone: string
  billToTaxId: string
  billToBillingAddress: string
  billToShippingAddress: string
}

const todayYmd = () => new Date().toISOString().slice(0, 10)
const NO_ORDER_PAYMENT_TERMS = '__none__'
const NO_DEFAULT_WAREHOUSE = '__none__'
const SELECT_WAREHOUSE_VALUE = '__select_warehouse__'
const SELECT_BIN_VALUE = '__select_bin__'
const NO_BIN_VALUE = '__unbinned__'
const blankSalesLine = (): SalesLineDraft => ({ itemId: '', uomId: '', description: '', qty: '', unitPrice: '', discountPct: '0' })
const makeDraftId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`
const blankIssueAllocation = (warehouseId = ''): IssueAllocationDraft => ({
  id: makeDraftId(),
  warehouseId,
  binId: '',
  qty: '',
})
const emptySoMetaDraft = (): SoMetaDraft => ({
  orderDate: todayYmd(),
  expectedShipDate: todayYmd(),
  dueDate: todayYmd(),
  paymentTermsId: '',
  paymentTerms: '',
  deliveryTerms: '',
  referenceNo: '',
  notes: '',
  internalNotes: '',
  preparedBy: '',
  approvedBy: '',
  confirmedBy: '',
  billToName: '',
  billToEmail: '',
  billToPhone: '',
  billToTaxId: '',
  billToBillingAddress: '',
  billToShippingAddress: '',
})
const escapeHtml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
const docText = (value: unknown, fallback = '-') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text) : fallback
}
const docMultiline = (value: unknown, fallback = '-') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text).replace(/\r?\n/g, '<br/>') : fallback
}
const docDate = (value: unknown, fallback = '-') => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text.slice(0, 10)) : fallback
}
const docName = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text ? escapeHtml(text) : '&nbsp;'
}

export default function SalesOrders() {
  const { t } = useI18n()
  const { companyId } = useOrg()
  const { user } = useAuth()
  const navigate = useNavigate()
  const salesOrderState = useSalesOrderState(companyId)
  const salesStateById = salesOrderState.byId
  const [searchParams, setSearchParams] = useSearchParams()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const workflowLabel = tt('orders.workflow', 'Workflow')
  const workflowStagesLabel = tt('orders.workflowStages', 'Workflow stages')

  // masters
  const [items, setItems] = useState<Item[]>([])
  const [uoms, setUoms] = useState<Uom[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [baseCode, setBaseCode] = useState<string>('MZN')
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [bins, setBins] = useState<Bin[]>([])

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
  const [soOrderDate, setSoOrderDate] = useState<string>(() => todayYmd())
  const [soDate, setSoDate] = useState<string>(() => todayYmd())
  const [soDueDate, setSoDueDate] = useState<string>(() => todayYmd())
  const [soTaxPct, setSoTaxPct] = useState<string>('0')
  const [soPaymentTermsId, setSoPaymentTermsId] = useState('')
  const [soPaymentTerms, setSoPaymentTerms] = useState('')
  const [soDeliveryTerms, setSoDeliveryTerms] = useState('')
  const [soReferenceNo, setSoReferenceNo] = useState('')
  const [soNotes, setSoNotes] = useState('')
  const [soInternalNotes, setSoInternalNotes] = useState('')
  const [soPreparedBy, setSoPreparedBy] = useState('')
  const [soApprovedBy, setSoApprovedBy] = useState('')
  const [soConfirmedBy, setSoConfirmedBy] = useState('')
  const [soBillToName, setSoBillToName] = useState('')
  const [soBillToEmail, setSoBillToEmail] = useState('')
  const [soBillToPhone, setSoBillToPhone] = useState('')
  const [soBillToTaxId, setSoBillToTaxId] = useState('')
  const [soBillToBillingAddress, setSoBillToBillingAddress] = useState('')
  const [soBillToShippingAddress, setSoBillToShippingAddress] = useState('')
  const [soLinesForm, setSoLinesForm] = useState<SalesLineDraft[]>([blankSalesLine()])

  const paymentTermById = useMemo(() => new Map(paymentTermsList.map(pt => [pt.id, pt])), [paymentTermsList])
  const paymentTermLabel = (termId?: string | null, fallback?: string | null) => {
    const term = termId ? paymentTermById.get(termId) : undefined
    if (term) return String(term.name || term.code || '').trim()
    return String(fallback ?? '').trim()
  }
  const paymentTermOptionLabel = (term: PaymentTerm) =>
    term.net_days > 0
      ? `${term.name || term.code} (${tt('orders.netDays', '{count} days', { count: term.net_days })})`
      : (term.name || term.code)
  const matchPaymentTermId = (termId?: string | null, termText?: string | null) => {
    if (termId && paymentTermById.has(termId)) return termId
    const needle = String(termText ?? '').trim().toLowerCase()
    if (!needle) return ''
    const hit = paymentTermsList.find(term => {
      const candidates = [term.name, term.code, `${term.name} (${term.net_days})`]
      return candidates.some(candidate => String(candidate ?? '').trim().toLowerCase() === needle)
    })
    return hit?.id ?? ''
  }
  const buildTermState = (orderDate: string, termId?: string | null, fallbackText?: string | null, currentDueDate?: string | null) => {
    const nextPaymentTerms = paymentTermLabel(termId, fallbackText)
    const matchedTerm = termId ? paymentTermById.get(termId) : undefined
    const dueDate = matchedTerm && Number.isFinite(Number(matchedTerm.net_days))
      ? addDaysIso(orderDate || todayYmd(), Number(matchedTerm.net_days))
      : (deriveDueDate({
          baseDate: orderDate || todayYmd(),
          fallbackDate: currentDueDate || orderDate || todayYmd(),
          paymentTerms: nextPaymentTerms || fallbackText || '',
        }) || currentDueDate || orderDate || todayYmd())
    return {
      paymentTermsId: termId || '',
      paymentTerms: nextPaymentTerms,
      dueDate,
    }
  }

  // Auto-fetch FX rate when currency changes
  useEffect(() => {
    async function fetchFxRate() {
      if (!companyId || soCurrency === baseCode) {
        setSoFx('1')
        return
      }
      
      try {
        const { data, error } = await supabase
          .from('fx_rates')
          .select('rate')
          .eq('from_code', soCurrency)
          .eq('to_code', baseCode)
          .eq('company_id', companyId)
          .order('date', { ascending: false })
          .limit(1)
          .maybeSingle()
        
        if (error) {
          console.warn('Failed to fetch FX rate:', error)
          setSoFx('1')
          return
        }
        
        if (data) {
          setSoFx(String(data.rate))
        } else {
          setSoFx('1')
        }
      } catch (err) {
        console.warn('Error fetching FX rate:', err)
        setSoFx('1')
      }
    }
    
    fetchFxRate()
  }, [soCurrency, baseCode, companyId])

  useEffect(() => {
    if (user?.name && !soPreparedBy.trim()) setSoPreparedBy(user.name)
  }, [user?.name, soPreparedBy])

  useEffect(() => {
    const cust = customers.find(c => c.id === soCustomerId)
    if (!cust) return
    const matchedPaymentTermsId = matchPaymentTermId(cust.payment_terms_id, cust.payment_terms)
    const termState = buildTermState(soOrderDate, matchedPaymentTermsId, cust.payment_terms, soDueDate)
    setSoPaymentTermsId(termState.paymentTermsId)
    setSoPaymentTerms(termState.paymentTerms)
    setSoDueDate(termState.dueDate)
    setSoBillToName(cust.name ?? '')
    setSoBillToEmail(cust.email ?? '')
    setSoBillToPhone(cust.phone ?? '')
    setSoBillToTaxId(cust.tax_id ?? '')
    setSoBillToBillingAddress(cust.billing_address ?? '')
    setSoBillToShippingAddress(cust.shipping_address ?? '')
  }, [customers, soCustomerId, paymentTermsList])

  // view+ship
  const [soViewOpen, setSoViewOpen] = useState(false)
  const [selectedSO, setSelectedSO] = useState<SO | null>(null)
  const [selectedSoMeta, setSelectedSoMeta] = useState<SoMetaDraft>(emptySoMetaDraft())
  const [creatingInvoiceForOrderId, setCreatingInvoiceForOrderId] = useState<string | null>(null)

  // GLOBAL override/default warehouse (optional UX)
  const [shipWhId, setShipWhId] = useState<string>('')

  // Per-line issue planning across multiple bins and warehouses.
  const [allocationsByLine, setAllocationsByLine] = useState<Record<string, IssueAllocationDraft[]>>({})
  const [stockOptionsByLine, setStockOptionsByLine] = useState<Record<string, StockSourceOption[]>>({})

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
      .select('id,customer_id,customer,status,currency_code,fx_to_base,total_amount,tax_total,due_date,updated_at,created_at,order_no,bill_to_name')
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

  const soNo = (s: any) => s?.orderNo ?? s?.order_no ?? s?.public_id ?? s?.id
  const fxSO = (s: SO) => n((s as any).fx_to_base ?? (s as any).fxToBase, 1)
  const curSO = (s: SO) => (s as any).currency_code ?? (s as any).currencyCode
  const amountSO = (s: SO) => salesOrderAmounts(s, solines.filter(l => l.so_id === s.id))

  const buildSoMetaDraft = (so?: SO | null): SoMetaDraft => {
    if (!so) return emptySoMetaDraft()
    const cust = so.customer_id ? customers.find(c => c.id === so.customer_id) : undefined
    const matchedPaymentTermsId = matchPaymentTermId((so as any).payment_terms_id ?? cust?.payment_terms_id, so.payment_terms ?? cust?.payment_terms)
    return {
      orderDate: String((so as any).order_date ?? '').slice(0, 10) || todayYmd(),
      expectedShipDate: String((so as any).expected_ship_date ?? '').slice(0, 10) || '',
      dueDate: String((so as any).due_date ?? '').slice(0, 10) || '',
      paymentTermsId: matchedPaymentTermsId,
      paymentTerms: paymentTermLabel(matchedPaymentTermsId, so.payment_terms ?? cust?.payment_terms ?? ''),
      deliveryTerms: String((so as any).delivery_terms ?? ''),
      referenceNo: String((so as any).reference_no ?? ''),
      notes: String(so.notes ?? ''),
      internalNotes: String((so as any).internal_notes ?? ''),
      preparedBy: String((so as any).prepared_by ?? ''),
      approvedBy: String((so as any).approved_by ?? ''),
      confirmedBy: String((so as any).confirmed_by ?? ''),
      billToName: String(so.bill_to_name ?? cust?.name ?? so.customer ?? ''),
      billToEmail: String(so.bill_to_email ?? cust?.email ?? ''),
      billToPhone: String(so.bill_to_phone ?? cust?.phone ?? ''),
      billToTaxId: String(so.bill_to_tax_id ?? cust?.tax_id ?? ''),
      billToBillingAddress: String(so.bill_to_billing_address ?? cust?.billing_address ?? ''),
      billToShippingAddress: String(so.bill_to_shipping_address ?? cust?.shipping_address ?? ''),
    }
  }

  // Prefer bill_to_name; if we can resolve a customer row, show CODE - Name
  const soCustomerLabel = (s: SO) => {
    const cust = s.customer_id ? customers.find(c => c.id === s.customer_id) : undefined
    if (cust) return `${cust.code ? cust.code + ' - ' : ''}${cust.name}`
    return s.bill_to_name ?? s.customer ?? (s.customer_id || tt('none', '(none)'))
  }

  const remaining = (l: SOL) => Math.max(n(l.qty) - n(l.shipped_qty), 0)

  async function refreshSalesData(activeCompanyId = companyId) {
    if (!activeCompanyId) {
      setSOs([])
      setSOLines([])
      return
    }

    const [soRes, solRes] = await Promise.all([
      supabase
        .from('sales_orders')
        .select('id,customer_id,customer,status,order_date,currency_code,fx_to_base,total_amount,tax_total,due_date,payment_terms_id,payment_terms,reference_no,delivery_terms,notes,internal_notes,prepared_by,approved_by,confirmed_by,bill_to_name,bill_to_email,bill_to_phone,bill_to_tax_id,bill_to_billing_address,bill_to_shipping_address,expected_ship_date,created_by,public_id,created_at,updated_at,order_no,company_id')
        .eq('company_id', activeCompanyId),
      supabase
        .from('sales_order_lines')
        .select('id,so_id,item_id,uom_id,description,line_no,qty,unit_price,discount_pct,line_total,is_shipped,shipped_at,shipped_qty')
        .eq('company_id', activeCompanyId),
    ])

    if (soRes.error) throw soRes.error
    if (solRes.error) throw solRes.error

    const withFlags = (solRes.data || []).map((line: any) => ({
      ...line,
      is_shipped: line.is_shipped ?? false,
      shipped_at: line.shipped_at ?? null,
      shipped_qty: Number.isFinite(Number(line.shipped_qty)) ? Number(line.shipped_qty) : 0,
    })) as SOL[]

    setSOs(((soRes.data || []) as SO[]).sort((a, b) => new Date(ts(b)).getTime() - new Date(ts(a)).getTime()))
    setSOLines(withFlags)
  }

  // load masters, conversions, settings, lists, defaults, (global) branding fallbacks
  useEffect(() => {
    ;(async () => {
      try {
        const uu = await supabase.from('uoms').select('id,code,name,family').order('code', { ascending: true })
        if (uu.error) throw uu.error
        setUoms(((uu.data || []) as any[]).map(u => ({ ...u, code: String(u.code || '').toUpperCase() })))

        const { data: convRows, error: convErr } = await supabase
          .from('uom_conversions')
          .select('from_uom_id,to_uom_id,factor')
        setConvGraph(convErr ? null : buildConvGraph((convRows || []) as ConvRow[]))

        // GLOBAL fallbacks for brand (used only if company_settings doesn't provide one)
        try {
          const [brandRes, companyRes] = await Promise.all([
            supabase.from('app_settings').select('data').eq('id', 'brand').maybeSingle(),
            supabase.from('app_settings').select('data').eq('id', 'company').maybeSingle(),
          ])
          const a = {} as any
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
          .select('id,code,name,email,phone,tax_id,billing_address,shipping_address,payment_terms_id,payment_terms')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (custs.error) throw custs.error
        setCustomers((custs.data || []) as Customer[])

        const { data: paymentTermsRows, error: paymentTermsError } = await supabase
          .rpc('get_payment_terms', { p_company_id: companyId })
        if (paymentTermsError) throw paymentTermsError
        setPaymentTermsList((paymentTermsRows || []) as PaymentTerm[])

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

        await refreshSalesData(companyId)

        // 6) default WH (for the global override)
        const fromSettings = (await supabase
          .from('app_settings').select('data').eq('id', 'app').maybeSingle()
        ).data as any
        const prefId = fromSettings?.data?.sales?.defaultFulfilWarehouseId
        const preferred = (whs.data || []).find((w:any) => w.id === prefId) ?? (whs.data || [])[0]
        setShipWhId(preferred?.id || '')

        // 7) branding - companies table (preferred)
        try {
          const row = await getCompanyProfileDB(companyId)
          setCompanyProfile(mapDBProfile(row))
          const nameFromCompanies = (row?.trade_name || row?.legal_name || '').trim()
          const logoFromCompanies = companyLogoUrl(row?.logo_path || undefined)
          if (nameFromCompanies) setBrandName(nameFromCompanies)
          if (logoFromCompanies) setBrandLogoUrl(logoFromCompanies)
        } catch (profileError) {
          console.warn('company profile load failed:', profileError)
        }

        // 8) fallback to company_settings brand
        try {
          const res = await supabase
            .from('company_settings')
            .select('data')
            .eq('company_id', companyId)
            .maybeSingle()
          const doc = (res.data as any)?.data || {}
          const csLogo = (doc?.documents?.brand?.logoUrl || '').trim()
          const csName = (doc?.documents?.brand?.name || '').trim()
          if (csLogo) setBrandLogoUrl(csLogo)
          if (csName) setBrandName(csName)
        } catch (settingsError) {
          console.warn('company settings load failed:', settingsError)
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

  useEffect(() => {
    const orderId = searchParams.get('orderId')
    if (!orderId) return
    const match = sos.find(so => so.id === orderId)
    if (!match) return
    setSelectedSO(match)
    setSoViewOpen(true)
  }, [searchParams, sos])

  useEffect(() => {
    setSelectedSoMeta(buildSoMetaDraft(selectedSO))
  }, [selectedSO, customers, paymentTermsList])

  useEffect(() => {
    if (!selectedSO) return
    const fresh = sos.find((order) => order.id === selectedSO.id)
    if (fresh && fresh !== selectedSO) setSelectedSO(fresh)
  }, [selectedSO, sos])

  const encodeBinValue = (binId?: string | null) => binId ?? NO_BIN_VALUE
  const decodeBinValue = (binValue?: string | null) => {
    if (!binValue) return null
    return binValue === NO_BIN_VALUE ? null : binValue
  }
  const pickPreferredSource = (options: StockSourceOption[], preferredWarehouseId?: string) => {
    if (!options.length) return null
    return (preferredWarehouseId ? options.find((option) => option.warehouseId === preferredWarehouseId) : null) || options[0]
  }
  const buildDefaultAllocation = (line: SOL, options: StockSourceOption[]): IssueAllocationDraft => {
    const preferred = pickPreferredSource(options, shipWhId)
    if (!preferred) return blankIssueAllocation(shipWhId || warehouses[0]?.id || '')
    const item = itemById.get(line.item_id)
    const availableInLineUom =
      item?.baseUomId ? safeConvert(preferred.qtyBase, item.baseUomId, line.uom_id) : null
    const defaultQty = availableInLineUom == null
      ? remaining(line)
      : Math.min(remaining(line), Math.max(availableInLineUom, 0))
    return {
      id: makeDraftId(),
      warehouseId: preferred.warehouseId,
      binId: encodeBinValue(preferred.binId),
      qty: defaultQty > 0 ? String(Number(defaultQty.toFixed(6))) : '',
    }
  }

  useEffect(() => {
    async function run() {
      if (!soViewOpen || !selectedSO || !companyId) {
        setStockOptionsByLine({})
        setAllocationsByLine({})
        return
      }
      const lines = solines.filter((line) => line.so_id === selectedSO.id && remaining(line) > 0)
      if (lines.length === 0) {
        setStockOptionsByLine({})
        setAllocationsByLine({})
        return
      }

      const itemIds = Array.from(new Set(lines.map((line) => line.item_id)))
      const { data, error } = await supabase
        .from('stock_levels')
        .select('item_id,warehouse_id,bin_id,qty')
        .eq('company_id', companyId)
        .in('item_id', itemIds)
        .gt('qty', 0)
      if (error) {
        console.warn('stock source fetch failed', error)
        setStockOptionsByLine({})
        return
      }

      const byItem: Record<string, StockSourceOption[]> = {}
      for (const row of (data || []) as any[]) {
        const warehouseId = String(row.warehouse_id || '')
        if (!warehouseId) continue
        const warehouseName = warehouses.find((warehouse) => warehouse.id === warehouseId)?.name || warehouseId
        const binId = row.bin_id == null ? null : String(row.bin_id)
        const binName = binId
          ? (bins.find((bin) => bin.id === binId)?.code || bins.find((bin) => bin.id === binId)?.name || binId)
          : tt('orders.noBin', '(no bin)')
        ;(byItem[String(row.item_id)] ||= []).push({
          warehouseId,
          warehouseName,
          binId,
          binLabel: binName,
          qtyBase: Number(row.qty) || 0,
        })
      }

      const nextOptions: Record<string, StockSourceOption[]> = {}
      for (const line of lines) {
        nextOptions[String(line.id)] = [...(byItem[line.item_id] || [])].sort((left, right) => {
          if (right.qtyBase !== left.qtyBase) return right.qtyBase - left.qtyBase
          if (left.warehouseName !== right.warehouseName) return left.warehouseName.localeCompare(right.warehouseName)
          return left.binLabel.localeCompare(right.binLabel)
        })
      }
      setStockOptionsByLine(nextOptions)
      setAllocationsByLine((current) => {
        const next: Record<string, IssueAllocationDraft[]> = {}
        for (const line of lines) {
          const key = String(line.id)
          const options = nextOptions[key] || []
          const rows = (current[key] || [])
            .filter((row) => !row.warehouseId || options.some((option) => option.warehouseId === row.warehouseId))
            .map((row) => {
              if (!row.warehouseId) return row
              const matchingOptions = options.filter((option) => option.warehouseId === row.warehouseId)
              if (!matchingOptions.length) return row
              if (!row.binId || !matchingOptions.some((option) => encodeBinValue(option.binId) === row.binId)) {
                return { ...row, binId: encodeBinValue(matchingOptions[0].binId) }
              }
              return row
            })
          next[key] = rows.length ? rows : [buildDefaultAllocation(line, options)]
        }
        return next
      })
    }
    run()
  }, [bins, companyId, itemById, selectedSO, shipWhId, soViewOpen, solines, warehouses])

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

  const updateAllocationRow = (lineKey: string, rowId: string, patch: Partial<IssueAllocationDraft>) => {
    setAllocationsByLine((current) => ({
      ...current,
      [lineKey]: (current[lineKey] || []).map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }))
  }

  const addAllocationRow = (line: SOL) => {
    const lineKey = String(line.id)
    const preferred = pickPreferredSource(stockOptionsByLine[lineKey] || [], shipWhId)
    setAllocationsByLine((current) => ({
      ...current,
      [lineKey]: [
        ...(current[lineKey] || []),
        {
          id: makeDraftId(),
          warehouseId: preferred?.warehouseId || shipWhId || '',
          binId: preferred ? encodeBinValue(preferred.binId) : '',
          qty: '',
        },
      ],
    }))
  }

  const removeAllocationRow = (line: SOL, rowId: string) => {
    const lineKey = String(line.id)
    setAllocationsByLine((current) => {
      const remainingRows = (current[lineKey] || []).filter((row) => row.id !== rowId)
      return {
        ...current,
        [lineKey]: remainingRows.length ? remainingRows : [buildDefaultAllocation(line, stockOptionsByLine[lineKey] || [])],
      }
    })
  }

  const buildIssuePlan = (line: SOL, rows: IssueAllocationDraft[], options: StockSourceOption[]) => {
    const item = itemById.get(line.item_id)
    const outstandingQty = remaining(line)
    const outstandingQtyBase = item?.baseUomId ? safeConvert(outstandingQty, line.uom_id, item.baseUomId) : null
    const optionMap = new Map(
      options.map((option) => [`${option.warehouseId}::${encodeBinValue(option.binId)}`, option])
    )
    const errors: string[] = []
    const preparedRows: Array<IssueAllocationDraft & { qtyNumber: number; qtyBase: number }> = []
    const sourceUsage = new Map<string, number>()
    let totalQty = 0
    let totalQtyBase = 0

    if (!item) {
      errors.push(tt('orders.itemMissingForIssue', 'Item setup is incomplete for this line.'))
      return { item, outstandingQty, outstandingQtyBase, totalQty, totalQtyBase, remainingQty: outstandingQty, errors, rows: preparedRows }
    }

    for (const row of rows) {
      const qtyNumber = n(row.qty, 0)
      if (qtyNumber <= 0) continue
      if (!row.warehouseId) {
        errors.push(tt('orders.selectSourceWh', 'Select source warehouse'))
        continue
      }
      if (!row.binId) {
        errors.push(tt('orders.selectSourceBin', 'Pick a From Bin for this line'))
        continue
      }
      const qtyBase = safeConvert(qtyNumber, line.uom_id, item.baseUomId)
      if (qtyBase == null) {
        const fromCode = uomById.get(uomIdFromIdOrCode(line.uom_id))?.code || line.uom_id
        errors.push(
          tt('orders.noConversion', 'No conversion from {from} to base for {sku}')
            .replace('{from}', String(fromCode))
            .replace('{sku}', String(item.sku))
        )
        continue
      }
      totalQty += qtyNumber
      totalQtyBase += qtyBase
      preparedRows.push({ ...row, qtyNumber, qtyBase })
      const sourceKey = `${row.warehouseId}::${row.binId}`
      sourceUsage.set(sourceKey, (sourceUsage.get(sourceKey) || 0) + qtyBase)
    }

    if (!preparedRows.length) {
      errors.push(tt('orders.issueQtyRequired', 'Enter at least one quantity to issue.'))
    }
    if (totalQty > outstandingQty + 0.000001) {
      errors.push(
        tt('orders.overAllocateIssue', 'Allocated quantity exceeds the remaining quantity to issue.')
      )
    }
    for (const [sourceKey, usedQtyBase] of sourceUsage.entries()) {
      const option = optionMap.get(sourceKey)
      if (!option) {
        errors.push(tt('orders.sourceUnavailable', 'One of the selected stock sources is no longer available.'))
        continue
      }
      if (usedQtyBase > option.qtyBase + 0.000001) {
        errors.push(
          tt('orders.overAllocateBin', 'Allocated quantity exceeds what is available in the selected bin.')
        )
      }
    }

    return {
      item,
      outstandingQty,
      outstandingQtyBase,
      totalQty,
      totalQtyBase,
      remainingQty: Math.max(outstandingQty - totalQty, 0),
      availableQtyBase: options.reduce((sum, option) => sum + option.qtyBase, 0),
      errors,
      rows: preparedRows,
    }
  }

  // actions
  async function tryUpdateStatus(id: string, candidates: SoStatus[]) {
    for (const status of candidates) {
      if (!VALID_SO_STATUSES.includes(status)) continue
      let query = supabase.from('sales_orders').update({ status }).eq('id', id)
      if (companyId) query = query.eq('company_id', companyId)
      const { error } = await query
      if (!error) return status
      if (!String(error?.message || '').toLowerCase().includes('violates')) console.warn('Status update error:', error)
    }
    return null
  }

  async function createSO() {
    try {
      if (!companyId) return toast.error(tt('org.noCompany', 'Join or create a company first'))
      if (!soCustomerId) return toast.error(tt('orders.customerRequired', 'Customer is required'))
      const cleanLines = soLinesForm
        .map(l => ({ ...l, qty: n(l.qty), unitPrice: n(l.unitPrice), discountPct: n(l.discountPct), description: (l.description || '').trim() } ))
        .filter(l => l.itemId && l.uomId && l.qty > 0 && l.unitPrice >= 0 && l.discountPct >= 0 && l.discountPct <= 100)

      if (!cleanLines.length) return toast.error(tt('orders.addOneLine', 'Add at least one valid line'))

      const allowed = currencies.map(c => c.code)
      const chosenCurrency = allowed.length === 0 ? baseCode : (allowed.includes(soCurrency) ? soCurrency : allowed[0])

      const fx = n(soFx, 1)
      const cust = customers.find(c => c.id === soCustomerId)
      const matchedPaymentTermsId = soPaymentTermsId || matchPaymentTermId(cust?.payment_terms_id, cust?.payment_terms)
      const resolvedPaymentTerms = paymentTermLabel(matchedPaymentTermsId, soPaymentTerms || cust?.payment_terms || '')
      const headerSubtotal = cleanLines.reduce((sum, line) => sum + discountedLineTotal(line.qty, line.unitPrice, line.discountPct), 0)

      const inserted: any = await supabase
        .from('sales_orders')
        .insert({
          company_id: companyId,
          created_by: user?.id || null,
          customer_id: soCustomerId,
          status: 'draft',
          order_date: soOrderDate || null,
          currency_code: chosenCurrency,
          fx_to_base: fx,
          expected_ship_date: soDate || null,
          due_date: soDueDate || null,
          notes: soNotes.trim() || null,
          internal_notes: soInternalNotes.trim() || null,
          payment_terms_id: matchedPaymentTermsId || null,
          payment_terms: resolvedPaymentTerms || null,
          delivery_terms: soDeliveryTerms.trim() || null,
          reference_no: soReferenceNo.trim() || null,
          prepared_by: (soPreparedBy.trim() || user?.name || '') || null,
          approved_by: soApprovedBy.trim() || null,
          confirmed_by: soConfirmedBy.trim() || null,
          bill_to_name: soBillToName.trim() || cust?.name || null,
          bill_to_email: soBillToEmail.trim() || cust?.email || null,
          bill_to_phone: soBillToPhone.trim() || cust?.phone || null,
          bill_to_tax_id: soBillToTaxId.trim() || cust?.tax_id || null,
          bill_to_billing_address: soBillToBillingAddress.trim() || cust?.billing_address || null,
          bill_to_shipping_address: soBillToShippingAddress.trim() || cust?.shipping_address || null,
          total_amount: headerSubtotal,
          tax_total: headerSubtotal * n(soTaxPct, 0) / 100,
        })
        .select('id')
        .single()
      if (inserted.error) throw inserted.error
      const soId = inserted.data.id

      for (let i = 0; i < cleanLines.length; i++) {
        const l = cleanLines[i]; const lineNo = i + 1
        const lineTotal = discountedLineTotal(l.qty, l.unitPrice, l.discountPct)
        await db.salesOrderLines.create({
          company_id: companyId,
          so_id: soId,
          item_id: l.itemId,
          uom_id: l.uomId,
          description: l.description || null,
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
      setSoOrderDate(() => todayYmd())
      setSoDate(() => todayYmd())
      setSoDueDate(() => todayYmd())
      setSoPaymentTermsId('')
      setSoPaymentTerms('')
      setSoDeliveryTerms('')
      setSoReferenceNo('')
      setSoNotes('')
      setSoInternalNotes('')
      setSoPreparedBy(user?.name || '')
      setSoApprovedBy('')
      setSoConfirmedBy('')
      setSoBillToName('')
      setSoBillToEmail('')
      setSoBillToPhone('')
      setSoBillToTaxId('')
      setSoBillToBillingAddress('')
      setSoBillToShippingAddress('')
      setSoLinesForm([blankSalesLine()])
      setSoOpen(false)

      await refreshSalesData(companyId)
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soCreateFailed', 'Failed to create SO'))
    }
  }

  async function confirmSO(soId: string) {
    try {
      const lines = solines.filter(l => l.so_id === soId)
      const subtotal = lines.reduce((s, l) => s + n(l.line_total), 0)

      const updated = await tryUpdateStatus(soId, ['submitted'])
      const confirmPatch: any = { total_amount: subtotal }
      if (user?.name) confirmPatch.confirmed_by = user.name
      let query = supabase.from('sales_orders').update(confirmPatch).eq('id', soId)
      if (companyId) query = query.eq('company_id', companyId)
      const { error } = await query
      if (error) throw error

      setSOs((prev) =>
        prev.map((order) =>
          order.id === soId
            ? { ...order, status: updated || order.status, total_amount: subtotal, confirmed_by: user?.name || order.confirmed_by }
            : order
        )
      )
      setSelectedSO((prev) =>
        prev?.id === soId
          ? { ...prev, status: updated || prev.status, total_amount: subtotal, confirmed_by: user?.name || prev.confirmed_by }
          : prev
      )
      setSelectedSoMeta((prev) => ({ ...prev, confirmedBy: user?.name || prev.confirmedBy }))
      toast.success(tt('orders.soConfirmed', 'SO confirmed'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soConfirmFailed', 'Failed to confirm SO'))
    }
  }

  async function approveSO(soId: string) {
    try {
      const updated = await tryUpdateStatus(soId, ['confirmed'])
      const approvePatch: any = {}
      if (user?.name) approvePatch.approved_by = user.name
      let query = supabase.from('sales_orders').update(approvePatch).eq('id', soId)
      if (companyId) query = query.eq('company_id', companyId)
      const { error } = await query
      if (error) throw error

      setSOs((prev) =>
        prev.map((order) =>
          order.id === soId
            ? { ...order, status: updated || order.status, approved_by: user?.name || order.approved_by }
            : order
        )
      )
      setSelectedSO((prev) =>
        prev?.id === soId
          ? { ...prev, status: updated || prev.status, approved_by: user?.name || prev.approved_by }
          : prev
      )
      setSelectedSoMeta((prev) => ({ ...prev, approvedBy: user?.name || prev.approvedBy }))
      toast.success(tt('orders.soApproved', 'SO approved'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.soApproveFailed', 'Failed to approve SO'))
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

  async function saveSelectedSOMeta() {
    if (!selectedSO || !companyId) return
    try {
      const patch: Partial<SO> & Record<string, any> = {
        order_date: selectedSoMeta.orderDate || null,
        expected_ship_date: selectedSoMeta.expectedShipDate || null,
        due_date: selectedSoMeta.dueDate || null,
        payment_terms_id: selectedSoMeta.paymentTermsId || null,
        payment_terms: selectedSoMeta.paymentTerms.trim() || null,
        delivery_terms: selectedSoMeta.deliveryTerms.trim() || null,
        reference_no: selectedSoMeta.referenceNo.trim() || null,
        notes: selectedSoMeta.notes.trim() || null,
        internal_notes: selectedSoMeta.internalNotes.trim() || null,
        approved_by: selectedSoMeta.approvedBy.trim() || null,
        confirmed_by: selectedSoMeta.confirmedBy.trim() || null,
        bill_to_name: selectedSoMeta.billToName.trim() || null,
        bill_to_email: selectedSoMeta.billToEmail.trim() || null,
        bill_to_phone: selectedSoMeta.billToPhone.trim() || null,
        bill_to_tax_id: selectedSoMeta.billToTaxId.trim() || null,
        bill_to_billing_address: selectedSoMeta.billToBillingAddress.trim() || null,
        bill_to_shipping_address: selectedSoMeta.billToShippingAddress.trim() || null,
      }
      const { error } = await supabase.from('sales_orders').update(patch).eq('id', selectedSO.id).eq('company_id', companyId)
      if (error) throw error
      const merged = { ...selectedSO, ...patch } as SO
      setSelectedSO(merged)
      setSOs(prev => prev.map(so => so.id === merged.id ? merged : so))
      toast.success(tt('orders.detailsSaved', 'Order details saved'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.detailsSaveFailed', 'Failed to save order details'))
    }
  }

  async function doShipLineSO(so: SO, line: SOL, options?: { silent?: boolean; refresh?: boolean }) {
    try {
      const lineKey = String(line.id)
      const plan = buildIssuePlan(line, allocationsByLine[lineKey] || [], stockOptionsByLine[lineKey] || [])
      if (plan.outstandingQty <= 0) {
        if (!options?.silent) toast.success(tt('orders.lineAlreadyShipped', 'Line already shipped'))
        return true
      }
      if (plan.errors.length) {
        throw new Error(plan.errors[0])
      }
      if (!plan.item) {
        throw new Error(tt('orders.itemMissingForIssue', 'Item setup is incomplete for this line.'))
      }

      const sourceChecks = new Map<string, { onHand: number; avgCost: number }>()
      for (const row of plan.rows) {
        const binDbId = decodeBinValue(row.binId)
        const key = `${row.warehouseId}::${row.binId}`
        if (!sourceChecks.has(key)) {
          const snapshot = await avgCostAt(row.warehouseId, binDbId, plan.item.id)
          sourceChecks.set(key, snapshot)
        }
      }

      const dbUsageBySource = new Map<string, number>()
      for (const row of plan.rows) {
        const key = `${row.warehouseId}::${row.binId}`
        dbUsageBySource.set(key, (dbUsageBySource.get(key) || 0) + row.qtyBase)
      }
      for (const [key, qtyBase] of dbUsageBySource.entries()) {
        const snapshot = sourceChecks.get(key)
        if (!snapshot || snapshot.onHand < qtyBase - 0.000001) {
          throw new Error(
            tt('orders.overAllocateBin', 'Allocated quantity exceeds what is available in the selected bin.')
          )
        }
      }

      for (const row of plan.rows) {
        const binDbId = decodeBinValue(row.binId)
        const key = `${row.warehouseId}::${row.binId}`
        const snapshot = sourceChecks.get(key)
        const avgCost = snapshot?.avgCost ?? 0
        const movementInsert = await supabase.from('stock_movements').insert({
          type: 'issue',
          item_id: plan.item.id,
          uom_id: uomIdFromIdOrCode(line.uom_id) || line.uom_id,
          qty: row.qtyNumber,
          qty_base: row.qtyBase,
          unit_cost: avgCost,
          total_value: avgCost * row.qtyBase,
          warehouse_from_id: row.warehouseId,
          bin_from_id: binDbId,
          notes: `SO ${soNo(so)}`,
          created_by: user?.name || 'system',
          ref_type: 'SO',
          ref_id: (so as any).id,
          ref_line_id: line.id ?? null,
        } as any).select('id').single()
        if (movementInsert.error) throw movementInsert.error
      }

      if (options?.refresh !== false) {
        await refreshSalesData(companyId)
      }
      if (!options?.silent) toast.success(tt('orders.lineShipped', 'Line shipped'))
      return true
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipLineFailed', 'Failed to ship line'))
      return false
    }
  }

  // Ship all lines that currently have a valid allocation plan.
  async function doShipSO(so: SO) {
    try {
      const lines = solines.filter((line) => line.so_id === so.id && remaining(line) > 0)
      if (!lines.length) return toast.error(tt('orders.noLinesToShip', 'No lines to ship'))

      const plannedLines = lines.filter((line) => {
        const plan = buildIssuePlan(line, allocationsByLine[String(line.id)] || [], stockOptionsByLine[String(line.id)] || [])
        return plan.rows.length > 0
      })
      if (!plannedLines.length) {
        return toast.error(tt('orders.issueQtyRequired', 'Enter at least one quantity to issue.'))
      }

      for (const line of plannedLines) {
        // eslint-disable-next-line no-await-in-loop
        const shipped = await doShipLineSO(so, line, { silent: true, refresh: false })
        if (!shipped) {
          await refreshSalesData(companyId)
          return
        }
      }
      await refreshSalesData(companyId)
      toast.success(tt('orders.issueBatchPosted', 'Allocated issue quantities posted'))
    } catch (err: any) {
      console.error(err)
      toast.error(err?.message || tt('orders.shipSoFailed', 'Failed to ship SO'))
    }
  }

  // computed
  const soOutstanding = useMemo(
    () => sos.filter((so) => {
      const state = salesStateById.get(so.id)
      if (state) return state.workflow_status !== 'cancelled' && state.fulfilment_status !== 'complete'
      return ['draft', 'submitted', 'confirmed', 'allocated'].includes(String(so.status).toLowerCase())
    }),
    [salesStateById, sos]
  )
  const soSubtotal = soLinesForm.reduce((s, r) => s + n(r.qty) * n(r.unitPrice) * (1 - n(r.discountPct,0)/100), 0)
  const soTax = soSubtotal * (n(soTaxPct, 0) / 100)
  const openSalesBase = useMemo(() => soOutstanding.reduce((sum, so) => sum + amountSO(so).totalBase, 0), [soOutstanding, solines])
  const draftSalesCount = useMemo(
    () => soOutstanding.filter((so) => (salesStateById.get(so.id)?.workflow_status ?? legacySalesWorkflowStatus(so.status)) === 'draft').length,
    [salesStateById, soOutstanding],
  )
  const submittedSalesCount = useMemo(
    () => soOutstanding.filter((so) => (salesStateById.get(so.id)?.workflow_status ?? legacySalesWorkflowStatus(so.status)) === 'awaiting_approval').length,
    [salesStateById, soOutstanding],
  )
  const confirmedSalesCount = useMemo(
    () => soOutstanding.filter((so) => (salesStateById.get(so.id)?.workflow_status ?? legacySalesWorkflowStatus(so.status)) === 'approved').length,
    [salesStateById, soOutstanding],
  )
  const selectedSOLines = useMemo(
    () => (selectedSO ? solines.filter((line) => line.so_id === selectedSO.id) : []),
    [selectedSO, solines]
  )
  const selectedSOOpenLines = useMemo(
    () => selectedSOLines.filter((line) => remaining(line) > 0),
    [selectedSOLines]
  )
  const selectedSORemainingQty = useMemo(
    () => selectedSOOpenLines.reduce((sum, line) => sum + remaining(line), 0),
    [selectedSOOpenLines]
  )

  function salesStatusClass(status?: string) {
    const value = legacySalesWorkflowStatus(status)
    if (value === 'draft') return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200'
    if (value === 'awaiting_approval') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    if (value === 'approved') return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
    if (value === 'cancelled') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
  }

  function salesStatusLabel(status?: string) {
    const value = legacySalesWorkflowStatus(status)
    if (value === 'draft') return tt(salesWorkflowLabelKey(value), 'Draft')
    if (value === 'awaiting_approval') return tt(salesWorkflowLabelKey(value), 'Awaiting approval')
    if (value === 'approved') return tt(salesWorkflowLabelKey(value), 'Approved')
    if (value === 'cancelled') return tt(salesWorkflowLabelKey(value), 'Cancelled')
    return tt('orders.status.unknown', 'Unknown')
  }

  function salesState(so?: SO | null) {
    return so ? salesStateById.get(so.id) : undefined
  }

  function salesFulfilmentLabel(so?: SO | null) {
    const value = salesState(so)?.fulfilment_status ?? legacySalesFulfilmentStatus(so?.status)
    if (value === 'not_started') return tt(salesFulfilmentLabelKey(value), 'Not started')
    if (value === 'partial') return tt(salesFulfilmentLabelKey(value), 'Partially fulfilled')
    return tt(salesFulfilmentLabelKey('complete'), 'Fully fulfilled')
  }

  function salesFulfilmentClass(so?: SO | null) {
    const value = salesState(so)?.fulfilment_status ?? legacySalesFulfilmentStatus(so?.status)
    if (value === 'complete') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    if (value === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    return 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-500/30 dark:bg-slate-500/10 dark:text-slate-200'
  }

  function salesSettlementLabel(so?: SO | null) {
    const value = salesState(so)?.settlement_status
    if (value === 'unsettled') return tt(settlementLabelKey(value), 'Unsettled')
    if (value === 'partially_settled') return tt(settlementLabelKey(value), 'Partially settled')
    if (value === 'settled') return tt(settlementLabelKey(value), 'Settled')
    if (value === 'overdue') return tt(settlementLabelKey(value), 'Overdue')
    return tt('orders.status.unknown', 'Unknown')
  }

  function salesSettlementClass(so?: SO | null) {
    const value = salesState(so)?.settlement_status
    if (value === 'settled') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300'
    if (value === 'overdue') return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300'
    if (value === 'partially_settled') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300'
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300'
  }

  const canIssueFromStatus = (status?: string) =>
    ['confirmed', 'allocated'].includes(String(status || '').toLowerCase())

  const canCreateFiscalInvoice = (status?: string) =>
    ['confirmed', 'allocated', 'shipped', 'closed'].includes(String(status || '').toLowerCase())

  async function openOrCreateFiscalInvoice(so: SO) {
    if (!companyId) {
      toast.error(tt('org.noCompany', 'Join or create a company first'))
      return
    }

    try {
      setCreatingInvoiceForOrderId(so.id)
      const result = await createDraftSalesInvoiceFromOrder(companyId, so.id)
      toast.success(
        result.existed
          ? tt('financeDocs.mz.invoiceOpened', 'Opened the existing fiscal invoice')
          : tt('financeDocs.mz.invoiceDraftCreated', 'Created a fiscal invoice draft from the sales order'),
      )
      navigate(`/sales-invoices/${result.invoiceId}`)
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('financeDocs.mz.invoiceDraftCreateFailed', 'Failed to create the fiscal invoice draft'))
    } finally {
      setCreatingInvoiceForOrderId(null)
    }
  }

  function salesWorkflowSummary(status?: string) {
    const value = String(status || '').toLowerCase()
    if (value === 'draft') {
      return {
        stage: tt('orders.workflowDraftStage', 'Draft ready for review'),
        help: tt('orders.workflowDraftHelp', 'Check terms, dates, and customer details before confirming the order.'),
        action: tt('orders.confirm', 'Confirm'),
      }
    }
    if (value === 'submitted') {
      return {
        stage: tt('orders.workflowConfirmedStage', 'Confirmed and waiting approval'),
        help: tt('orders.workflowConfirmedHelp', 'Approval signs off the commercial commitment before stock is issued.'),
        action: tt('orders.approve', 'Approve'),
      }
    }
    if (value === 'confirmed' || value === 'allocated') {
      return {
        stage: tt('orders.workflowReadyToIssue', 'Approved and ready for fulfilment'),
        help: tt('orders.workflowReadyToIssueHelp', 'Allocate stock by warehouse and bin, then post the issue quantities that are ready.'),
        action: tt('orders.shipAllocatedLines', 'Issue allocated lines'),
      }
    }
    if (value === 'shipped') {
      return {
        stage: tt('orders.workflowShippedStage', 'Shipped and ready for closure review'),
        help: tt('orders.workflowShippedHelp', 'Use the shipped browser or print view for handoff and final document review.'),
        action: tt('orders.print', 'Print'),
      }
    }
    if (value === 'closed') {
      return {
        stage: tt('orders.workflowClosedStage', 'Closed and fully documented'),
        help: tt('orders.workflowClosedHelp', 'This order is complete. Use the detail, print, and audit sections for traceability.'),
        action: tt('orders.view', 'View'),
      }
    }
    if (value === 'cancelled') {
      return {
        stage: tt('orders.workflowCancelledStage', 'Cancelled'),
        help: tt('orders.workflowCancelledHelp', 'No further operational action is expected on this order.'),
        action: tt('orders.view', 'View'),
      }
    }
    return {
      stage: salesStatusLabel(status),
      help: tt('orders.workflowGenericHelp', 'Review the order details and continue with the next operational step.'),
      action: tt('orders.view', 'View'),
    }
  }

  // ---- Print: uses companies profile (preferred), then company_settings brand as fallback
  async function printSO(so: SO, download = false) {
    const currency = curSO(so) || '-'
    const fx = fxSO(so) || 1
    const lines = solines.filter(l => l.so_id === so.id)

    const rows = lines.map(l => {
      const it = itemById.get(l.item_id)
      const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
      const disc = n(l.discount_pct, 0)
      const lineTotal = discountedLineTotal(n(l.qty), n(l.unit_price), disc)
      const shippedBadge = (n(l.shipped_qty) >= n(l.qty)) || l.is_shipped
        ? ' <span class="pill pill-ok">shipped</span>' : ''
      const detail = (l.description || '').trim()
      return `<tr>
        <td><div class="item-name">${docText(it?.name || l.item_id)}${shippedBadge}</div>${detail ? `<div class="item-detail">${docMultiline(detail, '')}</div>` : ''}</td>
        <td>${docText(it?.sku || '', '')}</td>
        <td class="right">${fmtAcct(n(l.qty))}</td>
        <td>${docText(uomCode)}</td>
        <td class="right">${fmtAcct(n(l.unit_price))}</td>
        <td class="right">${fmtAcct(disc)}</td>
        <td class="right">${fmtAcct(lineTotal)}</td>
      </tr>`
    }).join('')

    const amounts = amountSO(so)
    const subtotal = amounts.subtotal
    const tax = amounts.tax
    const total = amounts.total
    const number = soNo(so)
    const printedAt = new Date().toLocaleString()

    // Customer block (prefers bill_to_* then customer row)
    const custRow = so.customer_id ? customers.find(c => c.id === so.customer_id) : undefined
    const cust = {
      code: custRow?.code || '',
      name: so.bill_to_name ?? custRow?.name ?? so.customer ?? '-',
      email: so.bill_to_email ?? custRow?.email ?? '-',
      phone: so.bill_to_phone ?? custRow?.phone ?? '-',
      tax_id: so.bill_to_tax_id ?? custRow?.tax_id ?? '-',
      bill_to: (so.bill_to_billing_address ?? custRow?.billing_address ?? '')?.trim() || '-',
      ship_to: (so.bill_to_shipping_address ?? custRow?.shipping_address ?? '')?.trim() || '-',
      terms: so.payment_terms ?? custRow?.payment_terms ?? '-',
    }
    ;(cust as any).referenceNo = (so as any).reference_no ?? ''
    ;(cust as any).deliveryTerms = (so as any).delivery_terms ?? ''
    ;(cust as any).preparedBy = (so as any).prepared_by ?? ''
    ;(cust as any).approvedBy = (so as any).approved_by ?? ''
    ;(cust as any).confirmedBy = (so as any).confirmed_by ?? ''
    ;(cust as any).notes = so.notes ?? ''
    ;(cust as any).terms = paymentTermLabel((so as any).payment_terms_id ?? custRow?.payment_terms_id, (cust as any).terms) || (cust as any).terms
    const hasNotes = Boolean(String((cust as any).notes ?? '').trim())

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
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body{
        -webkit-print-color-adjust: exact; print-color-adjust: exact;
        margin: 0; padding: 0; color: #0f172a;
        font: 11.5px/1.35 ui-sans-serif, system-ui, Segoe UI, Roboto, Helvetica, Arial;
      }
      .wrap { padding: 0; }
      .header {
        display: flex; align-items: center; justify-content: space-between; gap: 12px;
        padding-bottom: 10px; margin-bottom: 12px; border-bottom: 1px solid #e5e7eb;
      }
      .brand { display: flex; align-items: center; gap: 10px; min-height: 38px; }
      .logo {
        height: 46px; width: auto; border: 1px solid #e5e7eb; border-radius: 8px;
        background: #f8fafc; padding: 3px;
      }
      .logo-fallback {
        height: 46px; width: 44px; border: 1px solid #e5e7eb; border-radius: 8px;
        display: flex; align-items: center; justify-content: center; font-weight: 700; background: #eef2ff;
      }
      .company-name { font-size: 22px; font-weight: 700; letter-spacing: .01em; }
      .doc-meta { text-align: right; }
      .doc-title { font-size: 26px; font-weight: 800; letter-spacing: .01em; margin: 0; }
      .muted { color: #64748b; }
      .cap { text-transform: capitalize; }

      .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 8px; }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; background: #fff; }
      .card h4 { margin: 0 0 4px; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
      .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
      .kv .k { color: #64748b; }
      .addr { white-space: pre-wrap; }
      .section { margin-top: 10px; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
      .section-head { padding: 8px 10px; background: #eff6ff; color: #1d4ed8; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
      .section-body { padding: 10px; }
      .item-name { font-weight: 600; }
      .item-detail { margin-top: 3px; color: #64748b; font-size: 10px; line-height: 1.3; white-space: pre-wrap; }

      table { width: 100%; border-collapse: collapse; margin-top: 4px; font-size: 11px; }
      th, td { border-bottom: 1px solid #eef2f7; padding: 6px 5px; text-align: left; }
      thead th { background: #f8fafc; font-weight: 700; }
      .right { text-align: right; }
      .pill {
        display: inline-block; padding: 0 6px; border-radius: 999px; font-size: 10px; line-height: 18px; vertical-align: middle;
        border: 1px solid #e5e7eb; color: #334155; background: #f1f5f9; margin-left: 6px;
      }
      .pill-ok { border-color: #86efac; background: #ecfdf5; color: #166534; }

      .totals {
        margin-top: 10px; width: 320px; margin-left: auto;
        display: grid; grid-template-columns: 1fr auto; row-gap: 4px;
      }
      .totals .label { color: #475569; }
      .totals .grand { font-weight: 800; }
      .totals .muted { color: #64748b; }
      .terms-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .terms-grid.single { grid-template-columns: 1fr; }
      .terms-box { border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px; background: #fff; min-height: 68px; }
      .terms-box h4 { margin: 0 0 6px; font-size: 10px; color: #475569; text-transform: uppercase; letter-spacing: .06em; }
      .closing { page-break-inside: avoid; }
      .signatures { margin-top: 10px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; page-break-inside: avoid; }
      .sig { padding-top: 20px; }
      .sig-line { border-top: 1px solid #94a3b8; height: 1px; }
      .sig-label { margin-top: 6px; color: #475569; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
      .sig-name { margin-top: 4px; min-height: 14px; font-size: 11px; font-weight: 600; }

      .footnote {
        margin-top: 10px; padding-top: 6px; border-top: 1px dashed #e5e7eb;
        color: #475569; font-size: 10px;
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

    const companyCard = `
      <div class="card">
        <h4>${tt('orders.companyDetails', 'Company Details')}</h4>
        <div class="kv">
          <div class="k">${tt('orders.tradeName', 'Trade name')}</div><div><b>${cp.tradeName || companyName || '-'}</b></div>
          <div class="k">${tt('orders.legalName', 'Legal name')}</div><div>${cp.legalName || '-'}</div>
          <div class="k">${tt('orders.taxId', 'Tax ID')}</div><div>${cp.taxId || '-'}</div>
          <div class="k">${tt('orders.registrationNo', 'Registration No.')}</div><div>${cp.regNo || '-'}</div>
          <div class="k">${tt('orders.phone', 'Phone')}</div><div>${cp.phone || '-'}</div>
          <div class="k">${tt('orders.email', 'Email')}</div><div>${cp.email || '-'}</div>
          <div class="k">${tt('orders.website', 'Website')}</div><div>${cp.website || '-'}</div>
          <div class="k">${tt('orders.address', 'Address')}</div><div class="addr">${addrLines || '-'}</div>
        </div>
        ${cp.printFooterNote ? `<div class="footnote">${cp.printFooterNote}</div>` : ''}
      </div>
    `

    const orderCard = `
      <div class="card">
        <h4>${tt('orders.order', 'Order')}</h4>
        <div class="kv">
          <div class="k">${tt('orders.workflow', 'Workflow')}</div><div><b class="cap">${salesStatusLabel(so.status)}</b></div>
          <div class="k">${tt('orders.currency', 'Currency')}</div><div><b>${currency}</b></div>
          <div class="k">${tt('orders.fxToBaseShort', 'FX -> {baseCode}', { baseCode })}</div><div><b>${fmtAcct(fx)}</b></div>
          <div class="k">${tt('orders.expectedShip', 'Expected Ship')}</div><div><b>${(so as any).expected_ship_date || '-'}</b></div>
        </div>
      </div>
    `

    const customerCard = `
      <div class="card" style="margin-top:8px">
        <h4>${tt('orders.customer', 'Customer')}</h4>
        <div><b>${cust.code ? cust.code + ' - ' : ''}${cust.name}</b></div>
        <div class="muted">${tt('orders.email', 'Email')}: ${cust.email} | ${tt('orders.phone', 'Phone')}: ${cust.phone} | ${tt('orders.taxId', 'Tax ID')}: ${cust.tax_id}</div>
        <div class="kv" style="margin-top:6px">
          <div class="k">${tt('orders.billTo', 'Bill To')}</div><div class="addr">${cust.bill_to}</div>
          <div class="k">${tt('orders.shipOrServiceLocation', 'Shipping / Service Location')}</div><div class="addr">${cust.ship_to}</div>
          <div class="k">${tt('orders.terms', 'Terms')}</div><div>${cust.terms}</div>
        </div>
      </div>
    `

    const html = `
      <div class="wrap">
        <div class="header">
          <div class="brand">
            ${headerBrand}
            <div class="company-name">${companyName || '-'}</div>
          </div>
          <div class="doc-meta">
            <h1 class="doc-title">${tt('orders.salesOrder', 'Sales Order')} ${number}</h1>
            <div class="muted">${tt('orders.printed', 'Printed')}: <b>${printedAt}</b></div>
          </div>
        </div>

        <div class="grid2">
          ${orderCard}
          ${companyCard}
        </div>

        ${customerCard}

        <div class="section">
          <div class="section-head">${tt('orders.commercialTerms', 'Commercial terms')}</div>
          <div class="section-body">
            <div class="terms-grid ${hasNotes ? '' : 'single'}">
              <div class="terms-box">
                <h4>${tt('orders.commercialTerms', 'Commercial terms')}</h4>
                <div class="kv">
                  <div class="k">${tt('orders.orderDate', 'Order Date')}</div><div>${docDate((so as any).order_date)}</div>
                  <div class="k">${tt('orders.dueDate', 'Due Date')}</div><div>${docDate((so as any).due_date)}</div>
                  <div class="k">${tt('orders.referenceNo', 'Reference')}</div><div>${docText((cust as any).referenceNo)}</div>
                  <div class="k">${tt('orders.paymentTerms', 'Payment Terms')}</div><div>${docText(cust.terms)}</div>
                  <div class="k">${tt('orders.deliveryTerms', 'Delivery Terms')}</div><div>${docText((cust as any).deliveryTerms)}</div>
                </div>
              </div>
              ${hasNotes ? `<div class="terms-box">
                <h4>${tt('orders.notes', 'Notes')}</h4>
                <div>${docMultiline((cust as any).notes)}</div>
              </div>` : ''}
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

        <div class="closing">
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
              <div class="sig-name">${docName((cust as any).preparedBy)}</div>
            </div>
            <div class="sig">
              <div class="sig-line"></div>
              <div class="sig-label">${tt('orders.confirmedBy', 'Confirmed by')}</div>
              <div class="sig-name">${docName((cust as any).confirmedBy)}</div>
            </div>
            <div class="sig">
              <div class="sig-line"></div>
              <div class="sig-label">${tt('orders.approvedBy', 'Approved by')}</div>
              <div class="sig-name">${docName((cust as any).approvedBy)}</div>
            </div>
          </div>
        </div>
      </div>
    `


    if (download) {
      // Add PDF-specific print styles
      const pdfCss = `${css}
        @media print {
          @page { size: A4; margin: 12mm; }
          body { margin: 0; padding: 0; }
          .wrap { padding: 0; }
        }
      `;
      
      // Create a Blob with the HTML content
      const blob = new Blob([`<html><head><title>SO ${number}</title><meta charset="utf-8"/><style>${pdfCss}</style></head><body>${html}</body></html>`], { type: 'text/html' })
      
      // Create a download link
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `SO-${number}.html`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return
    }

    const w = window.open('', '_blank'); if (!w) return
    w.document.write(`<html><head><title>SO ${number}</title><meta charset="utf-8"/><style>${css}</style></head><body>${html}</body></html>`)
    w.document.close()

    try { await (w as any).document?.fonts?.ready } catch {}
    const img = w.document.querySelector('img.logo') as HTMLImageElement | null
    if (img && 'decode' in img) { try { await (img as any).decode() } catch {} }
    setTimeout(() => { 
      try {
        w.focus(); 
        w.print()
      } catch (printError) {
        console.warn('Print failed:', printError)
        // Fallback: show a message to the user
        w.alert('Unable to print automatically. Please use your browser\'s print function (Ctrl+P or Cmd+P).')
      }
    }, 50)
  }

  return (
    <div className="mobile-container w-full max-w-full space-y-6 overflow-x-hidden">
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.openSales', 'Sales orders in workflow')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{soOutstanding.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('orders.openSalesHelp', 'Draft, confirmed, approved, and allocated orders still need operational attention.')}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.openSalesValue', 'Sales workflow value')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold tracking-tight">{formatMoneyBase(openSalesBase, baseCode)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('orders.openSalesValueHelp', 'Gross value of sales orders still moving through review, approval, allocation, or shipment.')}</p>
          </CardContent>
        </Card>
        <Card className="border-border/80 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('orders.salesReadiness', 'Order readiness')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <div className="text-sm font-medium">{tt('orders.confirmedReady', '{count} approved or allocated', { count: confirmedSalesCount })}</div>
            <p className="text-xs text-muted-foreground">{tt('orders.salesApprovalPending', '{count} confirmed orders are waiting for approval and {drafts} drafts still need review.', { count: submittedSalesCount, drafts: draftSalesCount })}</p>
          </CardContent>
        </Card>
      </div>

      {/* Outstanding + Create SO */}
      <Card className="border-dashed">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{tt('orders.outstandingSOs', 'Sales orders awaiting fulfilment')}</CardTitle>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setShippedOpen(true)}>
                {tt('orders.shippedBrowserCta', 'Completed workflow')}
              </Button>

              <Sheet open={soOpen} onOpenChange={setSoOpen}>
                <SheetTrigger asChild>
                  <Button size="sm">{tt('orders.newSO', 'New SO')}</Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
                  <SheetHeader className="px-4 pt-4 md:px-0 md:pt-0">
                    <SheetTitle>{tt('orders.newSO', 'New Sales Order')}</SheetTitle>
                    <SheetDescription className="sr-only">{tt('orders.createSO', 'Create a sales order')}</SheetDescription>
                  </SheetHeader>
                  <SheetBody className="px-4 pb-6 md:px-0">

                  {/* Header */}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                    <div>
                      <Label>{tt('orders.customer', 'Customer')}</Label>
                      <Select value={soCustomerId} onValueChange={setSoCustomerId}>
                        <SelectTrigger><SelectValue placeholder={tt('orders.selectCustomer', 'Select customer')} /></SelectTrigger>
                        <SelectContent className="max-h-64 overflow-auto">
                          {customers.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {(c.code ? c.code + ' - ' : '') + c.name}
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
                    <div>
                      <Label>{tt('orders.dueDate', 'Due Date')}</Label>
                      <Input type="date" value={soDueDate} onChange={e => setSoDueDate(e.target.value)} />
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
                    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                      <div className="flex flex-col gap-1 pb-3">
                        <h3 className="text-sm font-semibold">{tt('orders.documentSetup', 'Document setup')}</h3>
                        <p className="text-xs text-muted-foreground">{tt('orders.salesSetupHelp', 'Capture the commercial details first, then add goods or service lines below.')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label>{tt('orders.orderDate', 'Order Date')}</Label>
                          <Input
                            type="date"
                            value={soOrderDate}
                            onChange={e => {
                              const nextOrderDate = e.target.value
                              setSoOrderDate(nextOrderDate)
                              if (soPaymentTermsId || soPaymentTerms.trim()) {
                                setSoDueDate(buildTermState(nextOrderDate, soPaymentTermsId, soPaymentTerms, soDueDate).dueDate)
                              }
                            }}
                          />
                        </div>
                        <div>
                          <Label>{tt('orders.referenceNo', 'Reference')}</Label>
                          <Input value={soReferenceNo} onChange={e => setSoReferenceNo(e.target.value)} placeholder={tt('orders.referencePlaceholder', 'Customer PO, job, or contract reference')} />
                        </div>
                        <div>
                          <Label>{tt('orders.paymentTerms', 'Payment Terms')}</Label>
                          <Select
                            value={soPaymentTermsId || NO_ORDER_PAYMENT_TERMS}
                            onValueChange={(value) => {
                              const nextTermId = value === NO_ORDER_PAYMENT_TERMS ? '' : value
                              const termState = buildTermState(soOrderDate, nextTermId, '', soDueDate)
                              setSoPaymentTermsId(termState.paymentTermsId)
                              setSoPaymentTerms(termState.paymentTerms)
                              setSoDueDate(termState.dueDate)
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder={tt('orders.selectPaymentTerms', 'Select payment terms')} /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_ORDER_PAYMENT_TERMS}>{tt('orders.noPaymentTerms', 'No payment terms')}</SelectItem>
                              {paymentTermsList.map(term => (
                                <SelectItem key={term.id} value={term.id}>{paymentTermOptionLabel(term)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {!paymentTermsList.length
                              ? tt('orders.paymentTermsEmptyHelp', 'This company has no reusable payment terms yet. You can keep the field blank for now.')
                              : soPaymentTermsId
                              ? tt('orders.paymentTermsHelpSales', 'Defaults from the selected customer and can still be changed here.')
                              : soPaymentTerms.trim()
                                ? tt('orders.paymentTermsLegacyHelp', 'Current saved terms: {terms}. Choose a standard term to replace it.', { terms: soPaymentTerms })
                                : tt('orders.paymentTermsHelpSales', 'Defaults from the selected customer and can still be changed here.')}
                          </p>
                        </div>
                        <div>
                          <Label>{tt('orders.deliveryTerms', 'Delivery Terms')}</Label>
                          <Input value={soDeliveryTerms} onChange={e => setSoDeliveryTerms(e.target.value)} placeholder={tt('orders.deliveryTermsPlaceholder', 'Delivery, collection, on-site, remote service, etc.')} />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                      <div className="flex flex-col gap-1 pb-3">
                        <h3 className="text-sm font-semibold">{tt('orders.counterpartyAndResponsibilities', 'Counterparty and responsibilities')}</h3>
                        <p className="text-xs text-muted-foreground">{tt('orders.salesCounterpartyHelp', 'Keep billing, service location, and sign-off names on the order so the document stays usable for stock and service work.')}</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <div>
                          <Label>{tt('orders.preparedBy', 'Prepared by')}</Label>
                          <Input value={soPreparedBy || user?.name || ''} readOnly className="bg-muted/40" />
                          <p className="mt-1 text-xs text-muted-foreground">{tt('orders.preparedByAutoHelp', 'Auto-filled from the user who creates the order.')}</p>
                        </div>
                        <div>
                          <Label>{tt('orders.confirmedBy', 'Confirmed by')}</Label>
                          <Input value={soConfirmedBy || ''} readOnly className="bg-muted/40" placeholder={tt('orders.capturedOnConfirm', 'Captured when the order is confirmed')} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>{tt('orders.approvedBy', 'Approved by')}</Label>
                          <Input value={soApprovedBy || ''} readOnly className="bg-muted/40" placeholder={tt('orders.capturedOnApprove', 'Captured when the order is approved')} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                    <div className="flex flex-col gap-1 pb-3">
                      <h3 className="text-sm font-semibold">{tt('orders.counterpartyDetails', 'Customer and location details')}</h3>
                      <p className="text-xs text-muted-foreground">{tt('orders.counterpartyDetailsHelp', 'These details appear on the document and work for billing, delivery, and service-location scenarios.')}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <Label>{tt('orders.billToName', 'Bill-to Name')}</Label>
                        <Input value={soBillToName} onChange={e => setSoBillToName(e.target.value)} />
                      </div>
                      <div>
                        <Label>{tt('orders.taxId', 'Tax ID')}</Label>
                        <Input value={soBillToTaxId} onChange={e => setSoBillToTaxId(e.target.value)} />
                      </div>
                      <div>
                        <Label>{tt('orders.email', 'Email')}</Label>
                        <Input value={soBillToEmail} onChange={e => setSoBillToEmail(e.target.value)} />
                      </div>
                      <div>
                        <Label>{tt('orders.phone', 'Phone')}</Label>
                        <Input value={soBillToPhone} onChange={e => setSoBillToPhone(e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{tt('orders.billingAddress', 'Billing Address')}</Label>
                        <Textarea className="min-h-[86px]" value={soBillToBillingAddress} onChange={e => setSoBillToBillingAddress(e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{tt('orders.shipOrServiceLocation', 'Shipping / Service Location')}</Label>
                        <Textarea className="min-h-[86px]" value={soBillToShippingAddress} onChange={e => setSoBillToShippingAddress(e.target.value)} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{tt('orders.notes', 'Notes')}</Label>
                        <Textarea className="min-h-[92px]" value={soNotes} onChange={e => setSoNotes(e.target.value)} placeholder={tt('orders.notesPlaceholder', 'Visible on the customer-facing document. Use this for scope, delivery notes, or service details.')} />
                      </div>
                      <div className="md:col-span-2">
                        <Label>{tt('orders.internalNotes', 'Internal Notes')}</Label>
                        <Textarea className="min-h-[92px]" value={soInternalNotes} onChange={e => setSoInternalNotes(e.target.value)} placeholder={tt('orders.internalNotesPlaceholder', 'Internal remarks for operations or finance. This stays off the printed document.')} />
                      </div>
                    </div>
                  </div>

                  {/* Lines */}
                  <div className="mt-6">
                    <div className="flex flex-col gap-1">
                      <Label>{tt('orders.lines', 'Lines')}</Label>
                      <p className="text-xs text-muted-foreground">{tt('orders.linesHelp', 'Use the description field for service scope, project detail, or product specifics. Quantity and UoM still support stock and non-stock work.')}</p>
                    </div>
                    <div className="mt-2 border rounded-lg overflow-x-auto">
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
                          {soLinesForm.map((ln, idx) => {
                            const it = itemById.get(ln.itemId)
                            const baseUomId = it?.baseUomId || ''
                            const baseUomCode =
                              it?.baseUomId ? (uomById.get(uomIdFromIdOrCode(it.baseUomId))?.code || 'BASE') : 'BASE'
                            const qtyPreviewBase = it ? safeConvert(n(ln.qty), ln.uomId || baseUomId, baseUomId) : null
                            const previewInvalid = it ? (qtyPreviewBase == null && n(ln.qty) > 0) : false

                            const lineTotal = n(ln.qty) * n(ln.unitPrice) * (1 - n(ln.discountPct,0)/100)

                            return (
                              <tr key={idx} className="border-t align-top">
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
                                  <Textarea
                                    className="mt-2 min-h-[74px]"
                                    value={ln.description}
                                    onChange={e => setSoLinesForm(prev => prev.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                                    placeholder={tt('orders.lineDescriptionPlaceholder', 'Optional line description for service scope, specifications, or deliverables')}
                                  />
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
                                        : `-> ${fmtAcct(qtyPreviewBase)} ${baseUomCode}`}
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
                                  <Button size="icon" variant="ghost" onClick={() => setSoLinesForm(prev => prev.filter((_, i) => i !== idx))}>X</Button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="p-2">
                        <MobileAddLineButton
                          onAdd={() => setSoLinesForm(prev => [...prev, blankSalesLine()])}
                          label={tt('orders.addLine', 'Add Line')}
                        />
                      </div>
                    </div>

                    {/* Totals */}
                    <div className="sticky bottom-0 bg-background/95 backdrop-blur border-t mt-4">
                      <div className="p-4 grid grid-cols-1 gap-3 items-center">
                        <div className="flex flex-wrap items-center gap-3">
                          <Label className="whitespace-nowrap">{tt('orders.taxPct', 'Tax %')}</Label>
                          <Input className="w-28" type="number" min="0" step="0.01" value={soTaxPct} onChange={e => setSoTaxPct(e.target.value)} />
                        </div>
                        <div className="flex flex-col items-end text-sm">
                          <div className="w-full grid grid-cols-2 gap-1">
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
                  </SheetBody>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </CardHeader>

        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{workflowLabel}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
              <th className="py-2 pr-2">{tt('orders.actions', 'Actions')}</th>
            </tr></thead>
            <tbody>
              {soOutstanding.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.nothingPending', 'Nothing pending.')}</td></tr>}
              {soOutstanding.map(so => {
                const amounts = amountSO(so)
                return (
                  <tr key={so.id} className="border-b align-top">
                    <td className="py-3 pr-2 font-medium">{soNo(so)}</td>
                    <td className="py-3 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-3 pr-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${salesStatusClass(so.status)}`}>
                        {salesStatusLabel(so.status)}
                      </span>
                    </td>
                    <td className="py-3 pr-2 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                    <td className="py-3 pr-2">
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => { setSelectedSO(so); setSoViewOpen(true) }}>{tt('orders.view', 'View')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printSO(so)}>{tt('orders.print', 'Print')}</Button>
                        <Button size="sm" variant="outline" onClick={() => printSO(so, true)}>{tt('orders.download', 'Download')}</Button>
                        {String(so.status).toLowerCase() === 'draft' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => confirmSO(so.id)}>{tt('orders.confirm', 'Confirm')}</Button>
                            <Button size="sm" variant="destructive" onClick={() => cancelSO(so.id)}>{tt('orders.cancel', 'Cancel')}</Button>
                          </>
                        )}
                        {String(so.status).toLowerCase() === 'submitted' && (
                          <>
                            <Button size="sm" variant="outline" onClick={() => approveSO(so.id)}>{tt('orders.approve', 'Approve')}</Button>
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
        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b">
              <th className="py-2 pr-2">{tt('orders.so', 'SO')}</th>
              <th className="py-2 pr-2">{tt('orders.customer', 'Customer')}</th>
              <th className="py-2 pr-2">{workflowLabel}</th>
              <th className="py-2 pr-2">{tt('orders.currency', 'Currency')}</th>
              <th className="py-2 pr-2">{tt('orders.total', 'Total')}</th>
            </tr></thead>
            <tbody>
              {sos.length === 0 && <tr><td colSpan={5} className="py-4 text-muted-foreground">{tt('orders.noSOsYet', 'No SOs yet.')}</td></tr>}
              {sos.map(so => {
                const amounts = amountSO(so)
                return (
                  <tr key={so.id} className="border-b align-top">
                    <td className="py-3 pr-2 font-medium">{soNo(so)}</td>
                    <td className="py-3 pr-2">{soCustomerLabel(so)}</td>
                    <td className="py-3 pr-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${salesStatusClass(so.status)}`}>
                        {salesStatusLabel(so.status)}
                      </span>
                    </td>
                    <td className="py-3 pr-2">{curSO(so)}</td>
                    <td className="py-3 pr-2 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* SO View / Ship */}
      <Sheet open={soViewOpen} onOpenChange={(o) => {
        if (!o) {
          setSelectedSO(null)
          setAllocationsByLine({})
          setStockOptionsByLine({})
          if (searchParams.get('orderId')) {
            const next = new URLSearchParams(searchParams)
            next.delete('orderId')
            setSearchParams(next, { replace: true })
          }
        }
        setSoViewOpen(o)
      }}>
        <SheetContent side="right" className="w-full sm:w-[calc(100vw-16rem)] sm:max-w-none max-w-none p-0 md:p-6">
          <SheetHeader className="px-4 pt-4 md:px-0 md:pt-0">
            <SheetTitle>{tt('orders.soDetails', 'SO Details')}</SheetTitle>
            <SheetDescription className="sr-only">{tt('orders.soDetailsDesc', 'Review, pick source warehouse/bin per line, and ship')}</SheetDescription>
          </SheetHeader>
          <SheetBody className="px-4 pb-6 md:px-0">

          {!selectedSO ? (
            <div className="p-4 text-sm text-muted-foreground">{tt('orders.noSOSelected', 'No SO selected.')}</div>
          ) : (
            <div className="mt-4 space-y-5">
              <div className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-6">
                <div><Label>{tt('orders.so', 'SO')}</Label><div>{soNo(selectedSO)}</div></div>
                <div><Label>{tt('orders.customer', 'Customer')}</Label><div>{soCustomerLabel(selectedSO)}</div></div>
                <div>
                  <Label>{workflowLabel}</Label>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${salesStatusClass(selectedSO.status)}`}>
                      {salesStatusLabel(selectedSO.status)}
                    </span>
                  </div>
                </div>
                <div>
                  <Label>{tt('orders.fulfilmentStatus', 'Fulfilment')}</Label>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${salesFulfilmentClass(selectedSO)}`}>
                      {salesFulfilmentLabel(selectedSO)}
                    </span>
                  </div>
                </div>
                <div>
                  <Label>{tt('orders.legacyBalanceStatus', 'Legacy balance')}</Label>
                  <div>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${salesSettlementClass(selectedSO)}`}>
                      {salesSettlementLabel(selectedSO)}
                    </span>
                  </div>
                </div>
                <div><Label>{tt('orders.legacyOutstanding', 'Legacy outstanding')}</Label><div>{formatMoneyBase(n(salesState(selectedSO)?.legacy_outstanding_base), baseCode)}</div></div>
                <div><Label>{tt('orders.currency', 'Currency')}</Label><div>{curSO(selectedSO)}</div></div>
                <div><Label>{tt('orders.orderDate', 'Order Date')}</Label><div>{(selectedSO as any).order_date || tt('none', '(none)')}</div></div>
                <div><Label>{tt('orders.fxToBaseShort', 'FX to Base')}</Label><div>{fmtAcct(fxSO(selectedSO))}</div></div>
                <div><Label>{tt('orders.expectedShip', 'Expected Ship')}</Label><div>{(selectedSO as any).expected_ship_date || tt('none', '(none)')}</div></div>
                <div><Label>{tt('orders.dueDate', 'Due Date')}</Label><div>{(selectedSO as any).due_date || tt('none', '(none)')}</div></div>
              </div>
              </div>

              <OrderWorkflowStrip
                eyebrow={tt('orders.nextAction', 'Next action')}
                title={salesWorkflowSummary(selectedSO.status).stage}
                description={salesWorkflowSummary(selectedSO.status).help}
                actions={
                  <>
                    <Button variant="outline" onClick={() => printSO(selectedSO)}>{tt('orders.print', 'Print')}</Button>
                    <Button variant="outline" onClick={() => printSO(selectedSO, true)}>{tt('orders.download', 'Download')}</Button>
                    {String(selectedSO.status).toLowerCase() === 'draft' && (
                      <Button variant="outline" onClick={() => confirmSO(selectedSO.id)}>
                        {tt('orders.confirm', 'Confirm')}
                      </Button>
                    )}
                    {String(selectedSO.status).toLowerCase() === 'submitted' && (
                      <Button variant="outline" onClick={() => approveSO(selectedSO.id)}>
                        {tt('orders.approve', 'Approve')}
                      </Button>
                    )}
                    {canIssueFromStatus(selectedSO.status) && (
                      <Button onClick={() => doShipSO(selectedSO)}>
                        {tt('orders.shipAllocatedLines', 'Issue allocated lines')}
                      </Button>
                    )}
                    {canCreateFiscalInvoice(selectedSO.status) && (
                      <Button
                        variant="secondary"
                        disabled={creatingInvoiceForOrderId === selectedSO.id}
                        onClick={() => void openOrCreateFiscalInvoice(selectedSO)}
                      >
                        {creatingInvoiceForOrderId === selectedSO.id
                          ? tt('financeDocs.mz.invoiceDraftCreating', 'Preparing invoice...')
                          : tt('financeDocs.mz.openFiscalInvoice', 'Open fiscal invoice')}
                      </Button>
                    )}
                  </>
                }
                stats={[
                  {
                    label: tt('orders.orderLines', 'Order lines'),
                    value: selectedSOLines.length,
                    hint: tt('orders.orderLinesHelp', 'Includes product and service lines captured on the document.'),
                  },
                  {
                    label: tt('orders.fulfilmentOpenLines', 'Lines still open'),
                    value: selectedSOOpenLines.length,
                    hint: tt('orders.fulfilmentOpenLinesHelp', 'These lines still need stock issue or service completion before the order is fully shipped.'),
                  },
                  {
                    label: tt('orders.remainingQty', 'Remaining quantity'),
                    value: fmtAcct(selectedSORemainingQty),
                    hint: tt('orders.remainingQtyHelp', 'Use the allocation section below to split the remaining issue quantity across source bins.'),
                  },
                ]}
              />

              <OrderDetailSection
                title={tt('orders.documentDetails', 'Document details')}
                description={tt('orders.documentDetailsHelp', 'Update commercial terms, customer-facing notes, and document sign-off names without touching line totals or fulfilment logic.')}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <div>
                    <Label>{tt('orders.orderDate', 'Order Date')}</Label>
                    <Input
                      type="date"
                      value={selectedSoMeta.orderDate}
                      onChange={e => setSelectedSoMeta(prev => ({
                        ...prev,
                        orderDate: e.target.value,
                        dueDate: prev.paymentTermsId || prev.paymentTerms.trim()
                          ? buildTermState(e.target.value, prev.paymentTermsId, prev.paymentTerms, prev.dueDate).dueDate
                          : prev.dueDate,
                      }))}
                    />
                  </div>
                  <div>
                    <Label>{tt('orders.expectedShip', 'Expected Ship')}</Label>
                    <Input type="date" value={selectedSoMeta.expectedShipDate} onChange={e => setSelectedSoMeta(prev => ({ ...prev, expectedShipDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.dueDate', 'Due Date')}</Label>
                    <Input type="date" value={selectedSoMeta.dueDate} onChange={e => setSelectedSoMeta(prev => ({ ...prev, dueDate: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.referenceNo', 'Reference')}</Label>
                    <Input value={selectedSoMeta.referenceNo} onChange={e => setSelectedSoMeta(prev => ({ ...prev, referenceNo: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.paymentTerms', 'Payment Terms')}</Label>
                    <Select
                      value={selectedSoMeta.paymentTermsId || NO_ORDER_PAYMENT_TERMS}
                      onValueChange={(value) => setSelectedSoMeta(prev => {
                        const nextTermId = value === NO_ORDER_PAYMENT_TERMS ? '' : value
                        const termState = buildTermState(prev.orderDate, nextTermId, '', prev.dueDate)
                        return { ...prev, paymentTermsId: termState.paymentTermsId, paymentTerms: termState.paymentTerms, dueDate: termState.dueDate }
                      })}
                    >
                      <SelectTrigger><SelectValue placeholder={tt('orders.selectPaymentTerms', 'Select payment terms')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ORDER_PAYMENT_TERMS}>{tt('orders.noPaymentTerms', 'No payment terms')}</SelectItem>
                        {paymentTermsList.map(term => (
                          <SelectItem key={term.id} value={term.id}>{paymentTermOptionLabel(term)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {!paymentTermsList.length
                        ? tt('orders.paymentTermsEmptyHelp', 'This company has no reusable payment terms yet. You can keep the field blank for now.')
                        : selectedSoMeta.paymentTermsId
                        ? tt('orders.paymentTermsHelpSales', 'Defaults from the selected customer and can still be changed here.')
                        : selectedSoMeta.paymentTerms.trim()
                          ? tt('orders.paymentTermsLegacyHelp', 'Current saved terms: {terms}. Choose a standard term to replace it.', { terms: selectedSoMeta.paymentTerms })
                          : tt('orders.paymentTermsHelpSales', 'Defaults from the selected customer and can still be changed here.')}
                    </p>
                  </div>
                  <div>
                    <Label>{tt('orders.deliveryTerms', 'Delivery Terms')}</Label>
                    <Input value={selectedSoMeta.deliveryTerms} onChange={e => setSelectedSoMeta(prev => ({ ...prev, deliveryTerms: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.preparedBy', 'Prepared by')}</Label>
                    <Input value={selectedSoMeta.preparedBy || tt('orders.notAvailableShort', 'Not captured')} readOnly className="bg-muted/40" />
                    <p className="mt-1 text-xs text-muted-foreground">{tt('orders.preparedByAutoHelp', 'Auto-filled from the user who creates the order.')}</p>
                  </div>
                  <div>
                    <Label>{tt('orders.confirmedBy', 'Confirmed by')}</Label>
                    <Input value={selectedSoMeta.confirmedBy || tt('orders.notAvailableShort', 'Not captured')} readOnly className="bg-muted/40" />
                  </div>
                  <div>
                    <Label>{tt('orders.approvedBy', 'Approved by')}</Label>
                    <Input value={selectedSoMeta.approvedBy || tt('orders.notAvailableShort', 'Not captured')} readOnly className="bg-muted/40" />
                  </div>
                  <div>
                    <Label>{tt('orders.billToName', 'Bill-to Name')}</Label>
                    <Input value={selectedSoMeta.billToName} onChange={e => setSelectedSoMeta(prev => ({ ...prev, billToName: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.email', 'Email')}</Label>
                    <Input value={selectedSoMeta.billToEmail} onChange={e => setSelectedSoMeta(prev => ({ ...prev, billToEmail: e.target.value }))} />
                  </div>
                  <div>
                    <Label>{tt('orders.phone', 'Phone')}</Label>
                    <Input value={selectedSoMeta.billToPhone} onChange={e => setSelectedSoMeta(prev => ({ ...prev, billToPhone: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.billingAddress', 'Billing Address')}</Label>
                    <Textarea className="min-h-[86px]" value={selectedSoMeta.billToBillingAddress} onChange={e => setSelectedSoMeta(prev => ({ ...prev, billToBillingAddress: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.shipOrServiceLocation', 'Shipping / Service Location')}</Label>
                    <Textarea className="min-h-[86px]" value={selectedSoMeta.billToShippingAddress} onChange={e => setSelectedSoMeta(prev => ({ ...prev, billToShippingAddress: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.notes', 'Notes')}</Label>
                    <Textarea className="min-h-[92px]" value={selectedSoMeta.notes} onChange={e => setSelectedSoMeta(prev => ({ ...prev, notes: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3">
                    <Label>{tt('orders.internalNotes', 'Internal Notes')}</Label>
                    <Textarea className="min-h-[92px]" value={selectedSoMeta.internalNotes} onChange={e => setSelectedSoMeta(prev => ({ ...prev, internalNotes: e.target.value }))} />
                  </div>
                  <div className="md:col-span-2 xl:col-span-3 flex justify-end">
                    <Button variant="secondary" onClick={saveSelectedSOMeta}>{tt('orders.saveDetails', 'Save details')}</Button>
                  </div>
                </div>
              </OrderDetailSection>
              <OrderDetailSection
                title={tt('orders.lineSummary', 'Line summary')}
                description={tt('orders.lineSummaryHelp', 'Review the commercial scope first, then move to fulfilment for any remaining quantity that still needs to be issued.')}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/40">
                      <tr className="text-left">
                        <th className="px-3 py-2">{tt('orders.itemOrService', 'Item / Service')}</th>
                        <th className="px-3 py-2">{tt('orders.qty', 'Qty')}</th>
                        <th className="px-3 py-2">{tt('orders.shipped', 'Shipped')}</th>
                        <th className="px-3 py-2">{tt('orders.remaining', 'Remaining')}</th>
                        <th className="px-3 py-2 text-right">{tt('orders.lineTotal', 'Line Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedSOLines.map((line) => {
                        const item = itemById.get(line.item_id)
                        const uomCode = uomById.get(uomIdFromIdOrCode(line.uom_id))?.code || line.uom_id
                        const shippedQty = n(line.shipped_qty)
                        return (
                          <tr key={String(line.id || `${line.so_id}-${line.line_no}`)} className="border-t align-top">
                            <td className="px-3 py-3">
                              <div className="font-medium">{item?.name || line.item_id}</div>
                              {!!line.description && <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{line.description}</div>}
                            </td>
                            <td className="px-3 py-3">{fmtAcct(n(line.qty))} {uomCode}</td>
                            <td className="px-3 py-3">{fmtAcct(shippedQty)} {uomCode}</td>
                            <td className="px-3 py-3">{fmtAcct(remaining(line))} {uomCode}</td>
                            <td className="px-3 py-3 text-right font-mono tabular-nums">{fmtAcct(n(line.line_total))}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </OrderDetailSection>

              <OrderDetailSection
                title={tt('orders.defaultIssueWarehouse', 'Default warehouse for new allocations')}
                description={tt('orders.fulfilmentPanelHelp', 'Fulfilment stays separate from commercial edits: choose a default warehouse for new allocation rows, then post issue quantities line by line or in one batch.')}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                <div>
                  <Label>{tt('orders.defaultIssueWarehouse', 'Default warehouse for new allocations')}</Label>
                  <Select
                    value={shipWhId || NO_DEFAULT_WAREHOUSE}
                    onValueChange={(v) => {
                      const nextWarehouseId = v === NO_DEFAULT_WAREHOUSE ? '' : v
                      setShipWhId(nextWarehouseId)
                    }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_DEFAULT_WAREHOUSE}>{tt('orders.noDefaultWarehouse', 'No default warehouse')}</SelectItem>
                      {warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tt('orders.defaultIssueWarehouseHelp', 'New allocation rows start from this warehouse, but each row can still be changed before posting.')}
                  </p>
                </div>
                <div className="md:col-span-2 lg:col-span-2">
                  <div className="rounded-lg border border-dashed border-border/70 bg-muted/20 p-3 text-sm text-muted-foreground">
                    {tt('orders.fulfilmentPanelHelp', 'Fulfilment stays separate from commercial edits: choose a default warehouse for new allocation rows, then post issue quantities line by line or in one batch.')}
                  </div>
                </div>
              </div>
              </OrderDetailSection>

              <OrderDetailSection
                title={tt('orders.issueAllocations', 'Issue allocations')}
                description={tt('orders.issueAllocationHelp', 'Split each issue across the warehouse bins that actually hold stock. Quantities are validated against live on-hand balances before posting.')}
              >

                {!canIssueFromStatus(selectedSO.status) && (
                  <div className='mb-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'>
                    {String(selectedSO.status).toLowerCase() === 'draft'
                      ? tt('orders.confirmBeforeIssue', 'Confirm the sales order before issuing stock.')
                      : tt('orders.approveBeforeIssueSales', 'Approve the sales order before issuing stock.')}
                  </div>
                )}

                <div className='space-y-4'>
                  {selectedSOOpenLines.map(l => {
                    const it = itemById.get(l.item_id)
                    const baseU = it?.baseUomId || ''
                    const outstanding = remaining(l)
                    const outstandingBase = it ? safeConvert(outstanding, l.uom_id, baseU) : null
                    const uomCode = uomById.get(uomIdFromIdOrCode(l.uom_id))?.code || l.uom_id
                    const baseUomCode =
                      it?.baseUomId ? (uomById.get(uomIdFromIdOrCode(it.baseUomId))?.code || 'BASE') : 'BASE'
                    const disc = n(l.discount_pct, 0)
                    const key = String(l.id)
                    const options = stockOptionsByLine[key] || []
                    const rows = allocationsByLine[key] || [buildDefaultAllocation(l, options)]
                    const plan = buildIssuePlan(l, rows, options)
                    const availableInLineUom =
                      it?.baseUomId ? safeConvert(plan.availableQtyBase || 0, it.baseUomId, l.uom_id) : null

                    return (
                      <div key={key} className='rounded-xl border border-border/70 bg-background/70 p-4'>
                        <div className='flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between'>
                          <div className='space-y-1'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <h4 className='text-sm font-semibold'>{it?.name || l.item_id}</h4>
                              <span className='rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground'>
                                {it?.sku || '—'}
                              </span>
                            </div>
                            {!!l.description && (
                              <p className='max-w-3xl whitespace-pre-wrap text-xs text-muted-foreground'>{l.description}</p>
                            )}
                          </div>
                          <div className='text-xs text-muted-foreground lg:text-right'>
                            <div>{tt('orders.discountPct', 'Disc %')}: {fmtAcct(disc)}</div>
                            <div>{tt('table.qtyBase', 'Qty (base)')}: {outstandingBase == null ? '—' : `${fmtAcct(outstandingBase)} ${baseUomCode}`}</div>
                          </div>
                        </div>

                        <div className='mt-4 grid gap-3 md:grid-cols-3'>
                          <div className='rounded-lg border border-border/70 bg-muted/30 p-3'>
                            <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>{tt('orders.outstandingQty', 'Outstanding qty')}</p>
                            <div className='mt-1 text-lg font-semibold'>{fmtAcct(outstanding)} {uomCode}</div>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              {outstandingBase == null ? '—' : `${fmtAcct(outstandingBase)} ${baseUomCode}`}
                            </p>
                          </div>
                          <div className='rounded-lg border border-border/70 bg-muted/30 p-3'>
                            <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>{tt('orders.availableQty', 'Available stock')}</p>
                            <div className='mt-1 text-lg font-semibold'>
                              {availableInLineUom == null ? `${fmtAcct(plan.availableQtyBase || 0)} ${baseUomCode}` : `${fmtAcct(availableInLineUom)} ${uomCode}`}
                            </div>
                            <p className='mt-1 text-xs text-muted-foreground'>{fmtAcct(plan.availableQtyBase || 0)} {baseUomCode}</p>
                          </div>
                          <div className='rounded-lg border border-border/70 bg-muted/30 p-3'>
                            <p className='text-[11px] uppercase tracking-wide text-muted-foreground'>{tt('orders.remainingToIssue', 'Still to allocate')}</p>
                            <div className='mt-1 text-lg font-semibold'>{fmtAcct(Math.max(plan.remainingQty, 0))} {uomCode}</div>
                            <p className='mt-1 text-xs text-muted-foreground'>
                              {tt('orders.allocatedQty', 'Allocated')}: {fmtAcct(plan.totalQty)} {uomCode}
                            </p>
                          </div>
                        </div>

                        <div className='mt-4 space-y-3'>
                          {rows.map((row) => {
                            const warehouseValue = row.warehouseId || SELECT_WAREHOUSE_VALUE
                            const rowOptions = row.warehouseId
                              ? options.filter((option) => option.warehouseId === row.warehouseId)
                              : []
                            const selectedSource = row.binId
                              ? rowOptions.find((option) => encodeBinValue(option.binId) === row.binId)
                              : undefined
                            const availableLineQty = selectedSource && it?.baseUomId
                              ? safeConvert(selectedSource.qtyBase, it.baseUomId, l.uom_id)
                              : null

                            return (
                              <div key={row.id} className='rounded-lg border border-border/60 p-3'>
                                <div className='grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]'>
                                  <div>
                                    <Label>{tt('orders.fromWarehouse', 'From Warehouse')}</Label>
                                    <Select
                                      value={warehouseValue}
                                      onValueChange={(value) => {
                                        if (value === SELECT_WAREHOUSE_VALUE) {
                                          updateAllocationRow(key, row.id, { warehouseId: '', binId: '' })
                                          return
                                        }
                                        const firstOption = options.find((option) => option.warehouseId === value)
                                        updateAllocationRow(key, row.id, {
                                          warehouseId: value,
                                          binId: firstOption ? encodeBinValue(firstOption.binId) : '',
                                        })
                                      }}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder={tt('orders.selectWh', 'Select warehouse')} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={SELECT_WAREHOUSE_VALUE}>{tt('orders.selectWh', 'Select warehouse')}</SelectItem>
                                        {warehouses.map((warehouse) => (
                                          <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div>
                                    <Label>{tt('orders.fromBin', 'From Bin')}</Label>
                                    <Select
                                      value={row.binId || SELECT_BIN_VALUE}
                                      onValueChange={(value) => updateAllocationRow(key, row.id, {
                                        binId: value === SELECT_BIN_VALUE ? '' : value,
                                      })}
                                    >
                                      <SelectTrigger>
                                        <SelectValue placeholder={tt('orders.selectBin', 'Select bin')} />
                                      </SelectTrigger>
                                      <SelectContent>
                                        <SelectItem value={SELECT_BIN_VALUE}>{tt('orders.chooseWarehouseBin', 'Choose a warehouse/bin')}</SelectItem>
                                        {rowOptions.map((option) => (
                                          <SelectItem
                                            key={`${key}-${row.id}-${option.warehouseId}-${option.binId ?? 'unbinned'}`}
                                            value={encodeBinValue(option.binId)}
                                          >
                                            {option.binLabel} • {fmtAcct(option.qtyBase)} {baseUomCode}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>

                                  <div>
                                    <Label>{tt('orders.issueQty', 'Issue qty')}</Label>
                                    <Input
                                      type='number'
                                      min='0'
                                      step='0.000001'
                                      value={row.qty}
                                      placeholder={tt('orders.issueQtyPlaceholder', 'Enter quantity')}
                                      onChange={(event) => updateAllocationRow(key, row.id, { qty: event.target.value })}
                                    />
                                  </div>

                                  <div className='flex items-end justify-end'>
                                    <Button variant='ghost' size='sm' onClick={() => removeAllocationRow(l, row.id)}>
                                      {tt('orders.removeAllocation', 'Remove')}
                                    </Button>
                                  </div>
                                </div>

                                <div className='mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
                                  <span>
                                    {selectedSource
                                      ? tt('orders.availableQty', 'Available stock')
                                      : tt('orders.chooseWarehouseBin', 'Choose a warehouse/bin')}
                                    {selectedSource ? `: ${fmtAcct(selectedSource.qtyBase)} ${baseUomCode}` : ''}
                                  </span>
                                  {selectedSource && availableLineQty != null && (
                                    <span>{tt('orders.issueQtyBaseHelp', 'Equivalent in line UoM')}: {fmtAcct(availableLineQty)} {uomCode}</span>
                                  )}
                                  {!rowOptions.length && !!row.warehouseId && (
                                    <span>{tt('orders.noStockInWh', 'No stock in selected warehouse')}</span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {!!plan.errors.length && (
                          <div className='mt-3 rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'>
                            {Array.from(new Set(plan.errors)).map((error) => (
                              <div key={error}>{error}</div>
                            ))}
                          </div>
                        )}

                        <div className='mt-4 flex flex-wrap items-center justify-between gap-3'>
                          <p className='text-xs text-muted-foreground'>
                            {tt('orders.issueAllocationHelp', 'Split each issue across the warehouse bins that actually hold stock. Quantities are validated against live on-hand balances before posting.')}
                          </p>
                          <div className='flex flex-wrap gap-2'>
                            <Button variant='outline' onClick={() => addAllocationRow(l)}>
                              {tt('orders.addAllocation', 'Add allocation')}
                            </Button>
                            <Button
                              size='sm'
                              disabled={!canIssueFromStatus(selectedSO.status) || !!plan.errors.length || !plan.rows.length}
                              onClick={() => doShipLineSO(selectedSO, l)}
                            >
                              {tt('orders.issueAllocatedQty', 'Issue allocated qty')}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {selectedSOOpenLines.length === 0 && (
                    <div className='rounded-xl border border-dashed border-border/70 bg-muted/20 p-6 text-sm text-muted-foreground'>
                      {tt('orders.allLinesShipped', 'All lines shipped.')}
                    </div>
                  )}
                </div>
              </OrderDetailSection>

              <OrderAuditGrid
                title={tt('orders.auditAndSignoff', 'Audit and sign-off')}
                description={tt('orders.auditAndSignoffHelp', 'Prepared, confirmed, and approved names should map to real actions in the workflow instead of manual guesswork.')}
                fields={[
                  {
                    label: tt('orders.preparedBy', 'Prepared by'),
                    value: selectedSoMeta.preparedBy || tt('orders.notAvailableShort', 'Not captured'),
                  },
                  {
                    label: tt('orders.confirmedBy', 'Confirmed by'),
                    value: selectedSoMeta.confirmedBy || tt('orders.notAvailableShort', 'Not captured'),
                  },
                  {
                    label: tt('orders.approvedBy', 'Approved by'),
                    value: selectedSoMeta.approvedBy || tt('orders.notAvailableShort', 'Not captured'),
                  },
                ]}
              />
            </div>
          )}
          </SheetBody>
        </SheetContent>
      </Sheet>

      {/* Shipped SOs Browser */}
      <Sheet open={shippedOpen} onOpenChange={setShippedOpen}>
        <SheetContent side="right" className="w-full sm:max-w-3xl max-w-none p-0 md:p-6">
          <SheetHeader className="px-4 pt-4 md:px-0 md:pt-0">
            <SheetTitle>{tt('orders.shippedBrowser', 'Completed sales workflow')}</SheetTitle>
            <SheetDescription className="sr-only">
              {tt('orders.shippedBrowserDesc', 'Search, filter, and print operationally finished sales orders.')}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="px-4 pb-6 md:px-0">

          {/* Filters */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
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
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            <div className="text-muted-foreground">{workflowStagesLabel}:</div>
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
                  <th className="py-2 px-3">{tt('orders.fulfilmentStatus', 'Fulfilment')}</th>
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
                  const amounts = amountSO(so)
                  const updated = (so.updated_at || so.created_at || '').slice(0, 19).replace('T', ' ')
                  return (
                    <tr key={so.id} className="border-t">
                      <td className="py-2 px-3">{soNo(so)}</td>
                      <td className="py-2 px-3">{soCustomerLabel(so)}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${salesFulfilmentClass(so)}`}>
                          {salesFulfilmentLabel(so)}
                        </span>
                      </td>
                      <td className="py-2 px-3">{updated || '-'}</td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums">{formatMoneyBase(amounts.totalBase, baseCode)}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" onClick={() => printSO(so)}>
                            {tt('orders.print', 'Print')}
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => printSO(so, true)}>
                            {tt('orders.download', 'Download')}
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
          <div className="flex justify-between items-center pt-4">
            <div className="text-xs text-muted-foreground">
              {tt('orders.rows', 'Rows')}: {shippedRows.length}
            </div>
            {shippedHasMore && (
              <Button size="sm" variant="secondary" onClick={() => fetchShippedPage(shippedPage + 1)}>
                {tt('common.loadMore', 'Load more')}
              </Button>
            )}
          </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  )
}






