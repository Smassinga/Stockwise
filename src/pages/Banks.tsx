// src/pages/Banks.tsx
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/db'
import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetDescription, // <- fixes console warning
} from '../components/ui/sheet'
import toast from 'react-hot-toast'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { useOrg } from '../hooks/useOrg' // <- source of truth for company id
import { useI18n } from '../lib/i18n'

type BankAccount = {
  id: string
  company_id: string
  name: string
  bank_name: string | null
  account_number: string | null
  currency_code: string | null
  // Optional new columns (UI-safe if they don't exist yet)
  tax_number?: string | null
  swift?: string | null
  nib?: string | null
  created_at: string
}

type BalanceRow = { bank_id: string; balance_base: number }

export default function Banks() {
  const { t } = useI18n()
  const { companyId } = useOrg() // no changes to useOrg needed
  const [rows, setRows] = useState<BankAccount[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [openAdd, setOpenAdd] = useState(false)
  const [saving, setSaving] = useState(false)

  // async base currency → resolve to state, fallback MZN
  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')

  const [form, setForm] = useState<{
    name: string
    bank_name: string
    account_number: string
    currency_code: string
  }>({
    name: '',
    bank_name: '',
    account_number: '',
    currency_code: '', // will fill once baseCurrency arrives
  })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode()
        if (mounted && code) setBaseCurrency(code)
      } catch (e) {
        console.warn('Failed to load base currency:', e)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  // seed form currency once baseCurrency is known
  useEffect(() => {
    if (baseCurrency && !form.currency_code) {
      setForm((f) => ({ ...f, currency_code: baseCurrency }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseCurrency])

  useEffect(() => {
    if (!companyId) return
    loadBanks()
    loadBalances()
  }, [companyId])

  async function loadBanks() {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('id, company_id, name, bank_name, account_number, currency_code, tax_number, swift, nib, created_at')
      .eq('company_id', companyId)
      .order('created_at', { ascending: true })
    if (error) {
      console.warn('bank_accounts not ready:', error.message)
      setRows([])
      return
    }
    setRows((data || []) as BankAccount[])
  }

  async function loadBalances() {
    const { data, error } = await supabase.rpc('bank_account_balances', { p_company: companyId })
    if (error || !Array.isArray(data)) {
      console.warn('bank_account_balances not ready:', error?.message)
      setBalances({})
      return
    }
    const map: Record<string, number> = {}
    ;(data as BalanceRow[]).forEach((r) => {
      map[r.bank_id] = r.balance_base
    })
    setBalances(map)
  }

  async function addBank() {
    if (!form.name.trim()) {
      toast.error(t('banks.required.nickname'))
      return
    }
    setSaving(true)
    try {
      // Let DB default current_company_id() fill company_id if we don't have it yet
      const payload: any = {
        name: form.name.trim(),
        bank_name: form.bank_name.trim() || null,
        account_number: form.account_number.trim() || null,
        currency_code: (form.currency_code || baseCurrency || 'MZN').toUpperCase() || null,
      }
      if (companyId) payload.company_id = companyId

      const { error } = await supabase.from('bank_accounts').insert(payload)
      if (error) throw error

      toast.success(t('banks.toast.added'))
      setOpenAdd(false)
      setForm({ name: '', bank_name: '', account_number: '', currency_code: baseCurrency || 'MZN' })

      // Refresh if we know the company; otherwise first load will happen once useOrg resolves
      if (companyId) {
        await loadBanks()
        await loadBalances()
      }
    } catch (e: any) {
      toast.error(t('banks.toast.addFailed'))
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-semibold">{t('banks.title')}</h1>
        <div className="ml-auto">
          <Sheet open={openAdd} onOpenChange={setOpenAdd}>
            <SheetTrigger asChild>
              <Button>+ {t('banks.new')}</Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>{t('banks.addTitle')}</SheetTitle>
                {/* a11y: provide description so DialogContent stops warning */}
                <SheetDescription className="sr-only">
                  {t('actions.save')}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 mt-4">
                <div>
                  <Label>{t('banks.nickname')}</Label>
                  <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <Label>{t('banks.bankName')}</Label>
                  <Input value={form.bank_name} onChange={(e) => setForm((f) => ({ ...f, bank_name: e.target.value }))} />
                </div>
                <div>
                  <Label>{t('banks.accountNumber')}</Label>
                  <Input
                    value={form.account_number}
                    onChange={(e) => setForm((f) => ({ ...f, account_number: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>{t('banks.currencyCode')}</Label>
                  <Input
                    value={form.currency_code}
                    onChange={(e) => setForm((f) => ({ ...f, currency_code: e.target.value.toUpperCase() }))}
                    placeholder={baseCurrency || 'MZN'}
                  />
                </div>
                <Button onClick={addBank} disabled={saving}>
                  {saving ? t('actions.saving') : t('banks.save')}
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {rows.map((b) => (
          <Card key={b.id} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex justify-between items-center">
                <span title={b.bank_name || undefined}>{b.name}</span>
                <span className="text-sm font-normal text-muted-foreground">
                  {b.currency_code || baseCurrency || 'MZN'}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1">
              <div className="text-sm text-muted-foreground">{t('banks.account')}</div>
              <div className="mb-2">{b.account_number || '—'}</div>

              {(b.swift || b.nib || b.tax_number) && (
                <div className="mb-2 text-xs text-muted-foreground space-y-1">
                  {b.swift && (
                    <div>
                      SWIFT: <span className="font-mono">{b.swift}</span>
                    </div>
                  )}
                  {b.nib && (
                    <div>
                      NIB/BIN: <span className="font-mono">{b.nib}</span>
                    </div>
                  )}
                  {b.tax_number && (
                    <div>
                      NUIT: <span className="font-mono">{b.tax_number}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="text-sm text-muted-foreground">{t('banks.balanceBase')}</div>
              <div className="text-2xl">{formatMoneyBase(balances[b.id] ?? 0)}</div>
              <div className="mt-4">
                <Link to={`/banks/${b.id}`}>
                  <Button variant="secondary" className="w-full">
                    {t('banks.open')}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card>
            <CardContent className="py-8 text-muted-foreground">{t('banks.empty')}</CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
