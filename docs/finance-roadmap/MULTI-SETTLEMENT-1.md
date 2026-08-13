# MULTI-SETTLEMENT-1 — Customer receipts and invoice allocation

Status: implemented locally; pending the integrated clean replay and release gate. No hosted migration has been applied by this package.

## Authoritative model

A real customer payment creates exactly one immutable `customer_receipts` row and exactly one cash or bank transaction anchored with `ref_type = 'CR'`. Invoice allocation is separate append-only evidence in `customer_receipt_allocations`. Adding or reversing an allocation never creates a second cash/bank transaction and never edits the receipt.

The governed functions are:

- `post_customer_receipt(...)` — posts one receipt and optional initial allocations atomically;
- `allocate_customer_receipt(...)` — allocates existing unapplied receipt credit;
- `reverse_customer_receipt_allocation(...)` — appends reversal evidence and restores receipt credit and invoice outstanding.

All three functions require the existing company finance authority and active company/access contract. Posting requests preserve retry idempotency. Receipt rows and allocation evidence are immutable outside the existing, platform-admin-only operational-reset bypass. That reset removes allocation evidence before receipts and their financial transactions.

## Financial and currency boundaries

Version 1 accepts company-base-currency receipts and issued Sales Invoices in that same currency only. It does not perform FX conversion and does not net unapplied customer credit against AR. Unapplied credit is valid receipt context but reduces an invoice only after a governed allocation is posted.

Legacy one-anchor cash/bank settlements remain valid. `v_sales_invoice_state` counts legacy direct SI settlements and active customer-receipt allocations exactly once. Its cash/bank channel totals include receipt allocations according to the original receipt channel, while `legacy_direct_settled_base` and `receipt_allocated_base` remain separate audit columns.

The canonical AR read model is `v_customer_receivable_exposures`. It exposes company/customer identity, the issued-invoice or approved temporary SO anchor, document and base currency amounts, due state, outstanding, legacy settlement, receipt allocation, and collections suppression/promise/dispute evidence. `v_customer_unapplied_credit` remains a separate company/customer/currency aggregate and must never be subtracted from outstanding AR.

## Application workflow

`/settlements?view=receipts&side=ar&customerId=<uuid>&companyId=<uuid>` validates the customer in the current company and opens a read-only customer AR context. It shows contact evidence, open issued documents, original/outstanding amounts, document and due dates, overdue position, available collections context, and unapplied credit as a separate value.

Posting uses a three-step customer → receipt/allocation → review flow. The oldest-first action is only a reviewable UI suggestion; the server validates customer, company, currency, receipt availability, invoice outstanding, authority, idempotency, and concurrency. Expected RPC failures map to safe PT/EN messages rather than raw Postgres or Supabase text.

## Permanent proof

`npm run test:multi-settlement` includes a rollback-only SQL behavior matrix proving:

- one receipt → one invoice → one financial transaction;
- one receipt → three invoices → one financial transaction;
- MZN 25,000 received with zero allocations remains MZN 25,000 unapplied;
- multiple later allocations create no new financial transaction;
- append-only allocation reversal restores both unapplied credit and invoice outstanding;
- receipt and allocation idempotency;
- wrong customer, wrong company, foreign currency, over-allocation, direct mutation, and insufficient authority rejection;
- cash/bank channel presentation remains coherent without double-counting.

A separate local-only concurrency harness uses two genuinely independent authenticated PostgreSQL sessions for each race. It proves that concurrent allocations cannot over-allocate one receipt and that separate receipts cannot concurrently over-allocate one invoice. Its deterministic disposable company is removed child-first in `finally`; no hosted connection is used.

## Explicit deferral

Full receipt reversal is deferred as a HIGH follow-up. Reversing the financial receipt itself must coordinate cash/bank reversal evidence, active allocations, payment-receipt evidence, accounting consequences, and immutable audit history. Treating allocation reversal as receipt reversal would create false financial truth, so this package deliberately supports allocation reversal only until the broader governed finance-reversal architecture is approved.
