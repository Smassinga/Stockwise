from pathlib import Path

sales_path = Path('src/pages/SalesInvoiceDetail.tsx')
vendor_path = Path('src/pages/VendorBillDetail.tsx')

sales_text = sales_path.read_text()
vendor_text = vendor_path.read_text()

sales_import = "import SalesInvoiceLinesCard from '../components/finance/SalesInvoiceLinesCard'\n"
sales_import_replacement = sales_import + "import SalesInvoiceResolutionCard from '../components/finance/SalesInvoiceResolutionCard'\n"
vendor_import = "import VendorBillLinesCard from '../components/finance/VendorBillLinesCard'\n"
vendor_import_replacement = vendor_import + "import VendorBillResolutionCard from '../components/finance/VendorBillResolutionCard'\n"

if sales_text.count(sales_import) != 1:
    raise SystemExit(f'SalesInvoiceDetail: expected one SalesInvoiceLinesCard import, found {sales_text.count(sales_import)}')
if vendor_text.count(vendor_import) != 1:
    raise SystemExit(f'VendorBillDetail: expected one VendorBillLinesCard import, found {vendor_text.count(vendor_import)}')

sales_text = sales_text.replace(sales_import, sales_import_replacement, 1)
vendor_text = vendor_text.replace(vendor_import, vendor_import_replacement, 1)

sales_start_marker = """            <Card className=\"border-border/80 shadow-sm lg:col-span-2\">
              <CardHeader>
                <CardTitle>{tt('financeDocs.mz.resolutionTitle', 'Settlement and resolution')}</CardTitle>"""
sales_end_marker = """

            {!isDraft ? <div className=\"lg:col-span-2\"><ReceiptActions salesInvoiceId={invoice.id} /></div> : null}"""

sales_start = sales_text.find(sales_start_marker)
sales_end = sales_text.find(sales_end_marker, sales_start)
if sales_start < 0 or sales_end < 0:
    raise SystemExit('SalesInvoiceDetail: resolution card boundaries not found')

sales_old_block = sales_text[sales_start:sales_end]
for guard in (
    "resolutionTone(invoiceState?.resolution_status)",
    "financeDocs.mz.receiptsBreakdown",
    "financeDocs.mz.invoiceResolvedFullyCredited",
    "invoiceState?.current_legal_total_base || invoice.total_amount_mzn",
):
    if guard not in sales_old_block:
        raise SystemExit(f'SalesInvoiceDetail: missing resolution guard {guard}')

sales_replacement = """            <SalesInvoiceResolutionCard
              title={tt('financeDocs.mz.resolutionTitle', 'Settlement and resolution')}
              description={tt('financeDocs.mz.resolutionHelp', 'Once issued, the invoice becomes the receivable anchor. Receipts, credit notes, and debit notes all recalculate the same legal balance instead of leaving the original order as a duplicate settlement target.')}
              isActive={isIssued}
              inactiveMessage={tt('financeDocs.mz.settlementAfterIssue', 'Settlement begins after this draft is issued. Until then, the linked sales order remains the active operational anchor.')}
              badges={[
                { label: resolutionStatusLabel, variant: resolutionTone(invoiceState?.resolution_status) },
                { label: creditStatusLabel, variant: invoiceState?.credit_status === 'fully_credited' ? 'default' : 'outline' },
                { label: adjustmentStatusLabel, variant: invoiceState?.adjustment_status === 'debited' || invoiceState?.adjustment_status === 'credited_and_debited' ? 'outline' : 'secondary' },
                { label: settlementStatusLabel, variant: invoiceState?.settlement_status === 'overdue' ? 'destructive' : 'secondary' },
              ]}
              metrics={[
                {
                  label: tt('financeDocs.mz.originalAmount', 'Original total'),
                  value: money(invoiceState?.total_amount_base || invoice.total_amount_mzn, 'MZN'),
                  help: tt('financeDocs.mz.originalAmountHelp', 'Issued invoice total before receipts and credit notes'),
                },
                {
                  label: tt('settlements.settledAmount', 'Settled'),
                  value: money(invoiceState?.settled_base || 0, 'MZN'),
                  help: tt('financeDocs.mz.receiptsBreakdown', 'Cash {cash} · Bank {bank}', {
                    cash: money(invoiceState?.cash_received_base || 0, 'MZN'),
                    bank: money(invoiceState?.bank_received_base || 0, 'MZN'),
                  }),
                },
                {
                  label: tt('financeDocs.mz.creditedAmount', 'Credited'),
                  value: money(invoiceState?.credited_total_base || 0, 'MZN'),
                  help: tt('financeDocs.mz.creditNotesCount', '{count} credit notes issued', { count: invoiceState?.credit_note_count || 0 }),
                },
                {
                  label: tt('financeDocs.mz.debitedAmount', 'Debited'),
                  value: money(invoiceState?.debited_total_base || 0, 'MZN'),
                  help: tt('financeDocs.mz.debitNotesCount', '{count} debit notes issued', { count: invoiceState?.debit_note_count || 0 }),
                },
                {
                  label: tt('financeDocs.mz.currentLegalAmount', 'Current legal amount'),
                  value: money(invoiceState?.current_legal_total_base || invoice.total_amount_mzn, 'MZN'),
                  help: tt('financeDocs.mz.currentLegalAmountHelp', 'Original invoice minus credits plus debits'),
                },
                {
                  label: tt('settlements.outstandingAmount', 'Outstanding'),
                  value: money(invoiceState?.outstanding_base || 0, 'MZN'),
                  help: tt('financeDocs.mz.anchorReference', 'Settlement anchor: issued sales invoice'),
                  emphasize: true,
                },
              ]}
              summary={
                invoiceState?.credit_status === 'fully_credited'
                  ? tt('financeDocs.mz.invoiceResolvedFullyCredited', 'This invoice has been fully credited. It no longer carries an open receivable balance and should be treated as operationally resolved.')
                  : invoiceState?.adjustment_status === 'credited_and_debited'
                    ? tt('financeDocs.mz.invoiceResolvedCreditedAndDebited', 'This invoice has both credit and debit note adjustments. The current legal amount reflects the net chain before receipts are deducted.')
                    : invoiceState?.adjustment_status === 'debited'
                      ? tt('financeDocs.mz.invoiceResolvedDebited', 'This invoice has debit-note adjustments that increased the legal value of the receivable. Outstanding exposure reflects the adjusted amount.')
                      : invoiceState?.credit_status === 'partially_credited'
                        ? tt('financeDocs.mz.invoiceResolvedPartiallyCredited', 'This invoice has already been partially credited. The remaining balance reflects receipts and issued credit notes together.')
                        : tt('financeDocs.mz.invoiceResolvedOpen', 'Outstanding exposure now belongs to this invoice, not to the linked sales order.')
              }
            />"""

sales_text = sales_text[:sales_start] + sales_replacement + sales_text[sales_end:]

vendor_start_marker = """            <Card className=\"border-border/80 shadow-sm\">
              <CardHeader>
                <CardTitle>{tt('financeDocs.vendorBills.settlementTitle', 'Settlement and resolution')}</CardTitle>"""
vendor_end_marker = """

            <FinanceReconciliationReviewCard"""

vendor_start = vendor_text.find(vendor_start_marker)
vendor_end = vendor_text.find(vendor_end_marker, vendor_start)
if vendor_start < 0 or vendor_end < 0:
    raise SystemExit('VendorBillDetail: resolution card boundaries not found')

vendor_old_block = vendor_text[vendor_start:vendor_end]
for guard in (
    "financeDocs.vendorBills.paymentsBreakdown",
    "financeDocs.vendorBills.adjustmentSummaryMixed",
    "formatBaseMoney(row.current_legal_total_base)",
    "row.document_workflow_status !== 'posted'",
):
    if guard not in vendor_old_block:
        raise SystemExit(f'VendorBillDetail: missing resolution guard {guard}')

vendor_replacement = """            <VendorBillResolutionCard
              title={tt('financeDocs.vendorBills.settlementTitle', 'Settlement and resolution')}
              description={tt('financeDocs.vendorBills.settlementHelp', 'Posted vendor bills remain the AP settlement anchor. Supplier credits reduce the legal liability, supplier debits increase it, and payments reduce the same live document chain.')}
              isActive={row.document_workflow_status === 'posted'}
              inactiveMessage={tt('financeDocs.vendorBills.settlementAfterPosting', 'Settlement begins after this draft is posted. Until then, the linked purchase order remains the active operational anchor.')}
              metrics={[
                {
                  label: tt('financeDocs.vendorBills.originalTotal', 'Original total'),
                  value: formatBaseMoney(row.total_amount_base),
                  help: formatDocumentMoney(row.total_amount, row.currency_code),
                },
                {
                  label: tt('financeDocs.vendorBills.creditedTotal', 'Credited total'),
                  value: formatBaseMoney(row.credited_total_base),
                  help: tt('financeDocs.vendorBills.creditNotesCount', '{count} supplier credit notes posted', { count: row.credit_note_count }),
                },
                {
                  label: tt('financeDocs.vendorBills.debitedTotal', 'Debited total'),
                  value: formatBaseMoney(row.debited_total_base),
                  help: tt('financeDocs.vendorBills.debitNotesCount', '{count} supplier debit notes posted', { count: row.debit_note_count }),
                },
                {
                  label: tt('financeDocs.vendorBills.currentLegalAmount', 'Current AP total'),
                  value: formatBaseMoney(row.current_legal_total_base),
                  help: formatDocumentMoney(currentLegalDocumentTotal, row.currency_code),
                },
                {
                  label: tt('settlements.settledAmount', 'Settled'),
                  value: formatBaseMoney(row.settled_base),
                  help: tt('financeDocs.vendorBills.paymentsBreakdown', 'Cash {cash} · Bank {bank}', {
                    cash: formatBaseMoney(row.cash_paid_base),
                    bank: formatBaseMoney(row.bank_paid_base),
                  }),
                },
                {
                  label: tt('settlements.outstandingAmount', 'Outstanding'),
                  value: formatBaseMoney(row.outstanding_base),
                  help: tt('financeDocs.vendorBills.anchorReference', 'Settlement anchor: vendor bill'),
                  emphasize: true,
                },
              ]}
              summary={
                row.adjustment_status === 'credited_and_debited'
                  ? tt('financeDocs.vendorBills.adjustmentSummaryMixed', 'This vendor bill already has both supplier credit and supplier debit adjustments. The current AP total reflects the full net document chain before payments are deducted.')
                  : row.adjustment_status === 'debited'
                    ? tt('financeDocs.vendorBills.adjustmentSummaryDebited', 'Supplier debit notes have increased the legal AP amount on this bill. Outstanding liability reflects those posted upward adjustments.')
                    : row.credit_status === 'partially_credited'
                      ? tt('financeDocs.vendorBills.adjustmentSummaryCredited', 'Supplier credit notes have reduced part of this AP document. Outstanding liability reflects the remaining legal amount after credits and payments.')
                      : row.credit_status === 'fully_credited'
                        ? tt('financeDocs.vendorBills.adjustmentSummaryFullyCredited', 'This vendor bill has been fully credited. It no longer carries an open supplier liability.')
                        : tt('financeDocs.vendorBills.adjustmentSummaryOpen', 'No AP adjustment documents have changed this vendor bill yet.')
              }
            />"""

vendor_text = vendor_text[:vendor_start] + vendor_replacement + vendor_text[vendor_end:]

sales_path.write_text(sales_text)
vendor_path.write_text(vendor_text)
