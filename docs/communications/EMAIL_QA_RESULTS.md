# OPS-1 email QA results

The controlled portfolio comprises 16 messages: invite, report, digest, Sales Order reminder, Sales Invoice reminder, access expiry, purge, and activation, each in EN and PT. Due-soon, due-today, and overdue variants are rendered locally; one representative send per document/language is sufficient when layout is identical.

Every QA subject must start `[StockWise QA]`; every body must contain the EN/PT no-action banner and synthetic data only. The only authorised recipient for this rollout is `massingasamuel@hotmail.com`, enforced by the Template Lab allowlist. SMTP acceptance is recorded as “Accepted by Brevo SMTP” with worker, template/version, language, subject, recipient, provider message ID, and timestamp. SMTP acceptance is not inbox-delivery proof.

Production send results are appended only after the exact deployed templates are exercised. Auth signup/reset/email-change templates remain a separate read-only audit.

## 2026-07-31 rollout result

Local EN/PT template and finance compatibility tests passed. The shared workers and Template Lab deployed, and the recipient allowlist was configured. No portfolio message was sent in this run because the authenticated platform-admin browser session could not be controlled safely. There are therefore no Brevo acceptance IDs to record and no inbox-delivery claim. Hosted dispatch health at verification time was pending `0`, failed `0`.
