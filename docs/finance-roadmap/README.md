# Finance Document Roadmap

## A. Overview

This roadmap is the durable execution guide for the finance-document platform and the surrounding control-plane work that now governs tenant access, trials, and regression safety.

Use this folder to preserve:

- roadmap intent across sessions
- current implementation status
- phase dependencies
- architecture guardrails
- open decisions
- implementation notes that should not be rediscovered repeatedly

The detailed phase tracker lives in [phase-tracker.md](phase-tracker.md). The running decision log lives in [decision-log.md](decision-log.md).

## B. Current State Summary

Operational and finance foundations already in place:

- `sales_orders` and `purchase_orders` remain operational/commercial documents
- `sales_invoices` and `vendor_bills` are the legal/financial settlement anchors once issued or posted
- pre-finance settlements re-anchor from `SO` to `SI` and from `PO` to `VB`
- AR supports issuance plus credit notes and debit notes, including partial and cumulative adjustment chains
- AP supports vendor bills plus supplier credit notes and supplier debit notes, including partial and cumulative adjustment chains
- finance-document output is snapshot-backed and language-driven with `pt` / `en` support
- finance documents surface actor-aware activity journals, linked document chains, structured adjustment reasons, and settlement events
- invoice issue readiness is explicit before Mozambique issue RPC execution
- PO billing is independent from stock receipt state
- AR/AP reconciliation uses DB-backed bridge views and controller-grade review surfaces
- Items and Assembly now use clearer operational UX, and Assembly has lightweight BOM-level time planning
- bank, cash, and UOM surfaces were hardened and clarified after Phase 3

Hardening and control-plane foundations now also exist:

- the Supabase repo now runs from a canonical baseline plus forward migrations, with `npm run check:migrations` guarding against accidental synthetic pull artifacts
- the first post-baseline cleanup removed legacy duplicate schema structures so membership/access and stock truth now point to one canonical model each
- a real automated finance regression suite is in repo and passing
- tenant access now uses subscription and entitlement state, not membership alone
- new-company trial bootstrap starts a 7-day trial
- expired, suspended, and disabled tenants are blocked by backend access helpers and app routing
- manual paid activation is handled through a platform-admin control plane, not raw DB edits as the intended operating model
- operational purge can be scheduled for expired trial tenants while retaining auth credentials
- platform control now shows created date, canonical owner, member counts, and the latest recorded sign-in signal for each company
- platform admins can now run a guarded operational reset that preserves identity and control-plane records while clearing company business data
- Platform Control now counts disabled companies correctly in the status summary instead of hiding them behind a suspended-only aggregation
- inbound activation/support contact is now centralized on `support@stockwiseapp.com`
- Platform Control now previews and sends professional company access emails using the canonical company recipient and a separate support inbox
- public pricing is now presented in MZN on the landing page
- platform-admin access is now explicitly documented and visible only to active platform admins
- the approved StockWise logo now drives the public brand, app shell, PWA icons, and Tauri packaging icons
- the landing page pricing structure now follows the 2026 MZN workbook with clearer package breakdown and real CTAs
- public and authenticated pages have had a professional placeholder/copy audit to remove unfinished-looking text and stale demo assets
- the authenticated shell now has a clearer Android/mobile bottom-navigation path for the most-used routes
- a dedicated Operator workspace now supports fast daily stock issue and simple sale with a default walk-in/cash customer
- Point of Sale now uses professional naming in the shell and route metadata, and sellable items expose a default sell price on item setup for operator prefilling
- opening-data import now supports practical go-live setup for items, counterparties, locations, and current stock without pretending to migrate historical documents
- repo current-truth docs were tightened again after the canonical-baseline cleanup so Tauri release notes, Android/mobile guidance, and current product surfaces match the live app instead of older intermediate states

## C. Architecture Guardrails

These rules must not be broken by future work:

1. Finance-document truth
   - `SO` and `PO` are operational documents.
   - `SI` and `VB` become the finance/legal truth once issued or posted.
   - Reminders, settlements, balances, and exposure must follow the active finance anchor once it exists.

2. Adjustment-document model
   - issued/post documents are not edited in place for legal value changes
   - corrections flow through credit/debit note chains
   - `current legal amount = original - credits + debits`

3. Snapshot-backed output
   - issued/downloaded output renders from frozen document snapshots
   - snapshot language wins over mutable runtime language once the legal document exists

4. No duplicate exposure
   - balances due, settled amount, credited amount, debited amount, current legal amount, and outstanding amount must resolve from one active chain only

5. Receipt is not billing
   - physical receipt of PO stock is not AP billing completion
   - receipt completion must not suppress Vendor Bill creation when the PO is still billable

6. Access control is not UI-only
   - authentication, membership, and entitlement state are separate concerns
   - frontend route guards mirror backend access helpers; they do not replace them

7. Manual activation now, automation later
   - pricing is public
   - paid activation is manual for now
   - future payment automation must reuse the same control-plane model instead of redesigning entitlement state

8. Repo-first execution tracking
   - roadmap tracking belongs in repo documentation first
   - internal control-plane continuity belongs in repo docs even when restricted UI/admin routes also exist

## D. Phase Roadmap

| Phase | Purpose | Why It Matters | Current Status | Depends On |
|---|---|---|---|---|
| Phase 1 | Permissions and approval controls | Finance actions need explicit authority, separation of duties, and post-issue discipline | Completed | Current finance-document lifecycle baseline |
| Phase 2 | Audit trail and document-chain visibility | Finance users need coherent traceability across original documents, adjustments, and settlements | Completed | Phase 1 controls |
| Phase 3 | Reconciliation, operational clarity, and lightweight planning | Finance and ops need current-legal-value bridges, safer master data, and planning-ready workflows | Completed in core scope | Phase 2 traceability and stable state views |
| Operational hardening block | Repair high-friction live workflows before broader automation | Protect production reliability before wider regression enforcement | Completed | Stable Phase 1-3 architecture |
| Phase 4 | Automated finance regression suite | Stable finance and operational workflows now need repeatable regression protection | Implemented in core scope | Stable Phase 1-3 flows and post-Phase-3 hardening |
| Phase 5 | Security, abuse protection, access control, trial enforcement, and subscription-control foundation | The app now needs real tenant control, restriction, auditability, and safer public/commercial access handling | Implemented in foundation scope and Phase 5B core scope | Stable workflow controls and regression coverage |
| Phase 6 | Separated adoption workstreams: Android UX, Operator workflow, onboarding import | Product adoption now depends on general mobile usability, fast small-store issue flow, and lower-friction go-live setup, each with different constraints | Implemented in core scope as three separate workstreams | Stable Phase 3 operations, Phase 4 regression coverage, and Phase 5 control-plane foundations |

### Phase 3 close summary

Phase 3 is complete in core scope:

- Phase 3A: DB-backed AR/AP reconciliation bridges, aging by legal outstanding, exception queues, controller review surfaces
- Phase 3B: Items and Assembly operational UX clarity
- Phase 3C: BOM-level time planning with lightweight available-hours guidance

Still intentionally deferred from Phase 3:

- formal month-close close-pack exports
- full manufacturing ERP scheduling

### Operational hardening block

Completed between Phase 3 and the current access-control work:

- bank-linked settlement posting repaired
- landed-cost workflow repaired
- PO to Vendor Bill progression repaired
- receipt no longer blocks Vendor Bill billability
- SO to Sales Invoice draft creation repaired
- Sales Invoice issue readiness and controlled issue preparation implemented
- Banks, Cash, and UOM clarified operationally
- Tauri desktop and Android packaging hardened and documented

### Phase 4 implemented scope

The automated regression suite now protects:

- Sales Order -> Sales Invoice draft -> approval -> issue readiness -> issue
- Purchase Order -> Vendor Bill draft -> approval -> post
- settlements
- bank receive / pay
- cash posting
- AR/AP bridge and reconciliation calculations
- item/UOM dependency paths that affect finance and inventory correctness
- BOM / assembly gating and successful build posting
- trial/access lifecycle regression at the control-plane level
- public bootstrap abuse protection

Current implementation lives in the repo and runs through `npm run test:finance-regression`.

### Phase 5 implemented foundation scope

Implemented now:

- `plan_catalog`, `company_subscription_state`, `platform_admins`, `company_access_audit_log`, and `company_purge_queue`
- 7-day trial bootstrap through `create_company_and_bootstrap`
- backend entitlement helpers and route-level blocked-access handling
- manual grant/revoke/suspend/expire path through platform control
- auditability of admin access changes
- public bootstrap rate limiting
- public pricing in MZN

Intentionally deferred:

- automatic payment gateway integration
- webhook-driven automatic paid-plan activation
- self-serve paid checkout
- automatic purge execution

### Phase 5B completed scope

Completed in this pass:

- platform-admin discoverability now has a documented first-admin bootstrap path plus a visible Platform navigation section only for active platform admins
- `/platform-control` remains permission-based and is documented as the canonical manual access-control route
- the approved StockWise logo replaced the old runtime brand across public pages, app shell, blocked-access/auth surfaces, PWA icons, and Tauri icon generation
- landing-page pricing now follows the 2026 MZN package workbook with clearer billing options, grouped perks, and manual-activation posture
- broad placeholder and professional-copy cleanup removed stale demo/default assets and unfinished-looking public/app text
- platform control now has a trustworthy selected-company workspace with owner/sign-in metadata and guarded operational reset
- Platform Control now has operationally correct status counters, a clear path back to the main app, and a contained selected-company dashboard layout
- company access email previews and sends are now available for expiry warning, purge warning, and paid activation confirmation
- inbound support routing and outbound company-recipient routing are now explicitly separated and documented

Current limitation:

- no true vector SVG was generated in this pass; high-quality PNG-derived assets are now canonical runtime brand assets, and SVG extraction from the approved source artwork remains a later refinement

### Phase 6 completed scope

Phase 6 is deliberately split into three separate workstreams. They share some code paths, but they are not one blended feature.

- Workstream A. Android-first UX adaptation
  - the mobile shell now prioritizes a small set of primary routes with bottom navigation
  - page spacing and action placement now support one main job per screen more consistently on Android/mobile
  - desktop usability remains intact; this is a mobile adaptation pass, not a desktop downgrade

- Workstream B. Operator page for fast daily stock issue / simple sale
  - `/operator` now exists as a dedicated high-frequency workspace for small stores
  - it defaults to the walk-in/cash customer model and only asks for a named customer when needed
  - multi-line simple sale / stock issue now posts through a dedicated backend RPC instead of forcing the full sales-order workflow
  - sellable items now expose a default sell price in item setup, Point of Sale prefills from that commercial amount, and the operator can still adjust the line price before posting
  - the current-sale review rail now uses a wider, more readable layout instead of cramped issue-book style cards

- Workstream C. Onboarding ease with import support
  - `/setup/import` now supports practical go-live imports for items, customers, suppliers, warehouses/bins, and opening stock
  - imports validate and preview before commit
  - opening stock now commits through a server-authoritative batch import path so the receive audit and resulting stock bucket stay aligned for new go-live items
  - the scope is opening/master data only; historical SO/PO/SI/VB migration remains intentionally out of scope

### Post-Phase 6 adaptive shell and notification follow-up

- the authenticated shell now uses wider adaptive page-width rules so dashboard and workspace surfaces stop looking boxed on larger screens while still staying readable on laptop-sized viewports
- the global shell search field now uses the same surface language as the rest of StockWise instead of reading like an isolated dark slab
- compact Android/handheld layouts now preserve stronger bottom-navigation separation and safer bottom spacing above the dock
- notifications now cover high-signal finance document milestones from `finance_document_events`, specifically approval requests and issue/post confirmations for sales invoices and vendor bills, without promoting low-value draft noise

## E. Cross-Phase Tracked Items

### Due reminders anchor rule

Implemented rule:

- if a sales invoice exists, reminders anchor to the invoice
- only if no issued invoice exists do reminders remain on the sales order

### Document language behavior

Implemented rule:

- issued/post output uses stored document language snapshot first
- otherwise output falls back to the active app/document language

## F. Update Protocol

When finance or control-plane work lands:

1. Update the relevant phase and work-item status in [phase-tracker.md](phase-tracker.md).
2. Record any architecture or behavior decision in [decision-log.md](decision-log.md).
3. If a dependency or scope changed, update this master roadmap summary.
4. If a work item changed live runtime truth, update the nearest continuity doc in `docs/`.

Status vocabulary:

- `Not started`
- `In progress`
- `Completed`
- `Blocked`

## G. Open Decisions

Current open decisions that need explicit closure in future work:

- when to wire the finance regression suite into CI with a guarded mutation environment
- whether automatic purge execution should be implemented before payment automation
- when payment integration should start driving `company_subscription_state` instead of platform-admin manual grants
- whether month-close review later needs export packs beyond the current reconciliation workspace
- whether future treasury work needs deeper bank-statement reconciliation tooling
- whether a vector-extracted SVG should be added from the approved logo source package once suitable tooling or source artwork is available
- whether the Operator workflow later needs receipt printing, barcode input, or cashier-session controls beyond the current simple-sale scope
- whether onboarding/import later needs saved import mappings or a richer warehouse/bin bootstrap assistant beyond the current guided file review

## H. Risks / Blockers

Known risks:

- the finance regression suite currently mutates temporary live data and depends on disciplined cleanup
- payment automation is intentionally deferred, so internal operational discipline around manual activation remains important
- operational purge execution is scheduled but not yet automated
- runtime brand assets are now consistent, but SVG vector extraction is still deferred to avoid shipping a poor trace of the approved logo
- Android/mobile UX is improved in core flows, but broader route-by-route mobile refinement remains iterative follow-up rather than a one-pass rewrite

Current blocker summary:

- no hard blocker prevents the current roadmap from moving forward
- the next recommended implementation block is CI wiring for the finance regression suite plus the next adoption follow-up that real usage data justifies, rather than bundling mobile UX, Operator flow, and onboarding import into one vague feature
