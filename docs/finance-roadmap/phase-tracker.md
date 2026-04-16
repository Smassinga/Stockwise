# Finance Phase Tracker

Use this file as the working status board for finance-document implementation and the adjacent access-control platform work. Update it after each material change.

## Phase Summary

| Phase | Status | Owner / Execution Area | Primary Outcome | Notes |
|---|---|---|---|---|
| Phase 1. Permissions and approval controls | Completed | Frontend + DB policy / workflow | Sensitive finance actions follow explicit authority and state locks | Draft preparation, approval gating, finance-authority actions, and DB-side enforcement are live |
| Phase 2. Audit trail and document-chain visibility | Completed | Frontend + DB event/read model | Every finance document can be traced through its adjustment and settlement chain | Core AR/AP detail, order-chain surfaces, structured reasons, and actor-aware journals are live |
| Phase 3. Reconciliation, operational clarity, and lightweight planning | Completed in core scope | Finance read models + review UI + inventory/assembly UX | Finance can reconcile current legal balances, work exceptions, and operate from clearer stock/master-data and assembly-planning flows | Phase 3A, 3B, and 3C are complete in core scope; close-pack/reporting remains later follow-up |
| Operational hardening block | Completed | Workflow repair + treasury/master-data UX | High-friction production defects were repaired before broader automation | Bank, landed cost, PO/VB, SO/SI, issue readiness, treasury, and UOM flows were stabilized |
| Phase 4. Automated finance regression suite | Completed in core scope | Test automation + Supabase workflow validation | High-value finance and ops workflows now have repeatable regression protection | Current suite runs through `npm run test:finance-regression` |
| Phase 5. Security, abuse protection, access control, trial enforcement, and subscription-control foundation | Implemented in foundation scope and Phase 5B core scope | DB control plane + app routing + public commercial surfaces | Tenant access, manual activation, trial lifecycle, brand clarity, and public commercial posture now have a real foundation | Payment automation remains intentionally deferred |

## Phase 1. Permissions and Approval Controls

| Work Item | Status | Notes |
|---|---|---|
| Explicit role-action matrix for AR/AP documents | Completed | `OPERATOR+` prepares drafts and submits approval; `ADMIN+` approves, issues/posts, voids, adjusts, settles, and changes due-reminder policy |
| Separation of duties for operational vs finance users | Completed | Operations prepare; finance authority issues/posts legal docs and handles sensitive adjustments/settlements |
| Approval gating for AR issue / AP post | Completed | Base legal documents move through draft -> pending approval -> approved -> issue/post |
| Sales invoice issue-time readiness and controlled preparation | Completed | UI surfaces DB issue blockers before issue RPC; narrow legal preparation path exists for snapshot/exemption wording |
| State-locking and edit-locking after issue/post | Completed | Issued/posted documents stay immutable apart from allowed legal follow-up actions |
| UI action visibility vs DB enforcement parity | Completed | Restricted actions are hidden in UI and also blocked in DB |

## Phase 2. Audit Trail and Document-Chain Visibility

| Work Item | Status | Notes |
|---|---|---|
| Per-document event journal coverage | Completed | Shared finance journal plus fallback synthesis for older records |
| AR chain visibility | Completed | `SO -> SI -> customer credit/debit notes -> settlements` |
| AP chain visibility | Completed | `PO -> VB -> supplier credit/debit notes -> payments` |
| Structured reason codes and adjustment reasons | Completed | Reason code plus optional narrative detail |
| Audit visibility in UI | Completed | Actor, timestamp, transition, related-doc, and settlement events render on touched detail pages |
| Document output language behavior | Completed | Snapshot-first bilingual output across HTML, PDF, print, and share |

## Phase 3. Reconciliation, Operational Clarity, and Lightweight Planning

### Phase 3A

| Work Item | Status | Notes |
|---|---|---|
| AR bridge | Completed | Original, credits, debits, current legal, settled, and outstanding come from DB-backed anchor views |
| AP bridge | Completed | Same bridge discipline at Vendor Bill level |
| Aging based on current legal outstanding | Completed | Resolved anchors no longer look overdue |
| Exception queues | Completed | Broken bridge, missing anchor, over-settlement, issue-readiness blockers, and related anomalies are surfaced |
| Finance review screens | Completed | Settlements reconciliation workspace plus detail-page review context |
| Month-close reporting packs | In progress | Read model is ready; formal export pack layer remains later scope |

### Phase 3B

| Work Item | Status | Notes |
|---|---|---|
| Assembly page operational clarity redesign | Completed | Guided readiness-first structure |
| Items page master-data clarity redesign | Completed | Lightweight item-profile layer and safer classification |
| Continuity check against stock/costing/document assumptions | Completed | No Phase 3A reopening required |

### Phase 3C

| Work Item | Status | Notes |
|---|---|---|
| BOM-level time-per-unit model | Completed | Normalized-minute planning fields on BOM versions |
| Available-hours planning on Assembly page | Completed | Time capacity shown without turning execution into a scheduler |
| Limiting-factor visibility | Completed | Stock, time, both, or missing-time configuration |
| Missing-time-data fallback | Completed | Time remains advisory and explicit when not configured |

## Operational Hardening Block

| Work Item | Status | Notes |
|---|---|---|
| Bank-linked settlement posting repair | Completed | Canonical `bank_accounts` path restored |
| Landed-cost workflow repair | Completed | Live UUID/text mismatch removed |
| PO -> Vendor Bill progression repair | Completed | Deterministic raise/open path restored |
| Receipt-independent AP billability | Completed | Receipt state no longer suppresses Vendor Bill action |
| SO -> draft Sales Invoice repair | Completed | Minimum fiscal bootstrap restored draft creation |
| Sales Invoice issue readiness and controlled preparation | Completed | Real issue blockers surfaced before issue RPC |
| Banks / Cash / UOM operational clarity | Completed | Treasury and unit-master surfaces clarified |

## Phase 4. Automated Finance Regression Suite

| Work Item | Status | Notes |
|---|---|---|
| Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue | Completed | Success path plus blocked authority / readiness checks |
| Purchase Order -> Vendor Bill draft -> approval -> post | Completed | Draft reopen, approval, post, and blocked authority checks |
| Settlements / bank / cash continuity | Completed | Bank receive, bank pay, cash posting, and anchored settlement math |
| AR/AP bridge and reconciliation calculations | Completed | Current-legal-value bridge assertions for AR and AP anchors |
| Item/UOM dependency integrity | Completed | Finance/inventory assumptions covered through setup and mutation flows |
| BOM / assembly gating continuity | Completed | Ready build and stock-blocked path covered |
| Trial/access lifecycle regression | Completed | Trial bootstrap, expiry restriction, reactivation, and purge scheduling covered |
| Public bootstrap abuse protection | Completed | Repeated company bootstrap is rate-limited and asserted |
| Environment / CI plan | In progress | Suite is live and passing locally; CI wiring and mutation-environment discipline remain future scope |

## Phase 5. Security, Abuse Protection, Access Control, Trial Enforcement, and Subscription-Control Foundation

| Work Item | Status | Notes |
|---|---|---|
| Subscription and entitlement foundation | Completed | `plan_catalog`, `company_subscription_state`, `platform_admins`, audit log, purge queue |
| 7-day trial bootstrap and expiry model | Completed | Trial starts on company bootstrap and becomes enforceable through access helpers |
| Blocked-access route and app enforcement | Completed | Restricted tenants route to `/company-access`; backend helpers remain authoritative |
| Platform-admin manual grant/revoke control path | Completed | `platform_admin_set_company_access(...)` plus `/platform-control` |
| Auditability of access changes | Completed | `company_access_audit_log` records manual state transitions |
| Operational purge scheduling foundation | Completed | Queue and scope model implemented; destructive execution intentionally deferred |
| Security/RLS tightening for entitlement-aware access | Completed | Access helpers and policy cleanup now respect tenant access state |
| Public bootstrap abuse protection | Completed | Rate limiting added to trial bootstrap path |
| Pricing localization to MZN | Completed | Landing page now presents public pricing in MZN |
| Platform-admin discoverability and runbook | Completed | `/platform-control`, bootstrap command, and navigation visibility are now explicitly documented and easier to find for active platform admins |
| Approved StockWise brand replacement | Completed | Public shell, app shell, auth/access surfaces, PWA icons, and Tauri icons now use the approved logo assets |
| Landing-page pricing polish from 2026 workbook | Completed | Package structure, perks, grouped billing options, and real CTAs are now aligned to the MZN workbook |
| Placeholder and professional-copy audit | Completed | Stale demo/default assets and unfinished-looking user-facing copy were removed or rewritten |
| Vector SVG extraction from approved artwork | Not started | PNG-derived assets are canonical for now; SVG refinement is intentionally deferred until suitable vector tooling/source handling is available |
| Automatic payment integration | Not started | Explicitly deferred |
| Automatic paid-plan activation | Not started | Explicitly deferred |
| Automatic purge execution | Not started | Explicitly deferred |

## Notes

- Keep `Completed` reserved for work that is operationally usable, not partially coded.
- When a phase item changes the architecture guardrails, update [README.md](README.md) and [decision-log.md](decision-log.md) in the same commit.
- The current next recommended work is CI wiring for the regression suite and the next commercially necessary Phase 5 follow-up, not payment automation by default.
