# Notification event catalogue

OPS-1 introduces localisable, event-oriented notification evidence while preserving legacy title/body rows. Events contain company, resolved recipient, event type, category, safe payload, severity, canonical internal URL, occurrence/read/dismiss/resolve timestamps, and an optional deduplication key.

Initial producers cover inventory low/out/recovery transitions, Service Job completion and costing reopen, and membership activation/role/disable changes. Existing finance-document signals remain compatible. Recipients are resolved to authorised members; targeted rows cannot be read across company or user boundaries.

Preferences separate in-app and email modes for Approvals, Inventory, Orders, Service Jobs, Receivables, Payables, Users/access, Imports, Communications, and System. Critical system notices remain enabled. Email is not automatically enabled for every in-app event.

The bell shows a bounded latest set. `/notifications` provides category/unread filters, mark read/all, dismiss, timestamps, actions, and mobile cards. Unknown events fall back to safe legacy copy; raw event types, UUIDs, SQL errors, provider errors, and external URLs are not shown.
