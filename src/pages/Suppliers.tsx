// src/pages/Suppliers.tsx
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n } from '../lib/i18n'

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

// Currency "id" is always the CODE
type Currency = { id: string; code: string; name: string }

type Supplier = {
  id: string
  code: string
  name: string
  contactName: string | null
  email: string | null
  phone: string | null
  taxId: string | null
  currencyId: string | null
  paymentTermsId: string | null
  isActive: boolean
  notes: string | null
  createdAt: string | null
  updatedAt: string | null
}

// NEW: Payment term type
type PaymentTerm = {
  id: string
  code: string
  name: string
  net_days: number
}

const sortBy = <T,>(arr: T[], key: (t: T) => string) =>
  [...arr].sort((a, b) => key(a).localeCompare(key(b)))

// Helper function to check existence of records (avoids HEAD requests)
async function existsBy<T extends string>(
  table: string,
  where: Record<string, string|number|null|boolean>
): Promise<boolean> {
  let q = supabase.from(table).select('id', { count: 'exact' }).limit(1);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v as any);
  const { count, error } = await q;
  if (error) throw error;
  return (count ?? 0) > 0;
}

const mapSupplierRow = (r: any): Supplier => ({
  id: String(r.id),
  code: r.code ?? '',
  name: r.name ?? '',
  contactName: r.contactName ?? r.contact_name ?? null,
  email: r.email ?? null,
  phone: r.phone ?? null,
  taxId: r.taxId ?? r.tax_id ?? null,
  currencyId: r.currencyId ?? r.currency_code ?? null,
  paymentTermsId: r.paymentTermsId ?? r.payment_terms_id ?? null,
  isActive: typeof r.isActive === 'boolean' ? r.isActive : !!r.is_active,
  notes: r.notes ?? null,
  createdAt: r.createdAt ?? r.created_at ?? null,
  updatedAt: r.updatedAt ?? r.updated_at ?? null,
})

export default function Suppliers() {
  const { user } = useAuth()
  const { companyId, myRole } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const { t } = useI18n()

  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)

  // Create form
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [contactName, setContactName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [taxId, setTaxId] = useState('')
  const [currencyId, setCurrencyId] = useState('') // stores currency CODE
  const [paymentTermsId, setPaymentTermsId] = useState('')
  const [customPaymentTerms, setCustomPaymentTerms] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [notes, setNotes] = useState('')

  const currencyById = useMemo(() => new Map(currencies.map(c => [c.id, c])), [currencies])
  // Create a map of payment terms by ID for display
  const paymentTermById = useMemo(() => new Map(paymentTermsList.map(pt => [pt.id, pt])), [paymentTermsList])

  // ----------- Load masters (scoped) -----------
  useEffect(() => {
    (async () => {
      if (!user) return
      try {
        setLoading(true)

        // Currencies (global)
        {
          const cur = await supabase
            .from('currencies')
            .select('code,name')
            .order('code', { ascending: true })
          if (cur.error) throw cur.error
          setCurrencies((cur.data || []).map((r: any) => ({ id: r.code, code: r.code, name: r.name })))
        }

        // Load payment terms using RPC function
        if (companyId) {
          const { data: pts, error: ptErr } = await supabase
            .rpc('get_payment_terms', { p_company_id: companyId })
          if (ptErr) throw ptErr
          setPaymentTermsList((pts || []) as PaymentTerm[])
        }

        await reloadSuppliers()
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load suppliers')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, companyId])

  async function reloadSuppliers() {
    if (!companyId) { setSuppliers([]); return }

    // First try the view (preferred)
    const v = await supabase
      .from('suppliers_view')
      .select('id,code,name,contactName,email,phone,taxId,currencyId,paymentTermsId,isActive,notes,createdAt,updatedAt,company_id')
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (!v.error) {
      setSuppliers((v.data || []).map(mapSupplierRow))
      return
    }

    // If the view is missing company_id column or not deployed yet, fall back to base table.
    const fallback = await supabase
      .from('suppliers')
      .select('id,code,name,contact_name, email, phone, tax_id, currency_code, payment_terms_id, is_active, notes, created_at, updated_at')
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (fallback.error) {
      toast.error(fallback.error.message)
      setSuppliers([])
      return
    }
    setSuppliers((fallback.data || []).map(mapSupplierRow))
  }

  // ----------- Create / Update / Delete (scoped) -----------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.createMaster(role)) return toast.error('Only OPERATOR+ can create suppliers')
    if (!code.trim() || !name.trim()) return toast.error('Code and Name are required')

    try {
      // Per-company duplicate code check using helper function (avoids HEAD requests)
      if (await existsBy('suppliers', { company_id: companyId, code: code.trim() })) {
        return toast.error('Code must be unique (per company)');
      }

      // Determine effective payment terms
      const CUSTOM = "__custom__"
      // Remove the effectiveTerms logic since we're now using payment_terms_id
      // const effectiveTerms = 
      //   paymentTerms === CUSTOM ? (customPaymentTerms.trim() || null) : paymentTerms

      const payload: any = {
        company_id: companyId,          // tenant key
        code: code.trim(),
        name: name.trim(),
        contact_name: contactName.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        tax_id: taxId.trim() || null,
        currency_code: currencyId || null, // FK by CODE
        payment_terms_id: paymentTermsId || null,
        is_active: !!isActive,
        notes: notes.trim() || null,
      }

      const ins = await supabase.from('suppliers').insert(payload).select('id').single()
      if (ins.error) throw ins.error

      toast.success('Supplier created')
      setCode(''); setName(''); setContactName(''); setEmail(''); setPhone(''); setTaxId('')
      setCurrencyId(''); setPaymentTermsId(''); setCustomPaymentTerms(''); setIsActive(true); setNotes('')

      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create supplier')
    }
  }

  async function handleDelete(id: string) {
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.deleteMaster(role)) return toast.error('Only MANAGER+ can delete suppliers')
    try {
      const del = await supabase
        .from('suppliers')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId) // fail-closed to tenant
      if (del.error) throw del.error
      toast.success('Supplier deleted')
      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete supplier')
    }
  }

  async function toggleActive(id: string, next: boolean) {
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.updateMaster(role)) return toast.error('Only OPERATOR+ can update suppliers')
    try {
      const upd = await supabase
        .from('suppliers')
        .update({ is_active: next })
        .eq('id', id)
        .eq('company_id', companyId) // tenant guard
      if (upd.error) throw upd.error
      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update supplier')
    }
  }

  const suppliersRows = useMemo(() => sortBy(suppliers, s => (s.name || '').toLowerCase()), [suppliers])

  if (!user) return <div className="p-6 text-muted-foreground">{t('auth.title.signIn')}</div>
  if (loading) return <div className="p-6">{t('loading')}</div>

  // Constant for custom payment terms
  const CUSTOM = "__custom__"

  return (
    <div className="space-y-6 mobile-container w-full max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('suppliers.title')}</h1>
      </div>

      {/* Create */}
      <Card>
        <CardHeader><CardTitle>{t('suppliers.create')}</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="code">{t('customers.code')} *</Label>
              <Input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g., SAMSUNG" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t('customers.name')} *</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Samsung Electronics" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">{t('suppliers.currency')}</Label>
              <Select value={currencyId} onValueChange={setCurrencyId}>
                <SelectTrigger id="currency"><SelectValue placeholder="Select a currency" /></SelectTrigger>
                <SelectContent>
                  {currencies.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="contactName">{t('suppliers.contactName')}</Label>
              <Input id="contactName" value={contactName} onChange={e => setContactName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">{t('customers.email')}</Label>
              <Input id="email" value={email} onChange={e => setEmail(e.target.value)} type="email" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('customers.phone')}</Label>
              <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="taxId">{t('suppliers.taxId')}</Label>
              <Input id="taxId" value={taxId} onChange={e => setTaxId(e.target.value)} />
            </div>
            
            {/* Payment terms selector */}
            <div className="space-y-2">
              <Label>{t('suppliers.paymentTerms')}</Label>
              <Select value={paymentTermsId} onValueChange={setPaymentTermsId}>
                <SelectTrigger id="paymentTerms">
                  <SelectValue placeholder="Select payment terms" />
                </SelectTrigger>
                <SelectContent>
                  {paymentTermsList.map(pt => (
                    <SelectItem key={pt.id} value={pt.id}>
                      {pt.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>Custom</SelectItem>
                </SelectContent>
              </Select>
              {paymentTermsId === CUSTOM && (
                <Input 
                  placeholder="Enter custom payment terms" 
                  value={customPaymentTerms} 
                  onChange={e => setCustomPaymentTerms(e.target.value)} 
                />
              )}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="isActive" className="inline-flex items-center gap-2">
                <input
                  id="isActive"
                  type="checkbox"
                  className="h-4 w-4"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                {t('suppliers.active')}
              </Label>
            </div>

            <div className="md:col-span-3 space-y-2">
              <Label htmlFor="notes">{t('suppliers.notes')}</Label>
              <Input id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <div className="md:col-span-3">
              <Button type="submit" disabled={!can.createMaster(role)}>{t('suppliers.create')}</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* List */}
      <Card>
        <CardHeader><CardTitle>{t('suppliers.list')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">{t('customers.code')}</th>
                <th className="py-2 pr-2">{t('customers.name')}</th>
                <th className="py-2 pr-2">{t('suppliers.currency')}</th>
                <th className="py-2 pr-2">{t('suppliers.paymentTerms')}</th>
                <th className="py-2 pr-2">{t('customers.email')}</th>
                <th className="py-2 pr-2">{t('customers.phone')}</th>
                <th className="py-2 pr-2">{t('suppliers.status')}</th>
                <th className="py-2 pr-2">{t('customers.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {suppliersRows.length === 0 && (
                <tr><td colSpan={8} className="py-4 text-muted-foreground">{t('common.none')}</td></tr>
              )}
              {suppliersRows.map(s => {
                const c = s.currencyId ? currencyById.get(String(s.currencyId)) : null
                const curLabel = c ? `${c.code} — ${c.name}` : (s.currencyId || '-')
                // Get payment terms label
                const ptLabel = s.paymentTermsId ? (paymentTermById.get(s.paymentTermsId)?.name || s.paymentTermsId) : '-'
                return (
                  <tr key={s.id} className="border-b">
                    <td className="py-2 pr-2">{s.code}</td>
                    <td className="py-2 pr-2">{s.name}</td>
                    <td className="py-2 pr-2">{curLabel}</td>
                    <td className="py-2 pr-2">{ptLabel}</td>
                    <td className="py-2 pr-2">{s.email || '-'}</td>
                    <td className="py-2 pr-2">{s.phone || '-'}</td>
                    <td className="py-2 pr-2">
                      <span className={s.isActive ? 'text-green-700' : 'text-muted-foreground'}>
                        {s.isActive ? t('suppliers.active') : t('suppliers.inactive')}
                      </span>
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          disabled={!can.updateMaster(role)}
                          onClick={() => toggleActive(s.id, !s.isActive)}
                        >
                          {s.isActive ? t('suppliers.deactivate') : t('suppliers.activate')}
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={!can.deleteMaster(role)}
                          onClick={() =>
                            can.deleteMaster(role)
                              ? handleDelete(s.id)
                              : toast.error('')
                          }
                        >
                          {t('suppliers.delete')}
                        </Button>
                      </div>
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
