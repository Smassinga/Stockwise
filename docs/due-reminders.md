# Due Reminder System

The Due Reminder System automatically sends email notifications to customers when their invoices are approaching their due dates.

## Overview

The system consists of:
1. A queue table (`due_reminder_queue`) that stores jobs to be processed
2. An RPC function (`build_due_reminder_batch`) that identifies qualifying sales orders
3. An Edge Function (`due-reminder-worker`) that processes jobs and sends emails
4. A settings interface in the application for configuration

## Configuration

### Application Settings

In the Settings page, you can configure the Due Reminder Worker:

- **Enable Due Reminder Worker**: Turn the system on or off
- **Timezone**: The timezone used for calculating due dates
- **Lead Days**: Days before/after due date to send reminders (negative for overdue)
- **Recipient Emails**: Override customer emails (comma-separated)
- **BCC Emails**: BCC recipients for all reminder emails
- **Invoice Base URL**: Base URL for invoice links

### Environment Variables

The Edge Function requires these environment variables:

- `SENDGRID_API_KEY`: Your SendGrid API key
- `FROM_EMAIL`: Sender email address
- `REPLY_TO_EMAIL`: Reply-to email address
- `BRAND_NAME`: Your company name
- `SERVICE_ROLE_KEY`: Supabase service role key
- `REMINDER_HOOK_SECRET`: Secret for webhook authentication
- `DRY_RUN`: Set to "true" for testing without sending emails

## How It Works

1. Jobs are added to the `due_reminder_queue` table
2. The Edge Function processes pending jobs
3. For each job, it finds sales orders with due dates matching the lead days
4. It sends email reminders via SendGrid

## Troubleshooting

If you're getting "no reminders for window":

1. Check that sales orders exist with the correct company_id
2. Verify that the due dates match the lead days configuration
3. Ensure sales orders have positive amounts
4. Confirm that sales orders are not in cancelled/void/draft status
5. Check that customers have email addresses

## Testing

To test the system:

1. Set `DRY_RUN=true` to prevent actual emails from being sent
2. Use the test SQL script to verify your data
3. Enqueue a test job with lead_days set to [0] for today
4. Trigger the worker manually via curl

## Manual Trigger

To manually trigger the worker:

```bash
curl -i -X POST \
  "https://your-project.supabase.co/functions/v1/due-reminder-worker" \
  -H "X-Webhook-Secret: your-secret-key"
```