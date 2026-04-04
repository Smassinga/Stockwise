# Due Reminder Worker

Supabase Edge Function that sends customer AR due reminders by email using the shared Brevo SMTP mailer.

## Reminder Anchor Model

The worker does not decide reminder truth on its own. It consumes the active AR reminder anchor emitted by `build_due_reminder_batch(...)`.

Current rule:

- `sales_order` only while no issued sales invoice exists
- `sales_invoice` once an issued invoice exists

This prevents duplicate reminder exposure across the operational order and the legal invoice.

## What the Worker Sends

For each queued reminder row, the worker renders:

- document reference
- due date
- outstanding amount
- linked order traceability when the active anchor is an invoice
- localized reminder copy in `pt` or `en`

The worker supports both:

- legacy sales-order-only batch rows
- anchor-aware AR reminder rows

That backward compatibility allows the function to be deployed safely before or alongside the updated RPC.

## Job Payload

```json
{
  "channels": {
    "email": true
  },
  "recipients": {
    "emails": ["override@example.com"]
  },
  "lead_days": [3, 1, 0, -3],
  "document_base_url": "https://stockwiseapp.com",
  "bcc": ["finance@example.com"],
  "lang": "pt"
}
```

Notes:

- `document_base_url` is optional and only used to build app links
- `invoice_base_url` is still accepted as a legacy fallback field
- invoice-anchored reminders use invoice language snapshot when available

## Configuration

Required secrets/environment variables:

- `BREVO_SMTP_HOST`
- `BREVO_SMTP_PORT`
- `BREVO_SMTP_LOGIN`
- `BREVO_SMTP_KEY`
- `BREVO_SENDER_EMAIL`
- `BREVO_SENDER_NAME`
- `BREVO_REPLY_TO_EMAIL`
- `BREVO_REPLY_TO_NAME`
- `SERVICE_ROLE_KEY`
- `REMINDER_HOOK_SECRET`

Optional:

- `DRY_RUN`
- `DEBUG_LOG`
- `DUE_REMINDER_MAX_ATTEMPTS`
- `PUBLIC_SITE_URL` or equivalent site URL fallback for link generation

## Troubleshooting

If you get `no reminders for window`, verify:

1. qualifying AR anchors exist for the selected local day and lead offsets
2. sales orders are still on `legacy_order_link` if they have no issued invoice yet
3. invoice reminders are using positive invoice `outstanding_base`
4. fully settled or fully credited invoices are not expected to appear
5. customer billing email exists or override recipients were provided
