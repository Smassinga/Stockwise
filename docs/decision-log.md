# StockWise decision log

## 2026-07-31 — OPS-1 receipts, reports, exports, currency, and communications

- Receipts are settlement evidence, not document-status evidence; reprints are idempotent.
- POS remains non-fiscal and browser printing remains user controlled.
- Operational reporting shares dashboard recognition and does not aggregate configurable raw tables in React.
- Summary/Revenue/Customers/Suppliers and separate Turnover/Aging tabs are replaced by the authoritative catalogue; reusable utilities remain.
- MZN is rendered ISO-code-first in EN/PT without changing amount or FX authority.
- Application email templates are versioned EN/PT source modules; private dispatch evidence excludes HTML.
- Notifications are targeted, deduplicated, localisable events with legacy fallback and per-user preferences.
