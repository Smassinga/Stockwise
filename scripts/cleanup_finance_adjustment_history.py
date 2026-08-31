from pathlib import Path

sales_path = Path('src/pages/SalesInvoiceDetail.tsx')
vendor_path = Path('src/pages/VendorBillDetail.tsx')

sales_text = sales_path.read_text()
vendor_text = vendor_path.read_text()

sales_import = "import SalesInvoiceLinesCard from '../components/finance/SalesInvoiceLinesCard'\n"
sales_import_replacement = sales_import + "import SalesInvoiceAdjustmentHistoryCards from '../components/finance/SalesInvoiceAdjustmentHistoryCards'\n"
vendor_import = "import VendorBillLinesCard from '../components/finance/VendorBillLinesCard'\n"
vendor_import_replacement = vendor_import + "import VendorBillAdjustmentHistoryCards from '../components/finance/VendorBillAdjustmentHistoryCards'\n"

if sales_text.count(sales_import) != 1:
    raise SystemExit('SalesInvoiceDetail: SalesInvoiceLinesCard import mismatch')
if vendor_text.count(vendor_import) != 1:
    raise SystemExit('VendorBillDetail: VendorBillLinesCard import mismatch')

sales_text = sales_text.replace(sales_import, sales_import_replacement, 1)
vendor_text = vendor_text.replace(vendor_import, vendor_import_replacement, 1)

sales_helper_anchor = "  async function handlePrintAdjustment(model: ReturnType<typeof buildSalesCreditNoteOutputModel> | ReturnType<typeof buildSalesDebitNoteOutputModel>) {\n"
if sales_text.count(sales_helper_anchor) != 1:
    raise SystemExit('SalesInvoiceDetail: handlePrintAdjustment anchor mismatch')

sales_model_helpers = """  function buildCreditNoteModel(note: SalesCreditNoteRow) {
    return buildSalesCreditNoteOutputModel(
      note,
      creditNoteLinesByNoteId.get(note.id) || [],
      {
        brandName: brand.name,
        logoUrl: brand.logoUrl,
        lang,
        originalInvoiceReference: invoice?.internal_reference || '',
        bankAccounts,
      },
    )
  }

  function buildDebitNoteModel(note: SalesDebitNoteRow) {
    return buildSalesDebitNoteOutputModel(
      note,
      debitNoteLinesByNoteId.get(note.id) || [],
      {
        brandName: brand.name,
        logoUrl: brand.logoUrl,
        lang,
        originalInvoiceReference: invoice?.internal_reference || '',
        bankAccounts,
      },
    )
  }

"""
sales_text = sales_text.replace(sales_helper_anchor, sales_model_helpers + sales_helper_anchor, 1)

sales_start_marker = """          <Card className=\"border-border/80 shadow-sm\">
            <CardHeader>
              <CardTitle>{tt('financeDocs.mz.creditNotes', 'Credit notes')}</CardTitle>"""
sales_end_marker = """

          <FinanceTimelineCard"""
sales_start = sales_text.find(sales_start_marker)
sales_end = sales_text.find(sales_end_marker, sales_start)
if sales_start < 0 or sales_end < 0:
    raise SystemExit('SalesInvoiceDetail: adjustment history boundaries not found')
sales_old = sales_text[sales_start:sales_end]
for guard in (
    "creditNotes.map((note)",
    "debitNotes.map((note)",
    "buildSalesCreditNoteOutputModel(",
    "buildSalesDebitNoteOutputModel(",
    "financeDocs.mz.creditNotesFullyResolved",
):
    if guard not in sales_old:
        raise SystemExit(f'SalesInvoiceDetail: missing history guard {guard}')

sales_replacement = """          <SalesInvoiceAdjustmentHistoryCards
            creditNotes={creditNotes}
            debitNotes={debitNotes}
            isActive={isIssued}
            canCreateCredit={canCreateCreditNote}
            canCreateDebit={canCreateDebitNote}
            creditBlockedMessage={
              !canIssueSalesAdjustments
                ? tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')
                : invoiceState?.credit_status === 'fully_credited'
                  ? tt('financeDocs.mz.creditNotesFullyResolved', 'This invoice is already fully credited. No further credit note can be issued against it.')
                  : tt('financeDocs.mz.creditNotesPartialResolved', 'This invoice already has credit-note adjustments. Open the credit-note workflow again if more remaining value still needs to be credited.')
            }
            debitBlockedMessage={tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')}
            translate={(key, fallback, params) => tt(key, fallback, params)}
            formatDate={shortDate}
            formatMoney={money}
            creditReasonLabel={(note) => note.correction_reason_code ? getAdjustmentReasonLabel('sales_credit', note.correction_reason_code, lang) : ''}
            debitReasonLabel={(note) => note.correction_reason_code ? getAdjustmentReasonLabel('sales_debit', note.correction_reason_code, lang) : ''}
            onOpenCredit={() => setCreditDialogOpen(true)}
            onOpenDebit={() => setDebitDialogOpen(true)}
            onPrintCredit={(note) => void handlePrintAdjustment(buildCreditNoteModel(note))}
            onDownloadCredit={(note) => void handleDownloadAdjustmentPdf(buildCreditNoteModel(note))}
            onPrintDebit={(note) => void handlePrintAdjustment(buildDebitNoteModel(note))}
            onDownloadDebit={(note) => void handleDownloadAdjustmentPdf(buildDebitNoteModel(note))}
          />"""
sales_text = sales_text[:sales_start] + sales_replacement + sales_text[sales_end:]

vendor_start_marker = """          <Card className=\"border-border/80 shadow-sm\">
            <CardHeader>
              <CardTitle>{tt('financeDocs.vendorBills.creditNotesTitle', 'Supplier credit notes')}</CardTitle>"""
vendor_end_marker = """

          <FinanceTimelineCard"""
vendor_start = vendor_text.find(vendor_start_marker)
vendor_end = vendor_text.find(vendor_end_marker, vendor_start)
if vendor_start < 0 or vendor_end < 0:
    raise SystemExit('VendorBillDetail: adjustment history boundaries not found')
vendor_old = vendor_text[vendor_start:vendor_end]
for guard in (
    "creditNotes.map((note)",
    "debitNotes.map((note)",
    "const noteModel = buildCreditNoteModel(note)",
    "const noteModel = buildDebitNoteModel(note)",
    "financeDocs.vendorBills.creditNotesResolved",
):
    if guard not in vendor_old:
        raise SystemExit(f'VendorBillDetail: missing history guard {guard}')

vendor_replacement = """          <VendorBillAdjustmentHistoryCards
            creditNotes={creditNotes}
            debitNotes={debitNotes}
            isActive={row.document_workflow_status === 'posted'}
            canCreateCredit={canCreateCreditNote}
            canCreateDebit={canCreateDebitNote}
            creditBlockedMessage={
              !canPostVendorAdjustments
                ? tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')
                : tt('financeDocs.vendorBills.creditNotesResolved', 'This vendor bill is already fully credited. No further supplier credit note can be posted against it.')
            }
            debitBlockedMessage={tt('financeDocs.approval.financeAuthorityRequired', 'Finance authority is required for legal-document issue, post, void, adjustment, and settlement actions.')}
            translate={(key, fallback, params) => tt(key, fallback, params)}
            formatDocumentMoney={formatDocumentMoney}
            formatBaseMoney={formatBaseMoney}
            workflowVariant={(status) => workflowTone(status)}
            creditReasonLabel={(note) => note.adjustment_reason_code ? getAdjustmentReasonLabel('vendor_credit', note.adjustment_reason_code, lang) : ''}
            debitReasonLabel={(note) => note.adjustment_reason_code ? getAdjustmentReasonLabel('vendor_debit', note.adjustment_reason_code, lang) : ''}
            onOpenCredit={() => setCreditDialogOpen(true)}
            onOpenDebit={() => setDebitDialogOpen(true)}
            onPrintCredit={(note) => void handlePrintDocument(buildCreditNoteModel(note))}
            onDownloadCredit={(note) => void handleDownloadPdf(buildCreditNoteModel(note))}
            onShareCredit={(note) => void handleShareDocument(buildCreditNoteModel(note))}
            onPrintDebit={(note) => void handlePrintDocument(buildDebitNoteModel(note))}
            onDownloadDebit={(note) => void handleDownloadPdf(buildDebitNoteModel(note))}
            onShareDebit={(note) => void handleShareDocument(buildDebitNoteModel(note))}
          />"""
vendor_text = vendor_text[:vendor_start] + vendor_replacement + vendor_text[vendor_end:]

sales_table_import = "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'\n"
vendor_table_import = "import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'\n"
if '<Table' not in sales_text:
    sales_text = sales_text.replace(sales_table_import, '', 1)
if '<Table' not in vendor_text:
    vendor_text = vendor_text.replace(vendor_table_import, '', 1)

sales_path.write_text(sales_text)
vendor_path.write_text(vendor_text)
