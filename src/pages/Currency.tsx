// src/pages/Currency.tsx
import { useEffect, useState } from 'react'
import { db, supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../components/ui/select'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { setBaseCurrencyCode } from '../lib/currency'
import toast from 'react-hot-toast'

type Currency = { code: string; name: string; symbol?: string | null; decimals?: number | null }
type FxRate = { id: string; date: string; fromCode: string; toCode: string; rate: number }

const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'MZN', name: 'Mozambican Metical', symbol: 'MT', decimals: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', decimals: 2 },
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2 },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', decimals: 2 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', decimals: 2 },
]

export default function CurrencyPage() {
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [base, setBase] = useState<string>('MZN')
  const [fx, setFx] = useState<FxRate[]>([])

  // new fx form
  const [fxDate, setFxDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [from, setFrom] = useState<string>('USD')
  const [to, setTo] = useState<string>('MZN')
  const [rate, setRate] = useState<string>('')

  useEffect(() => {
    (async () => {
      try {
        // 1) Load currencies, settings (base), and recent fx
        const [cs, setting, rates] = await Promise.all([
          db.currencies.list({ orderBy: { code: 'asc' } }),
          db.settings.get('app').catch(() => null),
          db.fxRates.list({ orderBy: { date: 'desc' }, limit: 200 }),
        ])

        // 2) Ensure defaults exist
        const existing = cs || []
        const need = DEFAULT_CURRENCIES.filter(d => !existing.find(c => c.code === d.code))
        if (need.length) {
          await supabase.from('currencies').upsert(need) // idempotent
        }

        // 3) Refresh currencies list after seeding
        const fresh = await db.currencies.list({ orderBy: { code: 'asc' } })
        setCurrencies(fresh || [])

        // 4) Load base from settings (if present)
        if (setting?.baseCurrencyCode) setBase(setting.baseCurrencyCode)

        // 5) FX rates table
        setFx(rates || [])

        // 6) Make sure selectors have valid codes
        const all = fresh || existing
        if (all?.length) {
          if (!all.find(c => c.code === from)) setFrom(all[0].code)
          if (!all.find(c => c.code === to)) setTo(all[0].code)
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load currency data')
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveBase() {
    try {
      // Write snake_case to avoid generated-column issues
      const payload = { id: 'app', base_currency_code: base }
      const { error } = await supabase.from('settings').upsert(payload)
      if (error) throw error
      setBaseCurrencyCode(base)
      toast.success('Base currency saved')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save base currency')
    }
  }

  async function addFx() {
    try {
      const r = parseFloat(rate)
      if (!fxDate || !from || !to || !r || Number.isNaN(r) || r <= 0) {
        toast.error('Please fill date, from, to and a positive rate')
        return
      }
      const id = `fx_${fxDate}_${from}_${to}`

      // IMPORTANT: use snake_case fields; do NOT send fromCode/toCode (they are generated)
      const payload = {
        id,
        date: fxDate,
        from_code: from,
        to_code: to,
        rate: r,
      }

      const { error } = await supabase.from('fx_rates').upsert(payload)
      if (error) throw error

      toast.success('FX rate saved')

      const updated = await db.fxRates.list({ orderBy: { date: 'desc' }, limit: 200 })
      setFx(updated || [])
      setRate('')
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to save FX rate')
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Currency & FX</h1>

      <Card>
        <CardHeader><CardTitle>Base Currency</CardTitle></CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="w-64">
            <Label>Base Currency</Label>
            <Select value={base} onValueChange={setBase}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map(c => (
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
                {currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>To</Label>
            <Select value={to} onValueChange={setTo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {currencies.map(c => <SelectItem key={c.code} value={c.code}>{c.code}</SelectItem>)}
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
                <tr>
                  <td colSpan={3} className="py-4 text-muted-foreground">No rates saved.</td>
                </tr>
              )}
              {fx.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 pr-2">{r.date}</td>
                  <td className="py-2 pr-2">{r.fromCode} → {r.toCode}</td>
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
