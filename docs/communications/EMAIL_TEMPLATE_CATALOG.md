# Email template catalogue

All maintained application templates are version 1 and support EN/PT:

- `due_reminder_sales_order`
- `due_reminder_sales_invoice`
- `daily_digest`
- `member_invite`
- `report_ready`
- `company_access_expiry`
- `company_access_purge`
- `company_access_activation`

Each definition owns its key, version, supported languages, input contract, subject, HTML, and plain-text rendering. The shared layout provides restrained StockWise/company identity, a summary panel, canonical action plus fallback URL, contact details, and StockWise attribution. MZN is ISO-code-first. Inputs are escaped and no mutable HTML or secrets are accepted from the browser.

Queue/dispatch evidence records the template key and version so future version increments do not alter the meaning of historical sends.
