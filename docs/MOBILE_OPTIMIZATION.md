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
- Growth Batches G1-G2 adds a card-first `/growth-batches` workspace for group-level batch draft/active tracking, measurements, memo direct costs, and lifecycle timelines. Mobile cards must not expose disabled future-scope actions such as stock inputs, mortality, transfers, harvest, completion, reversal, FIFO, COGS, or finance posting.
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
- growth-batch cards and detail sections should show status, family, basis quantity, latest weight, memo cost, location, measurements, and event timeline without requiring horizontal scrolling
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
