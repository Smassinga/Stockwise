# UX-11C — Inventory, Orders and Point of Sale

Status: implemented and validated locally. POS-QTY-1 resolved the decimal weighted-sale blocker on 2026-08-09. UX-11A and UX-11B remain the approved uncommitted baseline.

## Scope and authority

This package changes presentation, content, semantic styling, accessibility labels, loading treatment, and register hierarchy for Items, Stock Levels, Stock Movements, Warehouses, Customers, Suppliers, Sales Orders, Purchase Orders, and Point of Sale.

It does not change inventory calculations, conversion rules, costing, pricing, order lifecycles, posting RPCs, RLS, schema, or migrations. `stock_movements` remains the inventory ledger, `stock_levels` remains derived, and POS continues to preview and post through the existing `post_operator_sale` authority path.

## Information hierarchy

### Items

- The page opens with the register title and real actions instead of an eyebrow, explanatory paragraph, status pills, and four summary cards.
- Desktop remains a dense table; the existing deliberate mobile representation remains the small-screen path.
- Name, SKU, operational role, base UOM, default sell price, stock state, and governed actions remain available.
- Item profile creation still uses `create_item_with_profile` where supported and verifies the persisted record before reporting success.
- Normal post-create editing remains limited to `min_stock`.

### Stock Levels

- The title and actions lead directly into a restrained summary band and filters.
- Inventory value, attention count, active warehouse scope, base currency, and position count remain visible without four separate KPI cards.
- Mixed UOM quantities are not added together.
- Healthy, low, out, negative, and threshold-unconfigured remain distinct text-plus-semantic states.
- Quantity presentation preserves up to four decimal places.

### Stock Movements

- History is the primary view and no longer begins with explanatory pills or five movement-count cards.
- Date, type, item, route, signed/directional context, quantity, value, and reference remain in the register.
- Record controls retain the existing governed receipt, issue, transfer, and adjustment RPCs.
- Quantity, UOM, and unit-cost controls now have explicit label associations; decimal inputs request a decimal mobile keyboard.
- Quantity presentation preserves up to four decimal places while monetary values retain their existing accounting precision.

### Warehouses

- The register uses an open list with dividers rather than a card per warehouse inside a page card.
- Warehouse code, address, bin count, active state, bins, and authority-aware actions remain visible.
- The summary is a compact definition list. A bin-query failure remains unavailable/partial data, never a false zero.

### Customers and Suppliers

- Redundant subtitles, decorative count lines, and list cards were removed.
- Search and the dense operating table remain primary.
- Initial loading now uses structural register skeletons.
- Raw backend load/mutation messages are logged for diagnostics and replaced in normal UI with scoped recoverable messages.

### Orders

- The shared order header no longer narrates the page or repeat company/view pills.
- The purchase/sales selector and links to the relevant finance documents remain operational context.
- The lazy route fallback now uses structural skeletons.
- Workflow summaries appear only when outstanding orders exist and use an open band rather than three cards; new companies no longer see a wall of zero cards.
- Existing workflow, fulfilment/receipt, invoice/vendor-bill, settlement, and action authority remain unchanged.

### Point of Sale

- The page title, warehouse, bin, and search controls are now an open working header.
- Redundant page-purpose, source, pricing, current-cart, and item-list explanations were removed.
- Source selection, stock availability, item identity, UOM, price, cart, customer, tax consequence, payment destination, authoritative preview, and success evidence remain.
- The last-sale state now uses semantic success tokens. Non-fiscal/unconfigured tax treatments use semantic warning tokens rather than direct amber utilities.
- Decorative shadows and nested header cards were reduced; the cart remains a deliberate operational panel.

## Loading, empty, and error contracts

- Known register structure uses skeletons rather than full-page spinners.
- Search/filter empty states remain distinct from first-use no-data states.
- Stock data or bin data that cannot be verified is unavailable, not zero.
- POS uses local preview/post progress; a local operation does not replace the full screen with a spinner.
- Business rejections such as insufficient stock and payment/tax blockers retain the existing safe domain messages.

## Silent-discard audit

Leny item created through the maintained UI:

| Field | Entered | Save and reload |
| --- | --- | --- |
| Name | `UX11C-QA Weighted Item` | retained |
| SKU | `UX11C-QA-WEIGHT-001` | retained |
| Base UOM | `KG — Kilogram` | retained |
| Minimum stock | `2.125` | retained |
| Default sell price | `MZN 120.00` | retained |
| Profile | General, stock tracked, purchasable, sellable | retained |

The register showed the same values after the create flow reloaded its data. No representative field silently disappeared.

## Leny QA record

Retained fixture:

- Item: `UX11C-QA Weighted Item`
- SKU: `UX11C-QA-WEIGHT-001`
- UOM: `KG — Kilogram` (existing UOM; no duplicate created)
- Default sell price: `MZN 120.00/kg`
- Minimum stock: `2.125 kg`
- Stock location: `Casa / QA-A2`
- Receipt: `10 kg` at `MZN 50.00/kg`
- Receipt timestamp: `2026-08-08 15:47:39` local browser display
- Receipt reference presentation: `Adjust`
- Receipt note: `UX11C-QA weighted opening stock`
- Verified stock after receipt: `10 kg`, average cost `MZN 50.00`, value `MZN 500.00`

The fixture and receipt movement are retained because they provide a recognisable regression target. No additional named customer, supplier, or purchase-order fixture was needed; POS-QTY-1 created the governed sales-order evidence recorded below.

## Decimal weighted-sale result — PASS

Intended chain:

`10 kg opening stock → POS quantity 1.375 kg → MZN 120.00/kg → MZN 165.00 → 8.625 kg ending stock`

POS-QTY-1 established that operational quantities and monetary values have separate precision contracts. The POS sales-order boundary supports four decimal places (`sales_order_lines.qty numeric(18,4)`); the current UOM model does not define UOM-specific decimal scales. Money continues to use the existing two-decimal rules.

The former root cause was the monetary `round2` helper inside `updateLineQty` in `src/pages/Operator.tsx`. POS cart quantity normalization now uses the explicit operational-quantity helper, and preview/post payload mapping preserves the resulting number unchanged.

Leny acceptance evidence:

- authoritative preview request quantity: `1.375 kg`;
- authoritative preview subtotal/total: `MZN 165.00`;
- posted sales order: `LEN-SO000000014` (`5a57cad8-6e35-4de6-ad9a-86082519b0f8`);
- persisted order and shipped quantity: `1.375 kg`;
- ending stock: `8.625 kg` at `Casa / QA-A2`;
- issue movement: `9042e745-a0fe-46f1-9801-9d71dc39da96`, quantity `1.375 kg`, value `MZN 68.75`;
- cash settlement: `87bc4b75-b4a4-4158-81fb-99c39fabf7db`, amount `MZN 165.00`;
- Dashboard movement evidence displays `1.375`, and Dashboard/Reports include `MZN 165.00` sales, `MZN 68.75` COGS, and `MZN 96.25` gross profit for 2026-08-09.

The retained weighted item now has `8.625 kg` stock. The sale, movement, settlement, and references remain in Leny as permanent QA evidence.

## Mobile and accessibility rules

- Critical item, UOM, quantity, price, total, and reference values remain available; quantity display supports four decimals.
- Operational mobile cards/lists are allowed where they improve touch use; desktop registers remain dense.
- Labels and native controls remain the first accessibility mechanism.
- Quantity and cost controls expose associated labels and decimal input mode.
- Status remains text plus semantic treatment, never colour alone.
- Reduced-motion behavior continues to come from the canonical UI foundation.

## Deferred items

- **MEDIUM:** Duplicate `Each` UOM records remain a separate governance issue and were not modified.
- **LOW:** POS `+` / `−` controls retain the existing one-base-unit step. Direct decimal entry is correct; UOM-specific step configuration does not exist and was not introduced by POS-QTY-1.
- **LOW:** The movement receipt created without a purchase order displays the existing generic `Adjust` reference; a more specific manual-receipt reference taxonomy would require a separately approved domain decision.
