# Mozambique Runtime Issuance

## A. Architecture Summary For Mozambique Fiscal Runtime

This document describes the app-side runtime package implemented on top of the live Step 2 + Wave 1 Mozambique database model.

Locked architecture:

- `sales_orders` remain operational and commercial documents.
- `sales_invoices` are the legal fiscal truth for outbound invoicing.
- `sales_invoices.internal_reference` is the visible legal/display reference.
- Internal workflow uses stable ids, not parsed document references.
- Issued invoices are immutable and corrections flow through `sales_credit_notes`.
- Vendor bills keep the existing dual-reference AP model and are not part of the Mozambique sales issuance runtime in this package.

Munchythief is the first validation tenant:

- company id: `54e38916-6ebd-470a-9e82-0d43f9ae1b31`
- legal seller identity snapshot source: `companies.legal_name = 'Munchythief, E.I'`
- computer phrase: `PROCESSADO POR COMPUTADOR`
- active 2026 series: `INV`, `NC`, `ND`

## B. Issuance Lifecycle

1. Sales order stays operational.
2. Operator opens a sales order in `/orders?tab=sales`.
3. `Open fiscal invoice` calls `createDraftSalesInvoiceFromOrder(...)`.
4. A draft row is created in `sales_invoices` plus `sales_invoice_lines`.
5. Operator opens `/sales-invoices/:invoiceId`.
6. Draft dates can still be adjusted on the invoice detail page.
7. `Issue invoice` calls `issue_sales_invoice_mz`.
8. Database snapshots seller, buyer, numbering, series, and compliance fields on the invoice row.
9. Invoice becomes immutable in DB and app.
10. Corrections use `createAndIssueFullCreditNoteForInvoice(...)`, which creates a draft `sales_credit_notes` header and lines, then calls `issue_sales_credit_note_mz`.

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

## D. Immutability Rules After Issue

App-side behavior:

- The invoice detail page only exposes date edits while the invoice is `draft`.
- Print / PDF / share actions are exposed after issue.
- Credit-note action is exposed only for issued invoices.

DB-side source of truth:

- `issue_sales_invoice_mz`
- `sales_invoice_hardening_guard()`
- line parent-status guards

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
| `src/lib/mzFinance.ts` | Finance runtime service layer for Mozambique issuance, notes, audit, artifacts, and SAF-T visibility | `createDraftSalesInvoiceFromOrder`, `issueSalesInvoice`, `getSalesInvoiceDocument`, `listSalesInvoiceDocumentLines`, `createAndIssueFullCreditNoteForInvoice`, `listFinanceEvents`, `listFiscalArtifacts`, `listSaftMozExports` | `SalesOrders.tsx`, `SalesInvoiceDetail.tsx`, `MozambiqueCompliance.tsx` | Supabase tables, RPCs, storage metadata | Sales invoices are fiscal truth; issue and note flows must go through DB helpers; imported/native reference rules live in DB | Order not eligible, missing order lines, invoice insert failure, line insert failure, RPC rejection, missing fiscal prerequisites | Open a confirmed order, create draft invoice, issue it, then issue a credit note |
| `src/lib/mzInvoiceOutput.ts` | Snapshot-based invoice renderer, print, PDF, and share helper | `buildSalesInvoiceOutputModel`, `printSalesInvoiceDocument`, `downloadSalesInvoicePdf`, `shareSalesInvoiceDocument` | `SalesInvoiceDetail.tsx` | `sales_invoices` snapshots and `sales_invoice_lines`; `jspdf`; Web Share API | Output must use stored invoice snapshots only; must show legal reference and `PROCESSADO POR COMPUTADOR`; must support MZN totals | Window blocked, PDF generation failure, share API unavailable, malformed snapshot data | Issue an invoice, print it, download PDF, verify seller/buyer data comes from invoice snapshots |
| `src/pages/SalesInvoiceDetail.tsx` | Main document workspace for draft save, issue, output actions, credit note, audit, and archive views | `loadWorkspace`, `handleSaveDraftDates`, `handleIssueInvoice`, `handlePrint`, `handleDownloadPdf`, `handleShare`, `handleCreateCreditNote`, `openArtifact` | Route `/sales-invoices/:invoiceId` | `mzFinance.ts`, `mzInvoiceOutput.ts`, Supabase storage signed URLs | No post-issue edit controls; credit notes only from issued invoices; audit/artifacts are read from DB, not inferred | Missing invoice, RPC rejection, output helper failure, artifact bucket/path missing, signed URL failure | Load a draft, save dates, issue it, verify buttons and sections change, then create a credit note |
| `src/pages/Orders/SalesOrders.tsx` | Operational entry point from sales order to fiscal draft invoice | `openOrCreateFiscalInvoice` | Route `/orders?tab=sales` | `mzFinance.ts` | Orders stay operational; only eligible statuses can create fiscal drafts | Wrong status, duplicate/failed draft creation, missing company context | Open confirmed/allocated/shipped/closed order and use `Open fiscal invoice` |
| `src/pages/SalesInvoices.tsx` | Register and discovery page for fiscal invoices | list page route and links to detail/compliance/orders | Route `/sales-invoices` | Step 2 read hook and detail route | Invoice register shows fiscal documents, not operational orders | Missing Step 2 state views, stale register data, search mismatch | Open register, search by legal reference, open detail |
| `src/pages/MozambiqueCompliance.tsx` | Company-level compliance visibility workspace | page load | Route `/compliance/mz` | `mzFinance.ts` | Visibility-only for now; do not assume SAF-T actions exist yet | Missing settings, missing active series, export history empty, artifact history empty | Open compliance page for Munchythief and confirm settings/series load |
| `src/App.tsx` | Route registration | `/sales-invoices/:invoiceId`, `/compliance/mz` | Root app router | lazy-loaded pages | Must expose the Mozambique pages under authenticated org routes | route missing, lazy import failure | Navigate directly to the routes |
| `src/components/layout/AppLayout.tsx` | Navigation exposure for Mozambique runtime pages | nav item generation | App shell | route paths and i18n fallback labels | Compliance route must be discoverable even if locale key is missing | missing nav label, wrong route grouping | Confirm sidebar shows `Mozambique Compliance` |
| `src/components/RouteMetadata.tsx` | SEO/page metadata for new routes | route metadata mapping | Router render tree | route path strings | metadata must not block runtime behavior | metadata omission only | Open route and confirm title metadata if needed |
| `src/locales/en.json` | Fallback copy for the invoice register/compliance nav | locale lookup | UI components | i18n system | Copy must reflect live runtime path, not future placeholder text | stale or misleading copy | Switch to English and verify invoice register copy |

## G. Diagnostic Map

| Feature | Route / Component | Helper / Hook | RPC / View / Table Touched | Expected State Transition | Common Failure Symptoms | First Place To Inspect |
|---|---|---|---|---|---|---|
| Draft invoice creation | `/orders?tab=sales` in `SalesOrders.tsx` | `createDraftSalesInvoiceFromOrder` | `sales_orders`, `sales_order_lines`, `sales_invoices`, `sales_invoice_lines` | sales order -> draft invoice | button fails, duplicate draft not reused, draft voided on partial insert failure | `mzFinance.ts` draft creation logs and order status/line data |
| Invoice issuance | `/sales-invoices/:invoiceId` | `issueSalesInvoice` | `issue_sales_invoice_mz`, `sales_invoices`, `sales_invoice_lines` | draft -> issued | RPC rejection, due-date or snapshot prerequisites missing, no refresh after issue | `mzFinance.ts` `salesInvoice.issue.*` log and DB issue guard message |
| Invoice detail loading | `/sales-invoices/:invoiceId` | `getSalesInvoiceDocument`, `listSalesInvoiceDocumentLines`, `listFinanceEvents`, `listFiscalArtifacts`, `listSalesCreditNotesForInvoice` | `sales_invoices`, `sales_invoice_lines`, `finance_document_events`, `fiscal_document_artifacts`, `sales_credit_notes` | load current document workspace | blank page, missing sections, one subquery fails and page drops to error toast | `SalesInvoiceDetail.tsx` `loadWorkspace` error log |
| Renderer / print / PDF / share | invoice detail actions | `buildSalesInvoiceOutputModel`, `printSalesInvoiceDocument`, `downloadSalesInvoicePdf`, `shareSalesInvoiceDocument` | snapshot fields from `sales_invoices` and `sales_invoice_lines` | issued invoice -> printable/shareable output | wrong seller/buyer data, blocked print window, PDF build failure, share unavailable | `mzInvoiceOutput.ts` output logs and snapshot field completeness |
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

### Output looks wrong

Check:

- invoice was already issued
- snapshot fields on `sales_invoices` are correct
- line data exists in `sales_invoice_lines`

Do not debug by looking at mutable company/customer masters first. The renderer intentionally ignores them once the invoice exists.

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
2. Select an eligible sales order.
3. Click `Open fiscal invoice`.
4. Confirm the app navigates to `/sales-invoices/:invoiceId`.
5. Confirm the draft invoice shows a legal reference and draft dates.
6. Issue the invoice.
7. Confirm the page reloads with status `issued`.
8. Confirm date inputs disappear and output buttons appear.
9. Print and download the invoice.
10. Confirm seller/buyer data in output matches invoice snapshots, not mutable masters.
11. Issue a full credit note from the same invoice.
12. Confirm the credit note appears in the credit-note section.
13. Confirm audit events appear.
14. Confirm the compliance page loads fiscal settings, series, and SAF-T history.

## J. Known Gaps And Next Package Boundaries

Known gaps:

- No canonical artifact registration for locally generated invoice outputs yet.
- No app-driven SAF-T generation or submission actions yet.
- No historical fiscal import/onboarding UI yet.
- Live browser proof for first invoice issuance and first credit note was not completed in this implementation session.

Active diagnostic risk:

- Sales-order tax is currently sourced from header-level `sales_orders.tax_total` and allocated proportionally into invoice lines during draft creation.
- That is a real limitation until canonical line-level tax sourcing exists on the operational document side.
- If totals or tax lines look suspicious, inspect `createDraftSalesInvoiceFromOrder(...)` first.

Transitional / deprecated paths:

- Sales orders are still active and required operationally.
- They are not legal fiscal truth.
- The invoice register is active.
- The compliance page is active but visibility-only for SAF-T and artifact history.
