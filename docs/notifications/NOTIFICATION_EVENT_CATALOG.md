# Notification event catalogue

OPS-1 introduces localisable, event-oriented notification evidence while preserving legacy title/body rows. Events contain company, resolved recipient, event type, category, safe payload, severity, canonical internal URL, occurrence/read/dismiss/resolve timestamps, and an optional deduplication key.

Initial producers cover inventory low/out/recovery transitions, Service Job completion and costing reopen, and membership activation/role/disable changes. Existing finance-document signals remain compatible. Recipients are resolved to authorised members; targeted rows cannot be read across company or user boundaries.

Receivables warning events are `receivables.due_soon`, `receivables.due_today`, `receivables.overdue`, and `receivables.severely_overdue`. They target active Owner, Admin, and Manager users only. Each event aggregates one company, customer, base currency, and configured due bucket from `v_customer_receivable_exposures`. Partial receipt allocations refresh the active aggregate in place; settlement or collection suppression resolves it without deleting history. Unapplied customer credit is shown as separate context and never subtracted from authoritative invoice outstanding.

Preferences separate in-app and email modes for Approvals, Inventory, Orders, Service Jobs, Receivables, Payables, Users/access, Imports, Communications, and System. Critical system notices remain enabled. Email is not automatically enabled for every in-app event.

The bell shows a bounded latest set. `/notifications` provides category/unread filters, mark read/all, dismiss, timestamps, actions, and mobile cards. Unknown events fall back to safe legacy copy; raw event types, UUIDs, SQL errors, provider errors, and external URLs are not shown.

Receivables actions carry both notification company and customer context. The client revalidates active membership and company access, awaits the company switch, and only then opens the customer Accounts Receivable workspace. A query-string company identifier alone is never treated as authority.

Authenticated clients cannot create or delete notification evidence directly. Database-owned producers emit notifications; normal users retain the guarded read/dismiss update contract and self-scoped category preferences. `public.notifications` is included in the Supabase Realtime publication so the existing authenticated bell can receive Postgres Changes under its RLS policies.
