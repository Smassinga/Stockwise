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
| Phase 2 | Audit trail and document-chain visibility | Finance users need coherent traceability across original documents, adjustments, and settlements | In progress | Phase 1 controls for sensitive actions |
| Phase 3 | Reconciliation and month-close readiness | Finance needs current-legal-value bridges, exception handling, and close-ready review surfaces | In progress | Phase 2 traceability and stable state views |
| Phase 4 | Automated finance regression suite | The platform is now too finance-critical to rely on manual smoke tests alone | Not started | Stable Phase 1-3 workflows and validations |

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

## H. Risks / Blockers

Known risks:

- finance-document behavior is already broad enough that undocumented assumptions can cause drift between sessions
- reminder logic now follows the active AR anchor, but still needs regression coverage to prevent drift
- regression coverage is still largely manual

Current blocker summary:

- no hard blocker prevents roadmap execution
- the main risk is drift, not immediate technical blockage
