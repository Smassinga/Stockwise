# Due Reminder Worker Implementation Summary

This document summarizes all the changes made to implement the Due Reminder Worker system in Stockwise.

## Files Created

### Backend (Supabase)

1. **Migration Files:**
   - `supabase/migrations/2025-10-11_add_due_reminder_queue.sql` - Creates the queue table
   - `supabase/migrations/2025-10-11_build_due_reminder_batch.sql` - Creates the batch building RPC function
   - `supabase/migrations/2025-10-11_enqueue_due_reminder.sql` - Creates the enqueue RPC function
   - `supabase/migrations/2025-10-12_company_profile_enhancements.sql` - Adds email_subject_prefix to companies table

2. **Edge Function:**
   - `supabase/functions/due-reminder-worker/index.ts` - Main worker implementation
   - `supabase/functions/due-reminder-worker/README.md` - Documentation

### Frontend (Settings UI)

3. **Settings Page:**
   - `src/pages/Settings.tsx` - Updated to remove WhatsApp settings and add Due Reminder settings, plus email_subject_prefix field

### Documentation

4. **Documentation Files:**
   - `docs/due-reminders.md` - Comprehensive documentation for the due reminder system
   - `docs/due-reminder-changes-summary.md` - This file
   - `docs/index.md` - Updated to include link to due reminders documentation
   - `docs/MONITORING.md` - Updated to include due reminder worker monitoring
   - `docs/DOCUMENTATION_UPDATE_SUMMARY.md` - Overall documentation update summary

## Key Features Implemented

### 1. Queue System
- Created `due_reminder_queue` table with proper indexing
- Defined `reminder_status` enum type
- Supports job scheduling with timezone awareness

### 2. Batch Processing
- Implemented `build_due_reminder_batch` RPC function
- Finds sales orders matching lead days configuration
- Filters out cancelled/void/draft orders
- Validates email addresses for sending

### 3. Job Enqueueing
- Created `enqueue_due_reminder` RPC function
- Allows flexible job configuration
- Supports custom lead days, recipients, and channels

### 4. Edge Function Worker
- Processes jobs from the queue
- Sends emails via SendGrid
- Supports dry run mode for testing
- Implements proper authentication
- Handles job claiming to prevent duplicate processing
- Uses company brand name in email subjects and content
- Supports email_subject_prefix for custom email subject branding

### 5. Settings UI
- Removed WhatsApp settings as requested
- Added comprehensive Due Reminder settings:
  - Enable/disable toggle
  - Timezone configuration
  - Lead days customization
  - Recipient email overrides
  - BCC recipients
  - Invoice base URL
- Added email_subject_prefix field to Company Profile for custom email subject branding

### 6. Company Profile Enhancements
- Added `email_subject_prefix` field to companies table
- Updated Settings UI to include email_subject_prefix input field
- Enhanced due reminder worker to use company brand name hierarchy:
  1. email_subject_prefix (if set)
  2. trade_name
  3. legal_name
  4. name
  5. BRAND_NAME (fallback)

## Configuration Options

### Environment Variables
- `SENDGRID_API_KEY` - SendGrid API key for email sending
- `FROM_EMAIL` - Sender email address
- `REPLY_TO_EMAIL` - Reply-to email address
- `BRAND_NAME` - Company/brand name
- `SERVICE_ROLE_KEY` - Supabase service role key
- `REMINDER_HOOK_SECRET` - Authentication secret for webhooks
- `DRY_RUN` - Testing mode (true/false)

### Job Payload Options
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

## Enhanced Email Features

### Branding Improvements
- Custom email subject prefix support via `email_subject_prefix` field
- Brand name used in email "From" header
- Brand name used in email content closing ("Thanks from {brand}.")
- Formal and clear copy in both English and Portuguese
- Added "already paid" disclaimer to reduce support inquiries

### Copy Enhancements
- English: More formal and clear language
- Portuguese: More idiomatic translations
- Added polite disclaimer for customers who have already paid
- Improved contact information presentation

## Troubleshooting

### Common Issues
1. "no reminders for window" - Check sales orders, due dates, and email addresses
2. Authentication failures - Verify `REMINDER_HOOK_SECRET`
3. SendGrid errors - Check `SENDGRID_API_KEY` and account status
4. Empty recipient lists - Ensure customers have emails or override recipients
5. Branding issues - Verify `email_subject_prefix` and company name fields

### Debugging Tools
- SQL scripts for checking queue, orders, and emails
- Dry run mode for testing without sending emails
- Detailed logging when `DEBUG_LOG` is enabled

## Testing

### Manual Testing
1. Set `DRY_RUN=true` for safe testing
2. Enqueue a test job with lead_days=[0] for today
3. Trigger the worker manually via curl
4. Check logs for "would send" messages

### Verification Queries
- Check queue table for job status
- Verify batch function returns expected results
- Confirm sales orders match filtering criteria
- Validate email addresses are present
- Check company branding fields are populated correctly

## Recent Enhancements

### Company Branding Support
- Added `email_subject_prefix` field to companies table
- Updated Settings UI to allow configuration of email subject prefix
- Enhanced due reminder worker to use hierarchical brand name selection
- Improved email templates to use company brand consistently

### Email Template Improvements
- Added "already paid" disclaimer to reduce support inquiries
- Updated English copy to be more formal and clear
- Improved Portuguese translations for better clarity
- Consistent use of company brand name in email content