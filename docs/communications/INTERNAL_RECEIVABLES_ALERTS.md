# Internal Receivables Alerts

## Purpose and authority

Internal Receivables Alerts give company decision-makers an in-app warning before customer email or another external channel is considered. They do not post receipts, settlements, credits, finance transactions, collection actions, or accounting entries.

`public.v_customer_receivable_exposures` is the only Accounts Receivable input. It already combines issued Sales Invoice authority, the bounded legacy Sales Order fallback, legacy direct settlements, customer receipt allocations, legal credit/debit effects, and collection suppression. `public.v_customer_unapplied_credit` supplies separate context only. Unapplied credit is never subtracted from invoice outstanding.

## Aggregation and lifecycle

The evaluator groups a configured warning stage by:

- company;
- customer;
- base currency;
- due-offset bucket.

The payload records the stable exposure-chain cohort, document count, authoritative aggregate outstanding, due context, and separate unapplied credit. One deduplication identity exists per recipient and company/customer/currency/bucket/business date. Repeating a scheduler window updates the same row without resetting read or dismissed state.

An active alert is refreshed from its stored exposure-chain cohort on every company evaluation, including non-stage days. A partial allocation therefore updates amount, count, due position, and credit context without producing a daily duplicate. Full settlement, authorised collection suppression, recipient ineligibility, or a disabled Receivables preference resolves the alert while preserving history.

## Schedule and recipients

The shared company warning schedule uses `dueReminders.timezone`, `sendAt`, and `leadDays`. Internal alerts require the explicit `dueReminders.internalAlertsEnabled` company setting. Customer email uses the separate `dueReminders.enabled` setting.

PostgreSQL Cron polls every 15 minutes and evaluates a company during the hour beginning at its local configured time. Invalid timezone settings are skipped for that company. Missing, malformed, empty, oversized, or out-of-range offset data falls back to the maintained default inside that company's evaluation and cannot abort other companies.

Recipients are active company members with Owner, Admin, or Manager authority. Operator and Viewer users are not recipients. Each user can disable the Receivables in-app category through `notification_preferences`; the company schedule and the user category preference are intentionally separate.

## Presentation and navigation

The notification catalogue renders the four events in Portuguese and English:

- `receivables.due_soon`;
- `receivables.due_today`;
- `receivables.overdue`;
- `receivables.severely_overdue`.

Copy includes customer, document count, currency, outstanding total, and any separate unapplied-credit context. Colour is not the only state signal.

The action opens `/settlements?view=receipts&side=ar&customerId=<id>&companyId=<id>`. Before navigation, the client verifies that the recipient still has an active membership and enabled access, awaits `setActiveCompany(...)` when necessary, and rejects mismatched URL/company context. The customer Accounts Receivable workspace remains RLS-scoped and shows open-document and collection context from the canonical view.

## Delivery and security

This channel is independent of the due-reminder Edge Function, Brevo, SMTP, customer BCC, and customer consent. The migration adds `notifications` to the existing Supabase Realtime publication for the authenticated bell.

Normal authenticated users have no direct INSERT, DELETE, or TRUNCATE authority on `notifications`. Existing guarded read/dismiss updates remain available. Database-owned notification producers use fixed search paths and restricted execution; the legacy PO/SO approval triggers are hardened so revoking direct table writes does not break them. Preference table grants are limited to SELECT, INSERT, and UPDATE, with existing self/company RLS retained.

## Native push status

Native push is not implemented in this package. The repository has no maintained FCM, OneSignal, Web Push, device-token registry, opt-in lifecycle, or delivery-audit architecture. The current Tauri desktop/mobile shell includes dialog, filesystem, and shell plugins, but no notification or push-delivery plugin. Adding a provider name or UI toggle without those prerequisites would create a false capability. In-app Realtime delivery is the only secondary live-delivery mechanism added here.

## Validation evidence and remaining gate

Static contract tests cover canonical-source binding, aggregation, credit non-netting, recipient/preferences, deduplication, refresh/resolution, scheduler isolation, security grants, legacy emitter continuity, localisation, and access-safe navigation. The rollback-only SQL matrix covers multi-document/partial-allocation evidence, separate currencies/companies, malformed company settings, opted-out and ineligible users, read/dismiss preservation, full resolution, direct-forgery denial, and PO/SO trigger continuity.

The SQL matrix, full local migration replay, browser Realtime/deep-link QA, and hosted scheduler/advisor evidence must be recorded during the integrated master-run validation. This document must not be read as proof that a hosted migration or native push deployment occurred.
