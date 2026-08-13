# Due Reminder System

## OPS-1 template authority

The worker selects Sales Invoice versus Sales Order using the active receivable anchor, then renders the versioned `due_reminder_sales_invoice` or `due_reminder_sales_order` template in EN/PT. Paid/settled documents remain excluded, retries and stale-processing recovery remain queue governed, and MZN is displayed code first. Dispatch audit stores template/version/provider metadata rather than rendered HTML.

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
4. the Settings page for the shared company warning schedule and separate delivery-channel controls

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

- internal receivables alerts enable/disable
- customer-facing email reminders enable/disable
- timezone
- send time
- lead days before/on/after due date
- internal BCC recipients

Internal receivables alerts are evaluated by PostgreSQL Cron and write only to the StockWise notification feed. They do not call the due-reminder Edge Function, Brevo, SMTP, or another external provider. Customer-facing reminder email remains a distinct worker/channel. Both channels reuse the same company timezone and configured due offsets, while each user controls the Receivables in-app category through notification preferences.

Malformed company offset data falls back to the maintained default for that company only; it cannot abort evaluation for other companies. A configured stage creates one alert per eligible recipient. Subsequent company evaluations refresh that active cohort from authoritative receipt allocations even on a non-stage day, without generating a daily duplicate.

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

## COMMS-3 adaptive lifecycle

Configured offsets use positive values before due, zero for due today, and negative values after due. Existing company offsets are preserved. The recommended `7, 3, 1, 0, -3, -15, -30` preset is applied only by an explicit Settings action.

`build_adaptive_due_reminder_batch(...)` retains `build_due_reminder_batch(...)` as the active-anchor and outstanding-balance authority. It selects only the latest crossed configured stage: missed stages never cascade and at most one currently relevant stage is returned for an anchor. The worker rechecks eligibility immediately before send.

`app.due_reminder_stage_dispatches` records one logical stage for company, anchor, due-date snapshot, offset, recipient, and language. Atomic reservation prevents concurrent workers from sending the same stage. Accepted stages cannot be reclaimed; failed or stale processing retries the same row. A due-date change creates a new version and supersedes unfinished stages for the former date.

Tone mapping is friendly at seven or more days before due, gentle urgency before due, action required on the date, overdue through seven days late, and escalated thereafter. EN/PT subjects and body copy use the exact relative state without threats or unsupported legal claims.
