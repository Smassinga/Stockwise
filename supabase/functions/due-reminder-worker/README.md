# Due Reminder Worker

A Supabase Edge Function that sends automated invoice due date reminders via email using SendGrid.

## Overview

The Due Reminder Worker processes jobs from a queue to send email reminders for sales orders that are approaching their due dates. It uses a flexible configuration system that allows you to customize when reminders are sent and to whom.

## How It Works

1. Jobs are enqueued in the `due_reminder_queue` table
2. The worker picks up pending jobs and processes them
3. For each job, it calls the `build_due_reminder_batch` RPC function to find qualifying sales orders
4. It sends email reminders via SendGrid for each qualifying order

## Configuration

### Environment Variables

The function requires these environment variables to be set in your Supabase project:

- `SENDGRID_API_KEY` - Your SendGrid API key for sending emails
- `FROM_EMAIL` - The sender email address (default: "no-reply@stockwiseapp.com")
- `REPLY_TO_EMAIL` - The reply-to email address (default: "support@stockwiseapp.com")
- `BRAND_NAME` - Your company/brand name (default: "Stockwise")
- `SERVICE_ROLE_KEY` - Supabase service role key for database access
- `REMINDER_HOOK_SECRET` - Secret key for authenticating webhook requests
- `DRY_RUN` - Set to "true" to test without actually sending emails (default: "false")

### Job Payload

Each job in the queue can have a payload with these options:

```json
{
  "channels": {
    "email": true
  },
  "recipients": {
    "emails": ["override@example.com"]
  },
  "lead_days": [3, 1, 0, -3],
  "invoice_base_url": "https://app.stockwise.app/invoices",
  "bcc": ["bcc@example.com"]
}
```

- `channels.email` - Whether to send email reminders (currently only email is supported)
- `recipients.emails` - Override the customer emails (if empty, uses customer emails from the database)
- `lead_days` - Days before/after due date to send reminders (negative numbers for overdue)
- `invoice_base_url` - Base URL for invoice links (will append the invoice code)
- `bcc` - BCC recipients for all emails

## Enqueueing Jobs

To enqueue a job, call the `enqueue_due_reminder` RPC function:

```sql
SELECT public.enqueue_due_reminder(
  'company-uuid-here',
  '2025-10-11',
  'Africa/Maputo',
  jsonb_build_object(
    'channels', jsonb_build_object('email', true),
    'recipients', jsonb_build_object('emails', jsonb_build_array('test@example.com')),
    'lead_days', jsonb_build_array(3, 1, 0, -3),
    'invoice_base_url', 'https://app.stockwise.app/invoices'
  )
);
```

## Triggering the Worker

To trigger the worker, make a POST request to the function endpoint:

```bash
curl -i -X POST \
  "https://your-project.supabase.co/functions/v1/due-reminder-worker" \
  -H "X-Webhook-Secret: your-secret-key"
```

## Testing

For testing, you can enable dry run mode:

```bash
supabase secrets set DRY_RUN="true"
```

In dry run mode, the function will log what emails would be sent without actually sending them.

## Troubleshooting

If you're getting "no reminders for window", check:

1. The job exists in `due_reminder_queue` with status "done"
2. Sales orders exist with:
   - Matching company_id
   - Due dates that match the lead days
   - Positive amounts
   - Status not in (cancelled, void, draft)
3. Customers have email addresses