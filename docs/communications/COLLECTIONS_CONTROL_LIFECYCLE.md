# Collections control lifecycle

COMMS-3C governs whether adaptive customer payment reminders may leave StockWise. Financial amounts, due dates, settlements, credits, and active receivable anchors remain authoritative in the maintained finance read models; a collections control never posts or adjusts financial evidence.

## Current control

`ar_collection_controls` keeps at most one current company-scoped state per Sales Order exposure chain. A missing row means `active`, so historical exposures do not need backfill. The active anchor may move from the Sales Order to an issued Sales Invoice without changing the chain or creating a second control.

| State | External reminders | Internal follow-up | Exit |
|---|---|---|---|
| `active` | Adaptive stage rules apply | Next stage remains visible | User control, settlement, or credit resolution |
| `paused` | Suppressed with `collection_paused` | Owner, pause expiry, and next action remain visible | Expiry or explicit reactivation/other control |
| `disputed` | Suppressed with `collection_disputed` | Owner and dispute follow-up remain visible | Governed resolution; financial balance changes only through finance evidence |
| `promise_to_pay` | Suppressed with `promise_open` | Promise due/evaluation remains visible | Kept closes when resolved; partial/broken becomes manual follow-up; revision/cancellation is governed |
| `manual_follow_up` | Suppressed with `manual_follow_up_required` | Assigned owner and due action remain visible | Completion selects the next governed state |
| `closed` | Never eligible | Closure evidence remains in the timeline | A new exposure requires separate authority |

MANAGER, ADMIN, and OWNER roles mutate controls through RPCs. VIEWER is read-only and OPERATOR cannot mutate controls. RPCs enforce company membership, optimistic versions, idempotency keys, fixed search paths, and current authoritative anchor state. Tables use RLS and FORCE RLS; direct authenticated mutations are revoked.

## Immutable events and promises

`ar_collection_control_events` is append-only. It records state changes, anchor movement, promise outcomes, manual follow-up, and settlement closure with snapshots, actor, timestamp, and a company-scoped idempotency key. Corrections are later events.

`ar_payment_promises` stores operational promises only. An open promise is unique per exposure chain; amount must be positive and cannot exceed current authoritative outstanding. A revision supersedes the previous promise. Promises never change a due date, post a payment, settle a document, or create accounting evidence.

The evaluator uses company-local dates and authoritative settlement and credit deltas since recording:

- `kept`: the exposure is resolved or qualifying settlement/credit covers the promised amount;
- `partially_kept`: positive qualifying evidence is below the promise while a balance remains;
- `broken`: the promised date passed with no qualifying coverage and a balance remains;
- `cancelled`: a governed actor supplies a reason;
- `superseded`: a revised promise replaces the open version.

Partial and broken outcomes require manual follow-up and never trigger an automatic aggressive customer email.

The service-role evaluator accepts an optional promise identifier. Workers omit it and evaluate all eligible company promises; controlled production QA supplies it so a future-date check is restricted to one clearly synthetic promise and cannot evaluate unrelated company records.

## Reminder integration

The adaptive builder resolves controls before returning candidates. The worker also rechecks the authoritative control immediately before provider submission, closing the queue-to-send race. Pending, failed, or processing stages are superseded when control leaves `active`; accepted provider evidence is immutable. On reactivation, the existing COMMS-3B selector chooses at most the latest relevant unsent stage—missed stages never cascade.

Stage evidence records eligibility, skip reason, control ID/version, promise ID, and evaluation time. Full settlement or credit closes the control, supersedes pending stages, and prevents future external reminders. Issuing an invoice moves the same chain control and prevents the Sales Order from bypassing suppression.

## Product surfaces

The active Sales Invoice detail shows the collections panel after invoice issuance. The Sales Order detail shows it only while the order is the active financial anchor. Guided EN/PT dialogs explain reminder suppression and that disputes/promises do not change balances. The timeline combines immutable control events and reminder evidence without exposing raw IDs or event enums.

Customer Performance and Receivables can display and filter collection state, owner, next action, promise, dispute, overdue days, and last accepted reminder. These fields do not alter financial totals.

Targeted notification events cover expiring/expired pauses, dispute follow-up, promise due/outcomes, manual follow-up, and settlement closure. They target the owner, or eligible managers when no owner exists, with canonical active-document links and deduplication keys.

## Operations and QA

Monitor suppressed-stage reasons separately from provider failure. A suppressed reminder is a successful governance decision, not a mail failure. Monitor evaluation failures, stale follow-ups, notification creation failures, and stages stuck in processing. The protected Template Lab can preview active and suppressed synthetic scenarios; suppressed customer states cannot invoke send mode.

Production QA uses only `OPS-QA-COLLECTIONS-` records in the authorised company and recipient. Capture control, promise, event, stage, skip, notification, and authoritative settlement evidence. Do not use disputes or promises to mutate finance state, and do not send a customer email merely to prove suppression.
