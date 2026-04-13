# Finance Phase Tracker

Use this file as the working status board for finance-document implementation. Update it after each material change.

## Phase Summary

| Phase | Status | Owner / Execution Area | Primary Outcome | Notes |
|---|---|---|---|---|
| Phase 1. Permissions and approval controls | Completed | Frontend + DB policy / workflow | Sensitive finance actions follow explicit authority and state locks | Draft preparation, approval gating, finance-authority actions, and DB-side enforcement are now in place for the current role model |
| Phase 2. Audit trail and document-chain visibility | Completed | Frontend + DB event/read model | Every finance document can be traced through its adjustment and settlement chain | Core AR/AP detail, order-chain surfaces, structured reasons, and actor-aware journals are live |
| Phase 3. Reconciliation and month-close readiness plus operational clarity | Active | Finance read models + review UI + inventory/assembly UX | Finance can reconcile current legal balances, work month-close exceptions, and operate from clearer stock/master-data flows | Phase 3A and 3B are now implemented in core scope; Phase 3C is planned next for time-oriented assembly planning |
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
| Explicit role-action matrix for AR/AP documents | Completed | Product + frontend + DB | Org roles, current actions inventory | `src/lib/permissions.ts`, `src/pages/SalesInvoiceDetail.tsx`, `src/pages/VendorBillDetail.tsx`, `src/pages/Settlements.tsx`, `src/pages/Cash.tsx`, `src/pages/Settings.tsx`, org hooks | Yes | Yes | Role-by-role action smoke test | Current model uses company roles: `OPERATOR+` prepares drafts and submits approval; `ADMIN+` approves, issues/posts, voids, adjusts, settles, and changes due-reminder policy |
| Separation of duties for operational vs finance users | Completed | Product + DB policy | Role matrix | Same as above plus policy/trigger helpers | Yes | Yes | Unauthorized action rejection in UI and DB | Operations may prepare/edit drafts. Finance authority is required for legal issue/post, void, adjustment, settlement-sensitive work, and due-reminder policy |
| Approval gating for AR issue / AP post / adjustment documents | Completed | Workflow + DB | Role matrix, document states | Invoice / vendor-bill helpers and pages | Yes | Yes | Draft -> pending approval -> approved -> issue/post flow | Base legal documents now require approval before issue/post. Adjustment documents remain finance-authority-only in Phase 1 rather than adding a second approval layer |
| Sales invoice issue-time readiness and controlled preparation | Completed | Frontend + DB + compliance model | Approval gating, Mozambique issue validators | `src/pages/SalesInvoiceDetail.tsx`, `src/lib/mzFinance.ts`, sales-invoice issue RPC helpers, issue-prep/readiness functions | Yes | Yes | Validate exact blocked invoice and a real approved happy-path issuance | Root cause was not approval mismatch. The live blocker was missing seller snapshot data because the company master lacked `tax_id`, plus approved exempt drafts could not persist `vat_exemption_reason_text` after approval. The UI now shows readiness blockers before issue, and the narrow issue-prep path can backfill legal snapshots and exemption wording without reopening draft edit mode. |
| State-locking and edit-locking after issue/post | Completed | DB + frontend | Existing hardening guards | `src/lib/mzFinance.ts`, finance-document pages, relevant triggers/functions | Already live | Already live | Attempt post-issue/post edits and confirm rejection | This is already part of the live foundation and should remain non-negotiable |
| UI action visibility rules vs DB enforcement rules | Completed | Frontend + DB | Role matrix | Detail pages, action buttons, RPC/trigger guards | Yes | Yes | Compare hidden actions with DB rejection behavior | The UI now hides/restricts finance-sensitive actions by role, while DB triggers/RPCs block the same actions if attempted directly |
| Threshold approvals / escalation | Not started | Product + finance workflow | Approval gating | TBD | TBD | TBD | Threshold-based approval scenarios | Intentionally deferred from Phase 1. The first enforceable model uses the existing role system without amount-based escalation |

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
| Per-document event journal coverage | Completed | DB + frontend | Event capture conventions | `finance_document_events`, finance-document triggers, detail pages | Yes | Yes | Verify who/when/state transitions per document type | Header lifecycle events, parent adjustment events, and settlement-linked events now land in the shared finance journal, with UI fallback synthesis for older rows created before full coverage |
| AR chain visibility: SO -> SI -> credit/debit notes -> settlements | Completed | Frontend + state helpers | Stable links and views | `src/pages/Orders/SalesOrders.tsx`, `src/pages/SalesInvoiceDetail.tsx`, `src/pages/Settlements.tsx` | No new core impact expected | Yes | End-to-end navigation and state consistency | Sales-order detail now surfaces the active anchor; sales-invoice detail now shows chain cards, structured reasons, and actor-aware journals |
| AP chain visibility: PO -> VB -> supplier credit/debit notes -> payments | Completed | Frontend + state helpers | Stable links and views | `src/pages/Orders/PurchaseOrders.tsx`, `src/pages/VendorBillDetail.tsx`, `src/pages/Settlements.tsx` | Yes | Yes | End-to-end navigation and state consistency | Purchase-order detail now surfaces the linked vendor-bill bridge; vendor-bill detail now shows chain cards, structured reasons, and actor-aware journals. The PO surfaces now use one vendor-bill action state across list/detail views. Corrected rule: receipt status is operational only and does not block AP billing; one Vendor Bill per PO remains the current policy, so approved POs with positive purchased value raise a bill when none exists and open the existing draft/posted bill when one does. |
| Structured reason codes and adjustment reasons | Completed | DB + frontend | Adjustment flows | AR/AP note helpers, detail pages, finance audit helpers | Yes | Yes | Reason required/visible in document and audit trail | AR and AP adjustment flows now require a structured reason code plus optional narrative detail, and the chosen reason is visible in chain and table surfaces |
| Audit visibility in UI | Completed | Frontend | Event journal coverage | Sales/Vendor detail pages, order detail sheets | No | Yes | Detail-page audit sections, timestamps, actors, action exposure | Activity journals now render human-readable titles, actor identity, timestamps, settlement events, and related-document actions instead of raw event keys only |
| Document output language behavior | Completed | Frontend + compliance/output model | Locale/source-of-truth decision | `src/lib/mzInvoiceOutput.ts`, `src/lib/financeDocumentOutput.ts`, `src/lib/financeDocumentOutputLanguage.ts`, `src/lib/i18n.tsx`, `src/pages/Settings.tsx`, `src/pages/MozambiqueCompliance.tsx` | No DB change required in the final rule | Yes | Issue/download in `pt` and `en`, compare output language | Implemented rule: use stored document language snapshot first; otherwise fall back to the current app/document language for output generation |
| Design principles for traceability | Completed | Documentation + product | All above | This roadmap folder, runtime docs | No | No | Review against implemented screens | Implemented rule: every user-visible finance number on the touched surfaces must explain itself through original amount, adjustments, settlements, current legal amount, and outstanding position |

## Phase 3. Reconciliation and Month-Close Readiness

### Purpose

Provide finance users with the bridge logic and review surfaces needed to reconcile balances and close periods confidently.

### Dependencies

- stable AR/AP current-legal state views
- Phase 2 document-chain visibility
- settled/outstanding consistency against active finance anchors

### Programme Structure

- Phase 3A. Reconciliation and month-close readiness
- Phase 3B. Operational UX clarity on confusing workflow/master-data pages
- Phase 3C. Assembly planning enhancement with time-oriented production logic

### Phase 3A Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| AR bridge: original total, credits, debits, current legal total, receipts, outstanding | Completed | DB views + frontend | `v_sales_invoice_state`, settlement anchor model | `v_sales_invoice_state`, invoice detail, settlements, reconciliation views | Yes | Yes | Compare invoice detail, settlements, and review register | AR bridge now resolves from DB-backed finance anchors and is visible in both operational and controller surfaces |
| AP bridge: original total, supplier credits, supplier debits, current legal total, payments, outstanding | Completed | DB views + frontend | `v_vendor_bill_state`, AP adjustment model | `v_vendor_bill_state`, vendor bill detail, settlements, reconciliation views | Yes | Yes | Compare vendor-bill detail, settlements, and review register | AP bridge now resolves from DB-backed finance anchors and is visible in both operational and controller surfaces |
| Aging based on current legal outstanding | Completed | Finance read model + frontend | Stable bridge logic | `v_finance_reconciliation_review`, Settlements, detail pages | Yes | Yes | Aging buckets after adjustments and settlements | Aging now uses legal outstanding after credits/debits/settlements, and resolved rows no longer present as overdue |
| Exception queues | Completed | Finance workspace | Aging and bridge logic | `v_finance_reconciliation_exceptions`, Settlements, detail pages | Yes | Yes | Exceptions surface correctly and are actionable | Current coverage includes negative bridge values, over-settlement, missing due/counterparty data, broken anchor chains, duplicate supplier refs, and approved-draft invoice issue blockers |
| Finance review screens | Completed | Frontend | Bridge logic, exception rules | Settlements, SalesInvoiceDetail, VendorBillDetail | Yes | Yes | Review workflow smoke test | Settlements now carries a dedicated reconciliation workspace. Detail pages surface due/aging/review/exception context from the same view model |
| Month-close reporting needs | In progress | Finance + reporting | Bridge logic and review screens | Current read model, future reporting/export stack | Base read model now yes | Limited current UI | Controller review against live anchors and exceptions | The close-ready read model is now in place. Formal close-pack exports and reporting packs remain follow-up work, not blockers for 3A |
| Due reminders logic review and redesign | Completed | Workflow + reminders | Settlement-anchor rule, AR bridge | `docs/due-reminders.md`, `supabase/functions/due-reminder-worker/index.ts`, due-reminder RPCs/migrations, `src/pages/Settings.tsx` | Yes | Yes | SO-only reminder, SI reminder, settled/credited suppression, mixed adjustment reminder checks | Implemented rule: reminder anchor becomes `SI` once a sales invoice is issued; only remain on `SO` if no issued invoice exists |

### Phase 3B Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| Assembly page operational clarity redesign | Completed | Frontend + ops workflow | Stable BOM/build RPCs, current stock sufficiency signals | `src/pages/BOM.tsx`, related assembly helpers | No finance-anchor change; uses the new item-profile read model for clearer stock context | Yes | Guided assembly workflow smoke test with sufficient and insufficient stock | The page is now organized around build target, planning inputs, component sufficiency, limiting factor, readiness, and execution. Avoidable invalid build attempts are blocked in the UI before the RPC call, without changing inventory posting rules. |
| Items page master-data clarity redesign | Completed | Frontend + inventory model | Stable item master rules | `src/pages/Items.tsx`, `src/lib/itemProfiles.ts`, `public.items`, `public.items_view` | Yes | Yes | Item create/edit guidance validation and post-create lock check | Added a lightweight operational item-profile model (`primary_role`, stock tracking, buy/sell flags, assembly flag) so users can classify resale items, raw materials, assembled products, finished goods, and services explicitly. Post-create editing remains limited to `min_stock` in normal operations. |
| Phase 3B continuity check against stock/costing/document assumptions | Completed | Frontend + DB read model | Existing inventory and finance anchors | `public.items_view`, `src/pages/BOM.tsx`, `src/pages/Items.tsx` | Yes | Yes | Validate builds, item create/edit, and no contradiction with Phase 3A surfaces | Phase 3A bridge logic was not reopened. The only dependency fix was adding item-profile/readiness context through `items_view` so Assembly and Items can show stock-facing meaning without altering finance anchors, settlement anchors, or costing policy. |

### Phase 3C Tracker

| Work Item | Status | Owner / Area | Dependencies | Affected Modules | DB Impact | Frontend Impact | Validation Required | Notes |
|---|---|---|---|---|---|---|---|---|
| Assembly time-per-unit model | Planned | Product + inventory/assembly model | Phase 3B assembly clarity | BOM/item models, planning helpers | Likely yes | Yes | Time-based planning calculations | Add practical `time_per_unit`, optional setup time, and normalized time units without full ERP scheduling. This now plugs into the new Assembly planning/time-estimate section rather than a raw execution-only page. |
| Available-hours planning on Assembly page | Planned | Frontend + planning helpers | Time-per-unit model | `src/pages/BOM.tsx` | Maybe | Yes | Estimate output from time and stock | Users should estimate how many units fit in available hours and how long a planned build will take. This depends on the new 3B planning structure being stable first. |
| Time-based limiting-factor visibility | Planned | Frontend + planning helpers | Above two items | Assembly UI, planning summaries | Maybe | Yes | Stock-vs-time limiting-factor smoke test | Planning should show whether stock or available work time is the binding constraint for the target build. |

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
