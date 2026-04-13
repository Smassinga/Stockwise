import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useOrg } from '../hooks/useOrg'
import { useI18n, withI18nFallback } from '../lib/i18n'
import { formatMoneyBase, getBaseCurrencyCode } from '../lib/currency'
import { hasRole, CanManageUsers } from '../lib/roles'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '../components/ui/sheet'

type BankAccount = {
  id: string
  company_id: string
  name: string
  bank_name: string | null
  account_number: string | null
  currency_code: string | null
  tax_number?: string | null
  swift?: string | null
  nib?: string | null
  created_at: string
}

type BalanceRow = { bank_id: string; balance_base: number }

type BankForm = {
  name: string
  bank_name: string
  account_number: string
  currency_code: string
  tax_number: string
  swift: string
  nib: string
}

const emptyForm = (currencyCode: string): BankForm => ({
  name: '',
  bank_name: '',
  account_number: '',
  currency_code: currencyCode,
  tax_number: '',
  swift: '',
  nib: '',
})

function maskAccountNumber(value?: string | null) {
  const trimmed = String(value || '').trim()
  if (!trimmed) return '—'
  if (trimmed.length <= 6) return trimmed
  return `${trimmed.slice(0, 3)} ••• ${trimmed.slice(-3)}`
}

export default function Banks() {
  const { t } = useI18n()
  const tf = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)
  const { companyId, companyName, myRole } = useOrg()
  const canManageBanks = hasRole(myRole, CanManageUsers)

  const [rows, setRows] = useState<BankAccount[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [openAdd, setOpenAdd] = useState(false)
  const [saving, setSaving] = useState(false)
  const [baseCurrency, setBaseCurrency] = useState<string>('MZN')
  const [form, setForm] = useState<BankForm>(() => emptyForm('MZN'))

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const code = await getBaseCurrencyCode()
        if (!mounted || !code) return
        setBaseCurrency(code)
        setForm((current) => (current.currency_code ? current : { ...current, currency_code: code }))
      } catch (error) {
        console.warn('Failed to load base currency:', error)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

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
    const next: Record<string, number> = {}
    ;(data as BalanceRow[]).forEach((row) => {
      next[row.bank_id] = Number(row.balance_base || 0)
    })
    setBalances(next)
  }

  async function addBank() {
    if (!canManageBanks) {
      toast.error(tf('banks.toast.noPermission', 'You do not have permission to manage bank accounts'))
      return
    }
    if (!form.name.trim()) {
      toast.error(tf('banks.required.nickname', 'Enter an internal nickname for this bank account'))
      return
    }

    setSaving(true)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        bank_name: form.bank_name.trim() || null,
        account_number: form.account_number.trim() || null,
        currency_code: (form.currency_code || baseCurrency || 'MZN').trim().toUpperCase(),
        tax_number: form.tax_number.trim() || null,
        swift: form.swift.trim() || null,
        nib: form.nib.trim() || null,
      }
      if (companyId) payload.company_id = companyId

      const { error } = await supabase.from('bank_accounts').insert(payload)
      if (error) throw error

      toast.success(tf('banks.toast.added', 'Bank account added'))
      setOpenAdd(false)
      setForm(emptyForm(baseCurrency || 'MZN'))
      if (companyId) {
        await loadBanks()
        await loadBalances()
      }
    } catch (error) {
      console.error(error)
      toast.error(tf('banks.toast.addFailed', 'Could not add bank account'))
    } finally {
      setSaving(false)
    }
  }

  const totalBalance = useMemo(
    () => rows.reduce((sum, row) => sum + Number(balances[row.id] ?? 0), 0),
    [balances, rows],
  )

  const currencies = useMemo(
    () => Array.from(new Set(rows.map((row) => row.currency_code || baseCurrency || 'MZN'))),
    [baseCurrency, rows],
  )

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.05] p-6 shadow-[0_30px_80px_-56px_rgba(15,23,42,0.48)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-[0.22em] text-primary/75">
              {tf('banks.eyebrow', 'Finance setup')}
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">
                {tf('banks.title', 'Bank accounts')}
              </h1>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                {tf(
                  'banks.subtitle',
                  'Configure the real bank accounts used for settlements, statement imports, and reconciliation. Each row represents a usable company bank account, not just a bank name.',
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-col items-start gap-3 lg:items-end">
            <Badge variant="outline" className="px-3 py-1 text-xs">
              {companyName || tf('company.selectCompany', 'Select company')}
            </Badge>
            <Sheet open={openAdd} onOpenChange={setOpenAdd}>
              <SheetTrigger asChild>
                <Button disabled={!canManageBanks}>+ {tf('banks.new', 'New bank account')}</Button>
              </SheetTrigger>
              <SheetContent className="sm:max-w-xl">
                <SheetHeader>
                  <SheetTitle>{tf('banks.addTitle', 'Add bank account')}</SheetTitle>
                  <SheetDescription>
                    {tf(
                      'banks.addDescription',
                      'Save the account identity, currency, and optional compliance references that finance will need when posting bank settlements and reconciling statements.',
                    )}
                  </SheetDescription>
                </SheetHeader>
                <SheetBody className="mt-5 pr-1">
                  <div className="space-y-6">
                    <Card className="border-border/70 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{tf('banks.form.identityTitle', 'Account identity')}</CardTitle>
                        <CardDescription>
                          {tf('banks.form.identityHelp', 'Use a clear internal nickname so finance can choose the right account quickly in settlements and statement workspaces.')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>{tf('banks.nickname', 'Nickname')}</Label>
                          <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>{tf('banks.bankName', 'Bank name')}</Label>
                          <Input value={form.bank_name} onChange={(e) => setForm((current) => ({ ...current, bank_name: e.target.value }))} />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-border/70 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{tf('banks.form.accountTitle', 'Account details')}</CardTitle>
                        <CardDescription>
                          {tf('banks.form.accountHelp', 'Capture the account number and operating currency used for bank receipts, payments, and statement matching.')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label>{tf('banks.accountNumber', 'Account number')}</Label>
                          <Input
                            value={form.account_number}
                            onChange={(e) => setForm((current) => ({ ...current, account_number: e.target.value }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>{tf('banks.currencyCode', 'Currency code')}</Label>
                          <Input
                            value={form.currency_code}
                            onChange={(e) => setForm((current) => ({ ...current, currency_code: e.target.value.toUpperCase() }))}
                            placeholder={baseCurrency || 'MZN'}
                          />
                        </div>
                      </CardContent>
                    </Card>

                    <Card className="border-border/70 shadow-none">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base">{tf('banks.form.referenceTitle', 'Compliance and reference fields')}</CardTitle>
                        <CardDescription>
                          {tf('banks.form.referenceHelp', 'Optional fields such as NIB, SWIFT, and tax number help keep printed bank details and statement reconciliation consistent without forcing them when not used.')}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                          <Label>{tf('banks.swift', 'SWIFT')}</Label>
                          <Input value={form.swift} onChange={(e) => setForm((current) => ({ ...current, swift: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>{tf('banks.nib', 'NIB')}</Label>
                          <Input value={form.nib} onChange={(e) => setForm((current) => ({ ...current, nib: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                          <Label>{tf('banks.taxNumberShort', 'Tax number')}</Label>
                          <Input value={form.tax_number} onChange={(e) => setForm((current) => ({ ...current, tax_number: e.target.value }))} />
                        </div>
                      </CardContent>
                    </Card>

                    <div className="flex justify-end">
                      <Button onClick={addBank} disabled={saving || !canManageBanks}>
                        {saving ? tf('actions.saving', 'Saving...') : tf('banks.save', 'Save bank account')}
                      </Button>
                    </div>
                  </div>
                </SheetBody>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>

      {!canManageBanks ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          {tf('banks.readOnly', 'Read-only: only users with bank-account management authority can add or update company bank accounts.')}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tf('banks.summary.accounts', 'Bank accounts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{rows.length}</div>
            <div className="text-xs text-muted-foreground">{tf('banks.summary.accountsHelp', 'Live bank settlement and statement accounts configured for this company.')}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tf('banks.summary.balance', 'Combined bank position')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{formatMoneyBase(totalBalance)}</div>
            <div className="text-xs text-muted-foreground">{tf('banks.summary.balanceHelp', 'Current book balance across every configured bank account in base currency.')}</div>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{tf('banks.summary.currencies', 'Currencies covered')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {currencies.length > 0 ? currencies.map((code) => (
                <Badge key={code} variant="secondary">{code}</Badge>
              )) : <span className="text-sm text-muted-foreground">{baseCurrency}</span>}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">{tf('banks.summary.currenciesHelp', 'Use separate accounts when settlement or statement reconciliation needs distinct bank currencies.')}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/70">
        <CardHeader className="pb-3">
          <CardTitle>{tf('banks.workspaceTitle', 'Bank account register')}</CardTitle>
          <CardDescription>
            {tf('banks.workspaceHelp', 'Use this register to open an account ledger, review book balance, upload statements, and maintain the account details that finance uses when posting bank receipts and payments.')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 px-6 py-10 text-center">
              <div className="text-base font-medium">{tf('banks.emptyTitle', 'No bank accounts configured yet')}</div>
              <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
                {tf('banks.emptyBody', 'Add the first bank account before posting bank settlements or importing statements. Stockwise uses these accounts as the live bank ledgers for receipts, payments, and reconciliation.')}
              </p>
              {canManageBanks ? (
                <Button className="mt-4" onClick={() => setOpenAdd(true)}>
                  {tf('banks.emptyAction', 'Add first bank account')}
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {rows.map((row) => (
                <Card
                  key={row.id}
                  className="border-border/70 bg-gradient-to-br from-background via-background to-primary/[0.03] shadow-[0_24px_70px_-56px_rgba(15,23,42,0.48)] transition-transform duration-200 hover:-translate-y-0.5"
                >
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-lg">{row.name}</CardTitle>
                        <CardDescription>{row.bank_name || tf('banks.noBankName', 'Bank name not recorded')}</CardDescription>
                      </div>
                      <Badge variant="outline">{row.currency_code || baseCurrency || 'MZN'}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{tf('banks.accountLabel', 'Account')}</Badge>
                      <Badge variant="outline">{maskAccountNumber(row.account_number)}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        {tf('banks.balanceBase', 'Book balance')}
                      </div>
                      <div className="mt-1 text-3xl font-semibold tracking-tight">
                        {formatMoneyBase(balances[row.id] ?? 0)}
                      </div>
                    </div>

                    {(row.swift || row.nib || row.tax_number) ? (
                      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">{tf('banks.swift', 'SWIFT')}</div>
                          <div className="font-mono text-foreground">{row.swift || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">{tf('banks.nib', 'NIB')}</div>
                          <div className="font-mono text-foreground">{row.nib || '—'}</div>
                        </div>
                        <div>
                          <div className="text-[11px] uppercase tracking-[0.18em]">{tf('banks.taxNumberShort', 'Tax number')}</div>
                          <div className="font-mono text-foreground">{row.tax_number || '—'}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
                        {tf('banks.noReferenceFields', 'Optional bank reference fields are not configured on this account yet.')}
                      </div>
                    )}

                    <Button asChild className="w-full">
                      <Link to={`/banks/${row.id}`}>{tf('banks.open', 'Open account')}</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
