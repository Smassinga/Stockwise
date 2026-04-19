import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '../components/ui/drawer'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'
import { can } from '../lib/permissions'
import { supabase } from '../lib/supabase'
import { createOperatorSaleIssue } from '../lib/operatorSale'
import toast from 'react-hot-toast'
import {
  ArrowRight,
  Minus,
  Package,
  Plus,
  Search,
  ShoppingBag,
  UserRound,
  Warehouse,
} from 'lucide-react'
import { getBaseCurrencyCode } from '../lib/currency'

type WarehouseRow = {
  id: string
  code: string
  name: string
}

type BinRow = {
  id: string
  warehouseId: string
  code: string
  name: string
}

type ItemRow = {
  id: string
  name: string
  sku: string | null
  baseUomId: string | null
  unitPrice: number | null
  canSell: boolean
  trackInventory: boolean
}

type CustomerRow = {
  id: string
  code?: string | null
  name: string
}

type UomRow = {
  id: string
  code: string
}

type StockLevelRow = {
  itemId: string
  warehouseId: string
  binId: string | null
  qty: number
  allocatedQty: number
  avgCost: number
}

type CartLine = {
  itemId: string
  name: string
  sku: string | null
  qty: number
  availableQty: number
  unitPrice: number
  baseUomCode: string
}

const copyByLang = {
  en: {
    title: 'Operator',
    subtitle: 'Fast daily stock issue and walk-in sale workspace for small-store operations.',
    headerHelp:
      'Use this page when the store needs a quick issue flow, not a full named-customer sales-order workflow.',
    sourceTitle: 'Source stock',
    sourceBody: 'Choose the selling location first. The item list stays focused on what is available in that bin right now.',
    warehouse: 'Warehouse',
    bin: 'Bin',
    search: 'Search items by name or SKU',
    searchPlaceholder: 'Search available stock',
    itemsTitle: 'Available stock',
    itemsBody: 'Tap an item to add it into the current issue. Quantities are reviewed in the current sale before posting.',
    itemsEmpty: 'No sellable stock is available in the selected bin.',
    itemsEmptyHelp: 'Change the source bin or receive stock before using the Operator workspace.',
    currentTitle: 'Current sale / issue',
    currentBody: 'Default to the walk-in cash customer and only pick a named customer when the sale needs it.',
    walkIn: 'Walk-in / cash customer',
    namedCustomer: 'Named customer',
    chooseCustomer: 'Choose customer',
    notes: 'Notes',
    reference: 'Reference',
    notesPlaceholder: 'Optional note for the issue book or counter reference',
    referencePlaceholder: 'Optional till slip or notebook reference',
    noLines: 'No items added yet.',
    noLinesHelp: 'Add one or more items from the stock list to build the current issue.',
    noCompany: 'Join or create a company first.',
    chooseBin: 'Choose the source bin first.',
    addLines: 'Add at least one item before posting the issue.',
    loading: 'Loading operator stock...',
    summaryItems: 'Lines',
    summaryQty: 'Units',
    summaryTotal: 'Total',
    unitPrice: 'Unit price',
    remove: 'Remove',
    addOne: 'Add 1',
    addAnother: 'Add one more',
    available: 'Available',
    onHand: 'On hand',
    reviewIssue: 'Review current issue',
    confirm: 'Confirm issue',
    posting: 'Posting issue...',
    readOnly: 'Read-only: only operators and above can post from this workspace.',
    success: 'Operator issue posted',
    successWithOrder: 'Operator issue posted on {orderNo}',
    drawerTitle: 'Review current issue',
    drawerBody: 'Confirm the walk-in or named-customer issue before stock is reduced.',
    pricingHelp: 'Sell price defaults from the item record and can be adjusted per line.',
    couldNotPost: 'Could not post the operator issue.',
  },
  pt: {
    title: 'Operador',
    subtitle: 'Workspace rápido para saída diária de stock e venda de balcão em operações de loja pequena.',
    headerHelp:
      'Use esta página quando a loja precisa de uma saída rápida, sem forçar o fluxo completo de encomenda com cliente identificado.',
    sourceTitle: 'Stock de origem',
    sourceBody: 'Escolha primeiro o local de venda. A lista de artigos fica focada no que está disponível nesse bin neste momento.',
    warehouse: 'Armazém',
    bin: 'Bin',
    search: 'Pesquisar artigos por nome ou SKU',
    searchPlaceholder: 'Pesquisar stock disponível',
    itemsTitle: 'Stock disponível',
    itemsBody: 'Toque num artigo para o adicionar à saída atual. As quantidades são revistas na venda atual antes do lançamento.',
    itemsEmpty: 'Não há stock vendável disponível no bin selecionado.',
    itemsEmptyHelp: 'Mude o bin de origem ou receba stock antes de usar o workspace do Operador.',
    currentTitle: 'Venda / saída atual',
    currentBody: 'O padrão é o cliente balcão / caixa. Escolha um cliente registado apenas quando a venda realmente precisar disso.',
    walkIn: 'Cliente balcão / caixa',
    namedCustomer: 'Cliente registado',
    chooseCustomer: 'Escolher cliente',
    notes: 'Notas',
    reference: 'Referência',
    notesPlaceholder: 'Nota opcional para o livro de saídas ou referência do balcão',
    referencePlaceholder: 'Referência opcional do talão ou do caderno',
    noLines: 'Ainda não há artigos adicionados.',
    noLinesHelp: 'Adicione um ou mais artigos da lista de stock para montar a saída atual.',
    noCompany: 'Entre numa empresa ou crie uma empresa primeiro.',
    chooseBin: 'Escolha primeiro o bin de origem.',
    addLines: 'Adicione pelo menos um artigo antes de lançar a saída.',
    loading: 'A carregar stock do operador...',
    summaryItems: 'Linhas',
    summaryQty: 'Unidades',
    summaryTotal: 'Total',
    unitPrice: 'Preço unitário',
    remove: 'Remover',
    addOne: 'Adicionar 1',
    addAnother: 'Adicionar mais uma',
    available: 'Disponível',
    onHand: 'Existência',
    reviewIssue: 'Rever saída atual',
    confirm: 'Confirmar saída',
    posting: 'A lançar saída...',
    readOnly: 'Somente operadores e acima podem lançar neste workspace.',
    success: 'Saída do operador lançada',
    successWithOrder: 'Saída do operador lançada em {orderNo}',
    drawerTitle: 'Rever saída atual',
    drawerBody: 'Confirme a saída de balcão ou com cliente identificado antes de reduzir o stock.',
    pricingHelp: 'O preço de venda vem do artigo por padrão e pode ser ajustado por linha.',
    couldNotPost: 'Não foi possível lançar a saída do operador.',
    loadFailed: 'Não foi possível carregar o workspace do Operador.',
  },
} as const

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const toNumber = (value: number | string | null | undefined, fallback = 0) => {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

function formatQty(value: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export default function Operator() {
  const { companyId, myRole } = useOrg()
  const { lang } = useI18n()
  const copy = copyByLang[lang]
  const canPost = can.createMovement(myRole)

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [binId, setBinId] = useState('')
  const [search, setSearch] = useState('')
  const [useNamedCustomer, setUseNamedCustomer] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [notes, setNotes] = useState('')
  const [referenceNo, setReferenceNo] = useState('')
  const [baseCurrencyCode, setBaseCurrencyCode] = useState('MZN')
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([])
  const [bins, setBins] = useState<BinRow[]>([])
  const [items, setItems] = useState<ItemRow[]>([])
  const [customers, setCustomers] = useState<CustomerRow[]>([])
  const [uoms, setUoms] = useState<UomRow[]>([])
  const [stockLevels, setStockLevels] = useState<StockLevelRow[]>([])
  const [cart, setCart] = useState<CartLine[]>([])

  const loadData = async () => {
    if (!companyId) {
      setWarehouses([])
      setBins([])
      setItems([])
      setCustomers([])
      setStockLevels([])
      setUoms([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const [warehouseRes, itemRes, customerRes, uomRes, stockRes, currencyCode] = await Promise.all([
        supabase
          .from('warehouses')
          .select('id, code, name')
          .eq('company_id', companyId)
          .eq('status', 'active')
          .order('name', { ascending: true }),
        supabase
          .from('items')
          .select('id, name, sku, base_uom_id, unit_price, can_sell, track_inventory')
          .eq('company_id', companyId)
          .order('name', { ascending: true }),
        supabase
          .from('customers')
          .select('id, code, name')
          .eq('company_id', companyId)
          .order('name', { ascending: true }),
        supabase
          .from('uoms')
          .select('id, code')
          .order('code', { ascending: true }),
        supabase
          .from('stock_levels')
          .select('item_id, warehouse_id, bin_id, qty, allocated_qty, avg_cost')
          .eq('company_id', companyId),
        getBaseCurrencyCode().catch(() => 'MZN'),
      ])

      if (warehouseRes.error) throw warehouseRes.error
      if (itemRes.error) throw itemRes.error
      if (customerRes.error) throw customerRes.error
      if (uomRes.error) throw uomRes.error
      if (stockRes.error) throw stockRes.error

      const warehouseRows = ((warehouseRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      }))
      const warehouseIds = warehouseRows.map((row) => row.id)
      const binRes = warehouseIds.length
        ? await supabase
            .from('bins')
            .select('id, warehouseId, code, name')
            .in('warehouseId', warehouseIds)
            .order('code', { ascending: true })
        : { data: [], error: null as any }
      if (binRes.error) throw binRes.error

      setWarehouses(warehouseRows)
      setBins(((binRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        warehouseId: String(row.warehouseId),
        code: String(row.code ?? ''),
        name: String(row.name ?? ''),
      })))
      setItems(((itemRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        name: String(row.name ?? ''),
        sku: row.sku ? String(row.sku) : null,
        baseUomId: row.base_uom_id ? String(row.base_uom_id) : null,
        unitPrice: row.unit_price == null ? null : Number(row.unit_price),
        canSell: Boolean(row.can_sell),
        trackInventory: Boolean(row.track_inventory),
      })))
      setCustomers(((customerRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: row.code ? String(row.code) : null,
        name: String(row.name ?? ''),
      })))
      setUoms(((uomRes.data || []) as any[]).map((row) => ({
        id: String(row.id),
        code: String(row.code ?? ''),
      })))
      setStockLevels(((stockRes.data || []) as any[]).map((row) => ({
        itemId: String(row.item_id),
        warehouseId: String(row.warehouse_id),
        binId: row.bin_id ? String(row.bin_id) : null,
        qty: toNumber(row.qty),
        allocatedQty: toNumber(row.allocated_qty),
        avgCost: toNumber(row.avg_cost),
      })))
      setBaseCurrencyCode(currencyCode || 'MZN')

      if (!warehouseId && warehouseRows[0]?.id) {
        setWarehouseId(warehouseRows[0].id)
      }
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy.loadFailed)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const binsForWarehouse = useMemo(
    () => bins.filter((row) => row.warehouseId === warehouseId),
    [bins, warehouseId],
  )

  useEffect(() => {
    if (!binsForWarehouse.length) {
      setBinId('')
      setCart([])
      return
    }

    if (!binsForWarehouse.some((row) => row.id === binId)) {
      setBinId(binsForWarehouse[0].id)
      setCart([])
    }
  }, [binId, binsForWarehouse])

  const uomCodeById = useMemo(() => new Map(uoms.map((row) => [row.id, row.code])), [uoms])
  const itemById = useMemo(() => new Map(items.map((row) => [row.id, row])), [items])

  const stockRows = useMemo(() => {
    return stockLevels
      .filter((row) => row.binId === binId)
      .map((row) => {
        const item = itemById.get(row.itemId)
        if (!item || !item.trackInventory || !item.canSell) return null
        return {
          item,
          availableQty: Math.max(round2(row.qty - row.allocatedQty), 0),
          onHandQty: round2(row.qty),
          avgCost: round2(row.avgCost),
          baseUomCode: uomCodeById.get(item.baseUomId || '') || 'EA',
        }
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => row.availableQty > 0)
      .sort((left, right) => left.item.name.localeCompare(right.item.name))
  }, [binId, itemById, stockLevels, uomCodeById])

  const filteredStockRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return stockRows
    return stockRows.filter((row) =>
      [row.item.name, row.item.sku || ''].join(' ').toLowerCase().includes(term),
    )
  }, [search, stockRows])

  const cartSubtotal = useMemo(
    () => round2(cart.reduce((sum, line) => sum + round2(line.qty * line.unitPrice), 0)),
    [cart],
  )
  const cartQty = useMemo(() => round2(cart.reduce((sum, line) => sum + line.qty, 0)), [cart])
  const selectedBin = bins.find((row) => row.id === binId) || null
  const selectedWarehouse = warehouses.find((row) => row.id === warehouseId) || null

  function addItem(itemId: string) {
    const stockRow = stockRows.find((row) => row.item.id === itemId)
    if (!stockRow) return

    setCart((current) => {
      const existing = current.find((row) => row.itemId === itemId)
      if (existing) {
        if (existing.qty >= stockRow.availableQty) return current
        return current.map((row) =>
          row.itemId === itemId
            ? { ...row, qty: round2(Math.min(row.qty + 1, stockRow.availableQty)) }
            : row,
        )
      }

      return [
        ...current,
        {
          itemId,
          name: stockRow.item.name,
          sku: stockRow.item.sku,
          qty: 1,
          availableQty: stockRow.availableQty,
          unitPrice: round2(stockRow.item.unitPrice ?? 0),
          baseUomCode: stockRow.baseUomCode,
        },
      ]
    })
  }

  function updateLineQty(itemId: string, nextQty: number) {
    setCart((current) =>
      current
        .map((row) => {
          if (row.itemId !== itemId) return row
          const clamped = Math.max(0, Math.min(round2(nextQty), row.availableQty))
          return { ...row, qty: clamped }
        })
        .filter((row) => row.qty > 0),
    )
  }

  function updateLinePrice(itemId: string, nextPrice: number) {
    setCart((current) =>
      current.map((row) =>
        row.itemId === itemId
          ? { ...row, unitPrice: Math.max(0, round2(nextPrice)) }
          : row,
      ),
    )
  }

  async function submitIssue() {
    if (!companyId) {
      toast.error(copy.noCompany)
      return
    }
    if (!binId) {
      toast.error(copy.chooseBin)
      return
    }
    if (!cart.length) {
      toast.error(copy.addLines)
      return
    }

    try {
      setSubmitting(true)
      const result = await createOperatorSaleIssue({
        companyId,
        sourceBinId: binId,
        customerId: useNamedCustomer ? customerId || null : null,
        orderDate: new Date().toISOString().slice(0, 10),
        currencyCode: baseCurrencyCode,
        fxToBase: 1,
        referenceNo: referenceNo.trim() || null,
        notes: notes.trim() || null,
        lines: cart.map((line) => ({
          itemId: line.itemId,
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
      })

      await loadData()
      setCart([])
      setNotes('')
      setReferenceNo('')
      setUseNamedCustomer(false)
      setCustomerId('')
      setDrawerOpen(false)
      if (result?.order_no) {
        toast.success(copy.successWithOrder.replace('{orderNo}', result.order_no))
      } else {
        toast.success(copy.success)
      }
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || copy.couldNotPost)
    } finally {
      setSubmitting(false)
    }
  }

  const renderSaleSummary = (mobile = false) => (
    <Card className={mobile ? 'border-border/70 shadow-lg' : 'border-border/70 shadow-sm'}>
      <CardHeader className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{copy.currentTitle}</CardTitle>
            <CardDescription>{copy.currentBody}</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-full">
            <UserRound className="mr-1 h-3.5 w-3.5" />
            {useNamedCustomer ? copy.namedCustomer : copy.walkIn}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            type="button"
            variant={useNamedCustomer ? 'outline' : 'default'}
            className="justify-start rounded-2xl"
            onClick={() => {
              setUseNamedCustomer(false)
              setCustomerId('')
            }}
          >
            {copy.walkIn}
          </Button>
          <Button
            type="button"
            variant={useNamedCustomer ? 'default' : 'outline'}
            className="justify-start rounded-2xl"
            onClick={() => setUseNamedCustomer(true)}
          >
            {copy.namedCustomer}
          </Button>
        </div>

        {useNamedCustomer ? (
          <div className="space-y-2">
            <Label>{copy.chooseCustomer}</Label>
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger className="rounded-2xl">
                <SelectValue placeholder={copy.chooseCustomer} />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {(customer.code ? `${customer.code} — ` : '') + customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}

        <div className="rounded-2xl border border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
          {copy.pricingHelp}
        </div>

        <div className="space-y-3">
          {cart.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-6 text-center">
              <div className="text-sm font-medium">{copy.noLines}</div>
              <div className="mt-2 text-xs text-muted-foreground">{copy.noLinesHelp}</div>
            </div>
          ) : (
            cart.map((line) => (
              <div key={line.itemId} className="rounded-2xl border border-border/70 bg-background/80 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {[line.sku, `${copy.available} ${formatQty(line.availableQty)} ${line.baseUomCode}`]
                        .filter(Boolean)
                        .join(' • ')}
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-9 rounded-xl px-3 text-xs"
                    onClick={() => updateLineQty(line.itemId, 0)}
                  >
                    {copy.remove}
                  </Button>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end">
                  <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-muted/15 p-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl"
                      onClick={() => updateLineQty(line.itemId, round2(line.qty - 1))}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <Input
                      type="number"
                      min="0"
                      max={line.availableQty}
                      step="0.01"
                      value={String(line.qty)}
                      className="h-10 w-24 border-0 bg-transparent text-center shadow-none"
                      onChange={(event) => updateLineQty(line.itemId, toNumber(event.target.value))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-10 w-10 rounded-xl"
                      onClick={() => updateLineQty(line.itemId, round2(line.qty + 1))}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <Label>{copy.summaryQty}</Label>
                    <div className="text-sm font-medium">
                      {formatQty(line.qty)} {line.baseUomCode}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{copy.unitPrice}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={String(line.unitPrice)}
                      onChange={(event) => updateLinePrice(line.itemId, toNumber(event.target.value))}
                    />
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-muted-foreground">{baseCurrencyCode}</div>
                    <div className="text-base font-semibold">
                      {round2(line.qty * line.unitPrice).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="grid gap-3 rounded-2xl border border-border/70 bg-muted/15 p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{copy.summaryItems}</div>
            <div className="mt-1 text-lg font-semibold">{cart.length}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{copy.summaryQty}</div>
            <div className="mt-1 text-lg font-semibold">{formatQty(cartQty)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{copy.summaryTotal}</div>
            <div className="mt-1 text-lg font-semibold">
              {cartSubtotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {baseCurrencyCode}
            </div>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="space-y-2">
            <Label>{copy.reference}</Label>
            <Input
              value={referenceNo}
              onChange={(event) => setReferenceNo(event.target.value)}
              placeholder={copy.referencePlaceholder}
            />
          </div>
          <div className="space-y-2">
            <Label>{copy.notes}</Label>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={copy.notesPlaceholder}
              rows={3}
            />
          </div>
        </div>

        <Button className="h-12 w-full rounded-2xl" disabled={!canPost || submitting || cart.length === 0} onClick={() => void submitIssue()}>
          {submitting ? copy.posting : copy.confirm}
        </Button>
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-6">
      <Card className="border-border/70 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <div className="inline-flex items-center rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
                <ShoppingBag className="mr-2 h-3.5 w-3.5" />
                {copy.title}
              </div>
              <CardTitle className="text-2xl md:text-3xl">{copy.subtitle}</CardTitle>
              <CardDescription className="max-w-3xl text-sm leading-6">
                {copy.headerHelp}
              </CardDescription>
            </div>
            {!canPost ? (
              <Badge variant="outline" className="rounded-full border-amber-500/40 bg-amber-500/10 text-amber-700">
                {copy.readOnly}
              </Badge>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            <div className="rounded-2xl border border-border/70 bg-background/85 p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{copy.sourceTitle}</div>
              <div className="mt-1 text-sm text-muted-foreground">{copy.sourceBody}</div>
            </div>
            <div className="space-y-2 rounded-2xl border border-border/70 bg-background/85 p-4">
              <Label>{copy.warehouse}</Label>
              <Select value={warehouseId} onValueChange={(value) => { setWarehouseId(value); setCart([]) }}>
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder={copy.warehouse} />
                </SelectTrigger>
                <SelectContent>
                  {warehouses.map((warehouse) => (
                    <SelectItem key={warehouse.id} value={warehouse.id}>
                      {warehouse.name} ({warehouse.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 rounded-2xl border border-border/70 bg-background/85 p-4">
              <Label>{copy.bin}</Label>
              <Select value={binId} onValueChange={(value) => { setBinId(value); setCart([]) }}>
                <SelectTrigger className="rounded-2xl">
                  <SelectValue placeholder={copy.bin} />
                </SelectTrigger>
                <SelectContent>
                  {binsForWarehouse.map((bin) => (
                    <SelectItem key={bin.id} value={bin.id}>
                      {bin.code} — {bin.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.searchPlaceholder}
              className="h-12 rounded-2xl pl-11"
            />
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_380px]">
        <Card className="border-border/70 shadow-sm">
          <CardHeader className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>{copy.itemsTitle}</CardTitle>
                <CardDescription>{copy.itemsBody}</CardDescription>
              </div>
              {selectedWarehouse && selectedBin ? (
                <Badge variant="outline" className="rounded-full">
                  <Warehouse className="mr-1 h-3.5 w-3.5" />
                  {selectedWarehouse.code} / {selectedBin.code}
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
                {copy.loading}
              </div>
            ) : filteredStockRows.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center">
                <div className="text-sm font-medium">{copy.itemsEmpty}</div>
                <div className="mt-2 text-xs text-muted-foreground">{copy.itemsEmptyHelp}</div>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {filteredStockRows.map((row) => {
                  const currentLine = cart.find((line) => line.itemId === row.item.id)
                  return (
                    <div key={row.item.id} className="rounded-3xl border border-border/70 bg-background/80 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{row.item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {[row.item.sku, `${copy.available} ${formatQty(row.availableQty)} ${row.baseUomCode}`]
                              .filter(Boolean)
                              .join(' • ')}
                          </div>
                        </div>
                        {currentLine ? (
                          <Badge variant="secondary" className="rounded-full">
                            {formatQty(currentLine.qty)} {row.baseUomCode}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-border/60 bg-muted/10 p-3">
                          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{copy.onHand}</div>
                          <div className="mt-1 text-lg font-semibold">
                            {formatQty(row.onHandQty)} {row.baseUomCode}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-border/60 bg-muted/10 p-3">
                          <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{baseCurrencyCode}</div>
                          <div className="mt-1 text-lg font-semibold">
                            {round2(row.item.unitPrice ?? 0).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </div>
                        </div>
                      </div>

                      <Button
                        type="button"
                        className="mt-4 h-12 w-full rounded-2xl"
                        disabled={!canPost || row.availableQty <= 0}
                        onClick={() => addItem(row.item.id)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {currentLine ? copy.addAnother : copy.addOne}
                      </Button>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="hidden xl:block xl:sticky xl:top-24 xl:self-start">
          {renderSaleSummary(false)}
        </div>
      </div>

      {cart.length > 0 ? (
        <div className="fixed inset-x-4 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-30 xl:hidden">
          <Button
            type="button"
            className="h-14 w-full rounded-2xl shadow-lg"
            onClick={() => setDrawerOpen(true)}
          >
            <ShoppingBag className="mr-2 h-4 w-4" />
            {copy.reviewIssue}
            <span className="ml-3 text-xs font-medium opacity-80">
              {cart.length} • {formatQty(cartQty)} • {cartSubtotal.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}{' '}
              {baseCurrencyCode}
            </span>
          </Button>
        </div>
      ) : null}

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent className="max-h-[88vh] rounded-t-[28px]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{copy.drawerTitle}</DrawerTitle>
            <DrawerDescription>{copy.drawerBody}</DrawerDescription>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-8">
            {renderSaleSummary(true)}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  )
}

