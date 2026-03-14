import { useEffect, useMemo, useState } from 'react'
import { Mail, MapPin, Pencil, Phone, Search, Users } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n } from '../lib/i18n'

import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'
import { Textarea } from '../components/ui/textarea'

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
  paymentTermsId: string
  paymentTerms: string
  notes: string
}

type PaymentTerm = {
  id: string
  code: string
  name: string
  net_days: number
}

type CustomerForm = {
  code: string
  name: string
  email: string
  phone: string
  taxId: string
  billingAddress: string
  shippingAddress: string
  currencyCode: string
  paymentTermsChoice: string
  customPaymentTerms: string
  notes: string
}

const NO_CURRENCY = '__none__'
const NO_PAYMENT_TERMS = '__none__'
const CUSTOM_PAYMENT_TERMS = '__custom__'

const EMPTY_FORM: CustomerForm = {
  code: '',
  name: '',
  email: '',
  phone: '',
  taxId: '',
  billingAddress: '',
  shippingAddress: '',
  currencyCode: '',
  paymentTermsChoice: '',
  customPaymentTerms: '',
  notes: '',
}

function mapRow(row: CustomerRow): Customer {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    email: row.email || '',
    phone: row.phone || '',
    taxId: row.tax_id || '',
    billingAddress: row.billing_address || '',
    shippingAddress: row.shipping_address || '',
    currencyCode: row.currency_code || '',
    paymentTermsId: row.payment_terms_id || '',
    paymentTerms: row.payment_terms || '',
    notes: row.notes || '',
  }
}

function formFromCustomer(customer: Customer): CustomerForm {
  const usesCustomTerms = !customer.paymentTermsId && !!customer.paymentTerms
  return {
    code: customer.code,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    taxId: customer.taxId,
    billingAddress: customer.billingAddress,
    shippingAddress: customer.shippingAddress,
    currencyCode: customer.currencyCode,
    paymentTermsChoice: customer.paymentTermsId || (usesCustomTerms ? CUSTOM_PAYMENT_TERMS : ''),
    customPaymentTerms: usesCustomTerms ? customer.paymentTerms : '',
    notes: customer.notes,
  }
}

function normalizeTermPayload(form: CustomerForm, paymentTermsById: Map<string, PaymentTerm>) {
  if (!form.paymentTermsChoice || form.paymentTermsChoice === NO_PAYMENT_TERMS) {
    return { payment_terms_id: null, payment_terms: null }
  }

  if (form.paymentTermsChoice === CUSTOM_PAYMENT_TERMS) {
    return {
      payment_terms_id: null,
      payment_terms: form.customPaymentTerms.trim() || null,
    }
  }

  const selected = paymentTermsById.get(form.paymentTermsChoice)
  return {
    payment_terms_id: form.paymentTermsChoice,
    payment_terms: selected ? selected.name : null,
  }
}

function customerTermsLabel(customer: Customer, paymentTermsById: Map<string, PaymentTerm>) {
  if (customer.paymentTermsId) {
    return paymentTermsById.get(customer.paymentTermsId)?.name || customer.paymentTerms || customer.paymentTermsId
  }
  return customer.paymentTerms || 'No terms'
}

function CustomerFormFields({
  form,
  onChange,
  currencies,
  paymentTermsList,
}: {
  form: CustomerForm
  onChange: (patch: Partial<CustomerForm>) => void
  currencies: Currency[]
  paymentTermsList: PaymentTerm[]
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="customer-code">Code *</Label>
        <Input
          id="customer-code"
          value={form.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="e.g., CUST-001"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-name">Name *</Label>
        <Input
          id="customer-name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Customer legal or trading name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-email">Email</Label>
        <Input
          id="customer-email"
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="customer@company.com"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-phone">Phone</Label>
        <Input
          id="customer-phone"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="+258 ..."
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-tax-id">Tax ID</Label>
        <Input
          id="customer-tax-id"
          value={form.taxId}
          onChange={(e) => onChange({ taxId: e.target.value })}
          placeholder="NUIT / VAT / Tax ID"
        />
      </div>
      <div className="space-y-2">
        <Label>Default currency</Label>
        <Select
          value={form.currencyCode || NO_CURRENCY}
          onValueChange={(value) => onChange({ currencyCode: value === NO_CURRENCY ? '' : value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="No default currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CURRENCY}>No default currency</SelectItem>
            {currencies.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>Payment terms</Label>
        <Select
          value={form.paymentTermsChoice || NO_PAYMENT_TERMS}
          onValueChange={(value) =>
            onChange({
              paymentTermsChoice: value === NO_PAYMENT_TERMS ? '' : value,
              customPaymentTerms: value === CUSTOM_PAYMENT_TERMS ? form.customPaymentTerms : '',
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="Select payment terms" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PAYMENT_TERMS}>No default terms</SelectItem>
            {paymentTermsList.map((paymentTerm) => (
              <SelectItem key={paymentTerm.id} value={paymentTerm.id}>
                {paymentTerm.name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_PAYMENT_TERMS}>Custom terms</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-custom-terms">Terms note</Label>
        <Input
          id="customer-custom-terms"
          value={form.customPaymentTerms}
          onChange={(e) => onChange({ customPaymentTerms: e.target.value })}
          placeholder="Only used when Custom terms is selected"
          disabled={form.paymentTermsChoice !== CUSTOM_PAYMENT_TERMS}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-billing-address">Billing address</Label>
        <Input
          id="customer-billing-address"
          value={form.billingAddress}
          onChange={(e) => onChange({ billingAddress: e.target.value })}
          placeholder="Street, city, province, postal code"
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-shipping-address">Shipping or service address</Label>
        <Input
          id="customer-shipping-address"
          value={form.shippingAddress}
          onChange={(e) => onChange({ shippingAddress: e.target.value })}
          placeholder="Only if it differs from billing"
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-notes">Notes</Label>
        <Textarea
          id="customer-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Commercial notes, service instructions, account context..."
        />
      </div>
    </div>
  )
}

export default function Customers() {
  const { user } = useAuth()
  const { myRole, companyId } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const { t } = useI18n()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [search, setSearch] = useState('')
  const [createForm, setCreateForm] = useState<CustomerForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [editForm, setEditForm] = useState<CustomerForm>(EMPTY_FORM)

  const currencyByCode = useMemo(() => new Map(currencies.map((currency) => [currency.code, currency])), [currencies])
  const paymentTermById = useMemo(
    () => new Map(paymentTermsList.map((paymentTerm) => [paymentTerm.id, paymentTerm])),
    [paymentTermsList]
  )

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)

        const resCur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })
        if (resCur.error) throw resCur.error
        setCurrencies((resCur.data || []) as Currency[])

        if (companyId) {
          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {
            p_company_id: companyId,
          })
          if (paymentTermsError) throw paymentTermsError
          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])
        }

        await reloadCustomers()
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || 'Failed to load customers')
      } finally {
        setLoading(false)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  async function reloadCustomers() {
    if (!companyId) {
      setCustomers([])
      return
    }

    const res = await supabase
      .from('customers')
      .select(
        'id,code,name,email,phone,tax_id,billing_address,shipping_address,currency_code,payment_terms_id,payment_terms,notes,created_at,updated_at'
      )
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (res.error) {
      toast.error(res.error.message)
      return
    }

    setCustomers((res.data || []).map(mapRow))
  }

  async function ensureUniqueCode(code: string, excludeId?: string) {
    if (!companyId) return false
    let query = supabase.from('customers').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('code', code)
    if (excludeId) query = query.neq('id', excludeId)
    const dup = await query
    if (dup.error) throw dup.error
    return (dup.count ?? 0) > 0
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!can.createMaster(role)) return toast.error('Only operators and above can create customers')
    if (!companyId) return toast.error('Join or create a company first')

    const code = createForm.code.trim()
    const name = createForm.name.trim()
    if (!code || !name) return toast.error('Code and name are required')
    if (
      createForm.paymentTermsChoice === CUSTOM_PAYMENT_TERMS &&
      !createForm.customPaymentTerms.trim()
    ) {
      return toast.error('Enter the custom payment terms or choose a standard term')
    }

    try {
      setSaving(true)
      if (await ensureUniqueCode(code)) {
        toast.error('Code must be unique in this company')
        return
      }

      const payload: Partial<CustomerRow> = {
        company_id: companyId,
        code,
        name,
        email: createForm.email.trim() || null,
        phone: createForm.phone.trim() || null,
        tax_id: createForm.taxId.trim() || null,
        billing_address: createForm.billingAddress.trim() || null,
        shipping_address: createForm.shippingAddress.trim() || null,
        currency_code: createForm.currencyCode || null,
        notes: createForm.notes.trim() || null,
        ...normalizeTermPayload(createForm, paymentTermById),
      }

      const insert = await supabase.from('customers').insert(payload).select('id').single()
      if (insert.error) throw insert.error

      toast.success(t('customers.toast.created') || 'Customer created')
      setCreateForm(EMPTY_FORM)
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create customer')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    if (!can.updateMaster(role)) return toast.error('Only operators and above can update customers')
    if (!companyId) return toast.error('Join or create a company first')

    const code = editForm.code.trim()
    const name = editForm.name.trim()
    if (!code || !name) return toast.error('Code and name are required')
    if (editForm.paymentTermsChoice === CUSTOM_PAYMENT_TERMS && !editForm.customPaymentTerms.trim()) {
      return toast.error('Enter the custom payment terms or choose a standard term')
    }

    try {
      setSaving(true)
      if (await ensureUniqueCode(code, editing.id)) {
        toast.error('Code must be unique in this company')
        return
      }

      const update = await supabase
        .from('customers')
        .update({
          code,
          name,
          email: editForm.email.trim() || null,
          phone: editForm.phone.trim() || null,
          tax_id: editForm.taxId.trim() || null,
          billing_address: editForm.billingAddress.trim() || null,
          shipping_address: editForm.shippingAddress.trim() || null,
          currency_code: editForm.currencyCode || null,
          notes: editForm.notes.trim() || null,
          ...normalizeTermPayload(editForm, paymentTermById),
        })
        .eq('id', editing.id)
        .eq('company_id', companyId)

      if (update.error) throw update.error

      toast.success('Customer updated')
      setEditing(null)
      setEditForm(EMPTY_FORM)
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update customer')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!can.deleteMaster(role)) return toast.error('Only managers and above can delete customers')
    if (!companyId) return toast.error('Join or create a company first')

    try {
      const del = await supabase.from('customers').delete().eq('id', id).eq('company_id', companyId)
      if (del.error) throw del.error
      toast.success(t('customers.toast.deleted') || 'Customer deleted')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to delete customer')
    }
  }

  const filteredCustomers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const base = [...customers].sort((a, b) => a.name.localeCompare(b.name))
    if (!needle) return base
    return base.filter((customer) =>
      [
        customer.code,
        customer.name,
        customer.email,
        customer.phone,
        customer.billingAddress,
        customer.shippingAddress,
        customerTermsLabel(customer, paymentTermById),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [customers, paymentTermById, search])

  const stats = useMemo(() => {
    const withContact = customers.filter((customer) => customer.email || customer.phone).length
    const withTerms = customers.filter(
      (customer) => customer.paymentTermsId || customer.paymentTerms
    ).length
    return {
      total: customers.length,
      withContact,
      withTerms,
    }
  }, [customers])

  if (!user) return <div className="p-6 text-muted-foreground">{t('auth.title.signIn')}</div>
  if (loading) return <div className="p-6">{t('loading')}</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('customers.title')}</h1>
          <p className="text-muted-foreground">
            Maintain commercial defaults, billing details, and settlement-ready customer records.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Customers</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-semibold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Records in this company</div>
            </div>
            <Users className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Contact ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.withContact}</div>
            <div className="text-xs text-muted-foreground">Customers with email or phone captured</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Commercial defaults</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.withTerms}</div>
            <div className="text-xs text-muted-foreground">Customers with default payment terms</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('customers.create')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
            Store default currency, billing details, and payment terms once so sales orders inherit the right commercial context.
          </div>
          <form onSubmit={handleCreate} className="space-y-6">
            <CustomerFormFields
              form={createForm}
              onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
              currencies={currencies}
              paymentTermsList={paymentTermsList}
            />
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setCreateForm(EMPTY_FORM)}>
                {t('common.clear')}
              </Button>
              <Button type="submit" disabled={saving || !can.createMaster(role)}>
                {saving ? t('actions.saving') : t('customers.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{t('customers.list')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by code, name, contact, or payment terms and keep existing accounts up to date.
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search customers"
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredCustomers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">{search ? 'No customers match this search.' : t('customers.empty')}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {search ? 'Try a different name, code, or contact detail.' : 'Create the first customer to speed up quoting, sales orders, and settlement tracking.'}
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 pr-4">Customer</th>
                  <th className="py-3 pr-4">Terms</th>
                  <th className="py-3 pr-4">Currency</th>
                  <th className="py-3 pr-4">Contact</th>
                  <th className="py-3 pr-4">Address</th>
                  <th className="py-3 pr-4 text-right">{t('customers.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredCustomers.map((customer) => {
                  const currency = customer.currencyCode ? currencyByCode.get(customer.currencyCode) : null
                  return (
                    <tr key={customer.id} className="border-b align-top">
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <div className="font-medium">{customer.name}</div>
                          <div className="text-xs text-muted-foreground">{customer.code}</div>
                          {customer.notes ? (
                            <div className="line-clamp-2 max-w-[280px] text-xs text-muted-foreground">
                              {customer.notes}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-2">
                          <Badge variant={customer.paymentTermsId ? 'secondary' : 'outline'}>
                            {customerTermsLabel(customer, paymentTermById)}
                          </Badge>
                          {customer.taxId ? (
                            <span className="text-xs text-muted-foreground">Tax ID: {customer.taxId}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        {currency ? (
                          <div className="flex flex-col">
                            <span className="font-medium">{currency.code}</span>
                            <span className="text-xs text-muted-foreground">{currency.name}</span>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t('common.dash')}</span>
                        )}
                      </td>
                      <td className="py-4 pr-4">
                        <div className="space-y-2">
                          {customer.email ? (
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{customer.email}</span>
                            </div>
                          ) : null}
                          {customer.phone ? (
                            <div className="flex items-center gap-2 text-sm">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span>{customer.phone}</span>
                            </div>
                          ) : null}
                          {!customer.email && !customer.phone ? (
                            <span className="text-muted-foreground">{t('common.dash')}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        {customer.billingAddress || customer.shippingAddress ? (
                          <div className="space-y-2">
                            {customer.billingAddress ? (
                              <div className="flex items-start gap-2 text-sm">
                                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                                <span className="line-clamp-2">{customer.billingAddress}</span>
                              </div>
                            ) : null}
                            {customer.shippingAddress && customer.shippingAddress !== customer.billingAddress ? (
                              <div className="text-xs text-muted-foreground">
                                Ship to: {customer.shippingAddress}
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t('common.dash')}</span>
                        )}
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            disabled={!can.updateMaster(role)}
                            onClick={() => {
                              setEditing(customer)
                              setEditForm(formFromCustomer(customer))
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!can.deleteMaster(role)}
                            onClick={() => handleDelete(customer.id)}
                          >
                            {t('common.remove')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit customer</DialogTitle>
            <DialogDescription>
              Update contact details, commercial defaults, and address information without recreating the record.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="space-y-6">
              <CustomerFormFields
                form={editForm}
                onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                currencies={currencies}
                paymentTermsList={paymentTermsList}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleUpdate} disabled={saving || !can.updateMaster(role)}>
                  {saving ? t('actions.saving') : 'Save changes'}
                </Button>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
