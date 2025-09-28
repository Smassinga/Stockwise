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

type RowT = {
  id: string
  created_at: string
  customer_id: string | null
  customer_code: string | null
  customer_name: string | null
  ref_type: string | null
  ref_no: string | null
  item_id: string
  item_name: string | null
  item_sku: string | null
  qty_base: number | null
  total_value: number | null
  notes: string | null
}
type Customer = { id: string; code: string | null; name: string }

const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

export default function CustomersTab() {
  const { t, lang } = useI18n()
  const { ui, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote } = useReports()
  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }

  const [baseCode, setBaseCode] = useState('MZN')
  const [from, setFrom] = useState<string>(startDate)
  const [to, setTo] = useState<string>(endDate)
  const [customerId, setCustomerId] = useState<string>('ALL')
  const [q, setQ] = useState<string>('')

  const [customers, setCustomers] = useState<Customer[]>([])
  const [rows, setRows] = useState<RowT[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      setBaseCode(await getBaseCurrencyCode())
      const cs = await supabase.from('customers').select('id,code,name').order('name', { ascending: true })
      setCustomers((cs.data || []) as Customer[])
      await fetchRows()
      setLoading(false)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchRows() {
    setLoading(true)
    try {
      let qy = supabase
        .from('customer_movements_view')
        .select('*')
        .gte('created_at', from)
        .lte('created_at', to + ' 23:59:59')
        .order('created_at', { ascending: false })

      if (customerId !== 'ALL') qy = qy.eq('customer_id', customerId)

      const { data, error } = await qy
      if (error) throw error

      const term = q.trim().toLowerCase()
      const filtered = !term
        ? (data || [])
        : (data || []).filter((r: any) => {
            const hay = `${r.ref_type || ''} ${r.ref_no || ''} ${r.item_name || ''} ${r.item_sku || ''} ${r.customer_name || ''}`.toLowerCase()
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
  const totalCOGS = useMemo(() => rows.reduce((s, r) => s + num(r.total_value), 0), [rows])

  // ---------- Export handlers ----------
  const stamp = endDate.replace(/-/g, '')
  const exportBody: Row[] = [
    ['Date', 'Ref', 'Item', 'Qty (base)', `COGS (${displayCurrency})`, 'Notes'],
    ...rows.map(r => [
      new Date(r.created_at).toLocaleString(lang),
      `${r.ref_type || ''}${r.ref_no ? ` ${r.ref_no}` : ''}`,
      r.item_name ? `${r.item_name}${r.item_sku ? ` (${r.item_sku})` : ''}` : r.item_id,
      Number(num(r.qty_base)),
      Number(num(r.total_value)),
      r.notes || '',
    ]),
  ]
  const onCSV = () =>
    downloadCSV(`customer_movements_${stamp}.csv`, [
      ...headerRows(ctx, 'Customer Movements'),
      ...formatRowsForCSV(exportBody, ctx, [4], [3]),
    ])
  const onXLSX = () =>
    saveXLSX(`customer_movements_${stamp}.xlsx`, ctx, [
      { title: 'Movements', headerTitle: 'Customer Movements', body: exportBody, moneyCols: [4], qtyCols: [3] },
    ])
  const onPDF = () => {
    const doc = startPDF(ctx, 'Customer Movements')
    pdfTable(doc, exportBody[0] as string[], exportBody.slice(1), [4], ctx, 110)
    doc.save(`customer_movements_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reports.customers.title') || 'Customers'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="mb-3 flex flex-wrap gap-2">
          <div className="w-40">
            <Input type="date" value={from} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value)} />
          </div>
          <div className="w-40">
            <Input type="date" value={to} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value)} />
          </div>
          <div className="w-64">
            <Select value={customerId} onValueChange={setCustomerId}>
              <SelectTrigger><SelectValue placeholder={t('common.select')} /></SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="ALL">{t('common.all') || 'All'}</SelectItem>
                {customers.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {(c.code ? c.code + ' — ' : '') + c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-56">
            <Input placeholder={t('common.search')} value={q} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQ(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={fetchRows} disabled={loading}>
            {t('common.apply') || 'Apply'}
          </Button>
        </div>

        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        <div className="mb-2 text-sm text-muted-foreground">
          {t('transactions.summary') || 'Transactions'}: {count} • {(t('kpi.cogs.title') || 'COGS')}: {formatMoneyBase(totalCOGS, baseCode)}
        </div>

        <div className="max-h-[520px] overflow-auto overscroll-contain rounded-md border">
          <div className="min-w-[900px] overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b">
                  <th className="py-2 pr-2">{t('table.date')}</th>
                  <th className="py-2 pr-2">{t('table.ref') || 'Ref'}</th>
                  <th className="py-2 pr-2">{t('table.item')}</th>
                  <th className="py-2 pr-2">{t('table.qtyBase')}</th>
                  <th className="py-2 pr-2">{t('kpi.cogs.title') || 'COGS'}</th>
                  <th className="py-2 pr-2">{t('table.notes') || 'Notes'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-muted-foreground">{t('common.noResults')}</td></tr>
                ) : rows.map(r => (
                  <tr key={r.id} className="border-b">
                    <td className="py-2 pr-2">{new Date(r.created_at).toLocaleString(lang)}</td>
                    <td className="py-2 pr-2">{r.ref_type || '—'} {r.ref_no ? ` ${r.ref_no}` : ''}</td>
                    <td className="py-2 pr-2">{r.item_name ? `${r.item_name} (${r.item_sku || ''})` : r.item_id}</td>
                    <td className="py-2 pr-2">{num(r.qty_base)}</td>
                    <td className="py-2 pr-2">{formatMoneyBase(num(r.total_value), baseCode)}</td>
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
