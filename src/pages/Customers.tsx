import { useEffect, useMemo, useState } from 'react'
import { Mail, MapPin, Pencil, Phone, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { supabase } from '../lib/db'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../hooks/useOrg'
import { can, type CompanyRole } from '../lib/permissions'
import { useI18n, withI18nFallback } from '../lib/i18n'

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
  return customer.paymentTerms || ''
}

function CustomerFormFields({
  form,
  onChange,
  currencies,
  paymentTermsList,
  tt,
}: {
  form: CustomerForm
  onChange: (patch: Partial<CustomerForm>) => void
  currencies: Currency[]
  paymentTermsList: PaymentTerm[]
  tt: (key: string, fallback: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="customer-code">{tt('customers.form.code', 'Code')} *</Label>
        <Input
          id="customer-code"
          value={form.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder={tt('customers.placeholder.code', 'e.g., CUST-001')}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-name">{tt('customers.form.name', 'Name')} *</Label>
        <Input
          id="customer-name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder={tt('customers.placeholder.name', 'Customer legal or trading name')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-email">{tt('customers.form.email', 'Email')}</Label>
        <Input
          id="customer-email"
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder={tt('customers.placeholder.email', 'customer@company.com')}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-phone">{tt('customers.form.phone', 'Phone')}</Label>
        <Input
          id="customer-phone"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder={tt('customers.placeholder.phone', '+258 ...')}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="customer-tax-id">{tt('customers.form.taxId', 'Tax ID')}</Label>
        <Input
          id="customer-tax-id"
          value={form.taxId}
          onChange={(e) => onChange({ taxId: e.target.value })}
          placeholder={tt('customers.placeholder.taxId', 'NUIT / VAT / Tax ID')}
        />
      </div>
      <div className="space-y-2">
        <Label>{tt('customers.form.currency', 'Default currency')}</Label>
        <Select
          value={form.currencyCode || NO_CURRENCY}
          onValueChange={(value) => onChange({ currencyCode: value === NO_CURRENCY ? '' : value })}
        >
          <SelectTrigger>
            <SelectValue placeholder={tt('customers.placeholder.noCurrency', 'No default currency')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CURRENCY}>{tt('customers.placeholder.noCurrency', 'No default currency')}</SelectItem>
            {currencies.map((currency) => (
              <SelectItem key={currency.code} value={currency.code}>
                {currency.code} - {currency.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>{tt('customers.form.paymentTerms', 'Payment terms')}</Label>
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
            <SelectValue placeholder={tt('customers.placeholder.paymentTerms', 'Select payment terms')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PAYMENT_TERMS}>{tt('customers.placeholder.noTerms', 'No default terms')}</SelectItem>
            {paymentTermsList.map((paymentTerm) => (
              <SelectItem key={paymentTerm.id} value={paymentTerm.id}>
                {paymentTerm.name}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_PAYMENT_TERMS}>{tt('customers.customTerms', 'Custom terms')}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          {paymentTermsList.length
            ? tt(
                'customers.paymentTermsHelp',
                'Choose a reusable company term or switch to custom terms for customer-specific wording.'
              )
            : tt(
                'customers.paymentTermsEmptyHelp',
                'No company payment terms are available yet. Leave this blank or use Custom terms below until defaults are added for this company.'
              )}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="customer-custom-terms">{tt('customers.form.termsNote', 'Terms note')}</Label>
        <Input
          id="customer-custom-terms"
          value={form.customPaymentTerms}
          onChange={(e) => onChange({ customPaymentTerms: e.target.value })}
          placeholder={tt('customers.placeholder.termsNote', 'Only used when Custom terms is selected')}
          disabled={form.paymentTermsChoice !== CUSTOM_PAYMENT_TERMS}
        />
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-billing-address">{tt('customers.form.billingAddress', 'Billing address')}</Label>
        <Input
          id="customer-billing-address"
          value={form.billingAddress}
          onChange={(e) => onChange({ billingAddress: e.target.value })}
          placeholder={tt('customers.placeholder.billingAddress', 'Street, city, province, postal code')}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-shipping-address">{tt('customers.form.shippingAddress', 'Shipping or service address')}</Label>
        <Input
          id="customer-shipping-address"
          value={form.shippingAddress}
          onChange={(e) => onChange({ shippingAddress: e.target.value })}
          placeholder={tt('customers.placeholder.shippingAddress', 'Only if it differs from billing')}
        />
      </div>
      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="customer-notes">{tt('customers.form.notes', 'Notes')}</Label>
        <Textarea
          id="customer-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder={tt('customers.placeholder.notes', 'Commercial notes, service instructions, account context...')}
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
  const tt = (key: string, fallback: string, vars?: Record<string, string | number>) =>
    withI18nFallback(t, key, fallback, vars)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [search, setSearch] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
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
        } else {
          setPaymentTermsList([])
        }

        await reloadCustomers()
      } catch (e: any) {
        console.error(e)
        toast.error(e?.message || tt('customers.toast.loadFailed', 'Failed to load customers'))
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
    if (!can.createMaster(role)) return toast.error(tt('customers.toast.noCreatePermission', 'Only operators and above can create customers'))
    if (!companyId) return toast.error(tt('customers.toast.joinCompany', 'Join or create a company first'))

    const code = createForm.code.trim()
    const name = createForm.name.trim()
    if (!code || !name) return toast.error(tt('customers.toast.codeNameRequired', 'Code and name are required'))
    if (
      createForm.paymentTermsChoice === CUSTOM_PAYMENT_TERMS &&
      !createForm.customPaymentTerms.trim()
    ) {
      return toast.error(tt('customers.toast.customTermsRequired', 'Enter the custom payment terms or choose a standard term'))
    }

    try {
      setSaving(true)
      if (await ensureUniqueCode(code)) {
        toast.error(tt('customers.toast.uniqueCode', 'Code must be unique in this company'))
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
      setCreateOpen(false)
      setCreateForm(EMPTY_FORM)
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('customers.toast.createFailed', 'Failed to create customer'))
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    if (!can.updateMaster(role)) return toast.error(tt('customers.toast.noUpdatePermission', 'Only operators and above can update customers'))
    if (!companyId) return toast.error(tt('customers.toast.joinCompany', 'Join or create a company first'))

    const code = editForm.code.trim()
    const name = editForm.name.trim()
    if (!code || !name) return toast.error(tt('customers.toast.codeNameRequired', 'Code and name are required'))
    if (editForm.paymentTermsChoice === CUSTOM_PAYMENT_TERMS && !editForm.customPaymentTerms.trim()) {
      return toast.error(tt('customers.toast.customTermsRequired', 'Enter the custom payment terms or choose a standard term'))
    }

    try {
      setSaving(true)
      if (await ensureUniqueCode(code, editing.id)) {
        toast.error(tt('customers.toast.uniqueCode', 'Code must be unique in this company'))
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

      toast.success(tt('customers.toast.updated', 'Customer updated'))
      setEditing(null)
      setEditForm(EMPTY_FORM)
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('customers.toast.updateFailed', 'Failed to update customer'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!can.deleteMaster(role)) return toast.error(tt('customers.toast.noDeletePermission', 'Only managers and above can delete customers'))
    if (!companyId) return toast.error(tt('customers.toast.joinCompany', 'Join or create a company first'))

    try {
      const del = await supabase.from('customers').delete().eq('id', id).eq('company_id', companyId)
      if (del.error) throw del.error
      toast.success(t('customers.toast.deleted') || 'Customer deleted')
      await reloadCustomers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || tt('customers.toast.deleteFailed', 'Failed to delete customer'))
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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">{t('customers.title')}</h1>
          <p className="text-muted-foreground">
            {tt('customers.subtitle', 'Maintain commercial defaults, billing details, and settlement-ready customer records.')}
          </p>
          <div className="text-sm text-muted-foreground">
            {stats.total} {tt('customers.summary.total', 'Customers')} • {stats.withContact} {tt('customers.summary.contactReady', 'Contact ready')} • {stats.withTerms} {tt('customers.summary.defaults', 'Commercial defaults')}
          </div>
        </div>
        <Button disabled={!can.createMaster(role)} onClick={() => setCreateOpen(true)}>
          {t('customers.create')}
        </Button>
      </div>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{t('customers.list')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {tt('customers.listHelp', 'Search by code, name, contact, or payment terms and keep existing accounts up to date.')}
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tt('customers.searchPlaceholder', 'Search customers')}
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredCustomers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">{search ? tt('customers.empty.filteredTitle', 'No customers match this search.') : t('customers.empty')}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {search
                  ? tt('customers.empty.filteredBody', 'Try a different name, code, or contact detail.')
                  : tt('customers.empty.body', 'Create the first customer to speed up quoting, sales orders, and settlement tracking.')}
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 pr-4">{tt('customers.table.customer', 'Customer')}</th>
                  <th className="py-3 pr-4">{tt('customers.table.terms', 'Terms')}</th>
                  <th className="py-3 pr-4">{tt('customers.table.currency', 'Currency')}</th>
                  <th className="py-3 pr-4">{tt('customers.table.contact', 'Contact')}</th>
                  <th className="py-3 pr-4">{tt('customers.table.address', 'Address')}</th>
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
                            {customerTermsLabel(customer, paymentTermById) || tt('customers.noTerms', 'No terms')}
                          </Badge>
                          {customer.taxId ? (
                            <span className="text-xs text-muted-foreground">{tt('customers.taxIdLabel', 'Tax ID')}: {customer.taxId}</span>
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
                                {tt('customers.shipTo', 'Ship to')}: {customer.shippingAddress}
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
                            {tt('customers.edit', 'Edit')}
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

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open)
          if (!open) setCreateForm(EMPTY_FORM)
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{t('customers.create')}</DialogTitle>
            <DialogDescription>
              {tt('customers.createHelp', 'Store default currency, billing details, and payment terms once so sales orders inherit the right commercial context.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <form onSubmit={handleCreate} className="space-y-6">
              <CustomerFormFields
                form={createForm}
                onChange={(patch) => setCreateForm((current) => ({ ...current, ...patch }))}
                currencies={currencies}
                paymentTermsList={paymentTermsList}
                tt={tt}
              />
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateForm(EMPTY_FORM)}>
                  {t('common.clear')}
                </Button>
                <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={saving || !can.createMaster(role)}>
                  {saving ? t('actions.saving') : t('customers.create')}
                </Button>
              </div>
            </form>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{tt('customers.editTitle', 'Edit customer')}</DialogTitle>
            <DialogDescription>
              {tt('customers.editDescription', 'Update contact details, commercial defaults, and address information without recreating the record.')}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="space-y-6">
              <CustomerFormFields
                form={editForm}
                onChange={(patch) => setEditForm((current) => ({ ...current, ...patch }))}
                currencies={currencies}
                paymentTermsList={paymentTermsList}
                tt={tt}
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(null)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleUpdate} disabled={saving || !can.updateMaster(role)}>
                  {saving ? t('actions.saving') : t('actions.save')}
                </Button>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  )
}
