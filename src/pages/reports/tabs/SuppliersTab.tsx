// src/pages/reports/tabs/SuppliersTab.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase'
import { useI18n } from '../../../lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { formatMoneyBase, getBaseCurrencyCode } from '../../../lib/currency'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'
import { useReports } from '../context/ReportsProvider'
import { useOrg } from '../../../hooks/useOrg'

type RowT = {
  id: string
  created_at: string
  supplier_id: string | null
  supplier_code: string | null
  supplier_name: string | null
  ref_type: string | null
  ref_no: string | null
  item_id: string | null
  item_name: string | null
  item_sku: string | null
  qty_base: number | null
  total_value: number | null
  notes: string | null
  company_id: string | null
}

type Supplier = { id: string; code: string | null; name: string; company_id: string | null }

const num = (value: any, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback)

export default function SuppliersTab() {
  const { t, lang } = useI18n()
  const tt = (key: string, fallback: string) => (t(key as any) === key ? fallback : t(key as any))
  const { companyId } = useOrg()
  const { ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }

  const [baseCode, setBaseCode] = useState('MZN')
  const [from, setFrom] = useState<string>(startDate)
  const [to, setTo] = useState<string>(endDate)
  const [supplierId, setSupplierId] = useState<string>('ALL')
  const [query, setQuery] = useState<string>('')
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [rows, setRows] = useState<RowT[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        setBaseCode(await getBaseCurrencyCode())
        if (!companyId) return

        const suppliersRes = await supabase.from('suppliers').select('id,code,name,company_id').eq('company_id', companyId).order('name', { ascending: true })
        if (suppliersRes.error) throw suppliersRes.error
        setSuppliers((suppliersRes.data || []) as Supplier[])

        await fetchRows(companyId)
      } catch (error) {
        console.error(error)
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function fetchRows(activeCompanyId = companyId) {
    if (!activeCompanyId) return
    setLoading(true)
    try {
      let queryBuilder = supabase
        .from('supplier_movements_view')
        .select('*')
        .eq('company_id', activeCompanyId)
        .gte('created_at', from)
        .lte('created_at', `${to} 23:59:59`)
        .order('created_at', { ascending: false })

      if (supplierId !== 'ALL') queryBuilder = queryBuilder.eq('supplier_id', supplierId)
      const { data, error } = await queryBuilder
      if (error) throw error

      const term = query.trim().toLowerCase()
      const filtered = !term
        ? data || []
        : (data || []).filter((row: any) => {
            const haystack = `${row.ref_type || ''} ${row.ref_no || ''} ${row.item_name || ''} ${row.item_sku || ''} ${row.supplier_name || ''}`.toLowerCase()
            return haystack.includes(term)
          })

      setRows(filtered as RowT[])
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  const movementCount = rows.length
  const totalValue = useMemo(() => rows.reduce((sum, row) => sum + num(row.total_value), 0), [rows])
  const stamp = endDate.replace(/-/g, '')
  const exportBody: Row[] = [
    [tt('table.date', 'Date'), tt('table.ref', 'Ref'), tt('table.item', 'Item'), tt('table.qtyBase', 'Qty (base)'), `${tt('table.value', 'Value')} (${displayCurrency})`, tt('table.notes', 'Notes')],
    ...rows.map((row) => [
      new Date(row.created_at).toLocaleString(lang),
      `${row.ref_type || ''}${row.ref_no ? ` ${row.ref_no}` : ''}`,
      row.item_name ? `${row.item_name}${row.item_sku ? ` (${row.item_sku})` : ''}` : (row.item_id || ''),
      Number(num(row.qty_base)),
      Number(num(row.total_value)),
      row.notes || '',
    ]),
  ]

  const onCSV = async () => {
    await downloadCSV(`supplier_movements_${stamp}.csv`, [
      ...headerRows(ctx, tt('reports.supplierMovements', 'Supplier Movements')),
      ...formatRowsForCSV(exportBody, ctx, [4], [3]),
    ])
  }

  const onXLSX = async () => {
    await saveXLSX(`supplier_movements_${stamp}.xlsx`, ctx, [
      { title: 'Movements', headerTitle: tt('reports.supplierMovements', 'Supplier Movements'), body: exportBody, moneyCols: [4], qtyCols: [3] },
    ])
  }

  const onPDF = async () => {
    const doc = await startPDF(ctx, tt('reports.supplierMovements', 'Supplier Movements'))
    await pdfTable(doc, exportBody[0] as string[], exportBody.slice(1), [4], ctx, 110)
    doc.save(`supplier_movements_${stamp}.pdf`)
  }

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle>{tt('reports.suppliers.title', 'Suppliers')}</CardTitle>
        <p className="text-sm text-muted-foreground">{tt('reports.supplierMovementsHelp', 'Review item-level purchase-side movements and value by supplier inside the same reporting context used across inventory and orders.')}</p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[180px_180px_minmax(0,260px)_minmax(0,220px)_auto]">
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          <Select value={supplierId} onValueChange={setSupplierId}>
            <SelectTrigger><SelectValue placeholder={tt('common.select', 'Select')} /></SelectTrigger>
            <SelectContent className="max-h-64">
              <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
              {suppliers.map((supplier) => (
                <SelectItem key={supplier.id} value={supplier.id}>
                  {(supplier.code ? `${supplier.code} — ` : '') + supplier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input placeholder={tt('common.search', 'Search')} value={query} onChange={(event) => setQuery(event.target.value)} />
          <Button variant="secondary" onClick={() => fetchRows()} disabled={loading}>
            {tt('common.apply', 'Apply')}
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('transactions.summary', 'Transactions')}</p>
            <div className="mt-2 text-lg font-semibold">{movementCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.supplierMovementCountHelp', 'Movement rows currently matching the selected supplier and date filters.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('table.value', 'Value')}</p>
            <div className="mt-2 text-lg font-semibold">{formatMoneyBase(totalValue, baseCode)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.supplierValueHelp', 'Base-currency value represented by the filtered supplier movement rows.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.supplierCoverage', 'Supplier coverage')}</p>
            <div className="mt-2 text-lg font-semibold">{supplierId === 'ALL' ? suppliers.length : 1}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.supplierCoverageHelp', 'Supplier scope currently in view for this movement report.')}</p>
          </div>
        </div>

        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} className="mt-0 justify-end" />

        <div className="max-h-[560px] overflow-auto rounded-xl border border-border/70">
          <div className="min-w-[900px] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left">
                  <th className="px-3 py-2">{tt('table.date', 'Date')}</th>
                  <th className="px-3 py-2">{tt('table.ref', 'Ref')}</th>
                  <th className="px-3 py-2">{tt('table.item', 'Item')}</th>
                  <th className="px-3 py-2 text-right">{tt('table.qtyBase', 'Qty (base)')}</th>
                  <th className="px-3 py-2 text-right">{tt('table.value', 'Value')}</th>
                  <th className="px-3 py-2">{tt('table.notes', 'Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-sm text-muted-foreground">
                      {tt('common.noResults', 'No results')}
                    </td>
                  </tr>
                ) : rows.map((row) => (
                  <tr key={`${row.id}-${row.created_at}`} className="border-t">
                    <td className="px-3 py-3">{new Date(row.created_at).toLocaleString(lang)}</td>
                    <td className="px-3 py-3">{row.ref_type || '—'}{row.ref_no ? ` ${row.ref_no}` : ''}</td>
                    <td className="px-3 py-3">{row.item_name ? `${row.item_name}${row.item_sku ? ` (${row.item_sku})` : ''}` : (row.item_id || '—')}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.qty_base != null ? num(row.qty_base) : '—'}</td>
                    <td className="px-3 py-3 text-right font-mono tabular-nums">{row.total_value != null ? formatMoneyBase(num(row.total_value), baseCode) : '—'}</td>
                    <td className="px-3 py-3">{row.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
