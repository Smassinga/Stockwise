import { supabase } from './supabase'
import { loadCompanyExportHeader } from './excelExport'
import type {
  FinanceExportCompany,
  FinanceExportCounterparty,
} from './financeExport'
import type { FinanceAnchorKind, FinanceLedgerSide } from './financeReconciliation'

type CounterpartyLookup = {
  companyId: string
  ledgerSide: FinanceLedgerSide
  anchorKind: FinanceAnchorKind
  anchorId: string
  fallbackName?: string | null
}

export type FinanceAdviceDocumentDetails = {
  primaryReference: string | null
  operationalReference: string | null
  externalReference: string | null
  documentDate: string | null
  dueDate: string | null
}

type CustomerMaster = {
  code: string | null
  name: string | null
  email: string | null
  phone: string | null
  tax_id: string | null
  billing_address: string | null
}

type SupplierMaster = {
  code: string | null
  name: string | null
  contact_name: string | null
  email: string | null
  phone: string | null
  tax_id: string | null
}

const clean = (value: unknown) => {
  const normalized = String(value ?? '').trim()
  return normalized || null
}

const joinAddress = (...parts: unknown[]) =>
  parts.map(clean).filter(Boolean).join(', ') || null

export async function loadFinanceExportCompany(companyId: string): Promise<FinanceExportCompany> {
  return loadCompanyExportHeader(companyId)
}

async function loadCustomerMaster(companyId: string, customerId: string | null) {
  if (!customerId) return null
  const { data, error } = await supabase
    .from('customers')
    .select('code,name,email,phone,tax_id,billing_address')
    .eq('company_id', companyId)
    .eq('id', customerId)
    .maybeSingle()
  if (error) throw error
  return data as CustomerMaster | null
}

async function loadSupplierMaster(companyId: string, supplierId: string | null) {
  if (!supplierId) return null
  const { data, error } = await supabase
    .from('suppliers')
    .select('code,name,contact_name,email,phone,tax_id')
    .eq('company_id', companyId)
    .eq('id', supplierId)
    .maybeSingle()
  if (error) throw error
  return data as SupplierMaster | null
}

export async function loadFinanceExportCounterparty({
  companyId,
  ledgerSide,
  anchorKind,
  anchorId,
  fallbackName,
}: CounterpartyLookup): Promise<FinanceExportCounterparty | null> {
  if (ledgerSide === 'AR') {
    if (anchorKind === 'sales_invoice' || anchorKind === 'sales_invoice_draft') {
      const { data, error } = await supabase
        .from('sales_invoices')
        .select('customer_id,buyer_legal_name_snapshot,buyer_nuit_snapshot,buyer_address_line1_snapshot,buyer_address_line2_snapshot,buyer_city_snapshot,buyer_state_snapshot,buyer_postal_code_snapshot,buyer_country_code_snapshot')
        .eq('company_id', companyId)
        .eq('id', anchorId)
        .maybeSingle()
      if (error) throw error
      const customerId = clean(data?.customer_id)
      const master = await loadCustomerMaster(companyId, customerId)
      const snapshotName = clean(data?.buyer_legal_name_snapshot)
      const name = snapshotName || clean(master?.name) || clean(fallbackName)
      if (!name) return null
      return {
        kind: 'customer',
        name,
        code: clean(master?.code),
        taxId: clean(data?.buyer_nuit_snapshot) || clean(master?.tax_id),
        email: clean(master?.email),
        phone: clean(master?.phone),
        address: joinAddress(
          data?.buyer_address_line1_snapshot,
          data?.buyer_address_line2_snapshot,
          data?.buyer_city_snapshot,
          data?.buyer_state_snapshot,
          data?.buyer_postal_code_snapshot,
          data?.buyer_country_code_snapshot,
        ) || clean(master?.billing_address),
        source: snapshotName ? 'document_snapshot' : 'master',
      }
    }

    const { data, error } = await supabase
      .from('sales_orders')
      .select('customer_id,bill_to_name,bill_to_email,bill_to_phone,bill_to_tax_id,bill_to_billing_address')
      .eq('company_id', companyId)
      .eq('id', anchorId)
      .maybeSingle()
    if (error) throw error
    const customerId = clean(data?.customer_id)
    const master = await loadCustomerMaster(companyId, customerId)
    const snapshotName = clean(data?.bill_to_name)
    const name = snapshotName || clean(master?.name) || clean(fallbackName)
    if (!name) return null
    return {
      kind: 'customer',
      name,
      code: clean(master?.code),
      taxId: clean(data?.bill_to_tax_id) || clean(master?.tax_id),
      email: clean(data?.bill_to_email) || clean(master?.email),
      phone: clean(data?.bill_to_phone) || clean(master?.phone),
      address: clean(data?.bill_to_billing_address) || clean(master?.billing_address),
      source: snapshotName ? 'document_snapshot' : 'master',
    }
  }

  if (anchorKind === 'vendor_bill') {
    const { data, error } = await supabase
      .from('vendor_bills')
      .select('supplier_id')
      .eq('company_id', companyId)
      .eq('id', anchorId)
      .maybeSingle()
    if (error) throw error
    const master = await loadSupplierMaster(companyId, clean(data?.supplier_id))
    const name = clean(master?.name) || clean(fallbackName)
    if (!name) return null
    return {
      kind: 'supplier',
      name,
      code: clean(master?.code),
      taxId: clean(master?.tax_id),
      contactName: clean(master?.contact_name),
      email: clean(master?.email),
      phone: clean(master?.phone),
      address: null,
      source: 'master',
    }
  }

  const { data, error } = await supabase
    .from('purchase_orders')
    .select('supplier_id,supplier_name,supplier_email,supplier_phone,supplier_tax_id')
    .eq('company_id', companyId)
    .eq('id', anchorId)
    .maybeSingle()
  if (error) throw error
  const master = await loadSupplierMaster(companyId, clean(data?.supplier_id))
  const snapshotName = clean(data?.supplier_name)
  const name = snapshotName || clean(master?.name) || clean(fallbackName)
  if (!name) return null
  return {
    kind: 'supplier',
    name,
    code: clean(master?.code),
    taxId: clean(data?.supplier_tax_id) || clean(master?.tax_id),
    contactName: clean(master?.contact_name),
    email: clean(data?.supplier_email) || clean(master?.email),
    phone: clean(data?.supplier_phone) || clean(master?.phone),
    address: null,
    source: snapshotName ? 'document_snapshot' : 'master',
  }
}

export async function loadFinanceAdviceDocumentDetails(
  companyId: string,
  anchorKind: FinanceAnchorKind,
  anchorId: string,
): Promise<FinanceAdviceDocumentDetails> {
  if (anchorKind === 'vendor_bill') {
    const { data, error } = await supabase
      .from('vendor_bills')
      .select('internal_reference,supplier_invoice_reference,bill_date,due_date,purchase_order_id')
      .eq('company_id', companyId)
      .eq('id', anchorId)
      .maybeSingle()
    if (error) throw error
    let operationalReference: string | null = null
    if (data?.purchase_order_id) {
      const { data: purchaseOrder, error: purchaseError } = await supabase
        .from('purchase_orders')
        .select('order_no')
        .eq('company_id', companyId)
        .eq('id', data.purchase_order_id)
        .maybeSingle()
      if (purchaseError) throw purchaseError
      operationalReference = clean(purchaseOrder?.order_no)
    }
    return {
      primaryReference: clean(data?.internal_reference),
      operationalReference,
      externalReference: clean(data?.supplier_invoice_reference),
      documentDate: clean(data?.bill_date),
      dueDate: clean(data?.due_date),
    }
  }

  if (anchorKind === 'sales_invoice' || anchorKind === 'sales_invoice_draft') {
    const { data, error } = await supabase
      .from('sales_invoices')
      .select('internal_reference,invoice_date,due_date,sales_order_id')
      .eq('company_id', companyId)
      .eq('id', anchorId)
      .maybeSingle()
    if (error) throw error
    let operationalReference: string | null = null
    if (data?.sales_order_id) {
      const { data: salesOrder, error: salesError } = await supabase
        .from('sales_orders')
        .select('order_no')
        .eq('company_id', companyId)
        .eq('id', data.sales_order_id)
        .maybeSingle()
      if (salesError) throw salesError
      operationalReference = clean(salesOrder?.order_no)
    }
    return {
      primaryReference: clean(data?.internal_reference),
      operationalReference,
      externalReference: null,
      documentDate: clean(data?.invoice_date),
      dueDate: clean(data?.due_date),
    }
  }

  if (anchorKind === 'purchase_order') {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('order_no,order_date,due_date')
      .eq('company_id', companyId)
      .eq('id', anchorId)
      .maybeSingle()
    if (error) throw error
    return {
      primaryReference: clean(data?.order_no),
      operationalReference: clean(data?.order_no),
      externalReference: null,
      documentDate: clean(data?.order_date),
      dueDate: clean(data?.due_date),
    }
  }

  const { data, error } = await supabase
    .from('sales_orders')
    .select('order_no,order_date,due_date')
    .eq('company_id', companyId)
    .eq('id', anchorId)
    .maybeSingle()
  if (error) throw error
  return {
    primaryReference: clean(data?.order_no),
    operationalReference: clean(data?.order_no),
    externalReference: null,
    documentDate: clean(data?.order_date),
    dueDate: clean(data?.due_date),
  }
}
