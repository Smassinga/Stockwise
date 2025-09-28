import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/db'
import { useI18n } from '../../../lib/i18n'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { Button } from '../../../components/ui/button'
import { Input } from '../../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select'
import { formatMoneyBase, getBaseCurrencyCode } from '../../../lib/currency'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'
import { useReports } from '../context/ReportsProvider'

type Supplier = { id: string; code: string | null; name: string }

// Normalized shape we render/export
type DisplayRow = {
  id: string
  createdAt: string
  supplierId: string | null
  supplierCode: string | null
  supplierName: string | null
  refType: string | null
  refNo: string | null
  itemId: string | null
  itemName: string | null
  itemSku: string | null
  qtyBase: number | null
  totalValue: number | null
  notes: string | null
}

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

// i18n helper so we don’t show raw keys on screen
const tr = (t: (k: any) => string, key: string, fallback: string) =>
  (t(key as any) === key ? fallback : t(key as any))

// Detect missing PostgREST table/view
const isPgRestMissing = (err: any) => {
  const code = err?.code || ''
  const msg = String(err?.message || '').toLowerCase()
  return code === 'PGRST205' || msg.includes('could not find the table') || msg.includes('schema cache')
}

export default function SuppliersTab() {
  const { t, lang } = useI18n()
  const { ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }

  const [baseCode, setBaseCode] = useState('MZN')
  const [from, setFrom] = useState<string>(startDate)
  const [to, setTo] = useState<string>(endDate)
  const [supplierId, setSupplierId] = useState<string>('ALL')
  const [q, setQ] = useState<string>('')

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [rows, setRows] = useState<DisplayRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setBaseCode(await getBaseCurrencyCode())
      const ss = await supabase.from('suppliers').select('id,code,name').order('name', { ascending: true })
      setSuppliers((ss.data || []) as Supplier[])
      await fetchRows()
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchRows() {
    setLoading(true)
    try {
      // Try the movements view (best UX)
      let qy = supabase
        .from('supplier_movements_view')
        .select('id, created_at, supplier_id, supplier_code, supplier_name, ref_type, ref_no, item_id, item_name, item_sku, qty_base, total_value, notes')
        .gte('created_at', from)
        .lte('created_at', to + ' 23:59:59')
        .order('created_at', { ascending: false })

      if (supplierId !== 'ALL') qy = qy.eq('supplier_id', supplierId)

      const mv = await qy
      if (mv.error) {
        // Fallback to simple master list if the view isn't deployed yet
        if (isPgRestMissing(mv.error)) {
          const master = await supabase
            .from('suppliers_view') // or 'suppliers' if you don’t have suppliers_view
            .select('id, code, name, notes, createdAt, created_at, updatedAt, updated_at')
            .order('createdAt', { ascending: false })
          if (master.error) throw master.error

          const raw = (master.data || []) as any[]
          const norm: DisplayRow[] = raw
            .filter(r => {
              const dateStr: string =
                r.createdAt || r.created_at || r.updatedAt || r.updated_at || new Date().toISOString()
              const ms = new Date(dateStr).getTime()
              return ms >= new Date(from + 'T00:00:00Z').getTime()
                  && ms <= new Date(to + 'T23:59:59Z').getTime()
            })
            .map(r => {
              const dateStr: string =
                r.createdAt || r.created_at || r.updatedAt || r.updated_at || new Date().toISOString()
              return {
                id: String(r.id),
                createdAt: new Date(dateStr).toISOString(),
                supplierId: String(r.id),
                supplierCode: r.code ?? null,
                supplierName: r.name ?? null,
                refType: null,
                refNo: null,
                itemId: null,
                itemName: null,
                itemSku: null,
                qtyBase: null,
                totalValue: null,
                notes: r.notes ?? null,
              }
            })

          const filteredBySupplier = supplierId === 'ALL'
            ? norm
            : norm.filter(r => r.supplierId === supplierId)

          const term = q.trim().toLowerCase()
          const filtered = !term
            ? filteredBySupplier
            : filteredBySupplier.filter(r => {
                const hay = `${r.supplierName || ''} ${r.supplierCode || ''} ${r.notes || ''}`.toLowerCase()
                return hay.includes(term)
              })

          setRows(filtered)
          return
        }
        throw mv.error
      }

      const term = q.trim().toLowerCase()
      const normalized: DisplayRow[] = (mv.data || []).map((r: any) => ({
        id: String(r.id),
        createdAt: new Date(r.created_at).toISOString(),
        supplierId: r.supplier_id ?? null,
        supplierCode: r.supplier_code ?? null,
        supplierName: r.supplier_name ?? null,
        refType: r.ref_type ?? null,
        refNo: r.ref_no ?? null,
        itemId: r.item_id ?? null,
        itemName: r.item_name ?? null,
        itemSku: r.item_sku ?? null,
        qtyBase: Number.isFinite(r.qty_base) ? Number(r.qty_base) : null,
        totalValue: Number.isFinite(r.total_value) ? Number(r.total_value) : null,
        notes: r.notes ?? null,
      }))

      const filtered = !term
        ? normalized
        : normalized.filter(r => {
            const hay = `${r.refType || ''} ${r.refNo || ''} ${r.itemName || ''} ${r.itemSku || ''} ${r.supplierName || ''}`.toLowerCase()
            return hay.includes(term)
          })

      setRows(filtered)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const count = rows.length
  const totalValue = useMemo(() => rows.reduce((s, r) => s + num(r.totalValue), 0), [rows])

  // ---------- Export handlers ----------
  const stamp = endDate.replace(/-/g, '')
  const exportBody: Row[] = [
    ['Date', 'Ref', 'Item', 'Qty (base)', `Value (${displayCurrency})`, 'Notes'],
    ...rows.map(r => [
      new Date(r.createdAt).toLocaleString(lang),
      `${r.refType || ''}${r.refNo ? ` ${r.refNo}` : ''}`,
      r.itemName ? `${r.itemName}${r.itemSku ? ` (${r.itemSku})` : ''}` : (r.itemId || ''),
      Number(num(r.qtyBase)),
      Number(num(r.totalValue)),
      r.notes || '',
    ]),
  ]
  const onCSV = () =>
    downloadCSV(`supplier_movements_${stamp}.csv`, [
      ...headerRows(ctx, 'Supplier Movements'),
      ...formatRowsForCSV(exportBody, ctx, [4], [3]),
    ])
  const onXLSX = () =>
    saveXLSX(`supplier_movements_${stamp}.xlsx`, ctx, [
      { title: 'Movements', headerTitle: 'Supplier Movements', body: exportBody, moneyCols: [4], qtyCols: [3] },
    ])
  const onPDF = () => {
    const doc = startPDF(ctx, 'Supplier Movements')
    pdfTable(doc, exportBody[0] as string[], exportBody.slice(1), [4], ctx, 110)
    doc.save(`supplier_movements_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr(t, 'reports.suppliers.title', 'Suppliers')}</CardTitle>
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
              <SelectTrigger><SelectValue placeholder={tr(t,'common.select','Select')} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="ALL">{tr(t,'common.all','All')}</SelectItem>
                {suppliers.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {(s.code ? s.code + ' — ' : '') + s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <Input placeholder={tr(t,'common.search','Search')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={fetchRows} disabled={loading}>
            {tr(t,'common.apply','Apply')}
          </Button>
        </div>

        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        <div className="mb-2 text-sm text-muted-foreground">
          {tr(t,'transactions.summary','Transactions')}: {count}
          {' '}• {tr(t,'table.value','Value')}: {formatMoneyBase(totalValue, baseCode)}
        </div>

        <div className="max-h-[520px] overflow-auto overscroll-contain rounded-md border">
          <div className="min-w-[900px] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{tr(t,'table.date','Date')}</th>
                  <th className="py-2 pr-2">{tr(t,'table.ref','Ref')}</th>
                  <th className="py-2 pr-2">{tr(t,'table.item','Item')}</th>
                  <th className="py-2 pr-2">{tr(t,'table.qtyBase','Qty (base)')}</th>
                  <th className="py-2 pr-2">{tr(t,'table.value','Value')}</th>
                  <th className="py-2 pr-2">{tr(t,'table.notes','Notes')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-muted-foreground">{tr(t,'common.noResults','No results')}</td></tr>
                ) : rows.map(r => (
                  // unique key fix:
                  <tr key={`${r.id}-${r.createdAt}`} className="border-b">
                    <td className="py-2 pr-2">{new Date(r.createdAt).toLocaleString(lang)}</td>
                    <td className="py-2 pr-2">{r.refType || '—'}{r.refNo ? ` ${r.refNo}` : ''}</td>
                    <td className="py-2 pr-2">
                      {r.itemName ? `${r.itemName}${r.itemSku ? ` (${r.itemSku})` : ''}` : (r.itemId || '—')}
                    </td>
                    <td className="py-2 pr-2">{r.qtyBase != null ? num(r.qtyBase) : '—'}</td>
                    <td className="py-2 pr-2">{r.totalValue != null ? formatMoneyBase(num(r.totalValue), baseCode) : '—'}</td>
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
