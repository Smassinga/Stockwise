import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { useRef } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { downloadImportTemplate, readImportWorkbook, type ParsedImportRow } from '../lib/importWorkbook'
import { profileFromRole, type ItemPrimaryRole } from '../lib/itemProfiles'
import { toOpeningStockPostingRow, type OpeningStockPostingRow } from '../lib/openingStockImport'
import { can } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import {
  clearPostingRequestKey,
  getPostingRequestKeyForFingerprint,
  stablePostingFingerprint,
  type PostingRequestKeyRef,
} from '../lib/postingRequestKeys'
import { buildConvGraph, normalizeUomCodeInput, tryConvertQty } from '../lib/uom'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { OperationalSummaryBand } from '../components/premium/OperationalSummaryBand'

type DatasetKey = 'items' | 'customers' | 'suppliers' | 'locations' | 'opening_stock'

type DatasetDefinition = {
  key: DatasetKey
  title: { en: string; pt: string }
  body: { en: string; pt: string }
  filename: string
  headers: string[]
  sampleRows: Array<Record<string, string | number>>
}

type ImportIssue = {
  row: number
  field: string
  message: string
}

type PreviewState<TPayload = Record<string, unknown>> = {
  rows: ParsedImportRow[]
  issues: ImportIssue[]
  payload: TPayload[]
}

type UomRow = { id: string; code: string }
type CurrencyRow = { code: string; name: string }
type WarehouseRow = { id: string; code: string; name: string }
type BinRow = { id: string; warehouseId: string; code: string; name: string }
type ItemRow = { id: string; sku: string; name: string; baseUomId: string | null }
type CustomerRow = { id: string; code: string; name: string }
type SupplierRow = { id: string; code: string; name: string }

type ItemPayload = {
  sku: string
  name: string
  base_uom_id: string
  min_stock: number
  unit_price: number
  primary_role: ItemPrimaryRole
  track_inventory: boolean
  can_buy: boolean
  can_sell: boolean
  is_assembled: boolean
}

type CustomerPayload = {
  code: string
  name: string
  email: string | null
  phone: string | null
  tax_id: string | null
  billing_address: string | null
  shipping_address: string | null
  currency_code: string | null
  notes: string | null
}

type SupplierPayload = {
  code: string
  name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  tax_id: string | null
  currency_code: string | null
  notes: string | null
  is_active: boolean
}

type LocationPayload = {
  warehouses: Array<{
    code: string
    name: string
    address: string | null
    status: string
  }>
  bins: Array<{
    warehouseCode: string
    code: string
    name: string
    status: string
  }>
}

type OpeningStockPayload = OpeningStockPostingRow

const DATASETS: DatasetDefinition[] = [
  {
    key: 'items',
    title: { en: 'Items', pt: 'Artigos' },
    body: {
      en: 'Bring current item master data into StockWise without recreating the catalog manually.',
      pt: 'Traga os artigos atuais para o StockWise sem recriar o catálogo manualmente.',
    },
    filename: 'stockwise-items-template.xlsx',
    headers: ['sku', 'name', 'base_uom_code', 'min_stock', 'unit_price', 'primary_role'],
    sampleRows: [
      { sku: 'ITEM-001', name: 'Retail Bread', base_uom_code: 'EA', min_stock: 5, unit_price: 35, primary_role: 'resale' },
    ],
  },
  {
    key: 'customers',
    title: { en: 'Customers', pt: 'Clientes' },
    body: {
      en: 'Import the customers you already trade with so the team can start from today, not from a blank CRM.',
      pt: 'Importe os clientes com quem já trabalha para a equipa começar hoje, e não a partir de um CRM vazio.',
    },
    filename: 'stockwise-customers-template.xlsx',
    headers: ['code', 'name', 'email', 'phone', 'tax_id', 'billing_address', 'shipping_address', 'currency_code', 'notes'],
    sampleRows: [
      { code: 'CUS-001', name: 'Mercado Central', email: 'compras@mercado.co.mz', phone: '840000000', tax_id: '900123456', billing_address: 'Maputo', shipping_address: 'Maputo', currency_code: 'MZN', notes: 'Opening import' },
    ],
  },
  {
    key: 'suppliers',
    title: { en: 'Suppliers', pt: 'Fornecedores' },
    body: {
      en: 'Set up purchasing counterparties early so stock replenishment and AP follow-up can start cleanly.',
      pt: 'Configure cedo as contrapartes de compra para que a reposição de stock e o seguimento de AP comecem limpos.',
    },
    filename: 'stockwise-suppliers-template.xlsx',
    headers: ['code', 'name', 'contact_name', 'email', 'phone', 'tax_id', 'currency_code', 'is_active', 'notes'],
    sampleRows: [
      { code: 'SUP-001', name: 'Panificação Norte', contact_name: 'Joana', email: 'vendas@padaria.co.mz', phone: '850000000', tax_id: '800123456', currency_code: 'MZN', is_active: 'true', notes: 'Opening import' },
    ],
  },
  {
    key: 'locations',
    title: { en: 'Warehouses and bins', pt: 'Armazéns e bins' },
    body: {
      en: 'Create the physical locations first so opening stock can land in the right place from day one.',
      pt: 'Crie primeiro os locais físicos para que o stock inicial entre no lugar certo desde o primeiro dia.',
    },
    filename: 'stockwise-locations-template.xlsx',
    headers: ['warehouse_code', 'warehouse_name', 'warehouse_address', 'warehouse_status', 'bin_code', 'bin_name', 'bin_status'],
    sampleRows: [
      { warehouse_code: 'MAIN', warehouse_name: 'Main store', warehouse_address: 'Maputo', warehouse_status: 'active', bin_code: 'SHOP-01', bin_name: 'Front counter', bin_status: 'active' },
    ],
  },
  {
    key: 'opening_stock',
    title: { en: 'Opening stock', pt: 'Stock inicial' },
    body: {
      en: 'Import current on-hand stock so operations can start from today forward without migrating historical orders or invoices.',
      pt: 'Importe o stock atual para que a operação comece a partir de hoje, sem migrar encomendas ou faturas históricas.',
    },
    filename: 'stockwise-opening-stock-template.xlsx',
    headers: ['item_sku', 'warehouse_code', 'bin_code', 'qty', 'uom_code', 'unit_cost', 'notes'],
    sampleRows: [
      { item_sku: 'ITEM-001', warehouse_code: 'MAIN', bin_code: 'SHOP-01', qty: 20, uom_code: 'EA', unit_cost: 12.5, notes: 'Opening stock' },
    ],
  },
]

const copyByLang = {
  en: {
    title: 'Opening data import',
    subtitle: 'Load opening stock and master data without pretending to migrate historical documents.',
    body:
      'This workspace is for go-live data only: items, customers, suppliers, locations, and current stock. Historical sales orders, purchase orders, invoices, and vendor bills stay outside this import phase.',
    permissions: 'Only operators and above can run imports.',
    chooseFile: 'Upload workbook',
    downloadTemplate: 'Download template',
    review: 'Review before commit',
    issues: 'Validation issues',
    ready: 'Rows ready',
    blocked: 'Blocked rows',
    importRows: 'Import rows',
    importing: 'Importing...',
    noPreview: 'Upload a CSV or XLSX file to review the rows before anything is committed.',
    noRows: 'The file did not contain usable rows.',
    fileHint: 'CSV, XLSX, and XLS files are supported. Only the first sheet is used.',
    tableRow: 'Row',
    tableField: 'Field',
    tableMessage: 'Message',
    previewRows: 'Preview rows',
    historicalNote: 'Historical document migration is intentionally out of scope here.',
    loadingLookups: 'Loading import references...',
    loadLookupsFailed: 'Could not load the import references.',
    readFileFailed: 'Could not read the import file.',
    resolveIssues: 'Resolve the validation issues before importing.',
    importSucceeded: '{count} row(s) imported.',
    importFailed: 'Import failed.',
    readyHelp: 'Validated rows ready to commit.',
    openingStockNote: 'Opening stock',
    returnToSetup: 'Return to company setup',
    dependenciesTitle: 'Before you import',
    dependencies: {
      locations: 'Locations establish the warehouses and bins used by stock imports.',
      items: 'Items require a valid unit of measure. Currency is used where commercial values are supplied.',
      customers: 'Customer currency codes must already be available to the company.',
      suppliers: 'Supplier currency codes must already be available to the company.',
      opening_stock: 'Opening stock requires existing items, warehouses, bins, units, quantities, and costs.',
    },
    resultTitle: 'Import completed',
    resultBody: '{count} row(s) were committed for {dataset}. Refresh company setup to review the new evidence.',
  },
  pt: {
    title: 'Importação de dados iniciais',
    subtitle: 'Carregue stock inicial e dados mestre sem fingir uma migração de documentos históricos.',
    body:
      'Este workspace serve apenas para dados de arranque: artigos, clientes, fornecedores, locais e stock atual. Encomendas, ordens de compra, faturas e vendor bills históricos ficam fora desta fase de importação.',
    permissions: 'Somente operadores e acima podem executar importações.',
    downloadTemplate: 'Descarregar modelo',
    review: 'Rever antes de gravar',
    issues: 'Problemas de validação',
    ready: 'Linhas prontas',
    blocked: 'Linhas bloqueadas',
    importRows: 'Importar linhas',
    importing: 'A importar...',
    noPreview: 'Carregue um ficheiro CSV ou XLSX para rever as linhas antes de qualquer gravação.',
    noRows: 'O ficheiro não devolveu linhas utilizáveis.',
    fileHint: 'São suportados CSV, XLSX e XLS. Apenas a primeira folha é usada.',
    tableRow: 'Linha',
    tableField: 'Campo',
    tableMessage: 'Mensagem',
    previewRows: 'Pré-visualização',
    historicalNote: 'A migração de documentos históricos fica intencionalmente fora deste fluxo.',
    loadingLookups: 'A carregar referências de importação...',
    loadLookupsFailed: 'Não foi possível carregar as referências de importação.',
    readFileFailed: 'Não foi possível ler o ficheiro de importação.',
    resolveIssues: 'Resolva os problemas de validação antes de importar.',
    importSucceeded: '{count} linha(s) importadas.',
    importFailed: 'A importação falhou.',
    readyHelp: 'Linhas validadas prontas para gravar.',
    openingStockNote: 'Stock inicial',
    returnToSetup: 'Voltar à configuração da empresa',
    dependenciesTitle: 'Antes de importar',
    dependencies: {
      locations: 'Os locais criam os armazéns e bins usados pelas importações de stock.',
      items: 'Os artigos exigem uma unidade de medida válida. A moeda é usada quando existem valores comerciais.',
      customers: 'Os códigos de moeda dos clientes já devem estar disponíveis para a empresa.',
      suppliers: 'Os códigos de moeda dos fornecedores já devem estar disponíveis para a empresa.',
      opening_stock: 'O stock inicial exige artigos, armazéns, bins, unidades, quantidades e custos já configurados.',
    },
    resultTitle: 'Importação concluída',
    resultBody: '{count} linha(s) foram gravadas para {dataset}. Actualize a configuração da empresa para rever a nova evidência.',
  },
} as const

function normalizeBoolean(value: string) {
  const normalized = value.trim().toLowerCase()
  return ['1', 'true', 'yes', 'sim', 'y'].includes(normalized)
}

function toNumber(value: string, fallback = 0) {
  const numeric = Number(String(value || '').replace(',', '.'))
  return Number.isFinite(numeric) ? numeric : fallback
}

function normalizeRole(value: string): ItemPrimaryRole | null {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  const aliases: Record<string, ItemPrimaryRole> = {
    general: 'general',
    resale: 'resale',
    resale_item: 'resale',
    raw_material: 'raw_material',
    raw: 'raw_material',
    finished_good: 'finished_good',
    finished: 'finished_good',
    assembled_product: 'assembled_product',
    assembled: 'assembled_product',
    service: 'service',
  }
  return aliases[normalized] || null
}

function uniqueIssues(issues: ImportIssue[]) {
  const seen = new Set<string>()
  return issues.filter((issue) => {
    const key = `${issue.row}|${issue.field}|${issue.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function OpeningImport() {
  const { companyId, myRole, authorityMode } = useOrg()
  const { lang } = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const canImport = can.createMaster(myRole)
  const [activeTab, setActiveTab] = useState<DatasetKey>('items')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [fileName, setFileName] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const openingStockRequestRef = useRef<PostingRequestKeyRef>(null)
  const [uoms, setUoms] = useState<UomRow[]>([])
  const [currencies, setCurrencies] = useState<CurrencyRow[]>([])
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [bins, setBins] = useState<BinRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [convGraph, setConvGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const [importResult, setImportResult] = useState<{ dataset: DatasetKey; count: number } | null>(null)

  const copy = copyByLang[lang]
  const activeDefinition = DATASETS.find((dataset) => dataset.key === activeTab) || DATASETS[0]
  const msg = (en: string, pt: string) => (lang === 'pt' ? pt : en)

  useEffect(() => {
    const dataset = searchParams.get('dataset')
    setActiveTab(DATASETS.some((entry) => entry.key === dataset) ? dataset as DatasetKey : 'items')
  }, [searchParams])

  async function loadLookups() {
    if (!companyId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [uomRes, currencyRes, warehouseRes, itemRes, customerRes, supplierRes, conversionRes] = await Promise.all([
        supabase.from('uoms').select('id, code').order('code', { ascending: true }),
        supabase.from('currencies').select('code, name').order('code', { ascending: true }),
        supabase.from('warehouses').select('id, code, name').eq('company_id', companyId).order('name', { ascending: true }),
        supabase.from('items').select('id, sku, name, base_uom_id').eq('company_id', companyId).order('name', { ascending: true }),
        supabase.from('customers').select('id, code, name').eq('company_id', companyId).order('name', { ascending: true }),
        supabase.from('suppliers').select('id, code, name').eq('company_id', companyId).order('name', { ascending: true }),
        supabase.from('uom_conversions').select('from_uom_id, to_uom_id, factor'),
      ])

      if (uomRes.error) throw uomRes.error
      if (currencyRes.error) throw currencyRes.error
      if (warehouseRes.error) throw warehouseRes.error
      if (itemRes.error) throw itemRes.error
      if (customerRes.error) throw customerRes.error
      if (supplierRes.error) throw supplierRes.error
      if (conversionRes.error) throw conversionRes.error

      const warehouseRows = ((warehouseRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      }))
      const warehouseIds = warehouseRows.map((row) => row.id)
      const binRes = warehouseIds.length
        ? await supabase.from('bins').select('id, warehouseId, code, name').in('warehouseId', warehouseIds)
        : { data: [], error: null as any }
      if (binRes.error) throw binRes.error

      setUoms(((uomRes.data || []) as UomRow[]).map((row) => ({ id: String(row.id), code: String(row.code) })))
      setCurrencies(((currencyRes.data || []) as CurrencyRow[]).map((row) => ({ code: String(row.code), name: String(row.name) })))
      setWarehouses(warehouseRows)
      setBins(((binRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        warehouseId: String(row.warehouseId),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      })))
      setItems(((itemRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        sku: String(row.sku ?? ''),
        name: String(row.name ?? ''),
        baseUomId: row.base_uom_id ? String(row.base_uom_id) : null,
      })))
      setCustomers(((customerRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      })))
      setSuppliers(((supplierRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      })))
      setConvGraph(buildConvGraph((conversionRes.data || []) as Array<{ from_uom_id: string; to_uom_id: string; factor: number }>))
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy.loadLookupsFailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadLookups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  useEffect(() => {
    setPreview(null)
    setFileName('')
    clearPostingRequestKey(openingStockRequestRef)
  }, [activeTab])

  const uomByCode = useMemo(() => new Map(uoms.map((row) => [row.code.toUpperCase(), row])), [uoms])
  const currencyCodes = useMemo(() => new Set(currencies.map((row) => row.code.toUpperCase())), [currencies])
  const warehouseByCode = useMemo(() => new Map(warehouses.map((row) => [row.code.toUpperCase(), row])), [warehouses])
  const warehouseCodeById = useMemo(() => new Map(warehouses.map((row) => [row.id, row.code.toUpperCase()])), [warehouses])
  const binByWarehouseAndCode = useMemo(
    () => new Map(bins.map((row) => [`${warehouseCodeById.get(row.warehouseId) || ''}|${row.code.toUpperCase()}`, row])),
    [bins, warehouseCodeById],
  )
  const itemBySku = useMemo(() => new Map(items.map((row) => [row.sku.toUpperCase(), row])), [items])
  const customerCodes = useMemo(() => new Set(customers.map((row) => row.code.toUpperCase())), [customers])
  const supplierCodes = useMemo(() => new Set(suppliers.map((row) => row.code.toUpperCase())), [suppliers])

  function validateRows(rows: ParsedImportRow[]): PreviewState {
    switch (activeTab) {
      case 'items': {
        const issues: ImportIssue[] = []
        const payload: ItemPayload[] = []
        const seenSku = new Set<string>()

        rows.forEach((row, index) => {
          const rowNo = index + 2
          const sku = row.sku?.trim().toUpperCase() || ''
          const name = row.name?.trim() || ''
          const uomCode = normalizeUomCodeInput(row.base_uom_code)
          const role = normalizeRole(row.primary_role || '') || 'general'

          if (!sku) issues.push({ row: rowNo, field: 'sku', message: msg('SKU is required.', 'O SKU é obrigatório.') })
          if (!name) issues.push({ row: rowNo, field: 'name', message: msg('Name is required.', 'O nome é obrigatório.') })
          if (!uomCode) issues.push({ row: rowNo, field: 'base_uom_code', message: msg('Base UOM code is required.', 'O código da UOM base é obrigatório.') })
          if (sku && seenSku.has(sku)) issues.push({ row: rowNo, field: 'sku', message: msg('SKU is duplicated in the file.', 'O SKU está duplicado no ficheiro.') })
          if (sku && customerCodes.has(sku)) {
            // no-op; avoid mixing code sets
          }
          if (sku && itemBySku.has(sku)) issues.push({ row: rowNo, field: 'sku', message: msg('SKU already exists in this company.', 'O SKU já existe nesta empresa.') })

          const uom = uomByCode.get(uomCode)
          if (uomCode && !uom) issues.push({ row: rowNo, field: 'base_uom_code', message: msg('Base UOM code was not found.', 'O código da UOM base não foi encontrado.') })

          const minStock = toNumber(row.min_stock || '0', 0)
          const unitPrice = toNumber(row.unit_price || '0', 0)
          if (minStock < 0) issues.push({ row: rowNo, field: 'min_stock', message: msg('Minimum stock cannot be negative.', 'O stock mínimo não pode ser negativo.') })
          if (unitPrice < 0) issues.push({ row: rowNo, field: 'unit_price', message: msg('Sell price cannot be negative.', 'O preço de venda não pode ser negativo.') })

          if (
            !issues.some((issue) => issue.row === rowNo)
            && uom
          ) {
            seenSku.add(sku)
            const profile = profileFromRole(role)
            payload.push({
              sku,
              name,
              base_uom_id: uom.id,
              min_stock: minStock,
              unit_price: unitPrice,
              primary_role: role,
              track_inventory: profile.trackInventory,
              can_buy: profile.canBuy,
              can_sell: profile.canSell,
              is_assembled: profile.isAssembled,
            })
          }
        })

        return { rows, issues: uniqueIssues(issues), payload }
      }

      case 'customers': {
        const issues: ImportIssue[] = []
        const payload: CustomerPayload[] = []
        const seenCodes = new Set<string>()

        rows.forEach((row, index) => {
          const rowNo = index + 2
          const code = row.code?.trim().toUpperCase() || ''
          const name = row.name?.trim() || ''
          const currencyCode = row.currency_code?.trim().toUpperCase() || ''

          if (!code) issues.push({ row: rowNo, field: 'code', message: msg('Code is required.', 'O código é obrigatório.') })
          if (!name) issues.push({ row: rowNo, field: 'name', message: msg('Name is required.', 'O nome é obrigatório.') })
          if (code && seenCodes.has(code)) issues.push({ row: rowNo, field: 'code', message: msg('Customer code is duplicated in the file.', 'O código do cliente está duplicado no ficheiro.') })
          if (code && customerCodes.has(code)) issues.push({ row: rowNo, field: 'code', message: msg('Customer code already exists in this company.', 'O código do cliente já existe nesta empresa.') })
          if (currencyCode && !currencyCodes.has(currencyCode)) issues.push({ row: rowNo, field: 'currency_code', message: msg('Currency code was not found.', 'O código da moeda não foi encontrado.') })

          if (!issues.some((issue) => issue.row === rowNo)) {
            seenCodes.add(code)
            payload.push({
              code,
              name,
              email: row.email?.trim() || null,
              phone: row.phone?.trim() || null,
              tax_id: row.tax_id?.trim() || null,
              billing_address: row.billing_address?.trim() || null,
              shipping_address: row.shipping_address?.trim() || null,
              currency_code: currencyCode || null,
              notes: row.notes?.trim() || null,
            })
          }
        })

        return { rows, issues: uniqueIssues(issues), payload }
      }

      case 'suppliers': {
        const issues: ImportIssue[] = []
        const payload: SupplierPayload[] = []
        const seenCodes = new Set<string>()

        rows.forEach((row, index) => {
          const rowNo = index + 2
          const code = row.code?.trim().toUpperCase() || ''
          const name = row.name?.trim() || ''
          const currencyCode = row.currency_code?.trim().toUpperCase() || ''

          if (!code) issues.push({ row: rowNo, field: 'code', message: msg('Code is required.', 'O código é obrigatório.') })
          if (!name) issues.push({ row: rowNo, field: 'name', message: msg('Name is required.', 'O nome é obrigatório.') })
          if (code && seenCodes.has(code)) issues.push({ row: rowNo, field: 'code', message: msg('Supplier code is duplicated in the file.', 'O código do fornecedor está duplicado no ficheiro.') })
          if (code && supplierCodes.has(code)) issues.push({ row: rowNo, field: 'code', message: msg('Supplier code already exists in this company.', 'O código do fornecedor já existe nesta empresa.') })
          if (currencyCode && !currencyCodes.has(currencyCode)) issues.push({ row: rowNo, field: 'currency_code', message: msg('Currency code was not found.', 'O código da moeda não foi encontrado.') })

          if (!issues.some((issue) => issue.row === rowNo)) {
            seenCodes.add(code)
            payload.push({
              code,
              name,
              contact_name: row.contact_name?.trim() || null,
              email: row.email?.trim() || null,
              phone: row.phone?.trim() || null,
              tax_id: row.tax_id?.trim() || null,
              currency_code: currencyCode || null,
              notes: row.notes?.trim() || null,
              is_active: row.is_active ? normalizeBoolean(row.is_active) : true,
            })
          }
        })

        return { rows, issues: uniqueIssues(issues), payload }
      }

      case 'locations': {
        const issues: ImportIssue[] = []
        const newWarehouses = new Map<string, LocationPayload['warehouses'][number]>()
        const newBins: LocationPayload['bins'] = []

        rows.forEach((row, index) => {
          const rowNo = index + 2
          const warehouseCode = row.warehouse_code?.trim().toUpperCase() || ''
          const warehouseName = row.warehouse_name?.trim() || ''
          const binCode = row.bin_code?.trim().toUpperCase() || ''
          const binName = row.bin_name?.trim() || ''

          if (!warehouseCode) issues.push({ row: rowNo, field: 'warehouse_code', message: msg('Warehouse code is required.', 'O código do armazém é obrigatório.') })
          if (!warehouseName) issues.push({ row: rowNo, field: 'warehouse_name', message: msg('Warehouse name is required.', 'O nome do armazém é obrigatório.') })

          const existingWarehouse = warehouseByCode.get(warehouseCode)
          if (existingWarehouse) {
            issues.push({ row: rowNo, field: 'warehouse_code', message: msg('Warehouse code already exists. Use it directly for opening stock instead of importing it again.', 'O código do armazém já existe. Use-o diretamente no stock inicial em vez de o importar outra vez.') })
          }

          const existingWarehouseDraft = newWarehouses.get(warehouseCode)
          if (existingWarehouseDraft && existingWarehouseDraft.name !== warehouseName) {
            issues.push({ row: rowNo, field: 'warehouse_name', message: msg('The same warehouse code cannot use different names in one file.', 'O mesmo código de armazém não pode usar nomes diferentes no mesmo ficheiro.') })
          }

          const hasBinValues = Boolean(binCode || binName)
          if (hasBinValues && !binCode) issues.push({ row: rowNo, field: 'bin_code', message: msg('Bin code is required when a bin name is supplied.', 'O código do bin é obrigatório quando existe um nome do bin.') })
          if (hasBinValues && !binName) issues.push({ row: rowNo, field: 'bin_name', message: msg('Bin name is required when a bin code is supplied.', 'O nome do bin é obrigatório quando existe um código do bin.') })
          if (hasBinValues && binByWarehouseAndCode.has(`${warehouseCode}|${binCode}`)) {
            issues.push({ row: rowNo, field: 'bin_code', message: msg('This warehouse/bin code already exists.', 'Este código de armazém/bin já existe.') })
          }

          if (!issues.some((issue) => issue.row === rowNo)) {
            if (!newWarehouses.has(warehouseCode)) {
              newWarehouses.set(warehouseCode, {
                code: warehouseCode,
                name: warehouseName,
                address: row.warehouse_address?.trim() || null,
                status: row.warehouse_status?.trim() || 'active',
              })
            }
            if (hasBinValues) {
              newBins.push({
                warehouseCode,
                code: binCode,
                name: binName,
                status: row.bin_status?.trim() || 'active',
              })
            }
          }
        })

        return {
          rows,
          issues: uniqueIssues(issues),
          payload: [{ warehouses: Array.from(newWarehouses.values()), bins: newBins }],
        }
      }

      case 'opening_stock': {
        const issues: ImportIssue[] = []
        const payload: OpeningStockPayload[] = []

        rows.forEach((row, index) => {
          const rowNo = index + 2
          const itemSku = row.item_sku?.trim().toUpperCase() || ''
          const warehouseCode = row.warehouse_code?.trim().toUpperCase() || ''
          const binCode = row.bin_code?.trim().toUpperCase() || ''
          const qty = toNumber(row.qty || '0', 0)
          const unitCost = toNumber(row.unit_cost || '0', 0)

          if (!itemSku) issues.push({ row: rowNo, field: 'item_sku', message: msg('Item SKU is required.', 'O SKU do artigo é obrigatório.') })
          if (!warehouseCode) issues.push({ row: rowNo, field: 'warehouse_code', message: msg('Warehouse code is required.', 'O código do armazém é obrigatório.') })
          if (!binCode) issues.push({ row: rowNo, field: 'bin_code', message: msg('Bin code is required.', 'O código do bin é obrigatório.') })
          if (qty <= 0) issues.push({ row: rowNo, field: 'qty', message: msg('Quantity must be above zero.', 'A quantidade deve ser superior a zero.') })
          if (unitCost < 0) issues.push({ row: rowNo, field: 'unit_cost', message: msg('Unit cost cannot be negative.', 'O custo unitário não pode ser negativo.') })

          const item = itemBySku.get(itemSku)
          const warehouse = warehouseByCode.get(warehouseCode)
          const bin = binByWarehouseAndCode.get(`${warehouseCode}|${binCode}`)
          if (!item) issues.push({ row: rowNo, field: 'item_sku', message: msg('Item SKU was not found in this company.', 'O SKU do artigo não foi encontrado nesta empresa.') })
          if (!warehouse) issues.push({ row: rowNo, field: 'warehouse_code', message: msg('Warehouse code was not found in this company.', 'O código do armazém não foi encontrado nesta empresa.') })
          if (!bin) issues.push({ row: rowNo, field: 'bin_code', message: msg('Bin code was not found for the selected warehouse.', 'O código do bin não foi encontrado para o armazém selecionado.') })

          const itemBaseUom = item?.baseUomId ? uoms.find((uom) => uom.id === item.baseUomId) : null
          const enteredUomCode = normalizeUomCodeInput(row.uom_code) || itemBaseUom?.code || ''
          const enteredUom = uomByCode.get(enteredUomCode)
          if (enteredUomCode && !enteredUom) issues.push({ row: rowNo, field: 'uom_code', message: msg('UOM code was not found.', 'O código da UOM não foi encontrado.') })

          const qtyBase = item && enteredUom && item.baseUomId
            ? (enteredUom.id === item.baseUomId
                ? qty
                : tryConvertQty(qty, enteredUom.id, item.baseUomId, convGraph))
            : null
          if (qty > 0 && enteredUomCode && qtyBase == null) {
            issues.push({ row: rowNo, field: 'uom_code', message: msg('The entered UOM cannot be converted into the item base UOM.', 'A UOM introduzida não pode ser convertida para a UOM base do artigo.') })
          }

          if (!issues.some((issue) => issue.row === rowNo) && item && enteredUom && bin && qtyBase != null) {
            payload.push(toOpeningStockPostingRow({
              itemId: item.id,
              uomId: enteredUom.id,
              quantity: qty,
              baseQuantity: qtyBase,
              unitCost,
              warehouseId: warehouse!.id,
              binId: bin.id,
              notes: row.notes?.trim() || copy.openingStockNote,
            }))
          }
        })

        return { rows, issues: uniqueIssues(issues), payload }
      }
    }
  }

  async function handleFile(file: File | null) {
    if (!file) return
    try {
      clearPostingRequestKey(openingStockRequestRef)
      const rows = await readImportWorkbook(file)
      setFileName(file.name)
      if (!rows.length) {
        setPreview({ rows: [], issues: [], payload: [] })
        toast.error(copy.noRows)
        return
      }
      setPreview(validateRows(rows))
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy.readFileFailed)
    }
  }

  async function commitImport() {
    if (!companyId || !preview) return
    if (!canImport) {
      toast.error(copy.permissions)
      return
    }
    if (preview.issues.length) {
      toast.error(copy.resolveIssues)
      return
    }
    if (!preview.payload.length) {
      toast.error(copy.noRows)
      return
    }

    try {
      setImporting(true)

      if (activeTab === 'items') {
        const payload = (preview.payload as ItemPayload[]).map((row) => ({ ...row, company_id: companyId }))
        const { error } = await supabase.from('items').insert(payload)
        if (error) throw error
      }

      if (activeTab === 'customers') {
        const payload = (preview.payload as CustomerPayload[]).map((row) => ({ ...row, company_id: companyId }))
        const { error } = await supabase.from('customers').insert(payload)
        if (error) throw error
      }

      if (activeTab === 'suppliers') {
        const payload = (preview.payload as SupplierPayload[]).map((row) => ({ ...row, company_id: companyId }))
        const { error } = await supabase.from('suppliers').insert(payload)
        if (error) throw error
      }

      if (activeTab === 'locations') {
        const payload = (preview.payload[0] || { warehouses: [], bins: [] }) as LocationPayload
        if (payload.warehouses.length) {
          const { error } = await supabase.from('warehouses').insert(
            payload.warehouses.map((row) => ({
              company_id: companyId,
              code: row.code,
              name: row.name,
              address: row.address,
              status: row.status,
            })),
          )
          if (error) throw error
        }

        if (payload.bins.length) {
          const { data: freshWarehouses, error: freshWarehousesError } = await supabase
            .from('warehouses')
            .select('id, code')
            .eq('company_id', companyId)
          if (freshWarehousesError) throw freshWarehousesError
          const warehouseMap = new Map((freshWarehouses || []).map((row: any) => [String(row.code).toUpperCase(), String(row.id)]))

          const binPayload = payload.bins.map((row) => ({
            id: `bin_${crypto.randomUUID()}`,
            company_id: companyId,
            warehouseId: warehouseMap.get(row.warehouseCode),
            code: row.code,
            name: row.name,
            status: row.status,
          }))

          if (binPayload.some((row) => !row.warehouseId)) {
            throw new Error(
              msg(
                'One or more imported bins could not resolve their warehouse code after warehouse creation.',
                'Um ou mais bins importados não conseguiram resolver o respetivo código de armazém após a criação do armazém.',
              ),
            )
          }

          const { error } = await supabase.from('bins').insert(binPayload)
          if (error) throw error
        }
      }

      if (activeTab === 'opening_stock') {
        const openingStockRows = preview.payload as OpeningStockPayload[]
        const fingerprint = stablePostingFingerprint({
          companyId,
          rows: openingStockRows,
        })
        const requestKey = getPostingRequestKeyForFingerprint(openingStockRequestRef, fingerprint)
        const openingStockRpc = authorityMode === 'platform_workspace'
          ? 'platform_admin_post_opening_stock_import'
          : 'post_opening_stock_import'
        const { error } = await supabase.rpc(openingStockRpc, {
          p_company_id: companyId,
          p_rows: openingStockRows,
          p_request_key: requestKey,
        })
        if (error) throw error
        clearPostingRequestKey(openingStockRequestRef)
      }

      toast.success(copy.importSucceeded.replace('{count}', String(preview.payload.length)))
      setImportResult({ dataset: activeTab, count: preview.payload.length })
      setPreview(null)
      setFileName('')
      await loadLookups()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy.importFailed)
    } finally {
      setImporting(false)
    }
  }

  const readyCount = preview?.payload.length || 0
  const blockedCount = preview?.issues.length ? new Set(preview.issues.map((issue) => issue.row)).size : 0
  const previewColumns = activeDefinition.headers

  return (
    <div className="app-page app-page--workspace">
      <PremiumPageHeader
        title={copy.title}
        description={copy.subtitle}
        context={!canImport ? (
          <Badge variant="outline" className="border-status-warning-border bg-status-warning-muted text-status-warning-foreground">
            {copy.permissions}
          </Badge>
        ) : undefined}
        actions={
          <Button asChild variant="outline" className="w-full sm:w-fit">
            <Link to="/settings?view=setup">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {copy.returnToSetup}
            </Link>
          </Button>
        }
      />

      {importResult ? (
        <div role="status" aria-live="polite" className="rounded-[var(--radius)] border border-status-success-border bg-status-success-muted p-4 text-status-success-foreground">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <div className="font-semibold">{copy.resultTitle}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {copy.resultBody
                  .replace('{count}', String(importResult.count))
                  .replace('{dataset}', DATASETS.find((entry) => entry.key === importResult.dataset)?.title[lang] || importResult.dataset)}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <Tabs value={activeTab} onValueChange={(value) => setSearchParams({ dataset: value })} className="space-y-6">
        <TabsList className="h-auto w-full justify-start gap-2 overflow-x-auto rounded-3xl border border-border/70 bg-background/88 p-2">
          {DATASETS.map((dataset) => (
            <TabsTrigger key={dataset.key} value={dataset.key} className="shrink-0 rounded-2xl px-4 py-2.5">
              {dataset.title[lang]}
            </TabsTrigger>
          ))}
        </TabsList>

        {DATASETS.map((dataset) => (
          <TabsContent key={dataset.key} value={dataset.key} className="space-y-6">
            <div className="rounded-[var(--radius)] border border-border/70 bg-muted/20 p-4">
              <div className="text-sm font-semibold">{copy.dependenciesTitle}</div>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">{copy.dependencies[dataset.key]}</p>
            </div>
            <Card className="border-border/70 shadow-sm">
              <CardHeader className="space-y-2">
                <CardTitle>{dataset.title[lang]}</CardTitle>
                <CardDescription className="hidden sm:block">{dataset.body[lang]}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                  <Button type="button" variant="outline" onClick={() => downloadImportTemplate(dataset.filename, dataset.headers, dataset.sampleRows)}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {copy.downloadTemplate}
                  </Button>
                  <div className="space-y-2">
                    <Label htmlFor={`opening-import-file-${dataset.key}`}>{copy.fileHint}</Label>
                    <Input
                      id={`opening-import-file-${dataset.key}`}
                      type="file"
                      accept=".csv,.xlsx,.xls"
                      onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
                      className="max-w-sm"
                      disabled={!canImport || loading || importing}
                    />
                  </div>
                  {fileName ? <Badge variant="secondary">{fileName}</Badge> : null}
                </div>
              </CardContent>
            </Card>

            {preview ? (
              <OperationalSummaryBand
                label={copy.review}
                items={[
                  { label: copy.review, value: preview.rows.length },
                  { label: copy.ready, value: readyCount, tone: readyCount ? 'success' : 'neutral' },
                  { label: copy.blocked, value: blockedCount, tone: blockedCount ? 'danger' : 'neutral' },
                ]}
              />
            ) : null}

            <Card className="border-border/70 shadow-sm">
              <CardHeader className="space-y-2">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle>{copy.review}</CardTitle>
                    <CardDescription className="hidden sm:block">{preview ? copy.previewRows : copy.noPreview}</CardDescription>
                  </div>
                  <Button className="w-full sm:w-auto" disabled={!preview || importing || !canImport || preview.issues.length > 0 || preview.payload.length === 0} onClick={() => void commitImport()}>
                    <Upload className="mr-2 h-4 w-4" />
                    {importing ? copy.importing : copy.importRows}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                {!preview ? (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
                    {copy.noPreview}
                  </div>
                ) : (
                  <>
                    {preview.issues.length ? (
                      <div className="rounded-2xl border border-status-warning-border bg-status-warning-muted p-4">
                        <div className="flex items-center gap-2 text-sm font-medium text-status-warning-foreground">
                          <AlertTriangle className="h-4 w-4" />
                          {copy.issues}
                        </div>
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full min-w-[680px] text-sm">
                            <thead>
                              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                                <th className="py-2 pr-4">{copy.tableRow}</th>
                                <th className="py-2 pr-4">{copy.tableField}</th>
                                <th className="py-2">{copy.tableMessage}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {preview.issues.slice(0, 12).map((issue) => (
                                <tr key={`${issue.row}-${issue.field}-${issue.message}`} className="border-b align-top">
                                  <td className="py-2 pr-4">{issue.row}</td>
                                  <td className="py-2 pr-4">{issue.field}</td>
                                  <td className="py-2">{issue.message}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : null}

                    <div className="overflow-x-auto rounded-2xl border border-border/70">
                      <table className="w-full min-w-[780px] text-sm">
                        <thead className="bg-muted/30">
                          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                            {previewColumns.map((column) => (
                              <th key={column} className="px-3 py-2">{column}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.slice(0, 12).map((row, index) => (
                            <tr key={`preview-${index}`} className="border-b align-top">
                              {previewColumns.map((column) => (
                                <td key={`${index}-${column}`} className="px-3 py-3 text-sm">
                                  {row[column] || '—'}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}

