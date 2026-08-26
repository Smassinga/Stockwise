# Purposeful containment

Status: active StockWise UI clarification, 2026-08-26.

This note clarifies the authenticated UI quality contract in `docs/premium-ui-direction.md`. It does not replace the canonical brand, accessibility, mobile, semantic-colour, loading, or content rules.

## Decision

Cards are valid when containment improves recognition of a distinct business object, comparison, scanning, decision-making, interaction, or mobile adaptation. Cards are not a default wrapper for unrelated content and must not be added only to decorate whitespace or make every section look like a widget.

A useful removal test is:

> If removing the container boundary makes the relationship between its contents less obvious, the containment is probably justified. If removing it changes almost nothing, the container is probably decorative.

StockWise may use cards, panels, tiles, rows, sections, lists, and tables. These are different layout tools rather than competing style ideologies.

## Preferred use

Purposeful containment is appropriate for:

- decision-first KPI summaries on Dashboard and report overview surfaces;
- one coherent attention or exception group;
- charts and analytical summaries whose controls, legend, data, and explanation belong together;
- customer, supplier, document, inventory, or finance summaries that represent one business object;
- quick-action groups where the actions belong to one operating task;
- mobile register alternatives when a desktop table would become unreadable or require excessive horizontal scrolling.

Flat rows, tables, sections, or whitespace remain preferable for:

- dense desktop ledgers and transaction registers;
- long forms where each field is not an independent object;
- simple headings or explanatory copy;
- individual navigation items;
- arbitrary paragraphs, empty whitespace, or every repeated table row.

## Anti-slop boundary

Purposeful cards must not recreate generic AI-dashboard styling. Avoid card walls, decorative icon bubbles, gradients, glow, glass effects, oversized radii, excessive shadows, meaningless percentage badges, or invented metrics. Use the existing StockWise semantic tokens, typography, restrained borders, light/dark surfaces, real business language, and truthful data.

Familiar business-product patterns are desirable when they reduce interpretation time. Originality is not a reason to make a financial or inventory workflow unfamiliar.

## Dashboard application

The Dashboard is the first reference implementation of this clarification.

- `Needs attention` is one operational containment surface, with exceptions kept as scan-friendly rows inside it.
- `Current position` uses four restrained KPI cards for operational revenue, gross profit, inventory value, and open orders.
- `Recent activity` remains one contained list, not one card per movement.
- `Daily performance` is one analytical surface around the chart and its evidence note.
- `Performance drivers` remains one grouped analysis surface, not separate decorative widgets for every statistic.
- First-use actions may be contained as one setup group.

The Dashboard data source, finance logic, COGS handling, inventory valuation, posting logic, RLS, role capability, and `get_owner_dashboard` RPC are unchanged by this presentation decision.

## Shared finance summary application

Finance position summaries use the same rule when the values are independent decision-bearing signals that users need to compare quickly. `FinanceSummaryBand` therefore renders restrained `PremiumMetricCard` surfaces for the maintained summary groups used by Sales Invoices, Vendor Bills, Settlements, Cash, and Bank Accounts.

This does not make finance registers card-first. Dense invoice, bill, settlement, cash, bank, and transaction rows remain tables, lists, or mobile register cards according to their existing contracts. The summary cards do not change document lifecycle, settlement anchors, balances, accounting calculations, posting authority, RPCs, RLS, or data sources.

## Deliberately flat surfaces

The current Items, Customers, Suppliers, Stock Movements, Warehouses, Orders, and Point of Sale compositions already had redundant summary or nested card walls removed during the maintained UX-11C pass. They should not be re-carded simply for visual consistency. Their existing tables, open summaries, operational panels, and mobile representations remain the reference unless a later page-specific review identifies a concrete decision or business object that benefits from containment.

Reports and Stock Levels remain valid candidates for selective metric-card containment because their authoritative summaries support comparison and operational decisions. Any later change must preserve their existing evidence, empty/unavailable distinctions, filters, exports, calculations, and mobile table contracts.

## Responsive rule

Desktop should favor comparison density where useful. Mobile may convert dense tables/registers to compact cards when this materially improves readability and touch interaction. Mobile does not require a card version of every desktop section.

## Review question

For every proposed card, reviewers should be able to answer: `What relationship or decision does this boundary make clearer?` If there is no concrete answer, remove the card.
