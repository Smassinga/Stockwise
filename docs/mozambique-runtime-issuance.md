# Mozambique Runtime Issuance

## A. Architecture Summary For Mozambique Fiscal Runtime

This document describes the app-side runtime package implemented on top of the live Step 2 + Wave 1 Mozambique database model.

Locked architecture:

- `sales_orders` remain operational and commercial documents.
- `sales_invoices` are the legal fiscal truth for outbound invoicing.
- `purchase_orders` remain operational documents until a vendor bill is booked.
- `vendor_bills` become the payable settlement truth once booked.
- `sales_invoices.internal_reference` is the visible legal/display reference.
- Internal workflow uses stable ids, not parsed document references.
- Issued invoices are immutable and corrections flow through `sales_credit_notes`.
- Settlement anchors support `SO`, `PO`, `SI`, and `VB`, but once a finance document exists the finance document becomes the canonical settlement anchor.
- Vendor bills keep the existing dual-reference AP model and now participate in the same settlement-anchor rules.

Munchythief is the first validation tenant:

- company id: `54e38916-6ebd-470a-9e82-0d43f9ae1b31`
- legal seller identity snapshot source: `companies.legal_name = 'Munchythief, E.I'`
- computer phrase: `PROCESSADO POR COMPUTADOR`
- active 2026 series: `INV`, `NC`, `ND`

## B. Issuance Lifecycle

1. Sales order stays operational.
2. Operator opens a sales order in `/orders?tab=sales`.
3. `View` keeps the order reachable in the normal workflow and persists the drawer path with `?tab=sales&orderId=<id>`.
4. The order workspace shows linked fiscal invoice reference and workflow when a draft or issued invoice already exists.
5. `Open fiscal invoice` calls `createDraftSalesInvoiceFromOrder(...)` only when no linked draft or issued invoice exists.
6. If a linked invoice already exists, the order workspace opens that invoice directly.
7. A draft row is created in `sales_invoices` plus `sales_invoice_lines`.
8. Operator opens `/sales-invoices/:invoiceId`.
9. While the invoice is still draft, the page shows preview seller/buyer/company-phrase values sourced from the linked sales order, customer, and company settings.
10. Draft dates can still be adjusted on the invoice detail page.
11. `Issue invoice` calls `issue_sales_invoice_mz`.
12. Database snapshots seller, buyer, numbering, series, and compliance fields on the invoice row.
13. Invoice becomes immutable in DB and app.
14. Corrections use `createAndIssueFullCreditNoteForInvoice(...)`, which creates a draft `sales_credit_notes` header and lines, then calls `issue_sales_credit_note_mz`.

## C. Renderer And Output Data Sources

Renderer source of truth:

- `sales_invoices`
- `sales_invoice_lines`

The renderer intentionally uses stored fiscal snapshot fields on the invoice row:

- seller snapshots
- buyer snapshots
- computer phrase snapshot
- MZN totals
- legal reference

It does not re-read mutable `companies`, `customers`, or `sales_orders` to render legal output. That is required for compliance and must remain true in future refactors.

Branding overlay:

- If a company logo is configured, the print/PDF output may show it as a branding element.
- This does not change the legal data source. Seller, buyer, fiscal totals, reference, and compliance phrase still come only from frozen invoice snapshots.

Formal bilingual template:

- Sales invoice, sales credit note, and sales debit note print/PDF output now use a fixed bilingual Portuguese/English template.
- App UI language does not change the formal document labels or structure for those legal outputs.
- The renderer must keep `PROCESSADO POR COMPUTADOR` present and now pairs it with the English phrase on the document footer when using the known Mozambique computer-processed wording.

Supplemental bank-details behavior:

- Bank details are sourced from the current company `bank_accounts` setup as a supplemental payment block only.
- Missing bank details must not break output generation; the payment block is omitted from print/PDF when no usable account fields exist.
- This does not relax the snapshot rule for seller/buyer legal identity, fiscal totals, or compliance wording.

Draft-only UI preview is different:

- before issue, the invoice detail page may show non-authoritative preview values loaded from the linked sales order, customer, and company settings
- those preview values are for operator visibility only
- once issue succeeds, the renderer and all legal output must rely on stored invoice snapshots only

## D. Immutability Rules After Issue

App-side behavior:

- The invoice detail page only exposes date edits while the invoice is `draft`.
- Print / PDF / share actions are exposed after issue.
- Credit-note action is exposed only for issued invoices.

DB-side source of truth:

- `issue_sales_invoice_mz`
- `sales_invoice_hardening_guard()`
- line parent-status guards
- settlement-anchor transfer helpers and read models:
  - `transfer_sales_order_settlement_anchor(...)`
  - `transfer_purchase_order_settlement_anchor(...)`
  - `v_sales_order_state`
  - `v_purchase_order_state`
  - `v_sales_invoice_state`
  - `v_vendor_bill_state`

The app must treat DB rejection as authoritative. Do not add client-only shortcuts that mutate issued headers or lines.

## E. Audit / Artifact / SAF-T Visibility Model

Implemented visibility:

- invoice detail page loads document-specific `finance_document_events`
- invoice detail page loads document-specific `fiscal_document_artifacts`
- compliance page loads company-level fiscal settings
- compliance page loads company-level active series
- compliance page loads company-level `saft_moz_exports`
- compliance page loads recent company-level events and artifacts

Not yet implemented operationally:

- canonical output artifact registration from generated PDF/XML
- SAF-T generation action
- SAF-T submission action

The compliance workspace is currently observational, not fully operational.

## F. Module Map

| Module | Purpose | Main Runtime Entry Points | Upstream Callers | Downstream Dependencies | Key Invariants / Compliance Assumptions | Failure Modes | Manual Verification |
|---|---|---|---|---|---|---|---|
| `src/lib/mzFinance.ts` | Finance runtime service layer for Mozambique issuance, notes, audit, artifacts, SAF-T visibility, and draft preview loading | `createDraftSalesInvoiceFromOrder`, `issueSalesInvoice`, `getSalesInvoiceDocument`, `getSalesInvoiceDraftPreview`, `listSalesInvoiceDocumentLines`, `createAndIssueFullCreditNoteForInvoice`, `listFinanceEvents`, `listFiscalArtifacts`, `listSaftMozExports` | `SalesOrders.tsx`, `SalesInvoiceDetail.tsx`, `MozambiqueCompliance.tsx` | Supabase tables, RPCs, storage metadata | Sales invoices are fiscal truth; issue and note flows must go through DB helpers; imported/native reference rules live in DB; `sales_order_lines` must be ordered by `line_no` then `id` because there is no live `created_at` column | Order not eligible, missing order lines, invoice insert failure, line insert failure, RPC rejection, missing fiscal prerequisites, preview lookup failure | Open a confirmed order, create draft invoice, issue it, then issue a credit note |
| `src/lib/mzInvoiceOutput.ts` | Snapshot-based invoice renderer, print, PDF, and share helper | `buildSalesInvoiceOutputModel`, `printSalesInvoiceDocument`, `downloadSalesInvoicePdf`, `shareSalesInvoiceDocument` | `SalesInvoiceDetail.tsx` | `sales_invoices` snapshots and `sales_invoice_lines`; `jspdf`; Web Share API | Output must use stored invoice snapshots only; must show legal reference and `PROCESSADO POR COMPUTADOR`; must support MZN totals; draft preview data must never leak into issued output rendering | Window blocked, PDF generation failure, share API unavailable, malformed snapshot data | Issue an invoice, print it, download PDF, verify seller/buyer data comes from invoice snapshots |
| `src/pages/SalesInvoiceDetail.tsx` | Main document workspace for draft save, issue, draft preview, output actions, credit note, audit, and archive views | `loadWorkspace`, `handleSaveDraftDates`, `handleIssueInvoice`, `handlePrint`, `handleDownloadPdf`, `handleShare`, `handleCreateCreditNote`, `openArtifact` | Route `/sales-invoices/:invoiceId` | `mzFinance.ts`, `mzInvoiceOutput.ts`, Supabase storage signed URLs | No post-issue edit controls; draft preview values are informational until issue; credit notes only from issued invoices; audit/artifacts are read from DB, not inferred | Missing invoice, preview lookup failure, RPC rejection, output helper failure, artifact bucket/path missing, signed URL failure | Load a draft, verify source preview values, issue it, verify buttons and sections change, then create a credit note |
| `src/pages/Orders/SalesOrders.tsx` | Operational entry point from sales order to persistent order detail, fiscal draft creation, and linked invoice navigation | `openSalesOrderDetail`, `openOrCreateFiscalInvoice` | Route `/orders?tab=sales` | `mzFinance.ts`, `sales_invoices` lookup | Orders stay operational; approved orders remain viewable from the order list; linked draft or issued invoices must stay reachable from the order workspace | Wrong status, duplicate/failed draft creation, missing company context, missing linked invoice summary | Open confirmed/allocated/shipped/closed order, use `View`, inspect lines/header, open linked invoice or create one |
| `src/pages/SalesInvoices.tsx` | Register and discovery page for fiscal invoices | list page route and links to detail/compliance/orders | Route `/sales-invoices` | Step 2 read hook and detail route | Invoice register shows fiscal documents, not operational orders | Missing Step 2 state views, stale register data, search mismatch | Open register, search by legal reference, open detail |
| `src/pages/Settlements.tsx` | Canonical receivables/payables workspace across orders and finance documents | `load`, `openSettlement`, `submitSettlement`, `viewOrder` | Route `/settlements` | `v_sales_order_state`, `v_purchase_order_state`, `v_sales_invoice_state`, `v_vendor_bill_state`, cash/bank transactions | Orders only remain anchors until issue/booking; once `SI` or `VB` exists it becomes the single settlement truth; no duplicate open exposure should remain | Missing settlement views, wrong ref_type reassociation, stale order-only wording, wrong drill-down target | Post a partial order settlement, issue the finance document, then confirm the settlement row moves to the document anchor |
| `src/pages/Cash.tsx` | Cash ledger and manual cash posting | `loadBook`, `loadData`, `addTransaction`, beginning-balance save | Route `/cash` | `cash_books`, `cash_transactions`, settlement reference helpers | Manual cash entries must accept `SO`, `PO`, `SI`, `VB`, or `ADJ`; sales anchors use receipts, purchase anchors use payments | Invalid UUID, anchor/type mismatch, wrong drill-down target | Post receipts/payments against `SO`, `SI`, `PO`, and `VB`, then open the linked anchor from the ledger |
| `src/pages/BankDetail.tsx` | Bank ledger and reconciliation visibility | `loadTx`, `loadStatements`, `loadBookBalance`, reconciliation actions | Route `/banks/:id` | `bank_transactions`, `bank_statements`, settlement reference helpers | Bank ledger must resolve `SO`, `PO`, `SI`, and `VB` references consistently with the settlements workspace | Missing ref columns, unresolved reference text, wrong drill-down target | Open bank ledger rows linked to orders/invoices/bills and confirm each opens the correct anchor |
| `src/pages/MozambiqueCompliance.tsx` | Company-level compliance visibility workspace | page load | Route `/compliance/mz` | `mzFinance.ts` | Visibility-only for now; do not assume SAF-T actions exist yet | Missing settings, missing active series, export history empty, artifact history empty | Open compliance page for Munchythief and confirm settings/series load |
| `src/App.tsx` | Route registration | `/sales-invoices/:invoiceId`, `/compliance/mz` | Root app router | lazy-loaded pages | Must expose the Mozambique pages under authenticated org routes | route missing, lazy import failure | Navigate directly to the routes |
| `src/components/layout/AppLayout.tsx` | Navigation exposure for Mozambique runtime pages | nav item generation | App shell | route paths and i18n fallback labels | Compliance route must be discoverable even if locale key is missing | missing nav label, wrong route grouping | Confirm sidebar shows `Mozambique Compliance` |
| `src/components/RouteMetadata.tsx` | SEO/page metadata for new routes | route metadata mapping | Router render tree | route path strings | metadata must not block runtime behavior | metadata omission only | Open route and confirm title metadata if needed |
| `src/locales/en.json` | Fallback copy for the invoice register/compliance nav | locale lookup | UI components | i18n system | Copy must reflect live runtime path, not future placeholder text | stale or misleading copy | Switch to English and verify invoice register copy |

## G. Diagnostic Map

| Feature | Route / Component | Helper / Hook | RPC / View / Table Touched | Expected State Transition | Common Failure Symptoms | First Place To Inspect |
|---|---|---|---|---|---|---|
| Draft invoice creation | `/orders?tab=sales` in `SalesOrders.tsx` | `createDraftSalesInvoiceFromOrder` | `sales_orders`, `sales_order_lines`, `sales_invoices`, `sales_invoice_lines` | sales order -> draft invoice | button fails, duplicate draft not reused, draft voided on partial insert failure | `mzFinance.ts` draft creation logs and order status/line data |
| Order detail loading | `/orders?tab=sales&orderId=<id>` in `SalesOrders.tsx` | `refreshSalesData`, `openSalesOrderDetail` | `sales_orders`, `sales_order_lines`, `sales_invoices` | order list -> persistent order detail drawer | `View` opens but drawer is blank, linked invoice summary missing, line query failure | `SalesOrders.refreshSalesData.*` console errors and the `orderId` query param |
| Invoice issuance | `/sales-invoices/:invoiceId` | `issueSalesInvoice` | `issue_sales_invoice_mz`, `sales_invoices`, `sales_invoice_lines` | draft -> issued | RPC rejection, due-date or snapshot prerequisites missing, line snapshot trigger failure, no refresh after issue | `mzFinance.ts` `salesInvoice.issue.*` log and DB issue guard message |
| Invoice detail loading | `/sales-invoices/:invoiceId` | `getSalesInvoiceDocument`, `listSalesInvoiceDocumentLines`, `listFinanceEvents`, `listFiscalArtifacts`, `listSalesCreditNotesForInvoice` | `sales_invoices`, `sales_invoice_lines`, `finance_document_events`, `fiscal_document_artifacts`, `sales_credit_notes` | load current document workspace | blank page, missing sections, one subquery fails and page drops to error toast | `SalesInvoiceDetail.tsx` `loadWorkspace` error log |
| Renderer / print / PDF / share | invoice detail actions | `buildSalesInvoiceOutputModel`, `printSalesInvoiceDocument`, `downloadSalesInvoicePdf`, `shareSalesInvoiceDocument` | snapshot fields from `sales_invoices` and `sales_invoice_lines` | issued invoice -> printable/shareable output | wrong seller/buyer data, blocked print window, PDF build failure, share unavailable | `mzInvoiceOutput.ts` output logs and snapshot field completeness |
| Settlement anchor transition | settlements, cash, bank, invoice/vendor bill detail | settlement state views plus re-anchor triggers | `cash_transactions`, `bank_transactions`, `v_sales_order_state`, `v_purchase_order_state`, `v_sales_invoice_state`, `v_vendor_bill_state` | order anchor -> finance-document anchor | order still looks collectible after invoice issue, duplicate exposure, pre-issue cash not carried onto invoice/bill | settlement read models and `20260401120000_finance_document_settlement_anchor_transition.sql` |
| Credit-note issuance | invoice detail dialog | `createAndIssueFullCreditNoteForInvoice` | `sales_credit_notes`, `sales_credit_note_lines`, `issue_sales_credit_note_mz` | issued invoice -> issued credit note | empty reason, header insert failure, line insert failure, RPC rejection | `mzFinance.ts` `creditNote.issueFromInvoice.*` log |
| Audit trail loading | invoice detail and compliance page | `listFinanceEvents` | `finance_document_events` | read recent events | empty or failed event panel | `mzFinance.ts` `financeEvents.load.*` log and RLS |
| Archive / artifact retrieval | invoice detail | `listFiscalArtifacts`, `openArtifact` | `fiscal_document_artifacts`, Supabase storage signed URL | read artifact rows -> open storage file | row exists but file cannot open, missing bucket/path, signed URL failure | `SalesInvoiceDetail.tsx` `openArtifact` error log |
| SAF-T history loading | compliance page | `listSaftMozExports` | `saft_moz_exports` | read export history | empty history, load failure, mistaken assumption that actions exist | `mzFinance.ts` `saftExports.load.*` log |
| Later SAF-T actions | future compliance page actions | future helper/action layer | `create_saft_moz_export_run`, `finalize_saft_moz_export_run`, `submit_saft_moz_export_run`, `fail_saft_moz_export_run` | pending -> generated -> submitted or failed | action buttons missing because not implemented yet | this document: section `Known Gaps` |

## H. Troubleshooting Guide

### Draft invoice creation fails

Check:

- active company context exists
- sales order status is one of `confirmed`, `allocated`, `shipped`, `closed`
- sales order has invoiceable lines with positive quantity
- header tax can be allocated against a positive subtotal

Inspect first:

- `SalesOrders.openOrCreateFiscalInvoice` console error
- `mzFinance.ts` events:
  - `salesInvoiceDraft.lookup.failed`
  - `salesInvoiceDraft.orderLoad.failed`
  - `salesInvoiceDraft.orderLinesLoad.failed`
  - `salesInvoiceDraft.headerInsert.failed`
  - `salesInvoiceDraft.linesInsert.failed`

Ordering note:

- `sales_order_lines` does not expose `created_at` in the live schema.
- Fiscal draft preparation must keep deterministic ordering on `line_no ASC, id ASC`.
- If this ordering changes again, inspect `createDraftSalesInvoiceFromOrder(...)` first.

### Invoice issue fails

Check:

- invoice is still `draft`
- draft dates are valid
- company fiscal settings and active series exist
- seller and buyer snapshots can be frozen by the DB issue helper

Inspect first:

- `SalesInvoiceDetail.issueInvoice` console error
- `mzFinance.ts` event `salesInvoice.issue.failed`
- DB helper `issue_sales_invoice_mz` rejection message

Specific symptom to recognize:

- if the app shows a 404-looking RPC network failure but the runtime error text mentions `invalid reference to FROM-clause entry`, inspect the live snapshot trigger functions first
- the concrete fix for that class of issue is the additive migration `20260401110000_wave1_mz_snapshot_issue_join_fix.sql`

### Output looks wrong

Check:

- invoice was already issued
- snapshot fields on `sales_invoices` are correct
- line data exists in `sales_invoice_lines`

Do not debug by looking at mutable company/customer masters first. The renderer intentionally ignores them once the invoice exists.

### Print falls back or PDF warns about layout

Check:

- the browser allowed iframe-based print execution
- the configured company logo URL is reachable if branding is expected
- the PDF log no longer shows `jspdf-autotable` width overflow

Inspect first:

- `salesInvoiceOutput.print.start`
- `salesInvoiceOutput.print.fallbackPdf`
- `salesInvoiceOutput.pdf.failed`

The runtime now prefers iframe print and falls back to PDF download if the browser cannot open a print surface safely.

### Credit note fails

Check:

- invoice status is `issued`
- correction reason is non-empty
- source invoice has lines

Inspect first:

- `SalesInvoiceDetail.createCreditNote` console error
- `mzFinance.ts` events:
  - `creditNote.headerInsert.failed`
  - `creditNote.linesInsert.failed`
  - `creditNote.issue.failed`

### Settlement anchor looks wrong

Check:

- whether the order is still pre-issue / pre-booking or a finance document already exists
- whether earlier receipts/payments were reassociated onto `SI` or `VB`
- whether the correct state view is being queried on the current screen

Inspect first:

- `v_sales_order_state`
- `v_purchase_order_state`
- `v_sales_invoice_state`
- `v_vendor_bill_state`
- `cash_transactions.ref_type/ref_id`
- `bank_transactions.ref_type/ref_id`

### Artifact row exists but file will not open

Check:

- `storage_bucket`
- `storage_path`
- storage object existence

Current package only reads archive metadata. Local PDF download does not register a canonical artifact automatically.

## I. Smoke-Test Checklist For Munchythief

Preconditions:

- active company is Munchythief
- a sales order exists in an eligible status
- company fiscal settings and active 2026 `INV`/`NC`/`ND` series are seeded

Checklist:

1. Open `/orders?tab=sales`.
2. Click `View` on an approved or otherwise eligible order.
3. Confirm the URL now carries `?tab=sales&orderId=<id>`.
4. Confirm the order drawer still shows the approved order header and lines.
5. Confirm the drawer shows linked fiscal invoice reference and workflow when a draft or issued invoice already exists.
6. If no linked invoice exists, click `Open fiscal invoice`.
7. Confirm the app navigates to `/sales-invoices/:invoiceId`.
8. Confirm the draft invoice shows a legal reference and draft dates.
9. Confirm the draft invoice preview shows seller, buyer, computer phrase, and MZN totals before issue.
10. Issue the invoice.
11. Confirm the page reloads with status `issued`.
12. Confirm date inputs disappear and output buttons appear.
13. Print and download the invoice.
14. Confirm seller/buyer data in output matches invoice snapshots, not mutable masters.
15. Return to the order workspace and confirm the linked fiscal invoice reference and workflow now appear.
16. Use `Open linked invoice` and confirm it routes back to the same invoice.
17. Issue a full credit note from the same invoice.
18. Confirm the credit note appears in the credit-note section.
19. Confirm audit events appear.
20. Confirm the compliance page loads fiscal settings, series, and SAF-T history.
21. Post a receipt against an approved sales order, issue the invoice, then confirm the receivable moves from `SO` to `SI`.
22. Post a payment against an approved purchase order, book the vendor bill, then confirm the payable moves from `PO` to `VB`.
23. After a full credit note, confirm the invoice shows a fully credited resolution state with no remaining open balance.

## J. Known Gaps And Next Package Boundaries

Known gaps:

- No canonical artifact registration for locally generated invoice outputs yet.
- No app-driven SAF-T generation or submission actions yet.
- No historical fiscal import/onboarding UI yet.
- Partial-credit and debit-note operator flows still need their own dedicated runtime workspace beyond the one-click full credit helper.

Active diagnostic risk:

- Sales-order tax is currently sourced from header-level `sales_orders.tax_total` and allocated proportionally into invoice lines during draft creation.
- That is a real limitation until canonical line-level tax sourcing exists on the operational document side.
- If totals or tax lines look suspicious, inspect `createDraftSalesInvoiceFromOrder(...)` first.

Transitional / deprecated paths:

- Sales orders are still active and required operationally.
- They are not legal fiscal truth.
- The invoice register is active.
- The compliance page is active but visibility-only for SAF-T and artifact history.

## K. Forward-State Settlement And Output Package Status

This section records the current implementation state so a later session can continue without relying on thread history.

Package intent:

- professional issued invoice output and more reliable print/PDF behavior
- forward-state settlement anchors across `SO`, `PO`, `SI`, and `VB`
- invoice resolution visibility after full or partial credit notes
- no tenant-specific branching or hardcoded company logic

Implemented locally in repo:

- `src/lib/mzInvoiceOutput.ts`
  - professional print/PDF layout
  - logo/brand support when available
  - only `PROCESSADO POR COMPUTADOR` remains; the extra explanatory sentence was removed
  - iframe print with PDF fallback when direct print fails
- `src/pages/SalesInvoiceDetail.tsx`
  - settlement/resolution card for issued invoices
  - explicit credited / settled / outstanding visibility
  - full-credit-note outcome shown as operationally resolved
- `src/pages/Settlements.tsx`
  - active settlement anchors now support `SO`, `PO`, `SI`, and `VB`
  - orders only remain collectible/payable until a finance document becomes the anchor
  - drill-down and dialog copy now follow the active anchor, not legacy order wording
- `src/pages/Cash.tsx`
  - manual cash entries and ledger links now support `SI` and `VB`
- `src/pages/BankDetail.tsx`
  - bank-ledger reference resolution and drill-down now support `SI` and `VB`
- `src/lib/orderFinance.ts`
- `src/lib/orderRefs.ts`
- `src/lib/orderState.ts`
  - shared settlement typing, labels, and anchor helpers now align to the forward-state model
- `src/lib/financeDocuments.ts`
  - settlement / resolution label helpers and state typing for invoice and vendor-bill read models
- `src/locales/en.json`
- `src/locales/pt.json`
  - settlement wording updated to anchor-centric copy
- `supabase/migrations/20260401120000_finance_document_settlement_anchor_transition.sql`
  - DB-side re-anchor helpers, triggers, and state views for settlement truth transfer

Local validation completed:

- `npm run lint:js` passed from `C:\Dev\Stockwise`
- `npm run build` passed from `C:\Dev\Stockwise`

Important environment correction:

- earlier Windows/UNC working-directory problems were real, but they were not the full explanation for prior build failures
- the package was revalidated from the correct repo root `C:\Dev\Stockwise`
- final local result for this package is green: lint and build both pass

Live rollout status from the last implementation session:

- no live frontend deployment was completed in that session
- no live DB migration for `20260401120000_finance_document_settlement_anchor_transition.sql` was completed in that session

Concrete live rollout blocker observed:

- direct Supabase CLI against the linked project failed on Postgres pooler auth with `password authentication failed for user "postgres"`
- direct `--db-url` attempts to the `db.<project-ref>.supabase.co` host failed with hostname resolution errors from that environment
- MCP Supabase connector token exchange also failed in that session

So the package should be treated as:

- code-complete locally
- locally validated
- not yet proven live for settlement-anchor transfer until the DB migration is applied from a healthy authenticated environment

Next session / rollout checklist:

1. deploy the frontend build containing the files listed above
2. apply `20260401120000_finance_document_settlement_anchor_transition.sql` from a healthy authenticated Supabase environment
3. retest these flows live:
   - approved sales order before invoice issue settles on `SO`
   - issued sales invoice with prior receipt/deposit re-anchors to `SI`
   - approved purchase order before bill posting settles on `PO`
   - posted vendor bill with prior payment re-anchors to `VB`
   - full credit note resolves the original invoice state correctly
   - partial credit note leaves the correct residual state
   - Cash, Bank Detail, Settlements, Orders, and finance-document views all point to the same active anchor
   - issued invoice print / PDF output is professionally formatted and no longer depends on a fragile popup-only flow

Non-goals preserved for this package:

- no rollback to order-centric fiscal truth
- no mutation of issued invoice output from live company/customer rows
- no heavy legacy-compatibility layer beyond what was needed to transition anchors cleanly
