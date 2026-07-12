# Android-First UX Position

This document records the current mobile direction for StockWise. It is not a generic responsive-design guide.

## Current Position

Mobile friendliness is a general product concern across the app. It is not the same workstream as Point of Sale and it is not the same workstream as onboarding/import.

Current design rules:

- one screen should do one main job on small screens
- primary routes must stay easy to reach without desktop-style side-navigation dependence
- touch targets must remain comfortably tappable
- avoid dense multi-column admin layouts on phones
- use clearer vertical flow and fewer competing actions per section
- prioritize operator actions such as Start POS, item lookup, stock movements, low-stock review, and recent activity over passive desktop analytics
- compact data-entry screens prioritise inputs/actions first; non-critical explanatory cards should collapse, shorten, or move below the main form while critical validation and warnings stay visible

## What Is Implemented

- the authenticated shell now exposes a clearer mobile path for the highest-value routes
- mobile navigation no longer depends on a desktop-only sidebar mental model
- Point of Sale and opening-data import were built as touch-friendly vertical workflows
- the recent treasury, UOM, items, and assembly refinements were kept responsive instead of being desktop-only rewrites
- the Android runtime now fits inside the system window area instead of drawing app chrome into the status bar space
- the mobile drawer uses a dedicated scroll body so lower navigation entries remain reachable on smaller Android screens
- compact inventory workspaces such as Items, Movements, and Stock Levels now switch to card-style review surfaces instead of relying only on wide desktop tables
- the dashboard now exposes a mobile-first operating flow: Today/status context, Action Needed, Quick Actions, Recent Activity, then deeper performance review
- Items, Movements, and Stock Levels now use the shared premium register pattern: search and filters appear before review content, Android shows cards first, and desktop keeps sortable paginated tables for comparison work
- Movements is treated as a stock-ledger register on Android: type/date/item/warehouse/bin filters stay above the card list, movement badges are semantic, and Details/View source actions remain visible without hover-only controls
- Recipes & Assemblies is now an Android-friendly operational workspace: premium summary cards appear before dense detail, ingredient/component lines render as mobile cards, readiness and estimated material-cost panels are scan-friendly, and the post action remains a single explicit assembly action
- Production Runs is live as a card-first `/production-runs` workspace for planned versus actual production, frozen costs, input buckets, direct costs, preview, posting, and controlled reversal. Draft changes require a fresh readiness preview, and reversal requires the exact run reference before the destructive action is enabled.
- Growth Batches G1-G2 is live as a card-first `/growth-batches` workspace for group-level batch draft/active tracking, measurements, memo direct costs, and lifecycle timelines. Production smoke validated the route at `390` width in light and dark mode with no page-level horizontal overflow, no unlabeled weight, and no missing currency.
- Growth Batches G3 is live with a card-first stock-input workflow for active batches. Authenticated local visual QA passed at `1440`, `1200`, `820`, and `390` in light and dark mode, and production smoke on 2026-06-22 verified preview, single post, stock-input history, MANAGER+ event-specific reversal, restored material cost, restored source stock, and no page-level horizontal scrolling. G4.1 mortality/shrinkage recording and event-specific reversal are live with the same card-first `/growth-batches` direction; production smoke on 2026-06-28 verified mortality/shrinkage preview, single post, loss history, MANAGER+ event-specific reversal, restored quantity/weight, no stock/finance/cost/price mutation, and no second-reversal control after reversal. G4.2 full-batch location transfers and event-specific transfer reversal are live with a card-first Transfers tab and preview-required dialog; the 2026-07-02 corrective smoke verified the detail title/action layout at `1440`, `1366`, `1200`, `1024`, `820`, and `390`, visible transfer history, maintained-UI transfer/reversal, restored location, no stock/finance/cost/price mutation, no second-reversal action, and no page-level horizontal overflow. G5.1 depleting harvests are live with a card-first Harvests tab, preview-required dialog, full-harvest awaiting-completion state, and MANAGER+ event-specific reversal; the 2026-07-03 smoke checked `1440`, `1366`, `1200`, `1024`, `820`, and `390`, English/Portuguese, light/dark where practical, readable harvest history, no action overflow, no raw backend codes, no second-reversal action, and no page-level horizontal overflow. G5.2 completion is live with a card-first Completion tab, preview-required dialog, lifecycle-only copy, and MANAGER+ event-specific completion reversal. The 2026-07-09 production smoke and follow-up localized UI review covered `1440`, `1366`, `1200`, `1024`, `820`, and `390`, English/Portuguese, light/dark, no page-level horizontal overflow, no G5.2 raw codes, and no second-reversal control. Split/child batches, non-depleting yield, whole-batch reversal, FIFO, COGS, fair value, and finance posting remain unavailable.
- onboarding now presents join-invite and create-company as separate mobile decision cards, with invite acceptance kept as an explicit action
- Settings now starts with a mobile-friendly operating setup map so company administrators can jump to real backed setup areas without scanning the entire long form first
- Users/Roles keeps invite controls, role definitions, status badges, and member review usable as stacked cards on phones

## Current Mobile-Sensitive Surfaces

These surfaces matter most when checking Android usability:

- dashboard
- Point of Sale
- items
- onboarding
- settings
- users and roles
- recipes and assemblies
- production runs
- growth batches
- opening import
- settlements
- banks, cash, and UOM

## What This Means for Future Work

Future UI changes should preserve:

- a limited set of primary mobile actions
- readable typography without shrinking the app into a dense spreadsheet
- single-direction flow per form or task
- explicit empty states and first-use guidance
- chart and table content lower in the mobile flow unless it is immediately actionable
- mobile register cards that surface status, location, and the next safe action before exposing wide-table detail
- stock movement cards should show item, type, route, quantity, value, reference, and details without requiring horizontal scrolling
- recipe/assembly cards should show finished item, ingredient/component sufficiency, limiting component, source/destination routing, estimated material cost, and the post action without requiring horizontal scrolling
- production-run cards and detail sections should show status, planned versus actual output, input bucket readiness, estimated versus frozen costs, movement links, and post/reverse actions without requiring horizontal scrolling
- growth-batch cards and detail sections should show status, family, basis quantity, latest weight, memo/direct/material costs, location, measurements, stock-input history, G4.1 loss history, G4.2 transfer history, G5.1 harvest history, G5.2 completion history, and event timeline without requiring horizontal scrolling
- contained horizontal scrolling inside dense Growth Batch desktop/tablet tables is acceptable at intermediate widths such as `1200` and `820` when page/body overflow remains zero and Android cards stay primary at phone width
- premium card icons should use stable badge containers and stack above text on narrow screens when horizontal rows become cramped

Future UI changes should avoid:

- forcing four or five actions into one mobile header
- burying key actions only inside hover menus or dense desktop tables
- reintroducing generic demo-style "responsive showcase" code paths
- copying the desktop dashboard hierarchy directly onto Android

## Tauri Android Implication

The packaged Android build should reflect the same current app shell and navigation assumptions as the web app:

- current StockWise branding
- current Point of Sale naming
- current mobile route structure
- current onboarding/import workspace

Current Android shell/runtime rules:

- the shell must respect safe-area insets at the top and bottom
- the drawer must scroll independently from the page body
- compact pages should prefer stacked cards, filters, and action groups before falling back to horizontal data tables
- dashboard-linked operator workflows should stay one tap away where practical

If Android packaging is prepared from stale metadata or stale copy, the packaged app will immediately feel older than the web product even if the core frontend is current.

## Activation workspace

The live `/activation` workspace stacks the plan, channel, payer, proof, submit, and status-history tasks on narrow screens. File requirements and the verification boundary remain visible at 390 px, long destination/reference text wraps, and Platform Control review dialogs retain scrollable bodies with reachable footer actions. Production checks at `1440`, `1200`, `820`, and `390` confirmed no page overflow or action escape. Lifecycle, status, period, and provider labels render in English and Portuguese rather than exposing raw codes.

## Commercial tax package (live)

SO/PO line entry uses stacked cards on narrow screens and a contained horizontally scrollable table only on larger screens. Tax treatment, taxable base, and tax amount stay adjacent to each line; bulk apply and totals wrap without escaping the sheet. Settings options and Items compatibility controls stack at 390 px. Production QA covered `1440` light English Items, `1200` dark English Sales Order, `820` light Portuguese Purchase Order, and `390` dark Portuguese Vendor Bill. Page-level overflow and raw package codes were zero; the browser console and CSP error counts were zero.
