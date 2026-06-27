# StockWise Landing Page Style Guide

## Visual Mood

The landing page is a premium business SaaS website. It should feel serious enough for business records, stock control, and finance review, while remaining clear and approachable for small and medium businesses.

Design attributes:

- light-first credibility with true white and pale blue-gray surfaces
- navy/slate text for trust and readability
- restrained blue and teal accents
- controlled dark sections for product showcase and operational contrast
- precise 8px to 12px radii for most surfaces
- thin borders and measured shadows
- compact enterprise typography
- no flashy neon, bokeh blobs, generic 3D, or decorative AI-looking cards

## Layout Rules

- The first viewport must show the StockWise brand, clear headline, CTA, login path, WiseCore proof, and product signal.
- A hint of the next section should be visible on normal desktop viewports.
- Sections should vary rhythm: image-backed hero, operation-fit register, trust strip, problem block, capabilities register, dark product showcase, process, use cases, compliance, pricing, FAQ, team proof, final CTA.
- Cards are used for repeated capabilities, pricing, FAQ, and product notes. Avoid nested cards and decorative section wrappers.
- Product visuals must be realistic and must not fabricate impossible product features.
- The hero uses `/landing/stockwise-records-desk.png` as a full-bleed business-records background, with the StockWise message over the image instead of a split text/mockup layout.
- Keep only one dashboard-style product preview on the page. It belongs in the dark product showcase. If another section needs a visual, use a distinct problem-to-solution or operating-control treatment instead of repeating the same preview.
- The retained product preview must support public light mode and dark mode.
- The everyday-challenges section may reuse the local `/landing/stockwise-records-desk.png` illustrative asset in a framed image card. It should feel like a realistic business-records composition: spreadsheet rows, count sheets, invoices, receipts, payment notes, and calculator context.
- Do not restore the coded collage as the primary visual; it was replaced because it looked too artificial. Do not use external image URLs.

## Typography

- Use the existing Inter stack.
- Hero headline should be confident and direct, not oversized beyond the content.
- Section headings should be smaller than the hero and fit comfortably on mobile.
- Labels may use uppercase only where they act as compact operational labels.
- Letter spacing should stay neutral or modest; avoid exaggerated tracking.

## Interaction

- Navigation links should point to real landing sections.
- Mobile nav must be usable without hover.
- CTA buttons must have visible focus states.
- Product menu hover is acceptable on desktop only if mobile has a direct expanded alternative.
- Pricing cards should have visibly stronger hover and focus-within states than normal cards, while keeping recommended-plan styling distinct from temporary inspection state.
- Pricing-period controls must be keyboard accessible, visible in light and dark mode, and default to monthly.
- Motion must respect reduced motion and stay subtle: section reveal, upward fade-in, card stagger, hover lift, and fast transitions are acceptable.
- Do not add heavy 3D, physics effects, shader backgrounds, or extra animation dependencies.
- Do not use constant distracting object motion. The page should feel fluid while users scroll, not like an animation demo.

## Growth And Costing Claims

Growth Batches copy may describe active lifecycle records, measurements, direct costs, stock inputs, reversals, and audit evidence. Public landing-page copy should describe only verified Growth Batch and costing behavior. Do not state that unverified lifecycle, costing, valuation, or finance-posting behavior is live unless those flows are implemented and verified end to end.

## Icon System

- Use Phosphor Icons for marketing, capability, operational, and decorative landing-page icons.
- Use Lucide only for functional interface affordances such as menu, close, chevrons, and CTA arrows.
- Import only the icons used by the page.
- Avoid one repeated blue rounded-square badge across every card.
- Use smaller inline icons for compact trust-strip, workflow, FAQ, and proof details.
- Reserve larger duotone `IconBadge` treatment for primary capability cards and selected operational cards.
- Use text-led cards with no icon when the icon would only fill space.
- Choose semantic icons: stock visibility, checkout/POS, linked finance documents, governed access, active growth batches, structured records, attention signals, connected records, and stock-before-selling should have distinct silhouettes.

## WiseCore Logo

Use the supplied WiseCore brand source to provide theme-appropriate public assets:

- `/brand/wisecore-logo-light.png` for light mode and structured-data logo references.
- `/brand/wisecore-logo-dark.png` for dark mode.

The logo container should be compact, balanced, and high-contrast. Do not place a tiny logo inside an oversized empty card.

## Public Theme And Language

Public light mode is the primary design target. Dark mode must remain readable and deliberate when the user toggles the public theme.

The public language toggle must keep English and Portuguese copy professional and UTF-8 clean.

## Dependency Position

No new dependencies are planned. The landing page should use the existing React, Tailwind, shadcn-style primitives, approved Phosphor/Lucide icon boundary, and framer-motion dependency already present in the app.
