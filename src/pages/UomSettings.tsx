import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { buildConvGraph, tryConvertQty, type ConvRow } from '../lib/uom'
import { useOrg } from '../hooks/useOrg'
import { useI18n } from '../lib/i18n'

type Uom = { id: string; code: string; name: string; family?: string }
type Conv = { from_uom_id: string; to_uom_id: string; factor: number; company_id: string | null }

const FAMILIES = ['mass', 'volume', 'length', 'area', 'time', 'count', 'other'] as const
type Family = typeof FAMILIES[number]

export default function UomSettings() {
  const { companyId, companyName, loading: orgLoading } = useOrg()
  const { t } = useI18n()

  const [uoms, setUoms] = useState<Uom[]>([])
  const [convs, setConvs] = useState<Conv[]>([])
  const [graph, setGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const [loading, setLoading] = useState(true)

  // add unit (global master — unchanged)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [family, setFamily] = useState<Family>('count')

  // add conversion (company-scoped)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [factor, setFactor] = useState('')

  // quick tester
  const [testFrom, setTestFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testQty, setTestQty] = useState('')

  const byId = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])

  // group UoMs by family (for nicer selects)
  const groupedUoms = useMemo(() => {
    const groups = new Map<string, Uom[]>()
    for (const u of uoms) {
      const fam = (u.family && u.family.trim()) ? u.family : 'other'
      if (!groups.has(fam)) groups.set(fam, [])
      groups.get(fam)!.push(u)
    }
    for (const arr of groups.values()) arr.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
    const order = Array.from(groups.keys()).sort((a, b) => a.localeCompare(b))
    return { groups, order }
  }, [uoms])

  useEffect(() => {
    if (orgLoading) return
    loadAll().catch((e) => {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgLoading, companyId])

  async function loadAll() {
    setLoading(true)
    try {
      // UoMs remain global masters
      const u = await supabase.from('uoms').select('id,code,name,family').order('name', { ascending: true })
      if (u.error) throw u.error
      const uu = (u.data || []).map((x: any) => ({ ...x, code: String(x.code || '').toUpperCase() })) as Uom[]
      setUoms(uu)

      // Conversions: include company-specific + global (NULL) defaults
      let cq = supabase
        .from('uom_conversions')
        .select('from_uom_id,to_uom_id,factor,company_id')
      cq = companyId
        ? cq.or(`company_id.eq.${companyId},company_id.is.null`)
        : cq.is('company_id', null)

      const c = await cq
      if (c.error) throw c.error

      const cc = (c.data || []).map((x: any) => ({
        from_uom_id: x.from_uom_id,
        to_uom_id: x.to_uom_id,
        factor: Number(x.factor),
        company_id: x.company_id ?? null,
      })) as Conv[]
      setConvs(cc)

      setGraph(buildConvGraph(cc as unknown as ConvRow[]))
    } finally {
      setLoading(false)
    }
  }

  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    const n = name.trim()
    if (!c || !n) return toast.error(t('uom.required') ?? 'Code and Name are required')

    // if uoms.id is UUID server-generated, drop id field
    const id = `uom_${c.toLowerCase()}`
    try {
      const { error } = await supabase
        .from('uoms')
        .upsert([{ id, code: c, name: n, family }], { onConflict: 'id' })
      if (error) throw error
      toast.success(t('uom.unitSaved') ?? 'Unit saved')
      setCode(''); setName(''); setFamily('count')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  async function addConv(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return toast.error(t('org.noCompany'))
    if (!fromId || !toId) return toast.error(t('uom.pickBoth') ?? 'Pick both From and To')
    if (fromId === toId) return toast.error(t('uom.mustDiffer') ?? 'From and To must be different')
    const f = Number(factor)
    if (!f || f <= 0) return toast.error(t('uom.factorGt0') ?? 'Factor must be > 0')

    // Optional: cross-family heads-up
    const a = byId.get(fromId)?.family
    const b = byId.get(toId)?.family
    if (a && b && a !== b) toast(t('uom.crossFamilyWarn') ?? 'Warning: converting across different families', { icon: '⚠️' })

    try {
      const { error } = await supabase
        .from('uom_conversions')
        .upsert(
          [{ from_uom_id: fromId, to_uom_id: toId, factor: f, company_id: companyId }],
          { onConflict: 'company_id,from_uom_id,to_uom_id' } // relies on the full unique index
        )
      if (error) throw error
      toast.success(t('uom.convSaved') ?? 'Conversion saved')
      setFromId(''); setToId(''); setFactor('')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  async function deleteConv(from: string, to: string) {
    if (!companyId) return toast.error(t('org.noCompany'))
    try {
      // Only delete your company’s own conversion (leave global defaults intact)
      const { error } = await supabase
        .from('uom_conversions')
        .delete()
        .eq('from_uom_id', from)
        .eq('to_uom_id', to)
        .eq('company_id', companyId)
      if (error) throw error
      toast.success(t('uom.convDeleted') ?? 'Conversion deleted')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || t('errors.title'))
    }
  }

  const preview = (() => {
    if (!fromId || !toId) return ''
    const from = byId.get(fromId)?.code || fromId
    const to = byId.get(toId)?.code || toId
    const f = Number(factor)
    if (!f) return `1 ${from} × ? = ${to}`
    return `1 ${from} × ${f} = ${to}`
  })()

  function runTest() {
    const q = Number(testQty)
    if (!graph) return toast.error(t('uom.noGraph') ?? 'No graph loaded yet')
    if (!testFrom || !testTo) return toast.error(t('uom.pickBothUnits') ?? 'Pick both units')
    if (!Number.isFinite(q)) return toast.error(t('uom.enterNumber') ?? 'Enter a number to test')
    const out = tryConvertQty(q, testFrom, testTo, graph)
    if (out == null) toast.error(t('uom.noPath') ?? 'No path found')
    else {
      const fromC = byId.get(testFrom)?.code || testFrom
      const toC = byId.get(testTo)?.code || testTo
      toast.success(`${q} ${fromC} = ${out} ${toC}`)
    }
  }

  const familyLabel = (fam?: string) => {
    const key = String(fam || 'other').toLowerCase()
    const map: Record<string, string> = {
      mass: 'Mass', volume: 'Volume', length: 'Length', area: 'Area', time: 'Time', count: 'Count', other: 'Other'
    }
    return map[key] || (fam || 'Other')
  }

  if (orgLoading || loading) return <div className="p-6">{t('loading')}</div>

  if (!companyId) {
    return (
      <div className="p-6 space-y-2">
        <h1 className="text-3xl font-bold">{t('uom.title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('uom.noCompanyDesc')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">{t('uom.title')}</h1>
      <p className="text-sm text-muted-foreground">
        Company: <span className="font-medium">{companyName || companyId}</span>
      </p>

      {/* Add Unit (global) */}
      <Card>
        <CardHeader><CardTitle>{t('uom.addUnit')}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addUnit} className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="code">{t('users.code') ?? 'Code'} *</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g., BOX" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t('items.fields.name')} *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Box" />
            </div>
            <div className="space-y-2">
              <Label>{t('uom.family')}</Label>
              <Select value={family} onValueChange={(v: Family) => setFamily(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAMILIES.map(f => <SelectItem key={f} value={f}>{familyLabel(f)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit">{t('uom.saveUnit')}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Add Conversion (company-scoped) */}
      <Card>
        <CardHeader><CardTitle>{t('uom.addConversion')}</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            <strong>{t('uom.rule')}</strong> <code>1 × FROM × factor = TO</code>. {t('uom.ruleExample')}
          </p>
          <form onSubmit={addConv} className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label>{t('uom.from')} *</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-64 overflow-auto">
                  {groupedUoms.order.map(fam => (
                    <div key={`from-${fam}`}>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                        {familyLabel(fam)}
                      </div>
                      {(groupedUoms.groups.get(fam) || []).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                      ))}
                      <div className="h-1" />
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t('uom.to')} *</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent className="max-h-64 overflow-auto">
                  {groupedUoms.order.map(fam => (
                    <div key={`to-${fam}`}>
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                        {familyLabel(fam)}
                      </div>
                      {(groupedUoms.groups.get(fam) || []).map(u => (
                        <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>
                      ))}
                      <div className="h-1" />
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="factor">{t('uom.factor')} *</Label>
              <Input id="factor" type="number" min="0" step="0.000001" value={factor}
                     onChange={(e) => setFactor(e.target.value)} placeholder="e.g., 24" />
              <div className="text-xs text-muted-foreground mt-1">{preview}</div>
            </div>
            <div className="flex items-end">
              <Button type="submit">{t('uom.saveConversion')}</Button>
            </div>

            {/* Quick Test */}
            <div className="space-y-2">
              <Label>{t('uom.quickTest')}</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Qty" value={testQty} onChange={(e)=>setTestQty(e.target.value)} />
                <Select value={testFrom} onValueChange={setTestFrom}>
                  <SelectTrigger><SelectValue placeholder="From" /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.order.map(fam => (
                      <div key={`test-from-${fam}`}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                          {familyLabel(fam)}
                        </div>
                        {(groupedUoms.groups.get(fam) || []).map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={testTo} onValueChange={setTestTo}>
                  <SelectTrigger><SelectValue placeholder="To" /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.order.map(fam => (
                      <div key={`test-to-${fam}`}>
                        <div className="px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground sticky top-0 bg-popover">
                          {familyLabel(fam)}
                        </div>
                        {(groupedUoms.groups.get(fam) || []).map(u => (
                          <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={runTest}>{t('uom.runTest')}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Existing Conversions (scrollable) */}
      <Card>
        <CardHeader><CardTitle>{t('uom.existing')}</CardTitle></CardHeader>
        <CardContent className="overflow-hidden">
          <div className="max-h-[60vh] overflow-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr className="text-left">
                  <th className="py-2 px-3">{t('uom.from')}</th>
                  <th className="py-2 px-3">{t('uom.to')}</th>
                  <th className="py-2 px-3">{t('uom.factor')}</th>
                  <th className="py-2 px-3">{t('uom.scope')}</th>
                  <th className="py-2 px-3">{t('users.table.actions')}</th>
                </tr>
              </thead>
              <tbody className="[&_tr:nth-child(even)]:bg-muted/30">
                {convs.length === 0 && (
                  <tr><td colSpan={5} className="py-4 px-3 text-muted-foreground">{t('uom.none')}</td></tr>
                )}
                {convs.map(c => {
                  const a = byId.get(c.from_uom_id)
                  const b = byId.get(c.to_uom_id)
                  const isCompanyRow = !!c.company_id
                  return (
                    <tr key={`${c.from_uom_id}->${c.to_uom_id}::${c.company_id ?? 'global'}`} className="border-b">
                      <td className="py-2 px-3">{a ? `${a.code} — ${a.name}` : c.from_uom_id}</td>
                      <td className="py-2 px-3">{b ? `${b.code} — ${b.name}` : c.to_uom_id}</td>
                      <td className="py-2 px-3">{c.factor}</td>
                      <td className="py-2 px-3">{isCompanyRow ? t('uom.company') : t('uom.global')}</td>
                      <td className="py-2 px-3">
                        {isCompanyRow
                          ? <Button variant="destructive" onClick={() => deleteConv(c.from_uom_id, c.to_uom_id)}>{t('common.remove')}</Button>
                          : <span className="text-muted-foreground">{t('common.dash')}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
