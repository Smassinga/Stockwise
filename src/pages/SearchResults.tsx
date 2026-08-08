import { useEffect, useState } from 'react'
import { FileText, Package, Receipt, Search, ShoppingCart, Truck, Users } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PremiumEmptyState, PremiumStatePanel } from '../components/premium/PremiumEmptyState'
import { PremiumPageHeader } from '../components/premium/PremiumPageHeader'
import { PremiumSkeleton } from '../components/premium/PremiumSkeleton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { useOrg } from '../hooks/useOrg'
import {
  SALES_INVOICE_STATE_VIEW,
  VENDOR_BILL_STATE_VIEW,
  isMissingFinanceViewError,
} from '../lib/financeDocuments'
import { useI18n } from '../lib/i18n'
import { supabase } from '../lib/supabase'

type SearchResult = {
  id: string
  type: 'item' | 'customer' | 'supplier' | 'purchase_order' | 'sales_order' | 'sales_invoice' | 'vendor_bill'
  name: string
  description?: string
  url: string
}

export default function SearchResults() {
  const location = useLocation()
  const navigate = useNavigate()
  const { companyId } = useOrg()
  const { t, lang } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const copy = lang === 'pt'
    ? {
        inputLabel: 'Pesquisar no StockWise',
        resultType: 'Tipo de resultado',
        noQuery: 'Introduza um nome, código ou referência para pesquisar.',
        unavailable: 'Não foi possível concluir a pesquisa.',
        unavailableHelp: 'Tente novamente. Os registos existentes não foram alterados.',
        retry: 'Tentar novamente',
      }
    : {
        inputLabel: 'Search StockWise',
        resultType: 'Result type',
        noQuery: 'Enter a name, code, or reference to search.',
        unavailable: 'The search could not be completed.',
        unavailableHelp: 'Try again. Existing records were not changed.',
        retry: 'Try again',
      }
  const orderWorkspaceUrl = (tab: 'purchase' | 'sales', orderId: string) =>
    `/orders?tab=${tab}&orderId=${encodeURIComponent(orderId)}`

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const q = params.get('q') || ''
    setQuery(q)
    if (q && companyId) void performSearch(q)
    if (!q) {
      setResults([])
      setLoadError(false)
    }
  }, [location.search, companyId])

  async function performSearch(searchQuery: string) {
    if (!companyId || !searchQuery.trim()) return

    setLoading(true)
    setLoadError(false)
    try {
      const term = searchQuery.trim().toLowerCase()
      const allResults: SearchResult[] = []

      const { data: items, error: itemsError } = await supabase
        .from('items')
        .select('id, name, sku')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)
      if (itemsError) throw itemsError
      items?.forEach((item) => allResults.push({
        id: item.id,
        type: 'item',
        name: item.name,
        description: `SKU: ${item.sku}`,
        url: `/items?q=${encodeURIComponent(item.name)}`,
      }))

      const { data: customers, error: customersError } = await supabase
        .from('customers')
        .select('id, name, code')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)
      if (customersError) throw customersError
      customers?.forEach((customer) => allResults.push({
        id: customer.id,
        type: 'customer',
        name: customer.name,
        description: customer.code ? `${lang === 'pt' ? 'Código' : 'Code'}: ${customer.code}` : undefined,
        url: `/customers?q=${encodeURIComponent(customer.name)}`,
      }))

      const { data: suppliers, error: suppliersError } = await supabase
        .from('suppliers')
        .select('id, name, code')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)
      if (suppliersError) throw suppliersError
      suppliers?.forEach((supplier) => allResults.push({
        id: supplier.id,
        type: 'supplier',
        name: supplier.name,
        description: supplier.code ? `${lang === 'pt' ? 'Código' : 'Code'}: ${supplier.code}` : undefined,
        url: `/suppliers?q=${encodeURIComponent(supplier.name)}`,
      }))

      const { data: purchaseOrders, error: purchaseOrdersError } = await supabase
        .from('purchase_orders')
        .select('id, order_no, supplier_name')
        .eq('company_id', companyId)
        .or(`order_no.ilike.%${term}%,supplier_name.ilike.%${term}%`)
        .limit(10)
      if (purchaseOrdersError) throw purchaseOrdersError
      purchaseOrders?.forEach((order) => allResults.push({
        id: order.id,
        type: 'purchase_order',
        name: `PO #${order.order_no}`,
        description: order.supplier_name,
        url: orderWorkspaceUrl('purchase', order.id),
      }))

      const { data: salesOrders, error: salesOrdersError } = await supabase
        .from('sales_orders')
        .select('id, order_no, bill_to_name')
        .eq('company_id', companyId)
        .or(`order_no.ilike.%${term}%,bill_to_name.ilike.%${term}%`)
        .limit(10)
      if (salesOrdersError) throw salesOrdersError
      salesOrders?.forEach((order) => allResults.push({
        id: order.id,
        type: 'sales_order',
        name: `SO #${order.order_no}`,
        description: order.bill_to_name,
        url: orderWorkspaceUrl('sales', order.id),
      }))

      const { data: salesInvoices, error: salesInvoicesError } = await supabase
        .from(SALES_INVOICE_STATE_VIEW)
        .select('id, internal_reference, counterparty_name, order_no')
        .eq('company_id', companyId)
        .or(`internal_reference.ilike.%${term}%,counterparty_name.ilike.%${term}%,order_no.ilike.%${term}%`)
        .limit(10)
      if (salesInvoicesError) {
        if (!isMissingFinanceViewError(salesInvoicesError, SALES_INVOICE_STATE_VIEW)) throw salesInvoicesError
      } else {
        salesInvoices?.forEach((invoice) => allResults.push({
          id: invoice.id,
          type: 'sales_invoice',
          name: invoice.internal_reference,
          description: invoice.counterparty_name || (invoice.order_no ? `Order ${invoice.order_no}` : undefined),
          url: `/sales-invoices/${invoice.id}`,
        }))
      }

      const { data: vendorBills, error: vendorBillsError } = await supabase
        .from(VENDOR_BILL_STATE_VIEW)
        .select('id, internal_reference, supplier_invoice_reference, primary_reference, counterparty_name, order_no')
        .eq('company_id', companyId)
        .or(`internal_reference.ilike.%${term}%,supplier_invoice_reference.ilike.%${term}%,counterparty_name.ilike.%${term}%,order_no.ilike.%${term}%`)
        .limit(10)
      if (vendorBillsError) {
        if (!isMissingFinanceViewError(vendorBillsError, VENDOR_BILL_STATE_VIEW)) throw vendorBillsError
      } else {
        vendorBills?.forEach((bill) => {
          const secondary = bill.internal_reference !== bill.primary_reference ? `Internal: ${bill.internal_reference}` : undefined
          allResults.push({
            id: bill.id,
            type: 'vendor_bill',
            name: bill.primary_reference,
            description: [bill.counterparty_name, secondary].filter(Boolean).join(' • ') || undefined,
            url: `/vendor-bills/${bill.id}`,
          })
        })
      }

      setResults(allResults)
    } catch (error) {
      console.error('Search error:', error)
      setResults([])
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  function handleSearch(event: React.FormEvent) {
    event.preventDefault()
    if (!query.trim()) return
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  function getTypeIcon(type: SearchResult['type']) {
    if (type === 'item') return <Package className="h-4 w-4" />
    if (type === 'customer') return <Users className="h-4 w-4" />
    if (type === 'supplier') return <Truck className="h-4 w-4" />
    if (type === 'purchase_order') return <ShoppingCart className="h-4 w-4" />
    if (type === 'sales_order') return <Receipt className="h-4 w-4" />
    return <FileText className="h-4 w-4" />
  }

  function getTypeLabel(type: SearchResult['type']) {
    const labels = lang === 'pt'
      ? { item: 'Artigo', customer: 'Cliente', supplier: 'Fornecedor', purchase_order: 'Ordem de compra', sales_order: 'Ordem de venda', sales_invoice: 'Fatura de cliente', vendor_bill: 'Fatura de fornecedor' }
      : { item: 'Item', customer: 'Customer', supplier: 'Supplier', purchase_order: 'Purchase order', sales_order: 'Sales order', sales_invoice: 'Sales invoice', vendor_bill: 'Vendor bill' }
    return labels[type]
  }

  return (
    <div className="app-page space-y-6">
      <PremiumPageHeader
        title={t('search.results')}
        description={query ? <>{t('search.resultsFor')}: “{query}”</> : undefined}
      />

      <form onSubmit={handleSearch} className="flex max-w-3xl flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label={copy.inputLabel}
            placeholder={t('common.searchPlaceholder')}
            className="pl-10"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? t('actions.searching') : t('actions.search')}
        </Button>
      </form>

      {loading ? (
        <PremiumSkeleton variant="list" rows={5} label={t('search.searching')} />
      ) : loadError ? (
        <PremiumStatePanel
          kind="error"
          title={copy.unavailable}
          description={copy.unavailableHelp}
          action={<Button type="button" variant="outline" onClick={() => void performSearch(query)}>{copy.retry}</Button>}
        />
      ) : !query.trim() ? (
        <PremiumEmptyState icon={<Search />} title={copy.noQuery} />
      ) : results.length === 0 ? (
        <PremiumEmptyState icon={<Search />} title={t('search.noResults')} description={t('search.tryDifferent')} />
      ) : (
        <section aria-label={t('search.results')} className="divide-y divide-border border-y border-border">
          {results.map((result) => (
            <Link
              key={`${result.type}-${result.id}`}
              className="flex min-h-16 items-center gap-3 px-1 py-4 transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              to={result.url}
            >
              <span className="shrink-0 text-muted-foreground" aria-hidden="true">{getTypeIcon(result.type)}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-foreground">{result.name}</span>
                {result.description ? <span className="block break-words text-sm text-muted-foreground">{result.description}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground" aria-label={`${copy.resultType}: ${getTypeLabel(result.type)}`}>
                {getTypeLabel(result.type)}
              </span>
            </Link>
          ))}
        </section>
      )}
    </div>
  )
}
