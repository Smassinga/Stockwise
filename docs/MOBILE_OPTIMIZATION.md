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

## What Is Implemented

- the authenticated shell now exposes a clearer mobile path for the highest-value routes
- mobile navigation no longer depends on a desktop-only sidebar mental model
- Point of Sale and opening-data import were built as touch-friendly vertical workflows
- the recent treasury, UOM, items, and assembly refinements were kept responsive instead of being desktop-only rewrites
- the Android runtime now fits inside the system window area instead of drawing app chrome into the status bar space
- the mobile drawer uses a dedicated scroll body so lower navigation entries remain reachable on smaller Android screens
- compact inventory workspaces such as Items, Movements, and Stock Levels now switch to card-style review surfaces instead of relying only on wide desktop tables

## Current Mobile-Sensitive Surfaces

These surfaces matter most when checking Android usability:

- dashboard
- Point of Sale
- items
- assembly
- opening import
- settlements
- banks, cash, and UOM

## What This Means for Future Work

Future UI changes should preserve:

- a limited set of primary mobile actions
- readable typography without shrinking the app into a dense spreadsheet
- single-direction flow per form or task
- explicit empty states and first-use guidance

Future UI changes should avoid:

- forcing four or five actions into one mobile header
- burying key actions only inside hover menus or dense desktop tables
- reintroducing generic demo-style "responsive showcase" code paths

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

If Android packaging is prepared from stale metadata or stale copy, the packaged app will immediately feel older than the web product even if the core frontend is current.
