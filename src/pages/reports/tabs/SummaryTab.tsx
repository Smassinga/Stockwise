// src/pages/reports/tabs/SummaryTab.tsx — company-scoped (v3: shipments − SO_REVERSAL for units; dashboard-aligned COGS net of SO_REVERSAL)
//
// What’s new in this version:
// • Units sold = Shipments (qty_base) MINUS SO_REVERSAL receives (qty_base) in the same period, per item.
//   - Best/Worst sellers use these NET units (clamped at 0).
//   - “Zero sales” counts items whose net units == 0.
// • COGS (period) = sum of stock_movements that are:
//     - + issues for sales ref types (SO/CASH_SALE/POS/CASH)
//     - − receives with ref_type='SO_REVERSAL'
//   Fallback to unit_cost×qty_base when total_value is missing (matches Dashboard).
//
// Everything else stays the same (valuation & audit table).

import { useEffect, useMemo, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '../../../components/ui/card'
import { useReports } from '../context/ReportsProvider'
import KPI from '../KPI'
import ExportButtons from '../components/ExportButtons'
import { headerRows, formatRowsForCSV, downloadCSV, saveXLSX, startPDF, pdfTable, Row } from '../utils/exports'
import { useOrg } from '../../../hooks/useOrg'
import { supabase } from '../../../lib/supabase'
import { useI18n } from '../../../lib/i18n'

type ShipmentRow = {
  id: string
  item_id: string
  qty_base: number | string
  created_at: string
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

// Match the Dashboard's sales ref types for COGS
const SALES_REF_TYPES = new Set(['SO', 'CASH_SALE', 'POS', 'CASH'])
const num = (v: any, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)

export default function SummaryTab() {
  const { t } = useI18n()
  const { companyId } = useOrg()

  const {
    turnoverPerItem, turnoverSummary,
    valuationAsOfEnd, ui, valuationEngine, valuationCurrent,
    period, itemById, moneyText, fmt,
    displayCurrency, fxRate, baseCurrency, fxNote, startDate, endDate,
    whName,
  } = useReports()

  const ctx = {
    companyName: ui.companyName,
    startDate, endDate,
    displayCurrency, baseCurrency, fxRate, fxNote,
  }

  const stamp = endDate.replace(/-/g, '')

  // --- movements remain for the audit table / exports (unchanged) ---
  const isThisCompany = (m: any) => {
    if (!companyId) return true
    return (m?.companyId ?? m?.company_id) === companyId
  }
  const movementsInCompany = (period?.inRange ?? []).filter(isThisCompany)

  // ------------------------------------------------------------------
  // Sales Shipments → base for "units sold" (qty_base)
  // + SO_REVERSAL receives → subtract from units sold
  // ------------------------------------------------------------------
  const [shipments, setShipments] = useState<ShipmentRow[]>([])
  const [reversals, setReversals] = useState<ReversalRow[]>([])
  const [loadingShip, setLoadingShip] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId || !startDate || !endDate) {
        setShipments([])
        setReversals([])
        return
      }
      setLoadingShip(true)
      try {
        // 1) shipments in period
        const { data: shipData, error: shipErr } = await supabase
          .from('sales_shipments')
          .select('id,item_id,qty_base,created_at,company_id')
          .eq('company_id', companyId)
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)

        if (shipErr) throw shipErr

        // 2) SO reversal receives in period (to net out units)
        const { data: revData, error: revErr } = await supabase
          .from('stock_movements')
          .select('id,item_id,qty_base,created_at,type,ref_type,company_id')
          .eq('company_id', companyId)
          .eq('type', 'receive')
          .eq('ref_type', 'SO_REVERSAL')
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)

        if (revErr) throw revErr

        if (!cancelled) {
          setShipments((shipData || []) as ShipmentRow[])
          setReversals((revData || []) as ReversalRow[])
        }
      } catch (e) {
        console.error(e)
        if (!cancelled) { setShipments([]); setReversals([]) }
      } finally {
        if (!cancelled) setLoadingShip(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, startDate, endDate])

  // Aggregate shipments & reversals → NET totals per item (qty_base)
  const salesAgg = useMemo(() => {
    const shippedByItem = new Map<string, number>()
    for (const s of shipments) {
      const q = Number(s.qty_base) || 0
      if (q <= 0) continue
      shippedByItem.set(s.item_id, (shippedByItem.get(s.item_id) || 0) + q)
    }

    const reversedByItem = new Map<string, number>()
    for (const r of reversals) {
      const q = Number(r.qty_base) || 0
      if (q <= 0) continue
      reversedByItem.set(r.item_id, (reversedByItem.get(r.item_id) || 0) + q)
    }

    // NET = max(0, shipped - reversed) to avoid negative units in the period view
    const netByItem = new Map<string, number>()
    for (const iid of new Set<string>([...shippedByItem.keys(), ...reversedByItem.keys()])) {
      const net = Math.max(0, (shippedByItem.get(iid) || 0) - (reversedByItem.get(iid) || 0))
      if (net > 0) netByItem.set(iid, net)
    }

    // totals / best / worst / zero-sales
    let total = 0
    for (const q of netByItem.values()) total += q

    let best: { itemId: string, qty: number } | null = null
    let worst: { itemId: string, qty: number } | null = null
    for (const [iid, q] of netByItem.entries()) {
      if (!best || q > best.qty) best = { itemId: iid, qty: q }
      if (!worst || q < worst.qty) worst = { itemId: iid, qty: q }
    }

    // zero-sales = items we know about with no NET sales in the period
    let zero = 0
    for (const iid of itemById.keys()) {
      if (!(netByItem.has(iid))) zero++
    }

    return { totalUnitsSold: total, perItemNet: netByItem, best, worst, zero }
  }, [shipments, reversals, itemById])

  // Resolve best/worst item objects for display
  const salesBestWorst = useMemo(() => {
    const best = salesAgg.best
      ? { item: itemById.get(salesAgg.best.itemId), qty: salesAgg.best.qty }
      : null
    const worst = salesAgg.worst
      ? { item: itemById.get(salesAgg.worst.itemId), qty: salesAgg.worst.qty }
      : null
    return { best, worst, zeroSales: salesAgg.zero }
  }, [salesAgg, itemById])

  // ------------------------------------------------------------------
  // COGS (period) — identical logic to Dashboard KPIs, net of SO reversals
  // ------------------------------------------------------------------
  const [cogsFromSalesMoves, setCogsFromSalesMoves] = useState(0)
  const [loadingCogs, setLoadingCogs] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!companyId || !startDate || !endDate) {
        setCogsFromSalesMoves(0)
        return
      }
      setLoadingCogs(true)
      try {
        const { data, error } = await supabase
          .from('stock_movements')
          .select('type,ref_type,created_at,total_value,unit_cost,qty_base')
          .eq('company_id', companyId)
          // include both sales issues and SO reversal receives
          .in('type', ['issue', 'receive'])
          .in('ref_type', [...Array.from(SALES_REF_TYPES), 'SO_REVERSAL'])
          .gte('created_at', `${startDate}T00:00:00Z`)
          .lte('created_at', `${endDate}T23:59:59.999Z`)

        if (error) throw error

        let sum = 0
        for (const m of (data || []) as any[]) {
          const val = Number.isFinite(Number(m.total_value))
            ? Number(m.total_value)
            : num(m.unit_cost) * num(m.qty_base)

          // issues add to COGS; SO_REVERSAL receives subtract
          const sign =
            m.type === 'issue' ? 1 :
            (m.type === 'receive' && m.ref_type === 'SO_REVERSAL' ? -1 : 0)

          if (sign !== 0) sum += sign * val
        }
        if (!cancelled) setCogsFromSalesMoves(sum)
      } catch (e) {
        console.error(e)
        if (!cancelled) setCogsFromSalesMoves(0)
      } finally {
        if (!cancelled) setLoadingCogs(false)
      }
    })()
    return () => { cancelled = true }
  }, [companyId, startDate, endDate])

  // ----- export rows -----
  const kpiRows: Row[] = [
    [t('reports.summary.kpi.metric'), t('reports.summary.kpi.value')],
    [t('reports.summary.kpi.daysInPeriod'), Number(turnoverPerItem.daysInPeriod)],
    // IMPORTANT: shipments − reversals (net) figure
    [t('reports.summary.kpi.unitsSoldNet'), Number(salesAgg.totalUnitsSold)],
    [t('reports.summary.kpi.avgInventoryUnits'), Number(turnoverSummary.avgInv)],
    [t('reports.summary.kpi.turnsUnits'), Number(turnoverSummary.turns)],
    [t('reports.summary.kpi.avgDaysToSell'), turnoverSummary.avgDaysToSell != null ? Number(turnoverSummary.avgDaysToSell) : ''],
    // IMPORTANT: dashboard-aligned COGS (net of SO reversals)
    [t('reports.summary.kpi.cogsPeriod'), Number(cogsFromSalesMoves)],
    [t('reports.summary.kpi.valuationTotal'), Number(valuationAsOfEnd
      ? Array.from(valuationEngine.valuationByWH_AsOfEnd.values()).reduce((s, v) => s + v, 0)
      : valuationCurrent.total)],
  ]

  const movementsRows: Row[] = [
    [t('reports.summary.movements.time'), t('reports.summary.movements.type'), t('reports.summary.movements.item'), t('reports.summary.movements.qty'), t('reports.summary.movements.unitCost'), t('reports.summary.movements.warehouseFrom'), t('reports.summary.movements.warehouseTo')],
    ...movementsInCompany.map(m => {
      const created = m?.createdAt ?? m?.created_at ?? m?.createdat
      const t = created ? new Date(created).toLocaleString() : ''
      const it = itemById.get(m.itemId)
      const qty = Math.abs(Number(m.qtyBase ?? m.qty) || 0)
      const wFrom = whName(m.warehouseFromId)
      const wTo = m.warehouseToId ? whName(m.warehouseToId) : whName(m.warehouseId)
      return [t, (m.type || '').toUpperCase(), it?.name || m.itemId, qty, Number(m.unitCost || 0), wFrom || '—', wTo || '—'] as Row
    }),
  ]

  // ----- handlers -----
  const onCSV = () => {
    downloadCSV(`summary_kpis_${stamp}.csv`, [
      ...headerRows(ctx, t('reports.summary.export.kpis')),
      ...formatRowsForCSV(kpiRows, ctx, [1], []),
    ])
    downloadCSV(`summary_movements_${stamp}.csv`, [
      ...headerRows(ctx, t('reports.summary.export.movements')),
      ...formatRowsForCSV(movementsRows, ctx, [4], [3]),
    ])
  }

  const onXLSX = () => {
    saveXLSX(`summary_${stamp}.xlsx`, ctx, [
      { title: 'KPIs', headerTitle: t('reports.summary.export.kpis'), body: kpiRows, moneyCols: [1] },
      { title: 'Movements', headerTitle: t('reports.summary.export.movements'), body: movementsRows, moneyCols: [4], qtyCols: [3] },
    ])
  }

  const onPDF = () => {
    const doc = startPDF(ctx, t('reports.summary.export.kpis'))
    pdfTable(doc, [t('reports.summary.kpi.metric'), t('reports.summary.kpi.value')], kpiRows.slice(1), [1], ctx, 110)
    doc.addPage()
    pdfTable(doc, [t('reports.summary.movements.time'),t('reports.summary.movements.type'),t('reports.summary.movements.item'),t('reports.summary.movements.qty'),t('reports.summary.movements.unitCost'),t('reports.summary.movements.warehouseFrom'),t('reports.summary.movements.warehouseTo')],
      movementsRows.slice(1), [4], ctx, 110)
    doc.save(`summary_${stamp}.pdf`)
  }

  // pick valuation map based on toggle
  const whVals = valuationAsOfEnd
    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.entries())
    : Array.from(valuationCurrent.byWH.entries())

  const whTotal = valuationAsOfEnd
    ? Array.from(valuationEngine.valuationByWH_AsOfEnd.values()).reduce((s, v) => s + v, 0)
    : valuationCurrent.total

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reports.summary.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ExportButtons onCSV={onCSV} onXLSX={onXLSX} onPDF={onPDF} />

        <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
          <KPI label={t('reports.summary.kpi.daysInPeriod')} value={fmt(turnoverPerItem.daysInPeriod, 0)} />
          {/* IMPORTANT: shipments − SO reversals (net) */}
          <KPI label={t('reports.summary.kpi.unitsSoldNet')} value={loadingShip ? '…' : fmt(salesAgg.totalUnitsSold, 2)} />
          <KPI label={t('reports.summary.kpi.avgInventoryUnits')} value={fmt(turnoverSummary.avgInv, 2)} />
          <KPI label={t('reports.summary.kpi.turnsUnits')} value={fmt(turnoverSummary.turns, 2)} />
          <KPI label={t('reports.summary.kpi.avgDaysToSell')} value={turnoverSummary.avgDaysToSell != null ? fmt(turnoverSummary.avgDaysToSell, 1) : '—'} />
          {/* IMPORTANT: dashboard-aligned COGS, net of reversals */}
          <KPI label={t('reports.summary.kpi.cogsPeriod')} value={loadingCogs ? '…' : moneyText(cogsFromSalesMoves)} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
          <Card className="border-dashed">
            <CardHeader><CardTitle>{t('reports.summary.bestWorst.title')}</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 pr-2 font-medium">{t('reports.summary.bestWorst.best')}</td>
                    <td className="py-2 pr-2">
                      {salesBestWorst.best
                        ? `${salesBestWorst.best.item?.name ?? salesAgg.best?.itemId} (${fmt(salesBestWorst.best.qty, 2)} units)`
                        : '—'}
                    </td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 pr-2 font-medium">{t('reports.summary.bestWorst.worst')}</td>
                    <td className="py-2 pr-2">
                      {salesBestWorst.worst
                        ? `${salesBestWorst.worst.item?.name ?? salesAgg.worst?.itemId} (${fmt(salesBestWorst.worst.qty, 2)} units)`
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-2 font-medium">{t('reports.summary.bestWorst.zeroSales')}</td>
                    <td className="py-2 pr-2">{fmt(salesBestWorst.zeroSales, 0)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card className="border-dashed md:col-span-2">
            <CardHeader>
              <CardTitle>
                {t('reports.summary.valuation.title')} {valuationAsOfEnd ? `(${t('reports.summary.valuation.asOfEndDate')}, ${ui.costMethod})` : `(${t('reports.summary.valuation.currentSnapshot')})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{t('reports.summary.valuation.warehouse')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.valuation.value')}</th>
                  </tr>
                </thead>
                <tbody>
                  {whVals.sort((a, b) => b[1] - a[1]).map(([wid, val]) => (
                    <tr key={wid} className="border-b">
                      <td className="py-2 pr-2">{whName(wid)}</td>
                      <td className="py-2 pr-2">{moneyText(val)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-2 pr-2 font-medium">{t('reports.summary.valuation.total')}</td>
                    <td className="py-2 pr-2 font-medium">{moneyText(whTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        <div className="mt-6">
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle>{t('reports.summary.movements.title')}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-2">{t('reports.summary.movements.time')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.type')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.item')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.qty')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.unitCost')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.warehouseFrom')}</th>
                    <th className="py-2 pr-2">{t('reports.summary.movements.warehouseTo')}</th>
                  </tr>
                </thead>
                <tbody>
                  {movementsInCompany.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-muted-foreground">{t('reports.summary.movements.noData')}</td></tr>
                  )}
                  {movementsInCompany.map(m => {
                    const created = m?.createdAt ?? m?.created_at ?? m?.createdat
                    const t = created ? new Date(created).toLocaleString() : ''
                    const it = itemById.get(m.itemId)
                    const qty = Math.abs(Number(m.qtyBase ?? m.qty) || 0)
                    const wFrom = whName(m.warehouseFromId)
                    const wTo = m.warehouseToId ? whName(m.warehouseToId) : whName(m.warehouseId)
                    return (
                      <tr key={m.id} className="border-b">
                        <td className="py-2 pr-2">{t}</td>
                        <td className="py-2 pr-2">{(m.type || '').toUpperCase()}</td>
                        <td className="py-2 pr-2">{it?.name || m.itemId}</td>
                        <td className="py-2 pr-2">{fmt(qty, 2)}</td>
                        <td className="py-2 pr-2">{moneyText(Number(m.unitCost || 0))}</td>
                        <td className="py-2 pr-2">{wFrom || '—'}</td>
                        <td className="py-2 pr-2">{wTo || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </CardContent>
    </Card>
  )
}
