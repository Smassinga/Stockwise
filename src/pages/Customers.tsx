// src/pages/Customers.tsx (company-scoped drop-in)
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db' // keep your existing client import
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n } from '../lib/i18n'

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

// ---------------- Types ----------------

type Currency = { code: string; name: string }

type CustomerRow = {
  id: string
  company_id?: string | null
  code: string
  name: string
  email: string | null
  phone: string | null
  tax_id: string | null
  billing_address: string | null
  shipping_address: string | null
  currency_code: string | null
  payment_terms_id: string | null
  notes: string | null
  created_at?: string | null
  updated_at?: string | null
}

type Customer = {
  id: string
  code: string
  name: string
  email: string
  phone: string
  taxId: string
  billingAddress: string
  shippingAddress: string
  currencyCode: string
  paymentTermsId: string
  notes: string
}

// NEW: Payment term type
type PaymentTerm = {
  id: string
  code: string
  name: string
  net_days: number
}

function mapRow(r: CustomerRow): Customer {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    email: r.email || '',
    phone: r.phone || '',
    taxId: r.tax_id || '',
    billingAddress: r.billing_address || '',
    shippingAddress: r.shipping_address || '',
    currencyCode: r.currency_code || '',
    paymentTermsId: r.payment_terms_id || '',
    notes: r.notes || '',
  }
}

export default function Customers() {
  const { user } = useAuth()
  const { myRole, companyId } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const { t } = useI18n()

  const [loading, setLoading] = useState(true)
  const [currencies, setCurrencies] = useState<Currency[]>([])
  // NEW: Payment terms state
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])

  // form
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [taxId, setTaxId] = useState('')
  const [billingAddress, setBillingAddress] = useState('')
  const [shippingAddress, setShippingAddress] = useState('')
  const [currencyCode, setCurrencyCode] = useState('')
  const [paymentTermsId, setPaymentTermsId] = useState('')
  const [customPaymentTerms, setCustomPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')

  // ---------- Load ----------
  useEffect(() => {
    (async () => {
      try {
        setLoading(true)

        // currencies (global)
        const resCur = await supabase
          .from('currencies')
          .select('code,name')
          .order('code', { ascending: true })
        if (resCur.error) throw resCur.error
        setCurrencies((resCur.data || []) as Currency[])

        // NEW: Load payment terms using RPC function
        if (companyId) {
          const { data: pts, error: ptErr } = await supabase
            .rpc('get_payment_terms', { p_company_id: companyId })
          if (ptErr) throw ptErr
          setPaymentTermsList((pts || []) as PaymentTerm[])
        }

        // customers (strictly company-scoped)
        if (!companyId) { setCustomers([]); return }
        const resCus = await supabase
          .from('customers')
          .select('id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms_id,notes,created_at,updated_at')
          .eq('company_id', companyId)
          .order('name', { ascending: true })
        if (resCus.error) throw resCus.error
        setCustomers((resCus.data || []).map(mapRow))
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load Customers')
      } finally {
        setLoading(false)
      }
    })()
  }, [companyId])

  const currencyByCode = useMemo(() => new Map(currencies.map(c => [c.code, c])), [currencies])
  // NEW: Create a map of payment terms by ID for display
  const paymentTermById = useMemo(() => new Map(paymentTermsList.map(pt => [pt.id, pt])), [paymentTermsList])

  async function reloadCustomers() {
    if (!companyId) { setCustomers([]); return }
    const res = await supabase
      .from('customers')
      .select('id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms_id,notes,created_at,updated_at')
      .eq('company_id', companyId)
      .order('name', { ascending: true })
    if (res.error) { toast.error(res.error.message); return }
    setCustomers((res.data || []).map(mapRow))
  }

  // ---------- Create / Delete ----------
  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!can.createMaster(role)) return toast.error('Only OPERATOR+ can create customers')
    if (!companyId) return toast.error('Join or create a company first')

    const c = code.trim()
    const n = name.trim()
    if (!c || !n) return toast.error('Code and Name are required')

    try {
      // unique code check *per company*
      const dup = await supabase
        .from('customers')
        .select('id')
        .eq('company_id', companyId)
        .eq('code', c)
        .limit(1)
      if (dup.error) throw dup.error
      if (dup.data && dup.data.length) return toast.error('Code must be unique in this company')

      // NEW: Determine effective payment terms
      const CUSTOM = "__custom__"
      // Remove the effectiveTerms logic since we're now using payment_terms_id
      // const effectiveTerms = 
      //   paymentTerms === CUSTOM ? (customPaymentTerms.trim() || null) : paymentTerms

      const payload: Partial<CustomerRow> = {
        company_id: companyId,
        code: c,
        name: n,
        email: email.trim() || null,
        phone: phone.trim() || null,
        tax_id: taxId.trim() || null,
        billing_address: billingAddress.trim() || null,
        shipping_address: shippingAddress.trim() || null,
        currency_code: currencyCode || null,
        payment_terms_id: paymentTermsId || null,
        notes: notes.trim() || null,
      }

      const ins = await supabase
        .from('customers')
        .insert(payload)
        .select('id')
        .single()
      if (ins.error) throw ins.error

      toast.success('Customer created')
      setCode(''); setName(''); setEmail(''); setPhone(''); setTaxId(''); setBillingAddress(''); setShippingAddress(''); setCurrencyCode(''); setPaymentTermsId(''); setCustomPaymentTerms(''); setNotes('')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create customer')
    }
  }

  async function handleDelete(id: string) {
    if (!can.deleteMaster(role)) return toast.error('Only MANAGER+ can delete customers')
    if (!companyId) return toast.error('Join or create a company first')
    try {
      // Hard-scope deletion by company to be extra safe (even with RLS)
      const del = await supabase
        .from('customers')
        .delete()
        .eq('id', id)
        .eq('company_id', companyId)
      if (del.error) throw del.error
      toast.success('Customer deleted')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete customer')
    }
  }

  // ---------- Render ----------
  if (!user) return <div className="p-6 text-muted-foreground">{t('auth.title.signIn')}</div>
  if (loading) return <div className="p-6">{t('loading')}</div>

  // NEW: Constant for custom payment terms
  const CUSTOM = "__custom__"

  return (
    <div className="space-y-6 mobile-container w-full max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">{t('customers.title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('customers.create')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="code">{t('customers.code')} *</Label>
              <Input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g., CUST-001" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">{t('customers.name')} *</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder={t('customers.name')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">{t('customers.currency')}</Label>
              <Select value={currencyCode} onValueChange={setCurrencyCode}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder={t('orders.currency')} />
                </SelectTrigger>
                <SelectContent>
                  {currencies.map(c => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">{t('customers.email')}</Label>
              <Input id="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">{t('customers.phone')}</Label>
              <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+258 ..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">{t('customers.taxId')}</Label>
              <Input id="taxId" value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="NIF / VAT" />
            </div>

            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="billingAddress">{t('customers.billing')}</Label>
              <Input id="billingAddress" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} placeholder="Street, City…" />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="shippingAddress">{t('customers.shipping')}</Label>
              <Input id="shippingAddress" value={shippingAddress} onChange={e => setShippingAddress(e.target.value)} placeholder="Street, City…" />
            </div>

            {/* Payment terms selector */}
            <div className="space-y-2 md:col-span-2">
              <Label>{t('customers.paymentTerms')}</Label>
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
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="notes">{t('customers.notes')}</Label>
              <Input id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <div className="flex items-end">
              <Button type="submit" disabled={!can.createMaster(role)}>
                {t('customers.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('customers.list')}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto w-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">{t('customers.code')}</th>
                <th className="py-2 pr-2">{t('customers.name')}</th>
                <th className="py-2 pr-2">{t('customers.currency')}</th>
                <th className="py-2 pr-2">{t('customers.paymentTerms')}</th>
                <th className="py-2 pr-2">{t('customers.email')}</th>
                <th className="py-2 pr-2">{t('customers.phone')}</th>
                <th className="py-2 pr-2">{t('customers.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-muted-foreground">{t('customers.empty')}</td>
                </tr>
              )}
              {customers.map(c => (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-2">{c.code}</td>
                  <td className="py-2 pr-2">{c.name}</td>
                  <td className="py-2 pr-2">{c.currencyCode ? `${c.currencyCode} — ${currencyByCode.get(c.currencyCode)?.name || ''}` : '-'}</td>
                  <td className="py-2 pr-2">{paymentTermById.get(c.paymentTermsId)?.name || '-'}</td>
                  <td className="py-2 pr-2">{c.email || '-'}</td>
                  <td className="py-2 pr-2">{c.phone || '-'}</td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={!can.deleteMaster(role)}
                        onClick={() => (can.deleteMaster(role) ? handleDelete(c.id) : toast.error(''))}
                      >
                        {t('common.remove')}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
