# Finance Document Roadmap

## A. Overview

This roadmap is the durable execution guide for the finance-document platform after the settlement-anchor transition, AR/AP adjustment rollout, and Mozambique issuance work.

Use this folder to preserve:

- roadmap intent across sessions
- current implementation status
- phase dependencies
- architecture guardrails
- open decisions
- implementation notes that should not be rediscovered repeatedly

The detailed phase tracker lives in [phase-tracker.md](phase-tracker.md). The running decision log lives in [decision-log.md](decision-log.md).

## B. Current State Summary

Finance-document foundation already in place:

- `sales_orders` and `purchase_orders` remain operational/commercial documents
- `sales_invoices` and `vendor_bills` are the legal/financial settlement anchors once issued/posted
- pre-finance settlements re-anchor from `SO` to `SI` and from `PO` to `VB`
- AR supports issuance plus credit notes and debit notes, including partial and cumulative adjustments
- AP supports vendor bills plus supplier credit notes and supplier debit notes, including partial and cumulative adjustments
- invoice and finance-document output already uses snapshot-backed legal fields rather than mutable masters
- finance-document output now resolves language from the stored document snapshot first, then from the active app/document language fallback, with bilingual `pt` / `en` rendering
- finance documents now surface actor-aware activity journals, linked document-chain views, settlement events, and structured adjustment reasons on the core AR/AP detail pages
- order detail screens now expose the active finance anchor and linked finance-document bridge from `SO -> SI` and `PO -> VB`
- native sales-invoice draft creation now bootstraps the minimum Mozambique fiscal settings and current-year fiscal series when they are missing, while issue-time legal tax identity validation remains strict
- Mozambique sales-invoice issue now runs through an explicit readiness and preparation path before the issue RPC is called; this keeps issue-time validation strict while surfacing the real blocker to the operator
- missing seller legal snapshots remain a hard issue-time blocker when company master tax identity is incomplete; draft preparation may backfill from existing company/order/customer data, but it must not invent a missing company NUIT
- approved draft invoices with exempt lines may now persist `vat_exemption_reason_text` through the narrow issue-preparation path so finance users can resolve that issue-time blocker without reopening the document to editable draft
- purchase-order list and detail surfaces now share a single vendor-bill action model: open the existing bill when one already exists, raise a new draft when the PO is approved and billable, or explain exactly why billing is blocked
- purchase-order billability is now independent from receipt completion: receiving stock may update the operational receipt status, but it must not remove the AP billing path unless a Vendor Bill already exists or the PO has no positive purchased value
- a Phase 3A reconciliation read model is now live through `v_finance_reconciliation_review` and `v_finance_reconciliation_exceptions`
- Settlements now has a controller-grade reconciliation workspace with AR/AP review registers, legal-value bridge totals, aging, due position, and visible exception queues
- Sales Invoice and Vendor Bill detail pages now surface reconciliation review context directly from the same DB-backed model used by the controller register
- Items now carries an operational item-profile layer (`primary_role`, stock tracking, buy/sell flags, assembly flag) that reduces master-data ambiguity without reopening post-create mutation risk
- Assembly now uses a guided operational workflow: choose the finished product, review BOM sufficiency, inspect limiting factors and readiness, then post the build from a clearer source/destination planning surface
- Assembly planning time now lives on the BOM version itself in normalized minutes (`assembly_time_per_unit_minutes`, `setup_time_per_batch_minutes`), so each recipe revision can keep its own planning pace without turning item masters into a scheduling subsystem
- Assembly now exposes lightweight time-oriented planning: total time required for the requested quantity, optional available work time, stock-versus-time capacity, effective buildable quantity, and a clear missing-time-data fallback when no estimate is configured
- bank-linked receive/pay now uses the canonical `bank_accounts` model end to end; the stale Phase 2 trigger dependency on `public.banks` has been removed from the active posting path
- Banks, Cash, and UOM now use clearer operational language and page structure: bank accounts are treated as real treasury ledgers, Cash is framed as the company cash book, and UOM makes the difference between global units and company conversion rules explicit

This roadmap covers what is still needed for execution maturity, finance control maturity, and sustainable regression safety.

## C. Architecture Guardrails

These rules must not be broken by future work:

1. Finance-document truth
   - `SO` and `PO` are operational documents.
   - `SI` and `VB` become the finance/legal truth once issued or posted.
   - Reminders, settlements, balances, and exposure must follow the active finance anchor once it exists.
   - physical receipt of PO stock is not the same as AP billing; receipt completion must not suppress Vendor Bill creation.

2. Adjustment-document model
   - issued/post documents are not edited in place for legal value changes
   - corrections must flow through credit/debit note chains
   - cumulative credits/debits must never exceed coherent legal bounds

3. Snapshot-backed legal output
   - issued/downloaded output must render from frozen document snapshots
   - mutable company/customer/supplier/order masters are not the legal render source after issue/post
   - branding may overlay output, but it must not replace fiscal snapshot truth

4. Dual-reference AP model
   - supplier invoice reference is supplier-origin and manually writable
   - Stockwise internal reference is system-generated and used for audit/system lookup
   - legacy prefixes may remain for audit continuity, but new UX must explain or replace ambiguity

5. No duplicate exposure
   - balances due, settled amount, credited amount, debited amount, current legal amount, and outstanding amount must resolve from one active chain only
   - no double charging, double counting, or duplicate receivable/payable exposure

6. AR/AP parity by principle, not by blind symmetry
   - close unjustified product gaps between AR and AP
   - do not force identical behavior where accounting or document law differs

7. Repo-first execution tracking
   - roadmap tracking belongs in repo documentation first
   - do not add tenant-facing product clutter for engineering roadmap status unless there is a clearly restricted internal/admin route

## D. Phase Roadmap

| Phase | Purpose | Why It Matters | Current Status | Depends On |
|---|---|---|---|---|
| Phase 1 | Permissions and approval controls | Finance actions need explicit authority, separation of duties, and post-issue discipline | Completed | Current finance-document lifecycle baseline |
| Phase 2 | Audit trail and document-chain visibility | Finance users need coherent traceability across original documents, adjustments, and settlements | Completed | Phase 1 controls for sensitive actions |
| Phase 3 | Reconciliation and month-close readiness plus operational clarity | Finance and ops need current-legal-value bridges, exception handling, cleaner master data, and planning-ready workflows | Active: Phase 3A, 3B, and 3C implemented in core scope; close-pack/reporting follow-up remains | Phase 2 traceability and stable state views |
| Phase 4 | Operational reliability and regression maturity | Treasury and master-data reliability still need targeted operational hardening before the full regression suite can take over | Active: Phase 4A implemented in core scope; Phase 4B regression suite still not started | Stable Phase 1-3 workflows and validations |

### Phase 3 programme structure

- Phase 3A. Reconciliation and month-close readiness
  - implemented in core scope
  - scope now includes AR/AP bridge registers, aging based on legal outstanding, exception queues, and detail-page reconciliation context
- Phase 3B. Operational UX clarity on confusing workflow/master-data pages
  - implemented in core scope
  - target surfaces: Items and Assembly
  - purpose: reduce master-data and production-workflow confusion before deeper planning logic is added
  - completed scope:
    - explicit item-role classification and safer item-creation guidance
    - Assembly restructured around build target, stock sufficiency, limiting factor, and readiness before execution
  - follow-up still open:
    - optional broader workflow polish on adjacent inventory screens if future testing shows confusion around the new item-profile layer
- Phase 3C. Assembly planning enhancement with time-oriented production logic
  - implemented in core scope
  - purpose: add practical time-based planning without turning Stockwise into a full ERP scheduler
  - completed scope:
    - planning time lives on the BOM version, not on the generic item master, with normalized-minute storage and readable hour/minute inputs in the UI
    - Assembly now estimates total time for the requested quantity, optional available work time, quantity possible from time, quantity possible from stock, and the effective build capacity from both constraints
    - the page now makes the limiting factor explicit: stock, time, both, or missing time configuration
    - missing time configuration stays explicit and safe: builds can still proceed when stock/routing are valid, but the UI does not invent time estimates
  - intentionally not done:
    - work-center scheduling
    - labor calendars or shifts
    - routing/operation sequencing
    - full MRP or production-order orchestration

### Production hardening block

Completed before Phase 3 activation:

- bank-linked settlement posting repaired
- landed-cost workflow repaired
- PO to Vendor Bill progression repaired, including receipt-independent AP billability
- SO to Sales Invoice draft creation repaired
- Sales Invoice issue readiness and controlled issue preparation implemented
- Tauri desktop and Android packaging hardened and documented

### Phase 4 programme structure

- Phase 4A. Treasury and master-data operational reliability / UX
  - implemented in core scope
  - scope now includes:
    - bank receive/pay repair against the canonical `bank_accounts` schema
    - finance-readable bank posting error handling on the touched bank settlement paths
    - clearer operational UX for Banks, Cash, and UOM
  - completed outcomes:
    - `bank_transactions` no longer route through the obsolete `public.banks` dependency during settlement audit journaling
    - Banks now behaves like a bank-account register, not a vague bank-name list
    - Cash now behaves like the company cash book with clearer settlement-policy guidance
    - UOM now separates global unit masters from company conversion rules more clearly
  - follow-up still open:
    - broader treasury workflow polish if future testing shows confusion around statement import, reconciliation, or bank-ledger maintenance
- Phase 4B. Automated finance regression suite
  - not started
  - purpose: turn the now-stable Phase 1-4A workflows into repeatable regression coverage
  - depends on:
    - stable treasury and settlement posting after Phase 4A
    - seeded validation data and repeatable non-production mutation environments

## E. Cross-Phase Tracked Items

### Due reminders anchor redesign

This item is tracked under Phase 3 because it depends on the settlement-anchor model and current-legal receivable logic.

Target rule:

- if a sales invoice exists, reminders must anchor to the sales invoice
- only if no sales invoice exists should reminder logic remain on the sales order

Implemented behavior:

- reminders stay on the sales order only while no issued sales invoice exists
- once an issued sales invoice exists, reminder anchor moves to the sales invoice
- reminder eligibility now follows invoice outstanding and current legal value, including settlement and credit/debit adjustments
- reminder language uses the invoice language snapshot when the active anchor is an invoice, otherwise company/app reminder language fallback applies

### Document language behavior

This item is tracked under Phase 2 because it affects issued output correctness and audit/compliance visibility.

Target rule:

- documents must render in the selected document/app language
- Portuguese selection should produce Portuguese output
- English selection should produce English output

Current state:

- app locale selection exists in settings and UI
- Mozambique fiscal settings store `document_language_code`
- finance-document output now uses this precedence rule:
  - if the issued/post document has a stored language snapshot, use it
  - otherwise fall back to the active app/document language
- shared output helpers now render labels, headings, section names, footer wording, and date/number formatting in `pt` or `en` consistently across AR and AP documents

Result:

- this is now implemented behavior and should stay snapshot-first for issued/post documents

## F. Update Protocol

When any finance-document work lands:

1. Update the relevant phase and work-item status in [phase-tracker.md](phase-tracker.md).
2. Record any architecture or behavior decision in [decision-log.md](decision-log.md).
3. If a dependency or scope changed, update this master roadmap summary.
4. If a work item changed the forward-state model, update [mozambique-runtime-issuance.md](../mozambique-runtime-issuance.md) only where it affects live runtime truth.

Status vocabulary:

- `Not started`
- `In progress`
- `Completed`
- `Blocked`

## G. Open Decisions

Current open decisions that need explicit closure in future work:

- whether approval escalation thresholds should be universal or company-configurable
- whether month-close review should live in a dedicated finance workspace or be embedded into existing Settlements / document registers
- whether internal engineering roadmap visibility ever needs a restricted in-app route, or should stay repo-only
- whether Phase 2 should later add filtered audit/report exports beyond the current document detail, order detail, and low-level event-registry surfaces
- whether future assembly planning should add calendar-aware capacity inputs beyond the current manual available-hours field, or keep the planning layer intentionally lightweight
- whether Phase 4A should later extend into deeper bank-statement reconciliation tooling or stay limited to bank-posting reliability and clearer treasury-master surfaces

## H. Risks / Blockers

Known risks:

- finance-document behavior is already broad enough that undocumented assumptions can cause drift between sessions
- reminder logic now follows the active AR anchor, but still needs regression coverage to prevent drift
- regression coverage is still largely manual
- the new item-profile layer is intentionally lightweight and UI-driven first; any future hard DB enforcement must be designed carefully so legacy items do not break production workflows

Current blocker summary:

- no hard blocker prevents roadmap execution
- the main risk is drift, not immediate technical blockage
- the next recommended implementation block is Phase 4B automated finance regression coverage, using the now-stable Phase 1-4A workflows as the baseline
