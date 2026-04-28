export type OutputLanguage = 'en' | 'pt' | 'bi'

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
    exchangeRate: string
    originalInvoice: string
    originalBill: string
    orderReference: string
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
    fiscalNote: string
    paymentTerms: string
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
  sections: {
    address: string
    bankDetails: string
    bankDetailsEmpty: string
    accountHolder: string
    bankName: string
    accountNumber: string
    nib: string
    swift: string
    taxNumber: string
  }
  footer: {
    computerProcessed: string
    pageLabel: string
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
      salesCreditNote: 'Nota de crédito',
      salesDebitNote: 'Nota de débito',
      vendorBill: 'Fatura de fornecedor',
      vendorCreditNote: 'Nota de crédito do fornecedor',
      vendorDebitNote: 'Nota de débito do fornecedor',
    },
    workflow: {
      draft: 'Rascunho',
      issued: 'Emitida',
      posted: 'Lançada',
      voided: 'Anulada',
    },
    meta: {
      invoiceDate: 'Data da fatura',
      noteDate: 'Data da nota',
      dueDate: 'Vencimento',
      currency: 'Moeda',
      exchangeRate: 'Câmbio',
      originalInvoice: 'Fatura original',
      originalBill: 'Documento original',
      orderReference: 'Pedido',
    },
    parties: {
      issuer: 'Emitente',
      client: 'Cliente',
      supplier: 'Fornecedor',
      company: 'Empresa',
      taxIdLabel: 'NUIT',
    },
    table: {
      description: 'Descrição',
      qty: 'Qtd.',
      unit: 'Un.',
      unitPrice: 'Preço unit.',
      vat: 'IVA',
      total: 'Total',
      taxRatePrefix: 'IVA',
    },
    notes: {
      vatExemptionReason: 'Motivo de isenção do IVA',
      notApplicable: 'Não aplicável a este documento.',
      correctionReason: 'Motivo da correção',
      fiscalNote: 'Nota fiscal',
      paymentTerms: 'Condições de pagamento',
      fiscalCorrection: 'Correção fiscal.',
      fiscalAdjustment: 'Ajuste fiscal.',
      supplierCreditAdjustment: 'Redução do passivo com fornecedor.',
      supplierDebitAdjustment: 'Aumento do passivo com fornecedor.',
      references: 'Referências',
      apDocument: 'Documento de contas a pagar.',
    },
    references: {
      supplierInvoiceReference: 'Referência da fatura do fornecedor',
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
    sections: {
      address: 'Endereço',
      bankDetails: 'Detalhes bancários',
      bankDetailsEmpty: 'Nenhuma conta bancária foi configurada para este documento.',
      accountHolder: 'Titular',
      bankName: 'Banco',
      accountNumber: 'Conta',
      nib: 'NIB',
      swift: 'SWIFT',
      taxNumber: 'Nº fiscal',
    },
    footer: {
      computerProcessed: 'PROCESSADO POR COMPUTADOR',
      pageLabel: 'Página',
    },
    share: {
      dateLabel: 'Data',
      baseTotalLabel: 'Total fiscal',
    },
    errors: {
      shareUnavailable: 'A partilha não está disponível neste dispositivo.',
      shareUnsupported: 'A partilha do PDF gerado não é suportada neste dispositivo.',
      printPrepFailed: 'Não foi possível preparar o documento para impressão.',
      printOpenFailed: 'Não foi possível abrir a janela de impressão.',
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
      exchangeRate: 'ROE',
      originalInvoice: 'Original invoice',
      originalBill: 'Original bill',
      orderReference: 'Order',
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
      fiscalNote: 'Fiscal note',
      paymentTerms: 'Payment terms',
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
    sections: {
      address: 'Address',
      bankDetails: 'Bank details',
      bankDetailsEmpty: 'No bank account is configured for this document.',
      accountHolder: 'Holder',
      bankName: 'Bank',
      accountNumber: 'Account',
      nib: 'NIB',
      swift: 'SWIFT',
      taxNumber: 'Tax number',
    },
    footer: {
      computerProcessed: 'PROCESSED BY COMPUTER',
      pageLabel: 'Page',
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
  bi: {
    documentTypes: {
      salesInvoice: 'Factura / Invoice',
      salesCreditNote: 'Nota de Crédito / Credit Note',
      salesDebitNote: 'Nota de Débito / Debit Note',
      vendorBill: 'Vendor Bill',
      vendorCreditNote: 'Supplier Credit Note',
      vendorDebitNote: 'Supplier Debit Note',
    },
    workflow: {
      draft: 'Rascunho / Draft',
      issued: 'Emitida / Issued',
      posted: 'Lançada / Posted',
      voided: 'Anulada / Voided',
    },
    meta: {
      invoiceDate: 'Data / Date',
      noteDate: 'Data / Date',
      dueDate: 'Vencimento / Due Date',
      currency: 'Moeda / Currency',
      exchangeRate: 'Câmbio / ROE',
      originalInvoice: 'Factura Original / Original Invoice',
      originalBill: 'Documento Original / Original Bill',
      orderReference: 'Encomenda / Sales Order',
    },
    parties: {
      issuer: 'Emitente / Issuer',
      client: 'Cliente / Client',
      supplier: 'Fornecedor / Supplier',
      company: 'Empresa / Company',
      taxIdLabel: 'NUIT / Tax ID',
    },
    table: {
      description: 'Descrição / Description',
      qty: 'Quantidade / Quantity',
      unit: 'Unidade / Unit',
      unitPrice: 'Preço Unitário / Unit Price',
      vat: 'IVA / VAT',
      total: 'Valor / Value',
      taxRatePrefix: 'IVA / VAT',
    },
    notes: {
      vatExemptionReason: 'Motivo de Isenção do IVA / VAT Exemption Reason',
      notApplicable: 'Não aplicável / Not applicable.',
      correctionReason: 'Motivo de Correcção / Correction Reason',
      fiscalNote: 'Nota Fiscal / Fiscal Note',
      paymentTerms: 'Condições de Pagamento / Payment Terms',
      fiscalCorrection: 'Correcção fiscal / Fiscal correction.',
      fiscalAdjustment: 'Ajuste fiscal / Fiscal adjustment.',
      supplierCreditAdjustment: 'Supplier credit adjustment.',
      supplierDebitAdjustment: 'Supplier debit adjustment.',
      references: 'Referências / References',
      apDocument: 'Accounts payable document.',
    },
    references: {
      supplierInvoiceReference: 'Referência da Factura / Supplier Invoice Reference',
      stockwiseKey: 'Chave StockWise / StockWise Key',
      linkedPurchaseOrder: 'Pedido de Compra / Purchase Order',
      originalInvoice: 'Factura Original / Original Invoice',
      originalBill: 'Documento Original / Original Bill',
    },
    totals: {
      subtotal: 'Valor Tributável / Taxable Amount',
      vat: 'IVA / VAT',
      total: 'Total',
      baseSubtotal: 'Valor Tributável / Taxable Amount',
      baseVat: 'IVA / VAT',
      baseTotal: 'Total',
    },
    sections: {
      address: 'Endereço / Address',
      bankDetails: 'Detalhes Bancários | Bank Details',
      bankDetailsEmpty: 'Sem contas bancárias configuradas / No bank details configured.',
      accountHolder: 'Titular / Holder',
      bankName: 'Banco / Bank',
      accountNumber: 'Conta / Account',
      nib: 'NIB',
      swift: 'SWIFT',
      taxNumber: 'NUIT / Tax ID',
    },
    footer: {
      computerProcessed: 'PROCESSADO POR COMPUTADOR / PROCESSED BY COMPUTER',
      pageLabel: 'Página / Page',
    },
    share: {
      dateLabel: 'Data / Date',
      baseTotalLabel: 'Total Fiscal / Base Total',
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
  'PROCESSADO POR COMPUTADOR / PROCESSED BY COMPUTER',
])

export function normalizeOutputLanguage(value?: string | null): OutputLanguage | null {
  const normalized = String(value || '').trim().toLowerCase()
  if (normalized === 'bi' || normalized === 'bilingual') return 'bi'
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
  if (language === 'pt') return 'pt-MZ'
  return 'en-GB'
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

  if (language === 'bi' || language === 'pt') {
    return new Intl.DateTimeFormat('pt-MZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date)
  }

  return new Intl.DateTimeFormat('en-GB', {
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
