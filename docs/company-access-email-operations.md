# Company Access Email Operations

This runbook records how Platform Control handles commercial and access emails.

## Scope

Current email scenarios in `/platform-control`:

- expiry warning
- purge warning
- paid activation confirmation

These emails are manual admin-triggered actions. They are not sent automatically when status changes.

## Inbound vs Outbound Routing

These flows are intentionally separate.

Inbound user contact:

- activation requests
- support requests
- public landing-page contact CTAs
- blocked-access request-activation CTA

All inbound contact now routes to:

- `support@stockwiseapp.com`

Outbound commercial/access notifications:

- expiry warning
- purge warning
- paid activation confirmation

These outbound emails go to the selected company's canonical recipient, not to `support@stockwiseapp.com`.

## Canonical Company Recipient Rule

Platform Control resolves the company recipient in this order:

1. `companies.email`
2. resolved owner email
3. active admin email fallback

If no safe recipient can be resolved:

- preview is blocked
- send is blocked
- Platform Control explains that no canonical company recipient is available yet

## Template Data Rules

The three templates use stored control-plane data, not unsaved form edits.

- expiry warning:
  - uses the stored access expiry date
  - for `active_paid`, that is `paid_until`
  - otherwise it falls back to `trial_expires_at`, then `paid_until`
- purge warning:
  - requires stored `purge_scheduled_at`
  - also references the stored expiry date when available
- paid activation confirmation:
  - requires `effective_status = active_paid`
  - requires stored `access_granted_at`
  - requires stored `paid_until`

Platform Control disables preview/send until the admin saves current access changes first.

## Audit Rules

Successful sends are written to `company_control_action_log` with these action types:

- `access_email_expiry_warning_sent`
- `access_email_purge_warning_sent`
- `access_email_activation_confirmation_sent`

Logged context includes:

- recipient email
- recipient source
- subject
- template key
- mail provider message id when available

## Support Address In Outbound Emails

Outbound emails include `support@stockwiseapp.com` as the StockWise support contact and reply-to target.

This does not change the recipient rule. The company still receives the email at its canonical recipient address.

## Current Operating Model

- manual send from Platform Control
- preview before send available in the UI
- no automatic billing or payment checkout implied
- no automatic activation implied
