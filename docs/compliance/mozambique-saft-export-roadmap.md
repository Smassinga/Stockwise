# Mozambique SAF-T Export Roadmap

## Current position

StockWise has Mozambique-oriented fiscal document data and a compliance support export, but it does not yet generate an official SAF-T/XML submission file.

Current capabilities:

- Fiscal settings for Mozambique jurisdiction.
- Fiscal series for sales invoices, sales credit notes, and sales debit notes.
- Sales invoice, credit note, and debit note tables with document references, dates, currency, exchange rate, VAT totals, totals, workflow status, and fiscal snapshots.
- Line tables for invoices, credit notes, and debit notes.
- Company, customer, and NUIT fields where configured.
- Fiscal document PDF output with bilingual labels and the phrase `PROCESSADO POR COMPUTADOR / PROCESSED BY COMPUTER`.
- Fiscal document artifact registry.
- SAF-T preparation run registry in `saft_moz_exports`.
- XLSX fiscal document export under Mozambique Compliance for review and compliance support.

## Not yet implemented

StockWise does not currently provide:

- Official SAF-T XML generation.
- Official Mozambique SAF-T schema validation.
- A signed or submission-ready Tax Authority file.
- Storage-backed generation of canonical SAF-T XML files from the app UI.
- Formal submission workflow to the Autoridade Tributária.

The current XLSX export must not be presented as an official SAF-T submission file.

## Data already available for mapping

Potential SAF-T source data already present in the application includes:

- Company legal/trade name, NUIT, address and contact fields.
- Customer name, NUIT and address snapshots.
- Sales invoices with document number, document date, due date, currency, exchange rate, status, subtotal, VAT total and gross total.
- Sales invoice lines with item code snapshot, description, quantity, unit, unit price, tax rate, VAT amount and line amount.
- Sales credit notes linked to original invoices.
- Sales debit notes linked to original invoices.
- Cash and bank settlement totals for invoices where available through the finance state view.
- Audit events for finance documents and SAF-T preparation runs.
- Fiscal document artifacts where registered.

## Data gaps to confirm

Before implementing official XML, the following must be confirmed against the official Mozambique specification:

- Exact SAF-T Mozambique XML schema/version required.
- Required master data sections and mandatory fields.
- Required tax table/classification fields.
- Required document status codes and cancellation/void mapping.
- Required invoice, credit note and debit note type codes.
- Required customer and supplier fields.
- Required product/service classification fields.
- Required payment/settlement section, if any.
- Required hash, signature, certificate or file integrity rules.
- Required period, currency and exchange-rate representation.
- Treatment of imported or historical documents.
- Treatment of draft, voided and issued documents.
- Whether POS sale receipts should be represented as invoices, sales orders, receipts or another section.

## Preliminary StockWise-to-SAF-T mapping

This mapping is preliminary and must be validated against the official schema.

- Company/header: `companies`, `company_fiscal_settings`.
- Customers: `customers` plus fiscal snapshots stored on issued documents.
- Products/services: `items`, `uoms`, document line snapshots.
- Sales invoices: `sales_invoices`, `sales_invoice_lines`.
- Credit notes: `sales_credit_notes`, `sales_credit_note_lines`.
- Debit notes: `sales_debit_notes`, `sales_debit_note_lines`.
- Tax totals: header `tax_total`, `tax_total_mzn`; line `tax_rate`, `tax_amount`.
- Currency: document `currency_code`, `fx_to_base`.
- Document lifecycle: `document_workflow_status`, `issued_at`, `voided_at`, `void_reason`.
- Settlement support: `v_sales_invoice_state`, `cash_transactions`, `bank_transactions`.
- Audit history: `finance_document_events`.
- Export run registry: `saft_moz_exports`.

## Implementation phases

1. Obtain and archive the official Mozambique SAF-T technical specification and XML schema.
2. Confirm fiscal/accounting interpretation with a Mozambican accountant or tax consultant.
3. Build a mapping document from StockWise tables to every required XML node.
4. Add missing canonical fields only where the specification requires them.
5. Implement a deterministic XML generator in a backend-controlled path.
6. Add schema validation and clear failure messages.
7. Store generated XML artifacts with checksum, period, source document count and source totals.
8. Add a preview/review step before final export.
9. Run test exports for taxable, exempt, credit note and debit note scenarios.
10. Validate generated files with an accountant/consultant and any official validator available.
11. Confirm the final interpretation and submission expectations with the accountant/consultant and, where applicable, the Mozambican Tax Authority before treating any XML as submission-ready.

## Validation requirements

Official XML implementation should not be considered complete until:

- XML validates against the official schema.
- Document counts and totals match StockWise registers.
- VAT totals match source documents.
- Credit/debit note links to original invoices are correct.
- Voided documents are represented according to the specification.
- Company and customer NUIT fields are present where required.
- Export file period and currency rules are correct.
- Generated file is reviewed by an accountant or fiscal consultant before real submission.

## Risks

Submitting non-compliant XML may create fiscal, accounting or operational risk. For that reason, StockWise must not label a file as official SAF-T/XML until the schema, mapping, validation and professional review are complete.
