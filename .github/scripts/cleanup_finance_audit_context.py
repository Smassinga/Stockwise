from pathlib import Path

files = [
    Path('src/pages/SalesInvoiceDetail.tsx'),
    Path('src/pages/VendorBillDetail.tsx'),
]

context_import = "import { loadFinanceAuditContext } from '../lib/financeAuditContext'\n"

for path in files:
    text = path.read_text(encoding='utf-8')
    if text.count('  listFinanceActorDirectory,\n') != 1:
        raise SystemExit(f'Expected one listFinanceActorDirectory import in {path}')
    if text.count('  listFinanceSettlementAuditEvents,\n') != 1:
        raise SystemExit(f'Expected one listFinanceSettlementAuditEvents import in {path}')
    text = text.replace('  listFinanceActorDirectory,\n', '')
    text = text.replace('  listFinanceSettlementAuditEvents,\n', '')

    anchor = "} from '../lib/financeAudit'\n"
    if text.count(anchor) != 1:
        raise SystemExit(f'Expected one financeAudit import anchor in {path}')
    text = text.replace(anchor, anchor + context_import)
    path.write_text(text, encoding='utf-8')

sales = files[0]
sales_text = sales.read_text(encoding='utf-8')
sales_old = """        const [actorRes, settlementRes] = await Promise.all([
          listFinanceActorDirectory(companyId, actorIds),
          nextInvoice?.document_workflow_status === 'issued'
            ? listFinanceSettlementAuditEvents(companyId, 'sales_invoice', invoiceId)
            : Promise.resolve([] as FinanceSettlementAuditEvent[]),
        ])

        nextActorDirectory = actorRes
        nextSettlementEvents = settlementRes
"""
sales_new = """        const auditContext = await loadFinanceAuditContext({
          companyId,
          actorIds,
          documentKind: 'sales_invoice',
          documentId: invoiceId,
          includeSettlementEvents: nextInvoice?.document_workflow_status === 'issued',
        })

        nextActorDirectory = auditContext.actorDirectory
        nextSettlementEvents = auditContext.settlementEvents
"""
if sales_text.count(sales_old) != 1:
    raise SystemExit('Expected one SalesInvoice audit context load block')
sales.write_text(sales_text.replace(sales_old, sales_new), encoding='utf-8')

vendor = files[1]
vendor_text = vendor.read_text(encoding='utf-8')
vendor_old = """        const [actorRes, settlementRes] = await Promise.all([
          listFinanceActorDirectory(companyId, actorIds),
          nextRow.document_workflow_status === 'posted'
            ? listFinanceSettlementAuditEvents(companyId, 'vendor_bill', billId)
            : Promise.resolve([] as FinanceSettlementAuditEvent[]),
        ])

        nextActorDirectory = actorRes
        nextSettlementEvents = settlementRes
"""
vendor_new = """        const auditContext = await loadFinanceAuditContext({
          companyId,
          actorIds,
          documentKind: 'vendor_bill',
          documentId: billId,
          includeSettlementEvents: nextRow.document_workflow_status === 'posted',
        })

        nextActorDirectory = auditContext.actorDirectory
        nextSettlementEvents = auditContext.settlementEvents
"""
if vendor_text.count(vendor_old) != 1:
    raise SystemExit('Expected one VendorBill audit context load block')
vendor.write_text(vendor_text.replace(vendor_old, vendor_new), encoding='utf-8')
