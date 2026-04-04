# Finance Phase Tracker

Use this file as the working status board for finance-document implementation. Update it after each material change.

## Phase Summary

| Phase | Status | Owner / Execution Area | Primary Outcome | Notes |
|---|---|---|---|---|
| Phase 1. Permissions and approval controls | In progress | Frontend + DB policy / workflow | Sensitive finance actions follow explicit authority and state locks | Lifecycle hardening exists; permission matrix and approval gating are still incomplete |
| Phase 2. Audit trail and document-chain visibility | In progress | Frontend + DB event/read model | Every finance document can be traced through its adjustment and settlement chain | Event and chain surfaces exist, but coverage is not yet complete or unified |
| Phase 3. Reconciliation and month-close readiness | In progress | Finance read models + review UI + reminders | Finance can reconcile current legal balances and work month-close exceptions | Core state views exist; close-oriented workflows still need dedicated surfaces |
| Phase 4. Automated finance regression suite | Not started | Test automation + seeded validation data | Finance behavior is guarded by repeatable regression tests | Current validation is still dominated by manual smoke passes |

## Phase 1. Permissions and Approval Controls

### Purpose

Control who can draft, approve, issue, post, void, credit, debit, and settle finance-sensitive documents, with clear separation between operational users and finance users.

### Dependencies

- live finance-document lifecycle and state hardening
- reliable org role context in the app
- DB-side enforcement for post-issue/post mutability

### Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| Explicit role-action matrix for AR/AP documents | Not started | Product + frontend + DB | Org roles, current actions inventory | `src/pages/SalesInvoiceDetail.tsx`, `src/pages/VendorBillDetail.tsx`, `src/pages/Settlements.tsx`, org hooks | Likely yes | Yes | Role-by-role action smoke test | Current action availability is not yet expressed as a single authoritative matrix |
| Separation of duties for operational vs finance users | Not started | Product + DB policy | Role matrix | Same as above plus policies | Likely yes | Yes | Unauthorized action rejection in UI and DB | Prevent operations-only users from issuing/posting/adjusting legal documents without finance authority |
| Approval gating for AR issue / AP post / adjustment documents | Not started | Workflow + DB | Role matrix, document states | Invoice / vendor-bill helpers and pages | Likely yes | Yes | Draft -> approval -> issue/post flow | Current lifecycle relies on draft/issue/post state but not a full approval checkpoint |
| State-locking and edit-locking after issue/post | Completed | DB + frontend | Existing hardening guards | `src/lib/mzFinance.ts`, finance-document pages, relevant triggers/functions | Already live | Already live | Attempt post-issue/post edits and confirm rejection | This is already part of the live foundation and should remain non-negotiable |
| UI action visibility rules vs DB enforcement rules | In progress | Frontend + DB | Role matrix | Detail pages, action buttons, RPC/trigger guards | Maybe | Yes | Compare hidden actions with DB rejection behavior | The rule must be: hidden where possible, enforced in DB always |
| Threshold approvals / escalation | Not started | Product + finance workflow | Approval gating | TBD | TBD | TBD | Threshold-based approval scenarios | Leave configurable only if genuinely required; do not add arbitrary complexity by default |

## Phase 2. Audit Trail and Document-Chain Visibility

### Purpose

Make the full legal/financial chain visible and explainable for every finance document.

### Dependencies

- Phase 1 action control decisions
- event journal model
- stable document-chain links and settlement-anchor views

### Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| Per-document event journal coverage | In progress | DB + frontend | Event capture conventions | `finance_document_events`, detail pages, compliance page | Maybe | Yes | Verify who/when/state transitions per document type | Sales invoice and vendor bill visibility exists, but coverage should be confirmed across all adjustment types |
| AR chain visibility: SO -> SI -> credit/debit notes -> settlements | In progress | Frontend + state helpers | Stable links and views | `src/pages/Orders/SalesOrders.tsx`, `src/pages/SalesInvoiceDetail.tsx`, `src/pages/Settlements.tsx` | No new core impact expected | Yes | End-to-end navigation and state consistency | Core chain is live but still needs a clearer unified chain presentation |
| AP chain visibility: PO -> VB -> supplier credit/debit notes -> payments | In progress | Frontend + state helpers | Stable links and views | `src/pages/Orders/PurchaseOrders.tsx`, `src/pages/VendorBillDetail.tsx`, `src/pages/Settlements.tsx` | No new core impact expected | Yes | End-to-end navigation and state consistency | AP parity improved materially, but chain presentation still needs polish and explicitness |
| Structured reason codes and adjustment reasons | In progress | DB + frontend | Adjustment flows | AR/AP note helpers and detail pages | Maybe | Yes | Reason required/visible in document and audit trail | Free-text reasons exist; structured code strategy still needs completion |
| Audit visibility in UI | In progress | Frontend | Event journal coverage | Detail pages, compliance views | No | Yes | Detail-page audit sections, filters, clarity | Current visibility is useful but still fragmented |
| Document output language behavior | Completed | Frontend + compliance/output model | Locale/source-of-truth decision | `src/lib/mzInvoiceOutput.ts`, `src/lib/financeDocumentOutput.ts`, `src/lib/financeDocumentOutputLanguage.ts`, `src/lib/i18n.tsx`, `src/pages/Settings.tsx`, `src/pages/MozambiqueCompliance.tsx` | No DB change required in the final rule | Yes | Issue/download in `pt` and `en`, compare output language | Implemented rule: use stored document language snapshot first; otherwise fall back to the current app/document language for output generation |
| Design principles for traceability | In progress | Documentation + product | All above | This roadmap folder, runtime docs | No | No | Review against implemented screens | Key principle: every user-visible number should be explainable back to original + adjustments + settlements |

## Phase 3. Reconciliation and Month-Close Readiness

### Purpose

Provide finance users with the bridge logic and review surfaces needed to reconcile balances and close periods confidently.

### Dependencies

- stable AR/AP current-legal state views
- Phase 2 document-chain visibility
- settled/outstanding consistency against active finance anchors

### Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| AR bridge: original total, credits, debits, current legal total, receipts, outstanding | In progress | DB views + frontend | `v_sales_invoice_state`, settlement anchor model | `v_sales_invoice_state`, invoice detail, settlements | Already partly live | Yes | Compare invoice detail, settlements, cash, bank | Core calculations exist; finance review/report presentation still needs completion |
| AP bridge: original total, supplier credits, supplier debits, current legal total, payments, outstanding | In progress | DB views + frontend | `v_vendor_bill_state`, AP adjustment model | `v_vendor_bill_state`, vendor bill detail, settlements | Already partly live | Yes | Compare vendor-bill detail, settlements, cash, bank | Core calculations exist; finance review/report presentation still needs completion |
| Aging based on current legal outstanding | Not started | Finance reporting | Stable bridge logic | Finance reporting / dashboard surfaces TBD | Likely yes | Likely yes | Aging buckets after adjustments and settlements | Aging must use current legal outstanding, not stale original totals |
| Exception queues | Not started | Finance workspace | Aging and bridge logic | New finance review surfaces | Likely yes | Yes | Exceptions surface correctly and are actionable | Examples: over-settlement attempts, orphan adjustments, missing supplier refs |
| Finance review screens | Not started | Frontend | Bridge logic, exception rules | Settlements or new finance review route | Maybe | Yes | Review workflow smoke test | Decide whether to extend Settlements or create a dedicated close workspace |
| Month-close reporting needs | Not started | Finance + reporting | Bridge logic and review screens | Reporting stack TBD | Likely yes | Likely yes | Close pack and period reporting checks | Must cover AR/AP movement and ending outstanding by current legal value |
| Due reminders logic review and redesign | Not started | Workflow + reminders | Settlement-anchor rule, AR bridge | `docs/due-reminders.md`, `supabase/functions/due-reminder-worker/index.ts`, due-reminder RPCs/migrations, `src/pages/Settings.tsx` | Yes | Maybe | Reminder routing before/after invoice issuance | Required rule: reminder anchor becomes `SI` once a sales invoice exists; only remain on `SO` if no invoice exists |

## Phase 4. Automated Finance Regression Suite

### Purpose

Replace fragile manual-only validation with repeatable finance regression coverage.

### Dependencies

- stable workflows and validation rules from Phases 1-3
- reliable seeded test data strategy
- defined non-production validation environment

### Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| Invoice issue/post flows | Not started | Test automation | Stable issue flow | AR helpers, invoice detail, issue RPC | No production-model change | No | Automated pass/fail with seeded drafts | Covers issuance prerequisites and immutable post-issue behavior |
| Vendor-bill posting flows | Not started | Test automation | Stable AP post flow | AP helpers, vendor-bill detail | No production-model change | No | Automated pass/fail with seeded drafts | Must cover posted-anchor behavior |
| Settlement re-anchoring | Not started | Test automation | Stable state views | Settlements, cash, bank, state views | No production-model change | No | SO->SI and PO->VB re-anchor checks | Prevent duplicate exposure regressions |
| Partial and cumulative credit notes | Not started | Test automation | Stable AR adjustments | Sales invoice detail and DB helpers | No production-model change | No | Multiple-note cumulative blocking and totals | Must cover over-credit rejection |
| Partial and cumulative debit notes | Not started | Test automation | Stable AR adjustments | Sales invoice detail and DB helpers | No production-model change | No | Multiple-note cumulative debit and totals | Must cover mixed credit/debit chains |
| Supplier credit/debit note flows | Not started | Test automation | Stable AP adjustments | Vendor bill detail and DB helpers | No production-model change | No | Full + partial AP adjustment coverage | Must cover cumulative supplier credit blocking |
| Outstanding/current legal amount calculations | Not started | Test automation | Stable state views | AR/AP state views and detail pages | No production-model change | No | Golden-value checks across screens | Same numbers must resolve consistently on every surface |
| Over-credit / over-debit blocking | Not started | Test automation | Stable DB validations | Adjustment triggers/functions | No production-model change | No | Negative-path tests | Reject incoherent quantities, tax, and value overages |
| Void restrictions | Not started | Test automation | Stable permission/lifecycle rules | Issue/post/void actions and guards | No production-model change | No | Attempt invalid void paths | Should block voids that contradict finance history |
| Test data strategy | Not started | QA + engineering | All above | Seed scripts / fixtures TBD | Maybe | No | Reusable data packs | Build reusable tenants/scenarios rather than ad hoc smoke data |
| Environment plan | Not started | Engineering | All above | CI and validation environment | No | No | Documented environment matrix | Define where finance regression is allowed to mutate data |

## Notes

- Update this tracker after each completed rollout, not only after large milestones.
- Keep `Completed` reserved for items that are operationally usable, not partially coded.
- If a phase item changes the architecture guardrails, update [README.md](README.md) and [decision-log.md](decision-log.md) in the same commit.
