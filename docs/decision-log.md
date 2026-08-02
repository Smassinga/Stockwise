# StockWise decision log

## 2026-07-31 — OPS-1 receipts, reports, exports, currency, and communications

- Receipts are settlement evidence, not document-status evidence; reprints are idempotent.
- POS remains non-fiscal and browser printing remains user controlled.
- Operational reporting shares dashboard recognition and does not aggregate configurable raw tables in React.
- Summary/Revenue/Customers/Suppliers and separate Turnover/Aging tabs are replaced by the authoritative catalogue; reusable utilities remain.
- MZN is rendered ISO-code-first in EN/PT without changing amount or FX authority.
- Application email templates are versioned EN/PT source modules; private dispatch evidence excludes HTML.
- Notifications are targeted, deduplicated, localisable events with legacy fallback and per-user preferences.

## 2026-08-02 — COMMS-3C collections controls

- Collections control follows the Sales Order exposure chain when an issued Sales Invoice becomes the active anchor.
- Pauses, disputes, open promises, and manual follow-up suppress automatic customer reminders without changing financial balances.
- Promise outcomes use authoritative settlement and credit deltas; promises never post payments or change due dates.
- Reactivation resumes with only the latest relevant adaptive stage, never a cascade of missed reminders.
- Current state is RPC-only and historical control events remain immutable.
