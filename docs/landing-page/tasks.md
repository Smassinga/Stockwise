# StockWise Landing Page Tasks

## Build Checklist

- [x] Define landing brief, style guide, section specs, and task list.
- [x] Rebuild the public landing page around the approved section order.
- [x] Keep CTAs accurate for trial, sign-in, pricing, and support contact.
- [x] Preserve language and theme controls.
- [x] Keep copy free of certification, official SAF-T, instant checkout, and MZN-first claims.
- [x] Keep implementation scoped to public landing files and docs.
- [x] Avoid new dependencies and heavy animation/3D libraries.
- [x] Remove the duplicate dashboard preview and keep one theme-aware product preview.
- [x] Replace the artificial coded business-records collage with the local desk/documents image asset.
- [x] Add lightweight CSS/IntersectionObserver page-level scroll reveal and stagger animation with reduced-motion support.
- [x] Verify desktop, laptop, tablet, and phone layouts.
- [x] Verify pricing section, mobile nav, language switch, theme switch, trial CTA, sign-in CTA, and contact CTA.

## Validation Checklist

- [x] `npm run lint:js`
- [x] `npm run check:css-vars`
- [x] `npm run check:css-classes`
- [x] `npm run build`
- [x] `npm run test:finance-regression`

## Release Notes To Confirm

- The landing page is public marketing only.
- No app workflow logic changed.
- No finance, stock, POS, invoice, settlement, Supabase, or migration logic changed.
- No new dependencies were added.
- The problem section now uses `/landing/stockwise-records-desk.png`; no external image URL is used.
- Page-level animation remains lightweight and CSS/IntersectionObserver-based.
