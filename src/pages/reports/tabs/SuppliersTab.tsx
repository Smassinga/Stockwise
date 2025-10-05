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

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

export default function SuppliersTab() {
  const { t, lang } = useI18n()
  const tt = (k: string, fb: string) => (t(k as any) === k ? fb : t(k as any))
  const { companyId } = useOrg()

  const { ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }

  const [baseCode, setBaseCode] = useState('MZN')
  const [from, setFrom] = useState<string>(startDate)
  const [to, setTo] = useState<string>(endDate)
  const [supplierId, setSupplierId] = useState<string>('ALL')
  const [q, setQ] = useState<string>('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [rows, setRows] = useState<RowT[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      try {
        setLoading(true)
        setBaseCode(await getBaseCurrencyCode())
        if (!companyId) return

        // scope suppliers to the active company
        const cs = await supabase
          .from('suppliers')
          .select('id,code,name,company_id')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (cs.error) throw cs.error
        setSuppliers((cs.data || []) as Supplier[])

        await fetchRows(companyId)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function fetchRows(cid = companyId) {
    if (!cid) return
    setLoading(true)
    try {
      let qy = supabase
        .from('supplier_movements_view')
        .select('*')
        .eq('company_id', cid)
        .gte('created_at', from)
        .lte('created_at', to + ' 23:59:59')
        .order('created_at', { ascending: false })

      if (supplierId !== 'ALL') qy = qy.eq('supplier_id', supplierId)

      const { data, error } = await qy
      if (error) throw error

      const term = q.trim().toLowerCase()
      const filtered = !term
        ? (data || [])
        : (data || []).filter((r: any) => {
            const hay = `${r.ref_type || ''} ${r.ref_no || ''} ${r.item_name || ''} ${r.item_sku || ''} ${r.supplier_name || ''}`.toLowerCase()
            return hay.includes(term)
          })

      setRows(filtered as RowT[])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const count = rows.length
  const totalValue = useMemo(() => rows.reduce((s, r) => s + num(r.total_value), 0), [rows])

  // ---------- Export handlers ----------
  const stamp = endDate.replace(/-/g, '')
  const exportBody: Row[] = [
    ['Date', 'Ref', 'Item', 'Qty (base)', `Value (${displayCurrency})`, 'Notes'],
    ...rows.map(r => [
      new Date(r.created_at).toLocaleString(lang),
      `${r.ref_type || ''}${r.ref_no ? ` ${r.ref_no}` : ''}`,
      r.item_name ? `${r.item_name}${r.item_sku ? ` (${r.item_sku})` : ''}` : (r.item_id || ''),
      Number(num(r.qty_base)),
      Number(num(r.total_value)),
      r.notes || '',
    ]),
  ]

  const onCSV  = () => downloadCSV(`supplier_movements_${stamp}.csv`, [
    ...headerRows(ctx, 'Supplier Movements'),
    ...formatRowsForCSV(exportBody, ctx, [4], [3]),
  ])

  const onXLSX = () => saveXLSX(`supplier_movements_${stamp}.xlsx`, ctx, [
    { title: 'Movements', headerTitle: 'Supplier Movements', body: exportBody, moneyCols: [4], qtyCols: [3] },
  ])

  const onPDF  = () => { const doc = startPDF(ctx, 'Supplier Movements'); pdfTable(doc, exportBody[0] as string[], exportBody.slice(1), [4], ctx, 110); doc.save(`supplier_movements_${stamp}.pdf`) }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tt('reports.suppliers.title', 'Suppliers')}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="w-40">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-40">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="w-64">
            <Select value={supplierId} onValueChange={setSupplierId}>
              <SelectTrigger><SelectValue placeholder={tt('common.select', 'Select')} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="ALL">{tt('common.all', 'All')}</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {(s.code ? s.code + ' — ' : '') + s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <Input placeholder={tt('common.search', 'Search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={() => fetchRows()} disabled={loading}>
            {tt('common.apply', 'Apply')}
          </Button>
        </div>

        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        <div className="mb-2 text-sm text-muted-foreground">
          {tt('transactions.summary', 'Transactions')}: {count}
          {' '}• {tt('table.value', 'Value')}: {formatMoneyBase(totalValue, baseCode)}
        </div>

        <div className="max-h-[520px] overflow-auto overscroll-contain rounded-md border">
          <div className="min-w-[900px] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{tt('table.date', 'Date')}</th>
                  <th className="py-2 pr-2">{tt('table.ref', 'Ref')}</th>
                  <th className="py-2 pr-2">{tt('table.item', 'Item')}</th>
                  <th className="py-2 pr-2">{tt('table.qtyBase', 'Qty (base)')}</th>
                  <th className="py-2 pr-2">{tt('table.value', 'Value')}</th>
                  <th className="py-2 pr-2">{tt('table.notes', 'Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-muted-foreground">{tt('common.noResults', 'No results')}</td></tr>
                ) : rows.map(r => (
                  <tr key={`${r.id}-${r.created_at}`} className="border-b">
                    <td className="py-2 pr-2">{new Date(r.created_at).toLocaleString(lang)}</td>
                    <td className="py-2 pr-2">{r.ref_type || '—'}{r.ref_no ? ` ${r.ref_no}` : ''}</td>
                    <td className="py-2 pr-2">
                      {r.item_name ? `${r.item_name}${r.item_sku ? ` (${r.item_sku})` : ''}` : (r.item_id || '—')}
                    </td>
                    <td className="py-2 pr-2">{r.qty_base != null ? num(r.qty_base) : '—'}</td>
                    <td className="py-2 pr-2">{r.total_value != null ? formatMoneyBase(num(r.total_value), baseCode) : '—'}</td>
                    <td className="py-2 pr-2">{r.notes || '—'}</td>
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
