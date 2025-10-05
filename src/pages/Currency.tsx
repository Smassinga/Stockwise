// src/pages/Currency.tsx
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import toast from 'react-hot-toast'
import { setBaseCurrencyCode } from '../lib/currency'

type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type FxRate = {
  id: string
  date: string
  from_code: string
  to_code: string
  rate: number
  fromCode?: string
  toCode?: string
}

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
]

export default function CurrencyPage() {
  const { companyId } = useOrg()

  const [loading, setLoading] = useState(true)
  const [allCurrencies, setAllCurrencies] = useState<Currency[]>([])
  const [allowed, setAllowed] = useState<Currency[]>([])
  const [base, setBase] = useState<string>('MZN')

  const [fx, setFx] = useState<FxRate[]>([])
  const [fxDate, setFxDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>('USD')
  const [to, setTo] = useState<string>('MZN')
  const [rate, setRate] = useState<string>('')

  const allowedCodes = useMemo(() => new Set(allowed.map(a => a.code)), [allowed])

  // -------- Load (per-company) --------
  useEffect(() => {
    if (!companyId) {
      setAllCurrencies([])
      setAllowed([])
      setFx([])
      setBase('MZN')
      setLoading(false)
      return
    }

    ;(async () => {
      try {
        setLoading(true)

        // 1) Seed master currency codes (idempotent, global)
        await supabase.from('currencies').upsert(DEFAULT_CURRENCIES)

        const { data: all, error: allErr } = await supabase
          .from('currencies')
          .select('code,name,symbol,decimals')
          .order('code', { ascending: true })
        if (allErr) throw allErr
        setAllCurrencies((all || []) as Currency[])

        // 2) Allowed currencies – company scoped via view/RLS
        const { data: ac, error: acErr } = await supabase
          .from('company_currencies_view')
          .select('code,name,symbol,decimals')
          .order('code', { ascending: true })
        if (acErr) throw acErr

        let allowedList = (ac || []) as Currency[]
        // first time: enable DEFAULT_CURRENCIES for this company
        if (!allowedList.length) {
          const ins = await supabase
            .from('company_currencies')
            .upsert(DEFAULT_CURRENCIES.map(c => ({ currency_code: c.code })))
          if (ins.error) throw ins.error

          const { data: seeded, error: seededErr } = await supabase
            .from('company_currencies_view')
            .select('code,name,symbol,decimals')
            .order('code', { ascending: true })
          if (seededErr) throw seededErr
          allowedList = (seeded || []) as Currency[]
        }
        setAllowed(allowedList)

        // 3) Base currency – company scoped
        const { data: s, error: sErr } = await supabase
          .from('company_settings_view')
          .select('base_currency_code')
          .limit(1)
          .maybeSingle()
        if (sErr) throw sErr
        const currentBase = s?.base_currency_code || 'MZN'
        setBase(currentBase)
        setBaseCurrencyCode(currentBase)

        // 4) FX rates – company scoped
        const { data: fxRows, error: fxErr } = await supabase
          .from('fx_rates_view')
          .select('id,date,from_code,to_code,rate,fromCode,toCode')
          .order('date', { ascending: false })
          .limit(200)
        if (fxErr) throw fxErr
        setFx((fxRows || []) as FxRate[])

        // keep selectors valid after company switch
        const allowedArr = Array.from(new Set(allowedList.map(c => c.code)))
        const fallback = allowedArr.includes('MZN') ? 'MZN' : (allowedArr[0] || 'MZN')
        if (!allowedArr.includes(from)) setFrom(fallback)
        if (!allowedArr.includes(to)) setTo(fallback)
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load currency data')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  // -------- Actions (all scoped by RLS/trigger to current company) --------
  async function saveBase() {
    try {
      if (!allowedCodes.has(base)) return toast.error('Base currency must be enabled for this company')
      const { error } = await supabase.rpc('set_base_currency_for_current_company', { p_code: base })
      if (error) throw error
      setBaseCurrencyCode(base)
      toast.success('Base currency saved for this company')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save base currency')
    }
  }

  async function refreshAllowed() {
    const { data, error } = await supabase
      .from('company_currencies_view')
      .select('code,name,symbol,decimals')
      .order('code', { ascending: true })
    if (error) throw error
    setAllowed((data || []) as Currency[])
  }

  async function addAllowed(code: string) {
    try {
      const { error } = await supabase.from('company_currencies').insert({ currency_code: code })
      if (error) throw error
      await refreshAllowed()
      toast.success(`Enabled ${code} for this company`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || `Failed to enable ${code}`)
    }
  }

  async function removeAllowed(code: string) {
    try {
      if (code === base) return toast.error('You cannot remove the current base currency')
      const { error } = await supabase.from('company_currencies').delete().eq('currency_code', code)
      if (error) throw error
      await refreshAllowed()
      toast.success(`Disabled ${code} for this company`)
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || `Failed to disable ${code}`)
    }
  }

  async function addFx() {
    try {
      const r = parseFloat(rate)
      if (!fxDate || !from || !to || !r || Number.isNaN(r) || r <= 0) {
        toast.error('Please fill date, from, to and a positive rate')
        return
      }
      if (!allowedCodes.has(from) || !allowedCodes.has(to)) {
        toast.error('Both currencies must be enabled for this company')
        return
      }
      const payload = { date: fxDate, from_code: from, to_code: to, rate: r }
      const { error } = await supabase
        .from('fx_rates')
        .upsert(payload, { onConflict: 'company_id,date,from_code,to_code' })
      if (error) throw error

      const { data, error: rErr } = await supabase
        .from('fx_rates_view')
        .select('id,date,from_code,to_code,rate,fromCode,toCode')
        .order('date', { ascending: false })
        .limit(200)
      if (rErr) throw rErr
      setFx((data || []) as FxRate[])
      setRate('')
      toast.success('FX rate saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save FX rate')
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Currency &amp; FX</h1>
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
        <Card><CardContent className="p-6"><div className="h-24 rounded bg-muted animate-pulse" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Currency &amp; FX</h1>

      {/* Allowed per company */}
      <Card>
        <CardHeader><CardTitle>Allowed Currencies (this company)</CardTitle></CardHeader>
        <CardContent className="grid gap-2">
          <div className="text-sm text-muted-foreground">
            Toggle which codes this company can use. Changes here don’t affect other companies.
          </div>

          <div className="flex flex-wrap gap-2">
            {allCurrencies.map(c => {
              const on = allowedCodes.has(c.code)
              return (
                <div
                  key={c.code}
                  className={[
                    'flex items-center gap-2 border rounded px-2 py-1',
                    on
                      ? 'bg-emerald-50 border-emerald-300/70 text-emerald-900 ' +
                        'dark:bg-emerald-500/15 dark:border-emerald-400/30 dark:text-emerald-200'
                      : 'bg-muted/40 border-border text-foreground ' +
                        'dark:bg-muted/20 dark:text-foreground'
                  ].join(' ')}
                >
                  <div className="min-w-[4.25rem] font-mono text-sm">{c.code}</div>
                  <div className="text-sm">{c.name}</div>
                  {on ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-1 hover:bg-emerald-100 dark:hover:bg-emerald-500/25"
                      onClick={() => removeAllowed(c.code)}
                    >
                      Disable
                    </Button>
                  ) : (
                    <Button size="sm" className="ml-1" onClick={() => addAllowed(c.code)}>
                      Enable
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Base currency */}
      <Card>
        <CardHeader><CardTitle>Base Currency (this company)</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="w-72">
            <Label>Base Currency</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={saveBase}>Save</Button>
        </CardContent>
      </Card>

      {/* FX */}
      <Card>
        <CardHeader><CardTitle>Add / Update FX Rate</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          <div>
            <Label>Date</Label>
            <Input type="date" value={fxDate} onChange={e => setFxDate(e.target.value)} />
          </div>
          <div>
            <Label>From</Label>
            <Select value={from} onValueChange={setFrom}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {allowed.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Rate (1 From = ? To)</Label>
            <Input
              type="number"
              min="0"
              step="0.000001"
              value={rate}
              onChange={e => setRate(e.target.value)}
              placeholder="e.g., 63.50"
            />
          </div>
          <div className="flex items-end">
            <Button onClick={addFx}>Save Rate</Button>
          </div>
        </CardContent>
      </Card>

      {/* Recent rates */}
      <Card>
        <CardHeader><CardTitle>Recent Rates</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Date</th>
                <th className="py-2 pr-2">Pair</th>
                <th className="py-2 pr-2">Rate</th>
              </tr>
            </thead>
            <tbody>
              {fx.length === 0 && (
                <tr><td colSpan={3} className="py-4 text-muted-foreground">No rates saved.</td></tr>
              )}
              {fx.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-2">{r.date}</td>
                  <td className="py-2 pr-2">{(r.fromCode || r.from_code)} → {(r.toCode || r.to_code)}</td>
                  <td className="py-2 pr-2">{r.rate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
