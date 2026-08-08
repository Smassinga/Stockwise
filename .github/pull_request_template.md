## Summary

Describe the user or operating outcome and the evidence used to verify it. Do not present mock data, screenshots, Lighthouse scores, or automated checks as proof of customers, compliance, production behaviour, or WCAG conformance.

## Validation

- [ ] Required lint, tests, type checks where available, and build pass; no new console errors or warnings were introduced.
- [ ] Mobile behaviour and critical truncation were checked where the change is responsive or data-dense.
- [ ] Loading, empty, error, success, warning, and destructive states were checked where they apply.
- [ ] Status uses semantic tokens plus text, an icon, or another non-colour signal.
- [ ] Keyboard order, visible focus, labels/accessibility names, dialog or drawer focus, and contrast were checked where interactive UI changed.
- [ ] Reduced motion was checked where motion or loading animation changed.
- [ ] The change adds no unnecessary cards, pills, gradients, glow, animation, or decorative copy.
- [ ] Any skipped item is marked not applicable and briefly explained in the PR description.
