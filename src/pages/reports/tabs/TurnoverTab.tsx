// src/pages/reports/tabs/TurnoverTab.tsx — NET units (shipments − SO reversals) + COGS from SO issues
//
// Changes (v2):
// • Sold (period) = sum of sales_shipments.qty_base MINUS sum of stock_movements.qty_base where (type='receive' AND ref_type='SO_REVERSAL'),
//   all company + date scoped, per item. (Clamped at 0 per item to avoid negative period-unit artifacts.)
// • COGS = sum of linked stock_movements.total_value (ONLY where ref_type='SO' AND type='issue'), fallback to unit_cost×qty_base if missing.
//   - We keep COGS logic as-is since your dashboard/summary now handle reversals at the KPI level.
// • Cash sales are included (they also come through as ref_type='SO').
// • All other turnover metrics remain from turnoverPerItem.

import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
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

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0)

export default function TurnoverTab() {
  const { companyId } = useOrg()
  const {
    turnoverPerItem, moneyText, fmt,
    startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote, ui,
  } = useReports()

  const ctx = { companyName: ui.companyName, startDate, endDate, displayCurrency, baseCurrency, fxRate, fxNote }
  const stamp = endDate.replace(/-/g, '')

  // -------------------------------
  // Load shipments + SO reversals (company + window)
  // -------------------------------
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [reversals, setReversals] = useState<ReversalRow[]>([])
  const [mvById, setMvById] = useState<Map<string, MovementCostRow>>(new Map())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId || !startDate || !endDate) {
        setShipments([]); setReversals([]); setMvById(new Map())
        return
      }
      setLoading(true)
      try {
        // 1) sales_shipments in the selected window for this company
        const { data: shipRows, error: shipErr } = await supabase
          .from('sales_shipments')
          .select('id,item_id,qty_base,created_at,company_id,movement_id')
          .eq('company_id', companyId)
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)
        if (shipErr) throw shipErr

        const ships = (shipRows || []) as ShipmentRow[]

        // 2) fetch ONLY the movements we care about (SO issues for this company) for COGS
        const mvIds = Array.from(new Set(ships.map(s => s.movement_id).filter(Boolean))) as string[]
        let mvMap = new Map<string, MovementCostRow>()
        if (mvIds.length) {
          const { data: mvRows, error: mvErr } = await supabase
            .from('stock_movements')
            .select('id,qty_base,unit_cost,total_value,ref_type,type,company_id')
            .in('id', mvIds)
            .eq('company_id', companyId)
            .eq('ref_type', 'SO')
            .eq('type', 'issue')
          if (mvErr) throw mvErr
          for (const r of (mvRows || []) as MovementCostRow[]) mvMap.set(r.id, r)
        }

        // 3) SO reversal receives in window (to net out units)
        const { data: revRows, error: revErr } = await supabase
          .from('stock_movements')
          .select('id,item_id,qty_base,created_at,type,ref_type,company_id')
          .eq('company_id', companyId)
          .eq('type', 'receive')
          .eq('ref_type', 'SO_REVERSAL')
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)
        if (revErr) throw revErr

        if (!cancelled) {
          setShipments(ships)
          setMvById(mvMap)
          setReversals((revRows || []) as ReversalRow[])
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) {
          setShipments([])
          setMvById(new Map())
          setReversals([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, startDate, endDate])

  // -------------------------------
  // Aggregate per item
  // -------------------------------
  // Sold units (net): shipments − SO reversal receives (clamped ≥ 0)
  const soldByItem = useMemo(() => {
    const shipped = new Map<string, number>()
    for (const s of shipments) {
      const q = num(s.qty_base)
      if (q <= 0) continue
      shipped.set(s.item_id, (shipped.get(s.item_id) || 0) + q)
    }

    const reversed = new Map<string, number>()
    for (const r of reversals) {
      const q = num(r.qty_base)
      if (q <= 0) continue
      reversed.set(r.item_id, (reversed.get(r.item_id) || 0) + q)
    }

    const net = new Map<string, number>()
    const allIds = new Set<string>([...shipped.keys(), ...reversed.keys()])
    for (const id of allIds) {
      const v = Math.max(0, (shipped.get(id) || 0) - (reversed.get(id) || 0))
      if (v > 0) net.set(id, v)
    }
    return net
  }, [shipments, reversals])

  // COGS: only from movements that are SO/issue (filtered at fetch)
  const cogsByItem = useMemo(() => {
    const m = new Map<string, number>()
    for (const s of shipments) {
      const q = num(s.qty_base)
      if (q <= 0) continue
      let cost = 0
      const mv = s.movement_id ? mvById.get(s.movement_id) : undefined
      if (mv) {
        const mvTotal = num(mv.total_value)
        if (mvTotal !== 0) {
          cost = mvTotal
        } else {
          const mvUnit = num(mv.unit_cost)
          const mvQty = num(mv.qty_base) || q
          cost = mvUnit * mvQty
        }
      } else {
        // No qualifying movement (e.g., BUILD/ADJUST/TRANSFER or missing): exclude from COGS
        cost = 0
      }
      m.set(s.item_id, (m.get(s.item_id) || 0) + cost)
    }
    return m
  }, [shipments, mvById])

  // -------------------------------
  // Build rows / exports with overrides
  // -------------------------------
  const rows: Row[] = [[
    'Item','SKU','Sold (period)','Begin Units','End Units','Avg Units','Turns','Avg Days to Sell','COGS'
  ]]

  turnoverPerItem.rows.forEach(r => {
    const sold = soldByItem.get(r.itemId) ?? 0 // prefer our net calc
    const cogs = cogsByItem.get(r.itemId) ?? 0
    rows.push([
      r.name, r.sku,
      Number(sold),
      Number(r.beginUnits.toFixed(2)),
      Number(r.endUnits.toFixed(2)),
      Number(r.avgUnits.toFixed(2)),
      Number(r.turns.toFixed(2)),
      r.avgDaysToSell != null ? Number(r.avgDaysToSell.toFixed(1)) : '',
      Number(cogs),
    ])
  })

  const onCSV = () => {
    downloadCSV(`turnover_${stamp}.csv`, [
      ...headerRows(ctx, 'Inventory Turnover & Avg Days to Sell'),
      ...formatRowsForCSV(rows, ctx, [8], [2,3,4,5,6,7]),
    ])
  }
  const onXLSX = () => {
    saveXLSX(`turnover_${stamp}.xlsx`, ctx, [
      { title: 'Turnover', headerTitle: 'Inventory Turnover & Avg Days to Sell', body: rows, moneyCols: [8], qtyCols: [2,3,4,5,6,7] },
    ])
  }
  const onPDF = () => {
    const doc = startPDF(ctx, 'Inventory Turnover & Avg Days to Sell')
    pdfTable(doc, rows[0] as string[], rows.slice(1), [8], ctx, 110)
    doc.save(`turnover_${stamp}.pdf`)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Turnover (Units) &amp; Avg Days to Sell</CardTitle></CardHeader>
      <CardContent className="overflow-x-auto">
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />
        <div className="text-xs text-muted-foreground mb-2">
          {loading
            ? 'Loading…'
            : 'Sold = shipments minus SO reversals (receive). COGS = cost of linked SO issue movements only (excludes BUILD/ADJUST/TRANSFER/internal).'}
        </div>
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b">
            <th className="py-2 pr-2">Item</th>
            <th className="py-2 pr-2">SKU</th>
            <th className="py-2 pr-2">Sold (period)</th>
            <th className="py-2 pr-2">Begin Units</th>
            <th className="py-2 pr-2">End Units</th>
            <th className="py-2 pr-2">Avg Units</th>
            <th className="py-2 pr-2">Turns</th>
            <th className="py-2 pr-2">Avg Days to Sell</th>
            <th className="py-2 pr-2">COGS</th>
          </tr></thead>
          <tbody>
            {turnoverPerItem.rows.length === 0 && (
              <tr><td colSpan={9} className="py-4 text-muted-foreground">No movements in the selected period.</td></tr>
            )}
            {turnoverPerItem.rows.map(r => {
              const sold = soldByItem.get(r.itemId) ?? 0
              const cogs = cogsByItem.get(r.itemId) ?? 0
              return (
                <tr key={r.itemId} className="border-b">
                  <td className="py-2 pr-2">{r.name}</td>
                  <td className="py-2 pr-2">{r.sku}</td>
                  <td className="py-2 pr-2">{fmt(sold, 2)}</td>
                  <td className="py-2 pr-2">{fmt(r.beginUnits, 2)}</td>
                  <td className="py-2 pr-2">{fmt(r.endUnits, 2)}</td>
                  <td className="py-2 pr-2">{fmt(r.avgUnits, 2)}</td>
                  <td className="py-2 pr-2">{fmt(r.turns, 2)}</td>
                  <td className="py-2 pr-2">{r.avgDaysToSell != null ? fmt(r.avgDaysToSell, 1) : '—'}</td>
                  <td className="py-2 pr-2">{moneyText(Number(cogs))}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
