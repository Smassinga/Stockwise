// src/pages/Customers.tsx
import React, { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db' // keep your existing client import
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'

import { Card, CardHeader, CardTitle, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

type Currency = { code: string; name: string }

type CustomerRow = {
  id: string
  code: string
  name: string
  email: string | null
  phone: string | null
  tax_id: string | null
  billing_address: string | null
  shipping_address: string | null
  currency_code: string | null
  payment_terms: string | null
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
  paymentTerms: string
  notes: string
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
    paymentTerms: r.payment_terms || '',
    notes: r.notes || '',
  }
}

export default function Customers() {
  const { user } = useAuth()
  const { myRole } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'

  const [loading, setLoading] = useState(true)
  const [currencies, setCurrencies] = useState<Currency[]>([])
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
  const [paymentTerms, setPaymentTerms] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    (async () => {
      if (!user) return
      try {
        setLoading(true)

        // currencies
        {
          const res = await supabase
            .from('currencies')
            .select('code,name')
            .order('code', { ascending: true })
          if (res.error) throw res.error
          setCurrencies(res.data || [])
        }

        // customers
        {
          const res = await supabase
            .from('customers')
            .select(
              'id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms,notes,created_at,updated_at'
            )
            .order('name', { ascending: true })
          if (res.error) throw res.error
          setCustomers((res.data || []).map(mapRow))
        }
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load Customers')
      } finally {
        setLoading(false)
      }
    })()
  }, [user])

  const currencyByCode = useMemo(() => new Map(currencies.map(c => [c.code, c])), [currencies])

  async function reloadCustomers() {
    const res = await supabase
      .from('customers')
      .select(
        'id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms,notes,created_at,updated_at'
      )
      .order('name', { ascending: true })
    if (res.error) {
      toast.error(res.error.message)
      return
    }
    setCustomers((res.data || []).map(mapRow))
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!can.createMaster(role)) {
      toast.error('Only OPERATOR+ can create customers')
      return
    }
    const c = code.trim()
    const n = name.trim()
    if (!c || !n) {
      toast.error('Code and Name are required')
      return
    }

    try {
      // unique code check
      const dup = await supabase.from('customers').select('id').eq('code', c).limit(1)
      if (dup.error) throw dup.error
      if (dup.data && dup.data.length) {
        toast.error('Code must be unique')
        return
      }

      const payload: Partial<CustomerRow> = {
        code: c,
        name: n,
        email: email.trim() || null,
        phone: phone.trim() || null,
        tax_id: taxId.trim() || null,
        billing_address: billingAddress.trim() || null,
        shipping_address: shippingAddress.trim() || null,
        currency_code: currencyCode || null,
        payment_terms: paymentTerms.trim() || null,
        notes: notes.trim() || null,
      }

      const ins = await supabase.from('customers').insert(payload).select('id').single()
      if (ins.error) throw ins.error

      toast.success('Customer created')
      setCode('')
      setName('')
      setEmail('')
      setPhone('')
      setTaxId('')
      setBillingAddress('')
      setShippingAddress('')
      setCurrencyCode('')
      setPaymentTerms('')
      setNotes('')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create customer')
    }
  }

  async function handleDelete(id: string) {
    if (!can.deleteMaster(role)) {
      toast.error('Only MANAGER+ can delete customers')
      return
    }
    try {
      const del = await supabase.from('customers').delete().eq('id', id)
      if (del.error) throw del.error
      toast.success('Customer deleted')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete customer')
    }
  }

  if (!user) {
    return <div className="p-6 text-muted-foreground">Please sign in to manage customers.</div>
  }

  if (loading) return <div className="p-6">Loading…</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Customers</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create Customer</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="code">Code *</Label>
              <Input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="e.g., CUST-001" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="Customer name" />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <Select value={currencyCode} onValueChange={setCurrencyCode}>
                <SelectTrigger>
                  <SelectValue placeholder="Select currency (optional)" />
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
              <Label htmlFor="email">Email</Label>
              <Input id="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="customer@email.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+258 ..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxId">Tax ID</Label>
              <Input id="taxId" value={taxId} onChange={e => setTaxId(e.target.value)} placeholder="NIF / VAT" />
            </div>

            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="billingAddress">Billing Address</Label>
              <Input
                id="billingAddress"
                value={billingAddress}
                onChange={e => setBillingAddress(e.target.value)}
                placeholder="Street, City…"
              />
            </div>
            <div className="space-y-2 md:col-span-3">
              <Label htmlFor="shippingAddress">Shipping Address</Label>
              <Input
                id="shippingAddress"
                value={shippingAddress}
                onChange={e => setShippingAddress(e.target.value)}
                placeholder="Street, City…"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="paymentTerms">Payment Terms</Label>
              <Input
                id="paymentTerms"
                value={paymentTerms}
                onChange={e => setPaymentTerms(e.target.value)}
                placeholder="Net 30, COD, etc."
              />
            </div>
            <div className="space-y-2 md:col-span-1">
              <Label htmlFor="notes">Notes</Label>
              <Input id="notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
            </div>

            <div className="flex items-end">
              <Button type="submit" disabled={!can.createMaster(role)}>
                Create
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Customers List</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Code</th>
                <th className="py-2 pr-2">Name</th>
                <th className="py-2 pr-2">Currency</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Phone</th>
                <th className="py-2 pr-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-muted-foreground">
                    No customers yet.
                  </td>
                </tr>
              )}
              {customers.map(c => (
                <tr key={c.id} className="border-b">
                  <td className="py-2 pr-2">{c.code}</td>
                  <td className="py-2 pr-2">{c.name}</td>
                  <td className="py-2 pr-2">
                    {c.currencyCode ? `${c.currencyCode} — ${currencyByCode.get(c.currencyCode)?.name || ''}` : '-'}
                  </td>
                  <td className="py-2 pr-2">{c.email || '-'}</td>
                  <td className="py-2 pr-2">{c.phone || '-'}</td>
                  <td className="py-2 pr-2">
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={!can.deleteMaster(role)}
                        onClick={() =>
                          can.deleteMaster(role)
                            ? handleDelete(c.id)
                            : toast.error('Only MANAGER+ can delete customers')
                        }
                      >
                        Delete
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
