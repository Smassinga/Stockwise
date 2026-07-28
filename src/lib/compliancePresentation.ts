export type ComplianceLanguage = 'en' | 'pt'

const documentTypes = {
  sales_invoice: { en: 'Sales invoice', pt: 'Factura de venda' },
  sales_credit_note: { en: 'Sales credit note', pt: 'Nota de crédito de venda' },
  sales_debit_note: { en: 'Sales debit note', pt: 'Nota de débito de venda' },
  vendor_bill: { en: 'Vendor bill', pt: 'Factura de fornecedor' },
  vendor_credit_note: { en: 'Vendor credit note', pt: 'Nota de crédito de fornecedor' },
  vendor_debit_note: { en: 'Vendor debit note', pt: 'Nota de débito de fornecedor' },
  saft_moz_export: { en: 'SAF-T preparation run', pt: 'Preparação SAF-T' },
} as const

const statuses = {
  draft: { en: 'Draft', pt: 'Rascunho' },
  approved: { en: 'Approved', pt: 'Aprovado' },
  issued: { en: 'Issued', pt: 'Emitido' },
  voided: { en: 'Voided', pt: 'Anulado' },
  queued: { en: 'Queued', pt: 'Em fila' },
  processing: { en: 'Processing', pt: 'Em processamento' },
  completed: { en: 'Completed', pt: 'Concluído' },
  failed: { en: 'Failed', pt: 'Falhou' },
  generated: { en: 'Generated', pt: 'Gerado' },
  submitted: { en: 'Submitted', pt: 'Submetido' },
  pending: { en: 'Pending', pt: 'Pendente' },
  archived: { en: 'Archived', pt: 'Arquivado' },
} as const

const eventTypes = {
  created: { en: 'Document created', pt: 'Documento criado' },
  submitted: { en: 'Submitted for review', pt: 'Submetido para revisão' },
  approved: { en: 'Document approved', pt: 'Documento aprovado' },
  issued: { en: 'Document issued', pt: 'Documento emitido' },
  voided: { en: 'Document voided', pt: 'Documento anulado' },
  fiscal_artifact_created: { en: 'Fiscal artifact recorded', pt: 'Artefacto fiscal registado' },
  saft_export_created: { en: 'SAF-T preparation recorded', pt: 'Preparação SAF-T registada' },
  draft_created: { en: 'Draft created', pt: 'Rascunho criado' },
  draft_edited: { en: 'Draft updated', pt: 'Rascunho actualizado' },
  approval_requested: { en: 'Approval requested', pt: 'Aprovação solicitada' },
} as const

const artifactTypes = {
  pdf: { en: 'PDF document', pt: 'Documento PDF' },
  xml: { en: 'XML artifact', pt: 'Artefacto XML' },
  imported_source: { en: 'Imported source', pt: 'Fonte importada' },
} as const

function labelFromMap<T extends Record<string, Record<ComplianceLanguage, string>>>(
  map: T,
  value: string | null | undefined,
  language: ComplianceLanguage,
  unavailable: string,
) {
  if (!value || !(value in map)) return unavailable
  return map[value as keyof T][language]
}

export function fiscalDocumentTypeLabel(value: string | null | undefined, language: ComplianceLanguage, unavailable: string) {
  return labelFromMap(documentTypes, value, language, unavailable)
}

export function complianceStatusLabel(value: string | null | undefined, language: ComplianceLanguage, unavailable: string) {
  return labelFromMap(statuses, value, language, unavailable)
}

export function complianceEventLabel(value: string | null | undefined, language: ComplianceLanguage, unavailable: string) {
  return labelFromMap(eventTypes, value, language, unavailable)
}

export function complianceArtifactLabel(value: string | null | undefined, language: ComplianceLanguage, unavailable: string) {
  return labelFromMap(artifactTypes, value, language, unavailable)
}

export function artifactBusinessName(fileName: string | null | undefined, fallback: string) {
  const normalized = fileName?.trim()
  return normalized || fallback
}
