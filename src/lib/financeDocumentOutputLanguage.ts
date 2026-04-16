export type OutputLanguage = 'en' | 'pt'

type OutputCopy = {
  documentTypes: {
    salesInvoice: string
    salesCreditNote: string
    salesDebitNote: string
    vendorBill: string
    vendorCreditNote: string
    vendorDebitNote: string
  }
  workflow: {
    draft: string
    issued: string
    posted: string
    voided: string
  }
  meta: {
    invoiceDate: string
    noteDate: string
    dueDate: string
    currency: string
    originalInvoice: string
    originalBill: string
  }
  parties: {
    issuer: string
    client: string
    supplier: string
    company: string
    taxIdLabel: string
  }
  table: {
    description: string
    qty: string
    unit: string
    unitPrice: string
    vat: string
    total: string
    taxRatePrefix: string
  }
  notes: {
    vatExemptionReason: string
    notApplicable: string
    correctionReason: string
    fiscalCorrection: string
    fiscalAdjustment: string
    supplierCreditAdjustment: string
    supplierDebitAdjustment: string
    references: string
    apDocument: string
  }
  references: {
    supplierInvoiceReference: string
    stockwiseKey: string
    linkedPurchaseOrder: string
    originalInvoice: string
    originalBill: string
  }
  totals: {
    subtotal: string
    vat: string
    total: string
    baseSubtotal: string
    baseVat: string
    baseTotal: string
  }
  footer: {
    computerProcessed: string
  }
  share: {
    dateLabel: string
    baseTotalLabel: string
  }
  errors: {
    shareUnavailable: string
    shareUnsupported: string
    printPrepFailed: string
    printOpenFailed: string
  }
}

const APP_LANGUAGE_STORAGE_KEY = 'app:lang'

const COPY: Record<OutputLanguage, OutputCopy> = {
  pt: {
    documentTypes: {
      salesInvoice: 'Fatura',
      salesCreditNote: 'Nota de cr\u00e9dito',
      salesDebitNote: 'Nota de d\u00e9bito',
      vendorBill: 'Fatura de fornecedor',
      vendorCreditNote: 'Nota de cr\u00e9dito do fornecedor',
      vendorDebitNote: 'Nota de d\u00e9bito do fornecedor',
    },
    workflow: {
      draft: 'Rascunho',
      issued: 'Emitida',
      posted: 'Lan\u00e7ada',
      voided: 'Anulada',
    },
    meta: {
      invoiceDate: 'Data da fatura',
      noteDate: 'Data da nota',
      dueDate: 'Vencimento',
      currency: 'Moeda',
      originalInvoice: 'Fatura original',
      originalBill: 'Documento original',
    },
    parties: {
      issuer: 'Emitente',
      client: 'Cliente',
      supplier: 'Fornecedor',
      company: 'Empresa',
      taxIdLabel: 'NUIT',
    },
    table: {
      description: 'Descri\u00e7\u00e3o',
      qty: 'Qtd.',
      unit: 'Un.',
      unitPrice: 'Pre\u00e7o unit.',
      vat: 'IVA',
      total: 'Total',
      taxRatePrefix: 'IVA',
    },
    notes: {
      vatExemptionReason: 'Motivo de isen\u00e7\u00e3o do IVA',
      notApplicable: 'N\u00e3o aplic\u00e1vel a este documento.',
      correctionReason: 'Motivo da corre\u00e7\u00e3o',
      fiscalCorrection: 'Corre\u00e7\u00e3o fiscal.',
      fiscalAdjustment: 'Ajuste fiscal.',
      supplierCreditAdjustment: 'Redu\u00e7\u00e3o do passivo com fornecedor.',
      supplierDebitAdjustment: 'Aumento do passivo com fornecedor.',
      references: 'Refer\u00eancias',
      apDocument: 'Documento de contas a pagar.',
    },
    references: {
      supplierInvoiceReference: 'Refer\u00eancia da fatura do fornecedor',
      stockwiseKey: 'Chave interna StockWise',
      linkedPurchaseOrder: 'Pedido de compra associado',
      originalInvoice: 'Fatura original',
      originalBill: 'Documento original',
    },
    totals: {
      subtotal: 'Subtotal',
      vat: 'IVA',
      total: 'Total',
      baseSubtotal: 'Subtotal fiscal',
      baseVat: 'IVA fiscal',
      baseTotal: 'Total fiscal',
    },
    footer: {
      computerProcessed: 'PROCESSADO POR COMPUTADOR',
    },
    share: {
      dateLabel: 'Data',
      baseTotalLabel: 'Total fiscal',
    },
    errors: {
      shareUnavailable: 'A partilha n\u00e3o est\u00e1 dispon\u00edvel neste dispositivo.',
      shareUnsupported: 'A partilha do PDF gerado n\u00e3o \u00e9 suportada neste dispositivo.',
      printPrepFailed: 'N\u00e3o foi poss\u00edvel preparar o documento para impress\u00e3o.',
      printOpenFailed: 'N\u00e3o foi poss\u00edvel abrir a janela de impress\u00e3o.',
    },
  },
  en: {
    documentTypes: {
      salesInvoice: 'Invoice',
      salesCreditNote: 'Credit note',
      salesDebitNote: 'Debit note',
      vendorBill: 'Vendor bill',
      vendorCreditNote: 'Supplier credit note',
      vendorDebitNote: 'Supplier debit note',
    },
    workflow: {
      draft: 'Draft',
      issued: 'Issued',
      posted: 'Posted',
      voided: 'Voided',
    },
    meta: {
      invoiceDate: 'Invoice date',
      noteDate: 'Note date',
      dueDate: 'Due date',
      currency: 'Currency',
      originalInvoice: 'Original invoice',
      originalBill: 'Original bill',
    },
    parties: {
      issuer: 'Issuer',
      client: 'Customer',
      supplier: 'Supplier',
      company: 'Company',
      taxIdLabel: 'NUIT',
    },
    table: {
      description: 'Description',
      qty: 'Qty',
      unit: 'UoM',
      unitPrice: 'Unit price',
      vat: 'VAT',
      total: 'Total',
      taxRatePrefix: 'VAT',
    },
    notes: {
      vatExemptionReason: 'VAT exemption reason',
      notApplicable: 'Not applicable to this document.',
      correctionReason: 'Adjustment reason',
      fiscalCorrection: 'Fiscal correction.',
      fiscalAdjustment: 'Fiscal adjustment.',
      supplierCreditAdjustment: 'Reduction of supplier liability.',
      supplierDebitAdjustment: 'Increase of supplier liability.',
      references: 'References',
      apDocument: 'Accounts payable document.',
    },
    references: {
      supplierInvoiceReference: 'Supplier invoice reference',
      stockwiseKey: 'StockWise internal key',
      linkedPurchaseOrder: 'Linked purchase order',
      originalInvoice: 'Original invoice',
      originalBill: 'Original bill',
    },
    totals: {
      subtotal: 'Subtotal',
      vat: 'VAT',
      total: 'Total',
      baseSubtotal: 'Base subtotal',
      baseVat: 'Base VAT',
      baseTotal: 'Base total',
    },
    footer: {
      computerProcessed: 'PROCESSED BY COMPUTER',
    },
    share: {
      dateLabel: 'Date',
      baseTotalLabel: 'Base total',
    },
    errors: {
      shareUnavailable: 'Sharing is not available on the current device.',
      shareUnsupported: 'Sharing the generated PDF is not supported on the current device.',
      printPrepFailed: 'Unable to prepare the document for printing.',
      printOpenFailed: 'Unable to open the print window.',
    },
  },
}

const KNOWN_COMPUTER_PHRASES = new Set([
  'PROCESSADO POR COMPUTADOR',
  'PROCESSED BY COMPUTER',
  'COMPUTER PROCESSED',
])

export function normalizeOutputLanguage(value?: string | null): OutputLanguage | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized.startsWith('pt')) return 'pt'
  if (normalized.startsWith('en')) return 'en'
  return null
}

export function readCurrentAppOutputLanguage(): OutputLanguage {
  try {
    return normalizeOutputLanguage(globalThis.localStorage?.getItem(APP_LANGUAGE_STORAGE_KEY)) || 'en'
  } catch {
    return 'en'
  }
}

export function resolveDocumentOutputLanguage(snapshotLanguage?: string | null, fallbackLanguage?: string | null): OutputLanguage {
  return normalizeOutputLanguage(snapshotLanguage)
    || normalizeOutputLanguage(fallbackLanguage)
    || readCurrentAppOutputLanguage()
}

export function getOutputCopy(language: OutputLanguage) {
  return COPY[language]
}

function numberLocale(language: OutputLanguage) {
  return language === 'pt' ? 'pt-MZ' : 'en-GB'
}

export function formatOutputCurrency(language: OutputLanguage, amount: number, currencyCode: string) {
  return new Intl.NumberFormat(numberLocale(language), {
    style: 'currency',
    currency: currencyCode || 'MZN',
  }).format(amount || 0)
}

export function formatOutputNumber(language: OutputLanguage, value: number, digits = 2) {
  return new Intl.NumberFormat(numberLocale(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0)
}

export function formatOutputDate(language: OutputLanguage, value?: string | null) {
  const text = String(value || '').trim()
  if (!text) return '-'

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!isoMatch) return text

  const year = Number(isoMatch[1])
  const month = Number(isoMatch[2]) - 1
  const day = Number(isoMatch[3])
  const date = new Date(year, month, day)
  if (Number.isNaN(date.getTime())) return text

  return language === 'pt'
    ? new Intl.DateTimeFormat('pt-MZ', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date)
    : new Intl.DateTimeFormat('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(date)
}

export function localizeComputerPhrase(language: OutputLanguage, snapshotPhrase?: string | null) {
  const text = String(snapshotPhrase || '').trim()
  if (!text) return COPY[language].footer.computerProcessed
  return KNOWN_COMPUTER_PHRASES.has(text.toUpperCase())
    ? COPY[language].footer.computerProcessed
    : text
}
