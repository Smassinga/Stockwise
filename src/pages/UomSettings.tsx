import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { buildConvGraph, tryConvertQty, type ConvRow } from '../lib/uom'

type Uom = { id: string; code: string; name: string; family?: string }
type Conv = { from_uom_id: string; to_uom_id: string; factor: number }

const FAMILIES = ['mass','volume','length','count','other'] as const
type family = typeof FAMILIES[number]

export default function UomSettings() {
  const [uoms, setUoms] = useState<Uom[]>([])
  const [convs, setConvs] = useState<Conv[]>([])
  const [graph, setGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const [loading, setLoading] = useState(true)

  // add unit
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [family, setfamily] = useState<family>('count')

  // add conversion
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [factor, setFactor] = useState('')

  // quick tester
  const [testFrom, setTestFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testQty, setTestQty] = useState('')

  const byId = useMemo(() => new Map(uoms.map(u => [u.id, u])), [uoms])

  async function loadAll() {
    setLoading(true)
    try {
      const u = await supabase.from('uoms').select('id,code,name,family').order('name', { ascending: true })
      if (u.error) throw u.error
      const uu = (u.data || []).map((x: any) => ({ ...x, code: String(x.code || '').toUpperCase() })) as Uom[]
      setUoms(uu)

      const c = await supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor')
      if (c.error) throw c.error
      const cc = (c.data || []).map((x: any) => ({ ...x, factor: Number(x.factor) })) as Conv[]
      setConvs(cc)
      setGraph(buildConvGraph(cc as unknown as ConvRow[]))
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to load UoMs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])

  async function addUnit(e: React.FormEvent) {
    e.preventDefault()
    const c = code.trim().toUpperCase()
    const n = name.trim()
    if (!c || !n) return toast.error('Code and Name are required')

    // if your uoms.id is UUID, drop "id" and let DB default generate
    const id = `uom_${c.toLowerCase()}`
    try {
      const { error } = await supabase.from('uoms').upsert([{ id, code: c, name: n, family }], { onConflict: 'id' })
      if (error) throw error
      toast.success('Unit saved')
      setCode(''); setName(''); setfamily('count')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save unit')
    }
  }

  async function addConv(e: React.FormEvent) {
    e.preventDefault()
    if (!fromId || !toId) return toast.error('Pick both From and To')
    if (fromId === toId) return toast.error('From and To must be different')
    const f = Number(factor)
    if (!f || f <= 0) return toast.error('Factor must be > 0')

    // Optional: same-family warning
    const a = byId.get(fromId)?.family
    const b = byId.get(toId)?.family
    if (a && b && a !== b) {
      toast('Warning: converting across different families', { icon: '⚠️' })
    }

    try {
      const { error } = await supabase
        .from('uom_conversions')
        .upsert([{ from_uom_id: fromId, to_uom_id: toId, factor: f }], { onConflict: 'from_uom_id,to_uom_id' })
      if (error) throw error
      toast.success('Conversion saved')
      setFromId(''); setToId(''); setFactor('')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save conversion')
    }
  }

  async function deleteConv(from: string, to: string) {
    try {
      const { error } = await supabase.from('uom_conversions').delete()
        .eq('from_uom_id', from).eq('to_uom_id', to)
      if (error) throw error
      toast.success('Conversion deleted')
      await loadAll()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete conversion')
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
    if (!graph) return toast.error('No graph loaded yet')
    if (!testFrom || !testTo) return toast.error('Pick both units')
    if (!Number.isFinite(q)) return toast.error('Enter a number to test')
    const out = tryConvertQty(q, testFrom, testTo, graph)
    if (out == null) toast.error('No path found')
    else {
      const fromC = byId.get(testFrom)?.code || testFrom
      const toC = byId.get(testTo)?.code || testTo
      toast.success(`${q} ${fromC} = ${out} ${toC}`)
    }
  }

  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Units & Conversions</h1>

      <Card>
        <CardHeader><CardTitle>Add Unit</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={addUnit} className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="code">Code *</Label>
              <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g., KG" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Kilogram" />
            </div>
            <div className="space-y-2">
              <Label>family</Label>
              <Select value={family} onValueChange={(v: family) => setfamily(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FAMILIES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit">Save Unit</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Add Conversion</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">
            <strong>Rule:</strong> <code>1 × FROM × factor = TO</code>. Example: TON → KG with factor 1000.
          </p>
          <form onSubmit={addConv} className="grid gap-4 md:grid-cols-5">
            <div className="space-y-2">
              <Label>From *</Label>
              <Select value={fromId} onValueChange={setFromId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {uoms.map(u => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>To *</Label>
              <Select value={toId} onValueChange={setToId}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  {uoms.map(u => <SelectItem key={u.id} value={u.id}>{u.code} — {u.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="factor">Factor *</Label>
              <Input id="factor" type="number" min="0" step="0.000001" value={factor} onChange={(e) => setFactor(e.target.value)} placeholder="e.g., 1000" />
              <div className="text-xs text-muted-foreground mt-1">{preview}</div>
            </div>
            <div className="flex items-end">
              <Button type="submit">Save Conversion</Button>
            </div>
            <div className="space-y-2">
              <Label>Quick Test</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Qty" value={testQty} onChange={(e)=>setTestQty(e.target.value)} />
                <Select value={testFrom} onValueChange={setTestFrom}>
                  <SelectTrigger><SelectValue placeholder="From" /></SelectTrigger>
                  <SelectContent>
                    {uoms.map(u => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={testTo} onValueChange={setTestTo}>
                  <SelectTrigger><SelectValue placeholder="To" /></SelectTrigger>
                  <SelectContent>
                    {uoms.map(u => <SelectItem key={u.id} value={u.id}>{u.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button variant="outline" onClick={runTest}>Run Test</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Existing Conversions</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">From</th>
                <th className="py-2 pr-2">To</th>
                <th className="py-2 pr-2">Factor</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {convs.length === 0 && <tr><td colSpan={4} className="py-4 text-muted-foreground">No conversions yet.</td></tr>}
              {convs.map(c => {
                const a = byId.get(c.from_uom_id)
                const b = byId.get(c.to_uom_id)
                return (
                  <tr key={`${c.from_uom_id}->${c.to_uom_id}`} className="border-b">
                    <td className="py-2 pr-2">{a ? `${a.code} — ${a.name}` : c.from_uom_id}</td>
                    <td className="py-2 pr-2">{b ? `${b.code} — ${b.name}` : c.to_uom_id}</td>
                    <td className="py-2 pr-2">{c.factor}</td>
                    <td className="py-2 pr-2">
                      <Button variant="destructive" onClick={() => deleteConv(c.from_uom_id, c.to_uom_id)}>Delete</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
