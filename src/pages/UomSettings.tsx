import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { buildConvGraph, tryConvertQty, type ConvRow } from '../lib/uom'
import { can, type CompanyRole } from '../lib/permissions'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type Uom = { id: string; code: string; name: string; family?: string }
type Conv = { from_uom_id: string; to_uom_id: string; factor: number; company_id: string | null }

const FAMILIES = ['mass', 'volume', 'length', 'area', 'time', 'count', 'other'] as const
type Family = typeof FAMILIES[number]

export default function UomSettings() {
  const { companyId, companyName, loading: orgLoading, myRole } = useOrg()
  const { t } = useI18n()
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const canEdit = can.updateMaster(role)

  const [uoms, setUoms] = useState<Uom[]>([])
  const [convs, setConvs] = useState<Conv[]>([])
  const [graph, setGraph] = useState<ReturnType<typeof buildConvGraph> | null>(null)
  const [loading, setLoading] = useState(true)

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [family, setFamily] = useState<Family>('count')
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [factor, setFactor] = useState('')
  const [testFrom, setTestFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [testQty, setTestQty] = useState('')

  const byId = useMemo(() => new Map(uoms.map((uom) => [uom.id, uom])), [uoms])

  const summary = useMemo(() => {
    const companyConversions = convs.filter((conv) => !!conv.company_id).length
    return {
      units: uoms.length,
      companyConversions,
      globalConversions: convs.length - companyConversions,
    }
  }, [convs, uoms.length])

  const groupedUoms = useMemo(() => {
    const groups = new Map<string, Uom[]>()
    for (const uom of uoms) {
      const currentFamily = uom.family?.trim() || 'other'
      if (!groups.has(currentFamily)) groups.set(currentFamily, [])
      groups.get(currentFamily)!.push(uom)
    }
    for (const list of groups.values()) list.sort((a, b) => (a.code || '').localeCompare(b.code || ''))
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [uoms])

  useEffect(() => {
    if (orgLoading) return
    loadAll().catch((error) => {
      console.error(error)
      toast.error(error?.message || tt('uom.toast.loadFailed', 'Failed to load units and conversions'))
    })
  }, [orgLoading, companyId])

  async function loadAll() {
    setLoading(true)
    try {
      const units = await supabase.from('uoms').select('id,code,name,family').order('name', { ascending: true })
      if (units.error) throw units.error
      const normalizedUnits = (units.data || []).map((row: any) => ({
        ...row,
        code: String(row.code || '').toUpperCase(),
      })) as Uom[]
      setUoms(normalizedUnits)

      let convQuery = supabase.from('uom_conversions').select('from_uom_id,to_uom_id,factor,company_id')
      convQuery = companyId
        ? convQuery.or(`company_id.eq.${companyId},company_id.is.null`)
        : convQuery.is('company_id', null)

      const conversions = await convQuery
      if (conversions.error) throw conversions.error

      const normalizedConvs = (conversions.data || []).map((row: any) => ({
        from_uom_id: row.from_uom_id,
        to_uom_id: row.to_uom_id,
        factor: Number(row.factor),
        company_id: row.company_id ?? null,
      })) as Conv[]
      setConvs(normalizedConvs)
      setGraph(buildConvGraph(normalizedConvs as unknown as ConvRow[]))
    } finally {
      setLoading(false)
    }
  }

  async function addUnit(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit) {
      toast.error(tt('uom.toast.noUnitPermission', 'You do not have permission to manage units'))
      return
    }
    const normalizedCode = code.trim().toUpperCase()
    const normalizedName = name.trim()
    if (!normalizedCode || !normalizedName) {
      toast.error(tt('uom.required', 'Code and name are required'))
      return
    }

    const id = `uom_${normalizedCode.toLowerCase()}`
    try {
      const { error } = await supabase
        .from('uoms')
        .upsert([{ id, code: normalizedCode, name: normalizedName, family }], { onConflict: 'id' })
      if (error) throw error
      toast.success(tt('uom.unitSaved', 'Unit saved'))
      setCode('')
      setName('')
      setFamily('count')
      await loadAll()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('errors.title', 'Error'))
    }
  }

  async function addConv(event: React.FormEvent) {
    event.preventDefault()
    if (!canEdit) {
      toast.error(tt('uom.toast.noConversionPermission', 'You do not have permission to manage conversions'))
      return
    }
    if (!companyId) {
      toast.error(tt('org.noCompany', 'Join or create a company first'))
      return
    }
    if (!fromId || !toId) {
      toast.error(tt('uom.pickBoth', 'Pick both From and To'))
      return
    }
    if (fromId === toId) {
      toast.error(tt('uom.mustDiffer', 'From and To must be different'))
      return
    }
    const numericFactor = Number(factor)
    if (!numericFactor || numericFactor <= 0) {
      toast.error(tt('uom.factorGt0', 'Factor must be > 0'))
      return
    }

    const fromFamily = byId.get(fromId)?.family
    const toFamily = byId.get(toId)?.family
    if (fromFamily && toFamily && fromFamily !== toFamily) {
      toast(tt('uom.crossFamilyWarn', 'Warning: converting across different families'), { icon: '⚠️' })
    }

    try {
      const { error } = await supabase
        .from('uom_conversions')
        .upsert(
          [{ from_uom_id: fromId, to_uom_id: toId, factor: numericFactor, company_id: companyId }],
          { onConflict: 'company_id,from_uom_id,to_uom_id' },
        )
      if (error) throw error
      toast.success(tt('uom.convSaved', 'Conversion saved'))
      setFromId('')
      setToId('')
      setFactor('')
      await loadAll()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('errors.title', 'Error'))
    }
  }

  async function deleteConv(from: string, to: string) {
    if (!canEdit) {
      toast.error(tt('uom.toast.noConversionPermission', 'You do not have permission to manage conversions'))
      return
    }
    if (!companyId) {
      toast.error(tt('org.noCompany', 'Join or create a company first'))
      return
    }
    try {
      const { error } = await supabase
        .from('uom_conversions')
        .delete()
        .eq('from_uom_id', from)
        .eq('to_uom_id', to)
        .eq('company_id', companyId)
      if (error) throw error
      toast.success(tt('uom.convDeleted', 'Conversion deleted'))
      await loadAll()
    } catch (error: any) {
      console.error(error)
      toast.error(error?.message || tt('errors.title', 'Error'))
    }
  }

  const preview = (() => {
    if (!fromId || !toId) return ''
    const fromCode = byId.get(fromId)?.code || fromId
    const toCode = byId.get(toId)?.code || toId
    const numericFactor = Number(factor)
    if (!numericFactor) return `1 ${fromCode} × ? = ${toCode}`
    return `1 ${fromCode} × ${numericFactor} = ${toCode}`
  })()

  function runTest() {
    const qty = Number(testQty)
    if (!graph) {
      toast.error(tt('uom.noGraph', 'No graph loaded yet'))
      return
    }
    if (!testFrom || !testTo) {
      toast.error(tt('uom.pickBothUnits', 'Pick both units'))
      return
    }
    if (!Number.isFinite(qty)) {
      toast.error(tt('uom.enterNumber', 'Enter a number to test'))
      return
    }
    const result = tryConvertQty(qty, testFrom, testTo, graph)
    if (result == null) {
      toast.error(tt('uom.noPath', 'No path found'))
      return
    }
    const fromCode = byId.get(testFrom)?.code || testFrom
    const toCode = byId.get(testTo)?.code || testTo
    toast.success(`${qty} ${fromCode} = ${result} ${toCode}`)
  }

  const familyLabel = (value?: string) => {
    const key = String(value || 'other').toLowerCase()
    const map: Record<string, string> = {
      mass: tt('uom.family.mass', 'Mass'),
      volume: tt('uom.family.volume', 'Volume'),
      length: tt('uom.family.length', 'Length'),
      area: tt('uom.family.area', 'Area'),
      time: tt('uom.family.time', 'Time'),
      count: tt('uom.family.count', 'Count'),
      other: tt('uom.family.other', 'Other'),
    }
    return map[key] || value || tt('uom.family.other', 'Other')
  }

  if (orgLoading || loading) return <div className="p-6">{tt('loading', 'Loading...')}</div>

  if (!companyId) {
    return (
      <div className="space-y-2 p-6">
        <h1 className="text-3xl font-semibold">{tt('uom.title', 'Units of measure')}</h1>
        <p className="text-sm text-muted-foreground">
          {tt('uom.noCompanyDesc', 'Join or create a company before maintaining company-specific UoM conversion rules.')}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05] p-6 shadow-[0_30px_80px_-56px_rgba(15,23,42,0.48)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-primary/75">
              {tt('uom.eyebrow', 'Master data clarity')}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">{tt('uom.title', 'Units of measure')}</h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {tt(
                  'uom.subtitleRefined',
                  'Keep the global unit master clean, then add only the company-specific conversion rules your purchasing, stock, and order-entry flows actually need.',
                )}
              </p>
            </div>
          </div>
          <Badge variant="outline" className="w-fit px-3 py-1 text-xs">
            {companyName || companyId}
          </Badge>
        </div>
      </div>

      {!canEdit ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {tt('uom.readOnly', 'Read-only: only operational roles can add units or maintain company conversion rules.')}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('uom.summary.units', 'Unit codes')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary.units}</div>
            <div className="text-xs text-muted-foreground">{tt('uom.summary.unitsHelp', 'Global unit codes shared across the whole app.')}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('uom.summary.companyConversions', 'Company conversions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary.companyConversions}</div>
            <div className="text-xs text-muted-foreground">{tt('uom.summary.companyConversionsHelp', 'Conversion rules owned and maintained by this company.')}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tt('uom.summary.globalDefaults', 'Global defaults')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{summary.globalConversions}</div>
            <div className="text-xs text-muted-foreground">{tt('uom.summary.globalDefaultsHelp', 'Fallback conversions loaded globally when the company has not overridden them.')}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tt('uom.unitsRegisterTitle', 'Unit master')}</CardTitle>
            <CardDescription>
              {tt('uom.unitsRegisterHelp', 'Code is the short operational symbol used in documents and data entry. Name is the readable label users will see across items, orders, BOMs, and stock screens.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {groupedUoms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-5 py-8 text-center text-sm text-muted-foreground">
                {tt('uom.emptyUnits', 'No units are configured yet. Add the first unit code before defining conversions.')}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedUoms.map(([currentFamily, list]) => (
                  <div key={currentFamily} className="rounded-2xl border border-border/70">
                    <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                      <div className="font-medium">{familyLabel(currentFamily)}</div>
                      <Badge variant="secondary">{list.length}</Badge>
                    </div>
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                      {list.map((uom) => (
                        <div key={uom.id} className="rounded-xl border border-border/70 bg-background/80 px-4 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-base font-semibold">{uom.code}</div>
                              <div className="text-sm text-muted-foreground">{uom.name}</div>
                            </div>
                            <Badge variant="outline">{familyLabel(uom.family)}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tt('uom.addUnit', 'Add unit')}</CardTitle>
            <CardDescription>
              {tt('uom.addUnitHelp', 'Create the reusable unit code first. Use the family only to group related units and reduce bad cross-family conversions later.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addUnit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="uom-code">{tt('users.code', 'Code')} *</Label>
                <Input id="uom-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder={tt('uom.placeholder.code', 'e.g., BOX')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="uom-name">{tt('items.fields.name', 'Name')} *</Label>
                <Input id="uom-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tt('uom.placeholder.name', 'e.g., Box')} />
              </div>
              <div className="space-y-2">
                <Label>{tt('uom.family', 'Family')}</Label>
                <Select value={family} onValueChange={(value: Family) => setFamily(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAMILIES.map((value) => (
                      <SelectItem key={value} value={value}>{familyLabel(value)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={!canEdit}>{tt('uom.saveUnit', 'Save unit')}</Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tt('uom.addConversion', 'Add conversion')}</CardTitle>
            <CardDescription>
              {tt('uom.conversionHelp', 'Define how one unit converts into another for this company. StockWise reads the rule as: 1 × FROM × factor = TO.')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addConv} className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label>{tt('uom.from', 'From')} *</Label>
                <Select value={fromId} onValueChange={setFromId}>
                  <SelectTrigger><SelectValue placeholder={tt('common.select', 'Select')} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.map(([currentFamily, list]) => (
                      <div key={`from-${currentFamily}`}>
                        <div className="sticky top-0 bg-popover px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {familyLabel(currentFamily)}
                        </div>
                        {list.map((uom) => (
                          <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tt('uom.to', 'To')} *</Label>
                <Select value={toId} onValueChange={setToId}>
                  <SelectTrigger><SelectValue placeholder={tt('common.select', 'Select')} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.map(([currentFamily, list]) => (
                      <div key={`to-${currentFamily}`}>
                        <div className="sticky top-0 bg-popover px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {familyLabel(currentFamily)}
                        </div>
                        {list.map((uom) => (
                          <SelectItem key={uom.id} value={uom.id}>{uom.code} - {uom.name}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="uom-factor">{tt('uom.factor', 'Factor')} *</Label>
                <Input
                  id="uom-factor"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={factor}
                  onChange={(e) => setFactor(e.target.value)}
                  placeholder={tt('uom.placeholder.factor', 'e.g., 24')}
                />
                <div className="text-xs text-muted-foreground">{preview || tt('uom.previewHelp', 'Choose both units to preview the conversion rule.')}</div>
              </div>
              <div className="flex items-end">
                <Button type="submit" disabled={!canEdit}>{tt('uom.saveConversion', 'Save conversion')}</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-border/70">
          <CardHeader className="pb-3">
            <CardTitle>{tt('uom.quickTest', 'Quick test')}</CardTitle>
            <CardDescription>
              {tt('uom.quickTestHelp', 'Check whether the current graph can convert between two units before relying on the rule in purchasing, items, BOMs, or order entry.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>{tt('uom.quantity', 'Quantity')}</Label>
                <Input placeholder={tt('uom.placeholder.qty', 'Qty')} value={testQty} onChange={(e) => setTestQty(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{tt('uom.from', 'From')}</Label>
                <Select value={testFrom} onValueChange={setTestFrom}>
                  <SelectTrigger><SelectValue placeholder={tt('uom.from', 'From')} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.map(([currentFamily, list]) => (
                      <div key={`test-from-${currentFamily}`}>
                        <div className="sticky top-0 bg-popover px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {familyLabel(currentFamily)}
                        </div>
                        {list.map((uom) => (
                          <SelectItem key={uom.id} value={uom.id}>{uom.code}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{tt('uom.to', 'To')}</Label>
                <Select value={testTo} onValueChange={setTestTo}>
                  <SelectTrigger><SelectValue placeholder={tt('uom.to', 'To')} /></SelectTrigger>
                  <SelectContent className="max-h-64 overflow-auto">
                    {groupedUoms.map(([currentFamily, list]) => (
                      <div key={`test-to-${currentFamily}`}>
                        <div className="sticky top-0 bg-popover px-2 py-1 text-[10px] font-semibold uppercase text-muted-foreground">
                          {familyLabel(currentFamily)}
                        </div>
                        {list.map((uom) => (
                          <SelectItem key={uom.id} value={uom.id}>{uom.code}</SelectItem>
                        ))}
                        <div className="h-1" />
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button variant="outline" onClick={runTest}>{tt('uom.runTest', 'Run test')}</Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle>{tt('uom.existing', 'Existing conversions')}</CardTitle>
          <CardDescription>
            {tt('uom.existingHelp', 'Company rows override or extend the global defaults. Only company-owned conversion rows can be removed from this page.')}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-hidden">
          <div className="max-h-[60vh] overflow-auto rounded-2xl border border-border/70">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2">{tt('uom.from', 'From')}</th>
                  <th className="px-3 py-2">{tt('uom.to', 'To')}</th>
                  <th className="px-3 py-2">{tt('uom.factor', 'Factor')}</th>
                  <th className="px-3 py-2">{tt('uom.scope', 'Scope')}</th>
                  <th className="px-3 py-2">{tt('users.table.actions', 'Actions')}</th>
                </tr>
              </thead>
              <tbody className="[&_tr:nth-child(even)]:bg-muted/20">
                {convs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">
                      {tt('uom.none', 'No conversion rules saved yet.')}
                    </td>
                  </tr>
                ) : (
                  convs.map((conv) => {
                    const fromUnit = byId.get(conv.from_uom_id)
                    const toUnit = byId.get(conv.to_uom_id)
                    const isCompanyRow = !!conv.company_id
                    return (
                      <tr key={`${conv.from_uom_id}->${conv.to_uom_id}::${conv.company_id ?? 'global'}`} className="border-t border-border/70">
                        <td className="px-3 py-3">{fromUnit ? `${fromUnit.code} - ${fromUnit.name}` : conv.from_uom_id}</td>
                        <td className="px-3 py-3">{toUnit ? `${toUnit.code} - ${toUnit.name}` : conv.to_uom_id}</td>
                        <td className="px-3 py-3">{conv.factor}</td>
                        <td className="px-3 py-3">
                          <Badge variant={isCompanyRow ? 'default' : 'secondary'}>
                            {isCompanyRow ? tt('uom.company', 'Company') : tt('uom.global', 'Global')}
                          </Badge>
                        </td>
                        <td className="px-3 py-3">
                          {isCompanyRow ? (
                            <Button variant="destructive" onClick={() => deleteConv(conv.from_uom_id, conv.to_uom_id)} disabled={!canEdit}>
                              {tt('common.remove', 'Remove')}
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">{tt('common.dash', '-')}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

