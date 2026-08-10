# UX-11D — Production, Growth and Services

Status: implemented and validated as an uncommitted UX-11 worktree package.

## Scope and correctness boundary

UX-11D changes presentation, state communication and interaction hierarchy for Recipes/BOM, Production Runs, Growth Batches, Service Jobs and Landed Cost. Existing RPCs remain authoritative. The package does not change production quantities, stock posting, costing, Growth Batch events, Service Job cost calculation, Landed Cost allocation, idempotency, RLS or schema.

Operational quantity and money remain separate contracts. Quantity evidence uses the shared operational formatter with up to four decimal places where the application already supports divisible quantities. Monetary values keep the existing currency format and rounding. Growth Batch count-basis whole-number validation remains backend-governed; no UOM-specific precision system was introduced.

## Information hierarchy

### Recipes / BOM

The register is a scan-oriented row list rather than a card grid. Each row preserves finished-item identity, SKU, recipe/version, state, component count, planning time, setup warnings and permitted actions. The open summary band reports active/inactive versions, covered finished items and recipes requiring review. Recipe detail keeps component quantities, UOM, stock sufficiency, WAC estimate and assembly evidence. The workflow guide appears only in the register.

### Production Runs

The register prioritises reference, product/BOM, status, chronology, quantity, location and cost evidence. An open summary band replaces the equal KPI-card row. Detail remains ordered around actual inputs, production activity, outputs, stock movements and frozen cost evidence. Posting/reversal consequences and the existing governed RPC actions remain unchanged. The workflow guide no longer repeats inside detail.

### Growth Batches

The register preserves batch identity, family, basis, state, location, opening/current measures, chronology and next actions. Detail retains the domain tabs: Overview, Materials & Location, Lifecycle, Measurements, Costs, and History & Audit. Lifecycle events and references remain the primary chronology. Transfer, harvest, completion, loss and stock-input previews use semantic state tokens with text; no event or cost is inferred from colour. The register summary and workflow guide are not repeated inside detail.

### Service Jobs

The register defaults to all jobs so finalised evidence is not silently hidden. Filtered-empty and genuine first-use states are distinct. Status and costing state use text plus canonical semantic treatments. Detail reserves structure while loading and reports recoverable evidence failures without exposing backend text. Missing cost evidence is unavailable, not zero. Company/customer material quantities use the operational quantity formatter and resolved UOM code; time remains non-cost evidence until an actual labour cost is recorded.

The current Service Job register source exposes actual cost but not a separately authoritative revenue/profit field. UX-11D therefore does not invent profitability. Revenue/profit presentation remains a follow-up for a source-backed contract.

### Landed Cost

Before a purchase order is selected, the workspace shows only the source selector and the prerequisite state. It does not render allocation controls, charges, summary zeros, preview totals or history. After selecting a received purchase order, the existing source, charge, allocation, preview and audit evidence becomes available. No allocation basis or calculation changed. Loading, no eligible receipts, calculated zero and errors remain distinct states.

## Reusable state rules

- Structural detail loading reserves the expected content areas; mutation buttons retain local busy states.
- Empty registers identify what is missing and only offer an action when the current role can act.
- Filtered-empty is not first-use; no-source is not calculated zero; error is not empty.
- Backend/Supabase diagnostics remain in the console while normal UI uses a neutral, recoverable message.
- Consequential state always includes text and does not rely on colour.
- Dense component, movement, allocation and event evidence remains visible; hierarchy is simplified without deleting operational detail.

## Leny QA evidence

The approved Leny company was used through normal authenticated application flows. Existing evidence reviewed includes Recipe `BDC001`, reversed Production Run `LEN-PR000000001`, active Growth Batches `LEN-GB000000001` through `LEN-GB000000003`, and a finalised Service Job with authoritative actual cost. Landed Cost was checked in both no-source and selected-source states without applying an allocation. No business transition was manufactured solely to make a screen look populated.

Browser QA covers English and Portuguese, desktop and viewport overrides at 360/390/430/820 widths, keyboard traversal, state labels and console output. The in-app browser returned a blank screenshot frame at the 360 override despite a populated accessibility tree, so small-width evidence is interaction/DOM based; exact exercised records and this harness limitation are recorded in the UX-11D completion report.

## Deferred product questions

- A source-backed Service Job revenue/profitability contract is required before presenting profit.
- Growth Batch action-level QA is limited by the safe applicability of existing Leny records; any unexercised transition is reported rather than simulated.
- Landed Cost application/posting is intentionally not required for presentation validation when selection and preview evidence are sufficient.
