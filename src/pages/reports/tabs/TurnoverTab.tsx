// src/pages/reports/tabs/TurnoverTab.tsx
import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card'
import { useI18n } from '../../../lib/i18n'
import { useReports } from '../context/ReportsProvider'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'
import { useOrg } from '../../../hooks/useOrg'
import { supabase } from '../../../lib/supabase'

type ShipmentRow = {
  id: string
  item_id: string
  qty_base: number | string
  created_at: string
  company_id?: string | null
  movement_id?: string | null
}

type MovementCostRow = {
  id: string
  qty_base: number | null
  unit_cost: number | null
  total_value: number | null
  ref_type?: string | null
  type?: string | null
  company_id?: string | null
}

type ReversalRow = {
  id: string
  item_id: string
  qty_base: number | string | null
  created_at: string
  type: 'receive' | string | null
  ref_type: string | null
  company_id?: string | null
}

const num = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : 0)

export default function TurnoverTab() {
  const { t } = useI18n()
  const tt = (key: string, fallback: string) => (t(key) === key ? fallback : t(key))
  const { companyId } = useOrg()
  const { turnoverPerItem, moneyText, fmt, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote, ui } = useReports()

  const ctx = { companyId: companyId || undefined, companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [reversals, setReversals] = useState<ReversalRow[]>([])
  const [mvById, setMvById] = useState<Map<string, MovementCostRow>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId || !startDate || !endDate) {
        setShipments([])
        setReversals([])
        setMvById(new Map())
        return
      }
      setLoading(true)
      try {
        const { data: shipRows, error: shipErr } = await supabase
          .from('sales_shipments')
          .select('id,item_id,qty_base,created_at,company_id,movement_id')
          .eq('company_id', companyId)
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)
        if (shipErr) throw shipErr

        const ships = (shipRows || []) as ShipmentRow[]
        const movementIds = Array.from(new Set(ships.map((row) => row.movement_id).filter(Boolean))) as string[]
        const nextMovementMap = new Map<string, MovementCostRow>()

        if (movementIds.length) {
          const { data: movementRows, error: movementErr } = await supabase
            .from('stock_movements')
            .select('id,qty_base,unit_cost,total_value,ref_type,type,company_id')
            .in('id', movementIds)
            .eq('company_id', companyId)
            .eq('ref_type', 'SO')
            .eq('type', 'issue')
          if (movementErr) throw movementErr
          for (const row of (movementRows || []) as MovementCostRow[]) nextMovementMap.set(row.id, row)
        }

        const { data: reversalRows, error: reversalErr } = await supabase
          .from('stock_movements')
          .select('id,item_id,qty_base,created_at,type,ref_type,company_id')
          .eq('company_id', companyId)
          .eq('type', 'receive')
          .eq('ref_type', 'SO_REVERSAL')
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)
        if (reversalErr) throw reversalErr

        if (!cancelled) {
          setShipments(ships)
          setMvById(nextMovementMap)
          setReversals((reversalRows || []) as ReversalRow[])
        }
      } catch (error) {
        console.error(error)
        if (!cancelled) {
          setShipments([])
          setMvById(new Map())
          setReversals([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [companyId, startDate, endDate])

  const soldByItem = useMemo(() => {
    const shipped = new Map<string, number>()
    for (const row of shipments) {
      const qty = num(row.qty_base)
      if (qty <= 0) continue
      shipped.set(row.item_id, (shipped.get(row.item_id) || 0) + qty)
    }

    const reversed = new Map<string, number>()
    for (const row of reversals) {
      const qty = num(row.qty_base)
      if (qty <= 0) continue
      reversed.set(row.item_id, (reversed.get(row.item_id) || 0) + qty)
    }

    const net = new Map<string, number>()
    const allIds = new Set<string>([...shipped.keys(), ...reversed.keys()])
    for (const id of allIds) {
      const value = Math.max(0, (shipped.get(id) || 0) - (reversed.get(id) || 0))
      if (value > 0) net.set(id, value)
    }
    return net
  }, [shipments, reversals])

  const cogsByItem = useMemo(() => {
    const costs = new Map<string, number>()
    for (const shipment of shipments) {
      const qty = num(shipment.qty_base)
      if (qty <= 0) continue
      let cost = 0
      const movement = shipment.movement_id ? mvById.get(shipment.movement_id) : undefined
      if (movement) {
        const movementTotal = num(movement.total_value)
        cost = movementTotal !== 0 ? movementTotal : num(movement.unit_cost) * (num(movement.qty_base) || qty)
      }
      costs.set(shipment.item_id, (costs.get(shipment.item_id) || 0) + cost)
    }
    return costs
  }, [mvById, shipments])

  const totalSoldUnits = Array.from(soldByItem.values()).reduce((sum, qty) => sum + qty, 0)
  const totalCogs = Array.from(cogsByItem.values()).reduce((sum, value) => sum + value, 0)

  const rows: Row[] = [[
    tt('reports.itemLabel', 'Item'),
    tt('reports.skuLabel', 'SKU'),
    tt('reports.turnoverSoldPeriod', 'Sold (period)'),
    tt('reports.turnoverBeginUnits', 'Begin Units'),
    tt('reports.turnoverEndUnits', 'End Units'),
    tt('reports.turnoverAvgUnits', 'Avg Units'),
    tt('reports.turnoverTurns', 'Turns'),
    tt('reports.turnoverDaysToSell', 'Avg Days to Sell'),
    tt('reports.summary.kpi.cogsPeriod', 'COGS (period)'),
  ]]

  turnoverPerItem.rows.forEach((row) => {
    rows.push([
      row.name,
      row.sku,
      Number(soldByItem.get(row.itemId) ?? 0),
      Number(row.beginUnits.toFixed(2)),
      Number(row.endUnits.toFixed(2)),
      Number(row.avgUnits.toFixed(2)),
      Number(row.turns.toFixed(2)),
      row.avgDaysToSell != null ? Number(row.avgDaysToSell.toFixed(1)) : '',
      Number(cogsByItem.get(row.itemId) ?? 0),
    ])
  })

  const onCSV = async () => {
    await downloadCSV(`turnover_${stamp}.csv`, [
      ...headerRows(ctx, tt('reports.turnoverTitle', 'Inventory Turnover & Avg Days to Sell')),
      ...formatRowsForCSV(rows, ctx, [8], [2, 3, 4, 5, 6, 7]),
    ])
  }

  const onXLSX = async () => {
    await saveXLSX(`turnover_${stamp}.xlsx`, ctx, [
      {
        title: tt('reports.sheet.turnover', 'Turnover'),
        headerTitle: tt('reports.turnoverTitle', 'Inventory Turnover & Avg Days to Sell'),
        body: rows,
        moneyCols: [8],
        qtyCols: [2, 3, 4, 5, 6, 7],
      },
    ])
  }

  const onPDF = async () => {
    const doc = await startPDF(ctx, tt('reports.turnoverTitle', 'Inventory Turnover & Avg Days to Sell'))
    await pdfTable(doc, rows[0] as string[], rows.slice(1), [8], ctx, 110, {
      qtyCols: [2, 3, 4, 5, 6, 7],
    })
    doc.save(`turnover_${stamp}.pdf`)
  }

  return (
    <Card className="rounded-2xl border-border/80 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle>{tt('reports.turnoverTitle', 'Inventory Turnover & Avg Days to Sell')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {tt('reports.turnoverHelp', 'Use this table to compare how fast stock moved, how long it sat on hand, and what COGS was attached to linked sales issues.')}
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} className="mt-0 justify-end" />

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.turnoverCoverage', 'Items in view')}</p>
            <div className="mt-2 text-lg font-semibold">{turnoverPerItem.rows.length}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.turnoverCoverageHelp', 'Items with turnover metrics in the selected period.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.summary.kpi.unitsSoldNet', 'Units sold (net)')}</p>
            <div className="mt-2 text-lg font-semibold">{loading ? '…' : fmt(totalSoldUnits, 2)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.turnoverUnitsHelp', 'Shipments less SO reversals in the reporting window.')}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{tt('reports.summary.kpi.cogsPeriod', 'COGS (period)')}</p>
            <div className="mt-2 text-lg font-semibold">{loading ? '…' : moneyText(totalCogs)}</div>
            <p className="mt-1 text-xs text-muted-foreground">{tt('reports.turnoverCogsHelp', 'Only linked SO issue movements contribute cost in this report.')}</p>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 p-3 text-xs text-muted-foreground">
          {loading
            ? tt('reports.loadingMetrics', 'Loading report data…')
            : tt('reports.turnoverMethodHelp', 'Sold = shipments less SO reversals. COGS = linked SO issue movements only, excluding internal inventory moves.')}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/70">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left">
                <th className="px-3 py-2">{tt('reports.itemLabel', 'Item')}</th>
                <th className="px-3 py-2">{tt('reports.skuLabel', 'SKU')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverSoldPeriod', 'Sold (period)')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverBeginUnits', 'Begin Units')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverEndUnits', 'End Units')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverAvgUnits', 'Avg Units')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverTurns', 'Turns')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.turnoverDaysToSell', 'Avg Days to Sell')}</th>
                <th className="px-3 py-2 text-right">{tt('reports.summary.kpi.cogsPeriod', 'COGS (period)')}</th>
              </tr>
            </thead>
            <tbody>
              {turnoverPerItem.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-sm text-muted-foreground">
                    {tt('reports.noTurnoverRows', 'No movements were recorded in the selected period.')}
                  </td>
                </tr>
              )}
              {turnoverPerItem.rows.map((row) => (
                <tr key={row.itemId} className="border-t">
                  <td className="px-3 py-3">{row.name}</td>
                  <td className="px-3 py-3">{row.sku}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(soldByItem.get(row.itemId) ?? 0, 2)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.beginUnits, 2)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.endUnits, 2)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.avgUnits, 2)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{fmt(row.turns, 2)}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{row.avgDaysToSell != null ? fmt(row.avgDaysToSell, 1) : '—'}</td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">{moneyText(cogsByItem.get(row.itemId) ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
