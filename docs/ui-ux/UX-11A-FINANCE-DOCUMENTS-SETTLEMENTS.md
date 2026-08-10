# UX-11A — Finance documents, settlements, cash, and banking

Status: implementation complete; awaiting review and checkpoint.

## Scope and safety

UX-11A changes presentation, information hierarchy, semantic state treatment, responsive registers, and shared finance summaries for Sales Invoices, Vendor Bills, Settlements, Cash, Banks and Bank Detail, and stock Transactions. It does not change accounting, posting, tax, settlement allocation, inventory, authority, RLS or RPC, schema, or migrations.

The existing finance model remains authoritative:

- sales orders and purchase orders are operational anchors before a legal finance document exists;
- an issued sales invoice becomes the AR settlement anchor;
- a posted vendor bill becomes the AP settlement anchor;
- receipts, payments, credits, debits, and reconciliation evidence continue to come from existing views and RPCs;
- UI action visibility continues to use existing role helpers and backend enforcement.

## Implemented information hierarchy

Registers prioritise reference, counterparty, document date and due date, total, open amount when applicable, and one lifecycle treatment. Draft documents do not show an open settlement amount or overdue settlement state. Compact mobile rows preserve full references and monetary values.

Detail pages use the actual document reference as the primary heading. The lifecycle strip is the primary status explanation. Draft details explicitly state that settlement starts only after issue or posting and retain the linked order as the active anchor. Output actions are secondary; void remains destructive.

Settlements retains the existing AR and AP anchor model and reconciliation evidence while replacing repeated metric cards and decorative workspace effects with an open summary band and canonical semantic tokens. Cash and Banks use the same summary grammar without adding KPIs or calculations.

Transactions remains the stock-movement register, not a finance-settlement ledger. It names that scope explicitly, uses semantic movement states with text and icons, provides structural loading, retry, and empty states, aligns numeric values, and supplies a dedicated mobile list rather than a squeezed table.

## Reusable rules

1. Open is a financial position, not automatically a warning.
2. Draft is neutral; issued or posted is informational unless another state changes its meaning; settled is success; overdue is warning; voided or failed is danger.
3. State is always accompanied by text and, where helpful, an icon.
4. Currency, precision, rounding, and calculated balances are displayed from authoritative existing sources.
5. Summary bands group scan-critical values without creating one card per number.
6. Structural loading uses `PremiumSkeleton`; recoverable errors use `PremiumStatePanel` with retry where meaningful.
7. Mobile registers preserve references and amounts and use a purpose-built row or list representation.

## QA evidence and known gap

The authenticated Leny tenant supplied real existing draft and issued invoice, draft and posted vendor-bill, receivable and payable, Cash Book, bank-account, bank-detail, and stock-movement states. No QA finance mutation was required or performed for the presentation corrections. The observed draft records previously inherited overdue and outstanding presentation from state views; UX-11A gates that settlement presentation until issue or posting without altering backend values.

The canonical finance regression remains protected from hosted-production execution. Local validation must preserve that refusal and must not bypass it.
