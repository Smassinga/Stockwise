# Due Reminder System

The Due Reminder System sends AR due reminders from the active legal/commercial anchor for each exposure chain.

## Reminder Anchor Rule

- If no issued sales invoice exists yet, the reminder anchor remains the sales order.
- Once an issued sales invoice exists, the reminder anchor moves to the sales invoice.
- The sales order must no longer continue sending due reminders once the issued invoice exists.
- Reminder exposure must never be duplicated across the order and invoice for the same chain.

## Source of Truth Used by Reminders

For the active reminder anchor, reminders use:

- counterparty identity
- due date
- outstanding amount
- document reference
- settlement and resolution state
- document language context where available
- linked order/invoice references for traceability when useful

For sales invoices, the reminder worker now uses the issued invoice state instead of stale order exposure. That means reminder amount and eligibility follow:

- settlements
- partial settlements
- full settlement suppression
- full credit suppression
- mixed credit/debit note chains
- current legal outstanding after adjustments

## Architecture

The system consists of:

1. `due_reminder_queue` for queued jobs
2. `build_due_reminder_batch(...)` to emit one active AR reminder anchor per exposure chain
3. `due-reminder-worker` to process queued jobs and send email reminders
4. the Settings page for scheduling and notification configuration

## Current Behavior

### Sales order reminders

Sales orders remain eligible only while they are still the active AR anchor:

- approved order
- due date present
- positive legacy outstanding exposure
- no issued sales invoice has taken over the chain

### Sales invoice reminders

Issued sales invoices become eligible when they are the active legal anchor and still have current legal outstanding:

- issued invoice
- due date present
- positive invoice outstanding
- not fully settled
- not fully credited

## Language Behavior

- If an invoice-anchored reminder row carries a document language snapshot, that language is used for the reminder.
- Otherwise reminder language falls back to company/app reminder language settings.
- Current supported reminder languages remain `pt` and `en`.

## Settings

The Settings page controls:

- enable/disable
- timezone
- send time
- lead days before/on/after due date
- internal BCC recipients

Reminder links follow product document routing automatically. Legacy base URL settings remain only as fallback compatibility for older configurations.

## Validation Checklist

Use this checklist when changing reminder behavior:

1. Sales order exists, no invoice yet: reminder stays on `SO`
2. Issued invoice exists: reminder moves to `SI`
3. Partially settled invoice: reminder uses invoice outstanding
4. Fully settled invoice: no reminder
5. Fully credited invoice: no reminder
6. Credit/debit-adjusted invoice: reminder uses current legal outstanding
7. No duplicate reminders across `SO` and `SI` for the same exposure

## Manual Trigger

```bash
curl -i -X POST \
  "https://your-project.supabase.co/functions/v1/due-reminder-worker" \
  -H "X-Webhook-Secret: your-secret-key"
```
