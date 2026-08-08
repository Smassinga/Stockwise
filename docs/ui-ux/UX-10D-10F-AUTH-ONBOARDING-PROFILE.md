# UX-10D / UX-10E / UX-10F implementation record

The canonical visual, semantic-state, loading, accessibility, content, and governance rules remain in `docs/premium-ui-direction.md`. This record documents the scoped application of those rules to Login, Onboarding, and User Profile.

## Login and account access

- The public authentication shell is a calm account-access layout rather than a marketing panel.
- Sign-in keeps email, password, password visibility, recovery, verification, resend cooldown, and friendly errors.
- Account creation asks for name, email, password, and confirmation. Phone is optional profile contact information and belongs in Profile.
- Verification and password-recovery links still use the existing callback and session handling. The UI does not expose raw provider errors or claim that automated checks prove accessibility compliance.

## Onboarding and first value

- The flow presents confirmed account, company access, and first operating task as named steps. It does not present invented completion percentages.
- Pending invitations remain explicit, email-bound choices. Creating a company does not remove pending invitations.
- Company creation continues through `create_company_and_bootstrap`, active-company selection, membership confirmation, and existing session refresh behavior.
- Company access is not described as full operational readiness. The completion state offers truthful navigation to add items, import opening data, review company setup, and, for OWNER or ADMIN roles, invite users. These choices are links to maintained routes and are not persisted as an operation type.

## Profile and security

- Profile shows the user identity, account email, optional phone, active company, role, language, theme, security, company-settings boundary, and public support route.
- Personal profile updates retain the existing Supabase Auth metadata and compatible `profiles` synchronization behavior.
- The previous current/new/confirm password form was misleading because it sent a recovery email instead of using the entered values. Profile now exposes one accurately labelled secure email-link action. The actual password update remains on `/update-password` through the existing recovery session.
- Company legal, fiscal, banking, stock, and document configuration remains in Settings.

## Scope and validation contract

UX-10G removed only the redundant page-purpose subheaders retained after this package: the secure-access brand subtitle and obvious sign-in instruction, the generic onboarding workspace subtitle, the Profile page-purpose sentence, and the sentence narrating the language/theme controls. Signup keeps the email-confirmation and company-access sequence because it adds a real prerequisite; Profile keeps password, company-setting, contact, and support consequences because those are not restatements of their headings.

Authenticated Leny QA confirmed the real user, company, and Administrator context; the profile form saved a temporary display-name change through Auth metadata and restored `Samuel Massinga`; PT/EN and theme controls updated the live surface; and no password-reset email was requested. The existing optional `profiles` table mirror remains blocked by its current table permission while Auth metadata remains authoritative. UX-10H records the expected mirror denial as informational diagnostics rather than presenting a successful save as a warning. The duplicated authority model still requires an explicitly approved profile-authority decision rather than weakened RLS or hidden diagnostics.

No Landing, Dashboard, authenticated navigation, pricing, activation, authorization, RLS, RPC, subscription, business logic, schema, or migration behavior is redesigned by this package. Automated lint, source-contract, UI-foundation, build, migration, and TypeScript-debt checks remain engineering signals; keyboard, focus, responsive, locale, theme, reduced-motion, and human accessibility review remain required QA.
