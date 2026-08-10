# UX-11B Reports

## Scope and correctness boundary

UX-11B changes the presentation and interaction contract of `/reports`. It does not change `get_operational_report`, any report calculation, recognition rule, period definition, query parameter, view, RPC, export data definition, schema, RLS policy, or migration. The active route continues to request one company-scoped report at a time with the selected start/end dates, no warehouse or customer restriction, cash activity included, and a 90-day slow-moving threshold.

The legacy files under `src/pages/reports/` are not routed by `App.tsx`; they were inspected as historical implementation context and were not changed. The maintained route is `src/pages/Reports.tsx`.

## Report inventory

| Purpose | EN / PT report name | Authoritative source and scope | Visible filters | Output and export | Access |
| --- | --- | --- | --- | --- | --- |
| Performance | Operational performance / Desempenho operacional | `get_operational_report('performance')`, delegating to `get_owner_dashboard`; activity in the inclusive selected date range | Start, end | Summary plus dated trend table; XLSX, CSV, PDF, print | Authenticated member with current-company access enforced by the RPC |
| Performance | Product profitability / Rentabilidade por produto | `get_operational_report('product-profitability')`, using the Owner Performance product and summary response; inclusive selected date range | Start, end | Product table plus authoritative summary; XLSX, CSV, PDF, print | Same RPC access contract |
| Inventory | Inventory valuation / Valorização do inventário | Current `stock_levels` snapshot returned by `get_operational_report('inventory-valuation')`; the RPC does not apply the requested date range to this report | None; refresh only | Current-position table; XLSX, CSV, PDF, print | Same RPC access contract |
| Inventory | Stock movement ledger / Razão de movimentos de stock | `get_operational_report('stock-movement-ledger')`; `stock_movements` in the inclusive selected date range | Start, end | Dense movement table; XLSX, CSV, PDF, print | Same RPC access contract |
| Inventory | Inventory ageing and slow-moving stock / Antiguidade e stock de baixa rotação | Current stock/last-out snapshot returned by `get_operational_report('inventory-ageing')`; fixed request threshold of 90 days | None; refresh only | Current ageing table with threshold evidence; XLSX, CSV, PDF, print | Same RPC access contract |
| Customers and suppliers | Customer performance and receivables / Desempenho de clientes e contas a receber | `get_operational_report('customer-location')`; completed activity in the inclusive selected date range, enriched by the maintained collections wrapper | Start, end, client-side collection status | Dense customer/receivables table; all exports use the already-filtered visible rows and state the collection filter | Same RPC access contract |
| Customers and suppliers | Supplier spend and payables / Compras a fornecedores e contas a pagar | `get_operational_report('supplier-payables')`; posted Vendor Bills and Purchase Orders in the inclusive selected date range | Start, end | Supplier table; XLSX, CSV, PDF, print | Same RPC access contract |
| Operations | Service Job profitability / Rentabilidade dos Trabalhos de Serviço | `get_operational_report('service-job-profitability')`; completed Service Jobs in the inclusive selected date range, with actual cost only when finalised | Start, end | Dense Service Job table; XLSX, CSV, PDF, print | Same RPC access contract |
| Operations | Order fulfilment / Cumprimento de ordens | `get_operational_report('order-fulfilment')`; Sales Orders whose order date is in the inclusive selected date range | Start, end | Ordered aggregate summary; XLSX, CSV, PDF, print | Same RPC access contract |

No chart is present in the maintained Reports route. UX-11B did not add one: the current responses are already conveyed more clearly by authoritative summaries and tables, and no extra series or frontend calculation was created.

## Presentation contract

- Desktop discovery is a compact purpose-based navigation list. Mobile and tablet use one labelled report selector so the report output is reached without scrolling through nine cards.
- The route has one direct page heading. Report-specific supporting text appears only for recognition, missing-cost, snapshot, or ageing-threshold context.
- Period reports show labelled start/end controls and an explicit localized period in the scope band. Inventory valuation and ageing are labelled as current snapshots and do not display misleading date controls.
- Column order is explicit per report. Numeric values are right-aligned and tabular; money continues to use the existing base-currency formatter and current precision; percentages add the percent sign without changing the RPC value.
- Wide report tables remain dense inside a keyboard-focusable, labelled horizontal region. The page itself must not scroll horizontally. Table captions name the report and active scope.
- Order fulfilment uses an ordered definition list instead of a one-row, ten-column table. If no order activity exists, the aggregate zero response is presented as no period activity rather than as a wall of zero metrics.
- Summary values are shown only when result evidence exists. Zero-valued summaries do not substitute for missing/no-activity data.

## Loading, empty, and error contract

- Known table output uses `PremiumSkeleton` table structure; reports with a summary reserve both summary and table structure. Motion remains governed by the shared reduced-motion contract.
- A client-side collection filter that removes otherwise available rows is a filtered-empty state.
- A period report with no rows is a no-activity-in-period state.
- A current-snapshot report with no rows is a no-current-records state.
- Invalid dates are identified before an RPC request and state the correction required.
- RPC failures render a neutral recoverable message with retry. Raw Supabase/PostgREST/RPC text is retained only in technical console diagnostics.
- Export failures are distinct from report-load failures and do not replace successfully loaded report data.

## Export contract

The existing XLSX, CSV, PDF, and print formats remain. Their data continues to be the already-rendered authoritative response; UX-11B changes only scope evidence and feedback. Export metadata states report, period or snapshot, MZN base currency, and the active collection filter where applicable. CSV uses the maintained company display name instead of an internal company identifier. Each export has a local busy state, and print output escapes report/customer/item text before inserting it into the print document.

## Leny authenticated QA evidence

QA on 8 August 2026 used the approved Leny Doçuras company and existing records only; no company record was created, edited, settled, or deleted.

- Populated: Operational performance returned 5 dated rows, MZN 1,420.00 operational sales, MZN 626.95 COGS, and MZN 793.05 gross profit for 10 July–8 August 2026. Product profitability returned 3 rows. Inventory valuation returned 11 stock rows. Inventory ageing returned 10 rows at the 90-day threshold. Service Job profitability returned 1 row. Order fulfilment returned 10 ordered aggregate metrics.
- Filtered empty: Customer performance and receivables returned one unfiltered cash-customer row; `Broken promise` produced zero visible rows and the filter-specific empty state.
- Period with no activity: Supplier spend and payables returned zero rows for 10 July–8 August 2026 and displayed the period no-activity state.
- Invalid filters: clearing the date controls displayed the correction state and disabled refresh instead of sending an invalid RPC request.
- Export: the CSV action on a populated report entered and exited its localized preparing state. The in-app download observer did not expose the generated Blob as a downloadable artifact, so file-content confirmation is covered by the source contract test rather than claimed as a captured browser file.
- Language/responsive: English and Portuguese were exercised. Widths 360, 390, 430, 820, and 1440 had one H1 and zero page-level horizontal overflow. Dense result tables remain horizontally contained; mobile aggregate summaries reflow without critical truncation or dock collision.
- Keyboard/focus: native buttons, labelled selects/date fields, table region focusability, and the shared visible focus ring were exercised. The focused mobile navigation control exposed the canonical green/white focus ring.
- Console: no UX-11B error or warning was observed during report switching, filters, empty state, language, responsive checks, or export interaction.

Screenshots are saved outside the repository under `ux-11b-audit` in the session visualization workspace.

## Deferred items

- Runtime RPC failure injection was not attempted against the authenticated Leny session. Error/retry behaviour is covered by source contract tests; a dedicated non-production request stub would be required for deterministic runtime injection.
- The active Reports route contains no chart. Future charts require an authoritative series, explicit period/units, a non-colour-only reading path, and evidence that the chart answers a question better than the table.
- RPC/query performance was qualitatively acceptable for the exercised Leny data. UX-11B did not change query sequencing or backend performance.
- Legacy unrouted report-tab code retains TypeScript debt and frontend-derived calculation paths. Removing or reconciling that dead architecture needs a separate technical-cleanup decision; UX-11B did not treat it as the active report source or modify it.
