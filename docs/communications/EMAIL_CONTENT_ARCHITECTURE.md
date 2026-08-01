# Email content architecture

COMMS-2 replaces the former all-purpose email payload with a discriminated template contract. Each template key owns its required input, subject, copy, detail sections, semantic treatment, and plain-text hierarchy. Production callers construct only the payload belonging to their template key; missing required business evidence stops rendering rather than introducing zeroes or synthetic dates.

## Typed contracts and owners

| Template | Version | Purpose | Production owner |
| --- | ---: | --- | --- |
| `member_invite` | 2 | Invite a person into one company with a localized role and security guidance | `mailer-invite` |
| `report_ready` | 3 | Announce one report, period, and supplied filters | `mailer-report` |
| `daily_digest` | 2 | Summarize performance, exceptions, and top activity | `digest-worker` |
| `due_reminder_sales_order` | 3 | Remind against the active Sales Order collection anchor | `due-reminder-worker` |
| `due_reminder_sales_invoice` | 3 | Remind against the issued Sales Invoice collection anchor | `due-reminder-worker` |
| `company_access_expiry` | 2 | Explain the access end date and manual renewal | `mailer-company-access` |
| `company_access_purge` | 2 | Warn about scheduled operational-data deletion | `mailer-company-access` |
| `company_access_activation` | 2 | Confirm a manually activated paid-access period | `mailer-company-access` |

Historical dispatch rows retain their original template versions. A material change to meaning, fields, or customer-facing copy requires another version increment.

## Separation rules

- Invitations contain company, role, inviter, optional expiry, and invitation security guidance—never operational metrics or document references.
- Report messages contain report identity, period, optional filters, and generated time—never collection dates or dashboard metrics unless a future governed contract explicitly adds them.
- Digests alone own the ten operational metrics. Incomplete costs keep profit and margin unavailable and add a costing warning.
- Reminders contain their own document reference, due date, optional total, and outstanding amount. The active-document rule prevents a Sales Order reminder once an issued Sales Invoice becomes the collection anchor.
- Access emails contain only plan/access dates and support actions. Purge is the only destructive visual variant.

## Brand and rendering

The email-safe layout uses inline styles and presentation tables, a 620 px maximum card, WiseCore green (`#009679`), charcoal text, neutral surfaces, and a large green CTA. Configured logos preserve aspect ratio and use descriptive alt text; without a logo, StockWise renders as a text identity without reserving an empty image region.

Semantic variants are `standard`, `informational`, `warning`, `destructive`, and `success`. They adjust restrained borders and tints without replacing the green brand system. Red is limited to purge warnings.

QA mode adds `[StockWise QA]` to the subject and a neutral dashed `TEST EMAIL` banner. Production mode contains neither. HTML values are escaped and action URLs are restricted to maintained StockWise origins. Plain text preserves headings, section labels, CTA URL, WiseCore attribution, and contact information.

## Localization and money

English and Mozambican Portuguese are authored per template. MZN remains ISO-code-first:

- EN: `MZN 1,250.00`
- PT: `MZN 1.250,00`

`MT`, `MTn`, suffix currency codes, fake dates, and false-zero unavailable values are prohibited.

## Template Lab

The platform-admin-only lab owns one isolated synthetic scenario per family. Preview metadata exposes the template version, semantic variant, required fields, and scenario label. The existing recipient allowlist, authentication, rate limiting, shared Brevo transport, and private dispatch audit remain authoritative.

## COMMS-3 identity and versions

`resolveEmailIdentity(...)` is the single authority for the visible sender, verified technical sender, Reply-To routing, subject company label, and identity category. Commercial mail uses the company trading name and finance/general Reply-To; internal intelligence uses `StockWise for {company}`; invitations use `{company} via StockWise`; access mail remains `StockWise`. The technical From address always remains the verified StockWise address.

Every company-context subject begins with the company label. QA subjects put `[StockWise QA]` before that label. Company-originated bodies state that StockWise sent the message on the company’s behalf. Private dispatch evidence snapshots the resolved identity without storing rendered HTML.

COMMS-3 versions are invitation v3, report v4, digest v3, both reminder families v4, and access families v3. Older dispatch evidence keeps its historical version.
