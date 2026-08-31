from pathlib import Path

sales_path = Path('src/pages/SalesInvoiceDetail.tsx')
vendor_path = Path('src/pages/VendorBillDetail.tsx')

sales = sales_path.read_text()
vendor = vendor_path.read_text()

sales_import = "import FinanceRawEventRegistryCard from '../components/finance/FinanceRawEventRegistryCard'\n"
vendor_import = "import FinanceRawEventRegistryCard from '../components/finance/FinanceRawEventRegistryCard'\n"

if sales.count(sales_import) != 1 or vendor.count(vendor_import) != 1:
    raise SystemExit('expected raw-event component import anchor exactly once in both finance pages')

sales = sales.replace(
    sales_import,
    sales_import + "import SalesInvoiceLinesCard from '../components/finance/SalesInvoiceLinesCard'\n",
    1,
)
vendor = vendor.replace(
    vendor_import,
    vendor_import + "import VendorBillLinesCard from '../components/finance/VendorBillLinesCard'\n",
    1,
)

sales_start_marker = "          <Card className=\"border-border/80 shadow-sm\">\n            <CardHeader>\n              <CardTitle>{tt('financeDocs.mz.documentLines', 'Document lines')}</CardTitle>"
sales_end_marker = "\n\n          <Card className=\"border-border/80 shadow-sm\">\n            <CardHeader>\n              <CardTitle>{tt('financeDocs.mz.creditNotes', 'Credit notes')}</CardTitle>"

vendor_start_marker = "          <Card className=\"border-border/80 shadow-sm\">\n            <CardHeader>\n              <CardTitle>{tt('financeDocs.fields.lines', 'Lines')}</CardTitle>"
vendor_end_marker = "\n\n          <Card className=\"border-border/80 shadow-sm\">\n            <CardHeader>\n              <CardTitle>{tt('financeDocs.vendorBills.creditNotesTitle', 'Supplier credit notes')}</CardTitle>"

sales_start = sales.find(sales_start_marker)
sales_end = sales.find(sales_end_marker, sales_start)
vendor_start = vendor.find(vendor_start_marker)
vendor_end = vendor.find(vendor_end_marker, vendor_start)

if min(sales_start, sales_end, vendor_start, vendor_end) < 0:
    raise SystemExit('finance line-table boundaries did not match the expected merged source')

sales_old = sales[sales_start:sales_end]
vendor_old = vendor[vendor_start:vendor_end]

sales_guards = [
    'lines.map((line)',
    'line.display_description',
    'line.display_unit_of_measure',
    'line.unit_price',
    'line.tax_amount',
]
vendor_guards = [
    'lines.map((line)',
    'line.unit_cost',
    'line.tax_amount',
    'line.line_total + line.tax_amount',
]

if not all(value in sales_old for value in sales_guards):
    raise SystemExit('sales invoice line-table content guard failed')
if not all(value in vendor_old for value in vendor_guards):
    raise SystemExit('vendor bill line-table content guard failed')

sales_component = """          <SalesInvoiceLinesCard
            lines={lines}
            title={tt('financeDocs.mz.documentLines', 'Document lines')}
            description={tt('financeDocs.mz.linesHelp', 'The detail table mirrors the formal invoice structure with fixed bilingual headers. Taxable line values stay separate from VAT so the totals block remains explicit and audit-friendly.')}
            emptyLabel={tt('financeDocs.linesEmpty', 'No document lines have been stored for this finance document yet.')}
            descriptionDashLabel={tt('common.dash', '-')}
            unitDashLabel="-"
            headers={{
              description: documentCopy.table.description,
              qty: documentCopy.table.qty,
              unit: documentCopy.table.unit,
              unitPrice: documentCopy.table.unitPrice,
              total: documentCopy.table.total,
              subtotal: documentCopy.totals.subtotal,
              vat: documentCopy.table.vat,
            }}
            formatMoney={(amount) => money(amount, invoice.currency_code)}
          />"""

vendor_component = """          <VendorBillLinesCard
            lines={lines}
            title={tt('financeDocs.fields.lines', 'Lines')}
            description={tt('financeDocs.vendorBills.linesHelp', 'Posted vendor bills keep their line values immutable. Supplier credit and debit notes adjust this AP chain without editing the posted document itself.')}
            emptyLabel={tt('financeDocs.linesEmpty', 'No document lines have been stored for this finance document yet.')}
            dashLabel={tt('common.dash', '-')}
            headers={{
              description: tt('orders.description', 'Description'),
              qty: tt('orders.qty', 'Qty'),
              unitCost: tt('financeDocs.fields.unitCost', 'Unit cost'),
              tax: tt('financeDocs.fields.taxTotal', 'Tax'),
              total: tt('financeDocs.fields.total', 'Total'),
            }}
            formatMoney={(amount) => formatDocumentMoney(amount, row.currency_code)}
          />"""

sales = sales[:sales_start] + sales_component + sales[sales_end:]
vendor = vendor[:vendor_start] + vendor_component + vendor[vendor_end:]

sales_path.write_text(sales)
vendor_path.write_text(vendor)
