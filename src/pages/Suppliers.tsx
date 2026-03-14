import { useEffect, useMemo, useState } from 'react'
import { Building2, Mail, Pencil, Phone, Search } from 'lucide-react'
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

type Currency = { id: string; code: string; name: string }

type Supplier = {
  id: string
  code: string
  name: string
  contactName: string
  email: string
  phone: string
  taxId: string
  currencyId: string
  paymentTermsId: string
  paymentTerms: string
  isActive: boolean
  notes: string
  createdAt: string | null
  updatedAt: string | null
}

type PaymentTerm = {
  id: string
  code: string
  name: string
  net_days: number
}

type SupplierForm = {
  code: string
  name: string
  contactName: string
  email: string
  phone: string
  taxId: string
  currencyId: string
  paymentTermsChoice: string
  customPaymentTerms: string
  isActive: boolean
  notes: string
}

const NO_CURRENCY = '__none__'
const NO_PAYMENT_TERMS = '__none__'
const CUSTOM_PAYMENT_TERMS = '__custom__'

const EMPTY_FORM: SupplierForm = {
  code: '',
  name: '',
  contactName: '',
  email: '',
  phone: '',
  taxId: '',
  currencyId: '',
  paymentTermsChoice: '',
  customPaymentTerms: '',
  isActive: true,
  notes: '',
}

const mapSupplierRow = (row: any): Supplier => ({
  id: String(row.id),
  code: row.code ?? '',
  name: row.name ?? '',
  contactName: row.contactName ?? row.contact_name ?? '',
  email: row.email ?? '',
  phone: row.phone ?? '',
  taxId: row.taxId ?? row.tax_id ?? '',
  currencyId: row.currencyId ?? row.currency_code ?? '',
  paymentTermsId: row.paymentTermsId ?? row.payment_terms_id ?? '',
  paymentTerms: row.paymentTerms ?? row.payment_terms ?? '',
  isActive: typeof row.isActive === 'boolean' ? row.isActive : !!row.is_active,
  notes: row.notes ?? '',
  createdAt: row.createdAt ?? row.created_at ?? null,
  updatedAt: row.updatedAt ?? row.updated_at ?? null,
})

function formFromSupplier(supplier: Supplier): SupplierForm {
  const usesCustomTerms = !supplier.paymentTermsId && !!supplier.paymentTerms
  return {
    code: supplier.code,
    name: supplier.name,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    taxId: supplier.taxId,
    currencyId: supplier.currencyId,
    paymentTermsChoice: supplier.paymentTermsId || (usesCustomTerms ? CUSTOM_PAYMENT_TERMS : ''),
    customPaymentTerms: usesCustomTerms ? supplier.paymentTerms : '',
    isActive: supplier.isActive,
    notes: supplier.notes,
  }
}

function normalizeTermPayload(form: SupplierForm, paymentTermsById: Map<string, PaymentTerm>) {
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

function supplierTermsLabel(supplier: Supplier, paymentTermsById: Map<string, PaymentTerm>) {
  if (supplier.paymentTermsId) {
    return paymentTermsById.get(supplier.paymentTermsId)?.name || supplier.paymentTerms || supplier.paymentTermsId
  }
  return supplier.paymentTerms || 'No terms'
}

function SupplierFormFields({
  form,
  onChange,
  currencies,
  paymentTermsList,
}: {
  form: SupplierForm
  onChange: (patch: Partial<SupplierForm>) => void
  currencies: Currency[]
  paymentTermsList: PaymentTerm[]
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="supplier-code">Code *</Label>
        <Input
          id="supplier-code"
          value={form.code}
          onChange={(e) => onChange({ code: e.target.value })}
          placeholder="e.g., SUP-001"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="supplier-name">Name *</Label>
        <Input
          id="supplier-name"
          value={form.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Supplier legal or trading name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplier-contact-name">Contact name</Label>
        <Input
          id="supplier-contact-name"
          value={form.contactName}
          onChange={(e) => onChange({ contactName: e.target.value })}
          placeholder="Primary buyer contact"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="supplier-email">Email</Label>
        <Input
          id="supplier-email"
          type="email"
          value={form.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="purchasing@supplier.com"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="supplier-phone">Phone</Label>
        <Input
          id="supplier-phone"
          value={form.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
          placeholder="+258 ..."
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="supplier-tax-id">Tax ID</Label>
        <Input
          id="supplier-tax-id"
          value={form.taxId}
          onChange={(e) => onChange({ taxId: e.target.value })}
          placeholder="NUIT / VAT / Tax ID"
        />
      </div>

      <div className="space-y-2">
        <Label>Default currency</Label>
        <Select
          value={form.currencyId || NO_CURRENCY}
          onValueChange={(value) => onChange({ currencyId: value === NO_CURRENCY ? '' : value })}
        >
          <SelectTrigger>
            <SelectValue placeholder="No default currency" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_CURRENCY}>No default currency</SelectItem>
            {currencies.map((currency) => (
              <SelectItem key={currency.id} value={currency.id}>
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
        <Label htmlFor="supplier-custom-terms">Terms note</Label>
        <Input
          id="supplier-custom-terms"
          value={form.customPaymentTerms}
          onChange={(e) => onChange({ customPaymentTerms: e.target.value })}
          placeholder="Only used when Custom terms is selected"
          disabled={form.paymentTermsChoice !== CUSTOM_PAYMENT_TERMS}
        />
      </div>

      <div className="space-y-2">
        <Label>Status</Label>
        <Select
          value={form.isActive ? 'active' : 'inactive'}
          onValueChange={(value) => onChange({ isActive: value === 'active' })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2 md:col-span-2">
        <Label htmlFor="supplier-notes">Notes</Label>
        <Textarea
          id="supplier-notes"
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Procurement notes, contract reminders, delivery behaviour..."
        />
      </div>
    </div>
  )
}

export default function Suppliers() {
  const { user } = useAuth()
  const { companyId, myRole } = useOrg()
  const role: CompanyRole = (myRole as CompanyRole) ?? 'VIEWER'
  const { t } = useI18n()

  const [currencies, setCurrencies] = useState<Currency[]>([])
  const [paymentTermsList, setPaymentTermsList] = useState<PaymentTerm[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [createForm, setCreateForm] = useState<SupplierForm>(EMPTY_FORM)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [editForm, setEditForm] = useState<SupplierForm>(EMPTY_FORM)

  const currencyById = useMemo(() => new Map(currencies.map((currency) => [currency.id, currency])), [currencies])
  const paymentTermById = useMemo(
    () => new Map(paymentTermsList.map((paymentTerm) => [paymentTerm.id, paymentTerm])),
    [paymentTermsList]
  )

  useEffect(() => {
    ;(async () => {
      if (!user) return
      try {
        setLoading(true)

        const cur = await supabase.from('currencies').select('code,name').order('code', { ascending: true })
        if (cur.error) throw cur.error
        setCurrencies((cur.data || []).map((row: any) => ({ id: row.code, code: row.code, name: row.name })))

        if (companyId) {
          const { data: paymentTerms, error: paymentTermsError } = await supabase.rpc('get_payment_terms', {
            p_company_id: companyId,
          })
          if (paymentTermsError) throw paymentTermsError
          setPaymentTermsList((paymentTerms || []) as PaymentTerm[])
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
    if (!companyId) {
      setSuppliers([])
      return
    }

    const viewResult = await supabase
      .from('suppliers_view')
      .select(
        'id,code,name,contactName,email,phone,taxId,currencyId,paymentTermsId,paymentTerms,isActive,notes,createdAt,updatedAt,company_id'
      )
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (!viewResult.error) {
      setSuppliers((viewResult.data || []).map(mapSupplierRow))
      return
    }

    const fallback = await supabase
      .from('suppliers')
      .select(
        'id,code,name,contact_name,email,phone,tax_id,currency_code,payment_terms_id,payment_terms,is_active,notes,created_at,updated_at'
      )
      .eq('company_id', companyId)
      .order('name', { ascending: true })

    if (fallback.error) {
      toast.error(fallback.error.message)
      setSuppliers([])
      return
    }

    setSuppliers((fallback.data || []).map(mapSupplierRow))
  }

  async function ensureUniqueCode(code: string, excludeId?: string) {
    if (!companyId) return false
    let query = supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('company_id', companyId).eq('code', code)
    if (excludeId) query = query.neq('id', excludeId)
    const dup = await query
    if (dup.error) throw dup.error
    return (dup.count ?? 0) > 0
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.createMaster(role)) return toast.error('Only operators and above can create suppliers')

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

      const payload: any = {
        company_id: companyId,
        code,
        name,
        contact_name: createForm.contactName.trim() || null,
        email: createForm.email.trim() || null,
        phone: createForm.phone.trim() || null,
        tax_id: createForm.taxId.trim() || null,
        currency_code: createForm.currencyId || null,
        is_active: !!createForm.isActive,
        notes: createForm.notes.trim() || null,
        ...normalizeTermPayload(createForm, paymentTermById),
      }

      const insert = await supabase.from('suppliers').insert(payload).select('id').single()
      if (insert.error) throw insert.error

      toast.success('Supplier created')
      setCreateForm(EMPTY_FORM)
      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to create supplier')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate() {
    if (!editing) return
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.updateMaster(role)) return toast.error('Only operators and above can update suppliers')

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
        .from('suppliers')
        .update({
          code,
          name,
          contact_name: editForm.contactName.trim() || null,
          email: editForm.email.trim() || null,
          phone: editForm.phone.trim() || null,
          tax_id: editForm.taxId.trim() || null,
          currency_code: editForm.currencyId || null,
          is_active: !!editForm.isActive,
          notes: editForm.notes.trim() || null,
          ...normalizeTermPayload(editForm, paymentTermById),
        })
        .eq('id', editing.id)
        .eq('company_id', companyId)

      if (update.error) throw update.error

      toast.success('Supplier updated')
      setEditing(null)
      setEditForm(EMPTY_FORM)
      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update supplier')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!companyId) return toast.error('Join or create a company first')
    if (!can.deleteMaster(role)) return toast.error('Only managers and above can delete suppliers')

    try {
      const del = await supabase.from('suppliers').delete().eq('id', id).eq('company_id', companyId)
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
    if (!can.updateMaster(role)) return toast.error('Only operators and above can update suppliers')

    try {
      const update = await supabase
        .from('suppliers')
        .update({ is_active: next })
        .eq('id', id)
        .eq('company_id', companyId)

      if (update.error) throw update.error
      await reloadSuppliers()
    } catch (e: any) {
      console.error(e)
      toast.error(e?.message || 'Failed to update supplier')
    }
  }

  const filteredSuppliers = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const sorted = [...suppliers].sort((a, b) => a.name.localeCompare(b.name))
    if (!needle) return sorted
    return sorted.filter((supplier) =>
      [
        supplier.code,
        supplier.name,
        supplier.contactName,
        supplier.email,
        supplier.phone,
        supplierTermsLabel(supplier, paymentTermById),
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    )
  }, [paymentTermById, search, suppliers])

  const stats = useMemo(() => {
    const active = suppliers.filter((supplier) => supplier.isActive).length
    const withTerms = suppliers.filter((supplier) => supplier.paymentTermsId || supplier.paymentTerms).length
    return {
      total: suppliers.length,
      active,
      inactive: suppliers.length - active,
      withTerms,
    }
  }, [suppliers])

  if (!user) return <div className="p-6 text-muted-foreground">{t('auth.title.signIn')}</div>
  if (loading) return <div className="p-6">{t('loading')}</div>

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('suppliers.title')}</h1>
          <p className="text-muted-foreground">
            Maintain supplier defaults, commercial terms, and contact details used across purchasing and landed cost workflows.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Suppliers</CardTitle>
          </CardHeader>
          <CardContent className="flex items-end justify-between">
            <div>
              <div className="text-3xl font-semibold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Records in this company</div>
            </div>
            <Building2 className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.active}</div>
            <div className="text-xs text-muted-foreground">Available for new purchasing activity</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Inactive</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.inactive}</div>
            <div className="text-xs text-muted-foreground">Kept for history, blocked for new use</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Terms captured</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.withTerms}</div>
            <div className="text-xs text-muted-foreground">Suppliers with default payment terms</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('suppliers.create')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
            Capture currency, payment terms, and primary contact details once so new purchase orders inherit the correct defaults.
          </div>
          <form onSubmit={handleCreate} className="space-y-6">
            <SupplierFormFields
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
                {saving ? t('actions.saving') : t('suppliers.create')}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>{t('suppliers.list')}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Search by supplier, contact, or terms and update existing records without recreating them.
            </p>
          </div>
          <div className="relative w-full sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search suppliers"
              className="pl-10"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {filteredSuppliers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center">
              <div className="text-lg font-medium">{search ? 'No suppliers match this search.' : 'No suppliers yet.'}</div>
              <div className="mt-2 text-sm text-muted-foreground">
                {search ? 'Try a different supplier name, contact, or code.' : 'Create the first supplier so purchasing, costing, and payables flows have a real counterparty record.'}
              </div>
            </div>
          ) : (
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="py-3 pr-4">Supplier</th>
                  <th className="py-3 pr-4">Terms</th>
                  <th className="py-3 pr-4">Currency</th>
                  <th className="py-3 pr-4">Contact</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4 text-right">{t('customers.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredSuppliers.map((supplier) => {
                  const currency = supplier.currencyId ? currencyById.get(supplier.currencyId) : null
                  return (
                    <tr key={supplier.id} className="border-b align-top">
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-1">
                          <div className="font-medium">{supplier.name}</div>
                          <div className="text-xs text-muted-foreground">{supplier.code}</div>
                          {supplier.contactName ? (
                            <div className="text-xs text-muted-foreground">Contact: {supplier.contactName}</div>
                          ) : null}
                          {supplier.notes ? (
                            <div className="line-clamp-2 max-w-[280px] text-xs text-muted-foreground">
                              {supplier.notes}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <div className="flex flex-col gap-2">
                          <Badge variant={supplier.paymentTermsId ? 'secondary' : 'outline'}>
                            {supplierTermsLabel(supplier, paymentTermById)}
                          </Badge>
                          {supplier.taxId ? (
                            <span className="text-xs text-muted-foreground">Tax ID: {supplier.taxId}</span>
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
                          {supplier.email ? (
                            <div className="flex items-center gap-2 text-sm">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                              <span className="truncate">{supplier.email}</span>
                            </div>
                          ) : null}
                          {supplier.phone ? (
                            <div className="flex items-center gap-2 text-sm">
                              <Phone className="h-4 w-4 text-muted-foreground" />
                              <span>{supplier.phone}</span>
                            </div>
                          ) : null}
                          {!supplier.email && !supplier.phone ? (
                            <span className="text-muted-foreground">{t('common.dash')}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-4 pr-4">
                        <Badge variant={supplier.isActive ? 'default' : 'secondary'}>
                          {supplier.isActive ? t('suppliers.active') : t('suppliers.inactive')}
                        </Badge>
                      </td>
                      <td className="py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            disabled={!can.updateMaster(role)}
                            onClick={() => {
                              setEditing(supplier)
                              setEditForm(formFromSupplier(supplier))
                            }}
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            disabled={!can.updateMaster(role)}
                            onClick={() => toggleActive(supplier.id, !supplier.isActive)}
                          >
                            {supplier.isActive ? t('suppliers.deactivate') : t('suppliers.activate')}
                          </Button>
                          <Button
                            variant="destructive"
                            disabled={!can.deleteMaster(role)}
                            onClick={() => handleDelete(supplier.id)}
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
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit supplier</DialogTitle>
            <DialogDescription>
              Update contact details, default terms, and supplier status without affecting historical orders.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pr-1">
            <div className="space-y-6">
              <SupplierFormFields
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
