import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useOrg } from '../hooks/useOrg'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Search, Package, Users, Truck, ShoppingCart, Receipt } from 'lucide-react'
import { useI18n } from '../lib/i18n'

type SearchResult = {
  id: string
  type: 'item' | 'customer' | 'supplier' | 'purchase_order' | 'sales_order'
  name: string
  description?: string
  url: string
}

export default function SearchResults() {
  const location = useLocation()
  const navigate = useNavigate()
  const { companyId } = useOrg()
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)

  // Get search query from URL parameters
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const q = params.get('q') || ''
    setQuery(q)
    if (q && companyId) {
      performSearch(q)
    }
  }, [location.search, companyId])

  const performSearch = async (searchQuery: string) => {
    if (!companyId || !searchQuery.trim()) return
    
    setLoading(true)
    try {
      const term = searchQuery.trim().toLowerCase()
      const allResults: SearchResult[] = []

      // Search items
      const { data: items } = await supabase
        .from('items')
        .select('id, name, sku')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)

      if (items) {
        items.forEach(item => {
          allResults.push({
            id: item.id,
            type: 'item',
            name: item.name,
            description: `SKU: ${item.sku}`,
            url: `/items/${item.id}`
          })
        })
      }

      // Search customers
      const { data: customers } = await supabase
        .from('customers')
        .select('id, name, code')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)

      if (customers) {
        customers.forEach(customer => {
          allResults.push({
            id: customer.id,
            type: 'customer',
            name: customer.name,
            description: customer.code ? `Code: ${customer.code}` : undefined,
            url: `/customers/${customer.id}`
          })
        })
      }

      // Search suppliers
      const { data: suppliers } = await supabase
        .from('suppliers')
        .select('id, name, code')
        .eq('company_id', companyId)
        .ilike('name', `%${term}%`)
        .limit(10)

      if (suppliers) {
        suppliers.forEach(supplier => {
          allResults.push({
            id: supplier.id,
            type: 'supplier',
            name: supplier.name,
            description: supplier.code ? `Code: ${supplier.code}` : undefined,
            url: `/suppliers/${supplier.id}`
          })
        })
      }

      // Search purchase orders
      const { data: purchaseOrders } = await supabase
        .from('purchase_orders')
        .select('id, order_no, supplier_name')
        .eq('company_id', companyId)
        .or(`order_no.ilike.%${term}%,supplier_name.ilike.%${term}%`)
        .limit(10)

      if (purchaseOrders) {
        purchaseOrders.forEach(po => {
          allResults.push({
            id: po.id,
            type: 'purchase_order',
            name: `PO #${po.order_no}`,
            description: po.supplier_name,
            url: `/orders/purchase/${po.id}`
          })
        })
      }

      // Search sales orders
      const { data: salesOrders } = await supabase
        .from('sales_orders')
        .select('id, order_no, bill_to_name')
        .eq('company_id', companyId)
        .or(`order_no.ilike.%${term}%,bill_to_name.ilike.%${term}%`)
        .limit(10)

      if (salesOrders) {
        salesOrders.forEach(so => {
          allResults.push({
            id: so.id,
            type: 'sales_order',
            name: `SO #${so.order_no}`,
            description: so.bill_to_name,
            url: `/orders/sales/${so.id}`
          })
        })
      }

      setResults(allResults)
    } catch (error) {
      console.error('Search error:', error)
      // Show error to user
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    navigate(`/search?q=${encodeURIComponent(query.trim())}`)
  }

  const getTypeIcon = (type: SearchResult['type']) => {
    switch (type) {
      case 'item': return <Package className="h-4 w-4" />
      case 'customer': return <Users className="h-4 w-4" />
      case 'supplier': return <Truck className="h-4 w-4" />
      case 'purchase_order': return <ShoppingCart className="h-4 w-4" />
      case 'sales_order': return <Receipt className="h-4 w-4" />
      default: return <Search className="h-4 w-4" />
    }
  }

  const getTypeLabel = (type: SearchResult['type']) => {
    switch (type) {
      case 'item': return 'Item'
      case 'customer': return 'Customer'
      case 'supplier': return 'Supplier'
      case 'purchase_order': return 'Purchase Order'
      case 'sales_order': return 'Sales Order'
      default: return 'Result'
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t('search.results')}</h1>
        <p className="text-muted-foreground">{t('search.resultsFor')}: "{query}"</p>
      </div>

      <Card>
        <CardHeader>
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('common.searchPlaceholder')}
                className="pl-10"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={loading}>
              {loading ? t('actions.searching') : t('actions.search')}
            </Button>
          </form>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="p-8 text-center">
              <p>{t('search.searching')}</p>
            </div>
          ) : results.length === 0 ? (
            <div className="p-8 text-center">
              <Search className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 font-medium">{t('search.noResults')}</h3>
              <p className="text-muted-foreground">{t('search.tryDifferent')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {results.map((result) => (
                <div 
                  key={`${result.type}-${result.id}`}
                  className="flex items-center gap-4 rounded-lg border p-4 hover:bg-accent cursor-pointer"
                  onClick={() => navigate(result.url)}
                >
                  <div className="rounded-md bg-primary/10 p-2">
                    {getTypeIcon(result.type)}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium">{result.name}</div>
                    {result.description && (
                      <div className="text-sm text-muted-foreground">{result.description}</div>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getTypeLabel(result.type)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}