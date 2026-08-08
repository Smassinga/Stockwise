# StockWise Landing Page Style Guide

This document applies the canonical rules in `docs/premium-ui-direction.md` to the public Landing Page.

## Visual Direction

- Use WiseCore green, black, charcoal, white, and neutral grayscale.
- Keep the current Inter stack until the separate typography comparison; IBM Plex Sans remains the first candidate.
- Prefer open editorial layouts, dividers, whitespace, strong headings, operating sequences, and real product truth.
- Use cards only for meaningful commercial grouping, such as pricing. Do not turn every problem, capability, trust signal, step, or use case into a card.
- Do not add gradients, glows, blurred orbs, glass, pointer effects, floating objects, marquees, decorative pills, large shadows, or animation to make the page feel modern.

## Hero

The hero is a calm split composition: one specific headline, one concise explanation, one primary CTA, one restrained text action, a truthful manual-activation note, and the approved operating-records illustration. It has no eyebrow pill, floating notices, stat cards, pulse, grid texture, gradient, or overlay stack.

The image caption must identify the desk asset as illustrative rather than customer or live product evidence.

## Information Structure

- Present the purchase-to-review relationship as a static operating chain, never a ticker or row of pills.
- Operation fit uses editorial rows.
- Trust/value uses restrained evidence statements with dividers.
- Problems use numbered statements.
- Capabilities use four larger operating stories instead of a module-card grid.
- Connected traceability uses static selling and purchasing paths, not a coded dashboard preview.
- Implementation uses a five-step timeline.
- Use cases explain how control changes, rather than claiming generic industry fit.
- Pricing may use four plan surfaces because each is a genuine commercial grouping.
- FAQ uses a divider-based disclosure list.

## Interaction And Motion

- Navigation, mobile menu, pricing-period selection, FAQ, language, theme, login, trial, activation, and contact controls must work with keyboard and touch.
- Escape closes the mobile menu and restores focus to its trigger.
- There is no page-level or decorative motion in UX-10C. Shared control transitions must remain non-essential and reduced-motion safe.
- Focus must remain visible in light and dark mode.

## Responsive Behaviour

- Design mobile as a reading sequence, not a compressed desktop arrangement.
- Hero actions become full-width on narrow phones.
- Long operating chains may use contained horizontal scrolling; the page itself must never overflow.
- Editorial rows become a single reading column on phones.
- Prices, document/workflow labels, errors, plan limits, and other decision-critical text must wrap rather than truncate.
- Header language, theme, and menu controls retain at least 44px targets.

## Icons

Lucide is used only for navigation and action affordances such as menu, close, chevron, and directional arrows. The page does not add decorative icon badges. If future marketing illustration needs an icon, use a direct Phosphor import and a clear information-design reason.

## Product Evidence Gap

The repository currently has no suitable maintained current StockWise product screenshot. The Landing therefore uses truthful operating relationships and the labelled desk illustration; it does not fabricate a dashboard. Add a real screenshot only after the asset is captured from an approved environment, reviewed for sensitive data, current product accuracy, locale/theme quality, and mobile crop behaviour.

## Dependencies

UX-10C adds no dependency. The page uses existing React, Tailwind, shared controls, pricing data, brand assets, locale/theme controls, and the maintained FAQ component.
