# StockWise Troubleshooting

This file records the current practical troubleshooting cases for this repo. It is not a generic frontend FAQ.

## Supabase Migration Workflow

For broader incident response, rollback, restore, Auth/email, Edge Function redeploy, and emergency platform-admin procedures, use [AVAILABILITY_AND_RECOVERY.md](AVAILABILITY_AND_RECOVERY.md). For the current enforcement, rate-limiting, monitoring, CI/CD, and scaling baseline, use [SECURITY_AND_SCALE_BASELINE.md](SECURITY_AND_SCALE_BASELINE.md).

### `db pull` creates `*_remote_schema.sql`

Cause:

- `npx supabase db pull` can emit a synthetic remote-schema artifact even when replay succeeds.

What to do:

1. review whether the file represents a real intentional schema delta
2. do not treat it as canonical by default
3. keep it out of commits unless it is explicitly accepted
4. run `npm run check:migrations`
5. if `db pull` or `migration fetch` accidentally records a synthetic artifact in remote migration history, repair only that tracking row after review, for example `npx supabase migration repair --status reverted <version>`

2026-06-03 note:

- remote history entry `20260531145805` was confirmed as an accidental synthetic `*_remote_schema.sql` artifact and repaired with `npx supabase migration repair --status reverted 20260531145805`
- a later pull-generated synthetic artifact `20260603050127_remote_schema.sql` was also inspected, removed, and repaired as reverted after `db pull` recorded it
- neither artifact was accepted as a canonical migration

### Shadow replay fails

Check:

- canonical migration order under `supabase/migrations`
- `supabase/roles.sql`
- whether a pull artifact was accidentally treated as a real migration

## Web App Build and Runtime

### Local dev server assumptions

StockWise uses Vite on port `3000`, not the default `5173`.

Check:

- `npm run dev`
- `vite.config.ts`
- `src-tauri/tauri.conf.json` `devUrl`

### Build passes but the flow is still wrong

Do not stop at `npm run build`.

Also check:

- browser console/runtime errors
- the affected workflow in local preview
- `npm run test:finance-regression` when finance, access, or posting logic changed

## Access and Company State

### New signup enters the app without verification

Expected production behavior:

- Supabase Auth email confirmation is enabled
- signup should show the verification/check-email state
- no company membership, entitlement, finance, inventory, POS, invoice, settlement, valuation, or RLS behavior is changed by this setting

Check:

- Auth config keeps `mailer_autoconfirm=false`
- unverified email sign-ins stay disabled
- Site URL is `https://stockwiseapp.com`
- redirect allow-list includes `https://stockwiseapp.com/auth/callback`
- Brevo-backed Supabase Auth SMTP is configured
- Confirm signup template still uses `{{ .ConfirmationURL }}`

### Auth emails do not arrive or render correctly

Current production delivery path:

- Supabase Auth sends confirm-signup, resend-confirmation, and reset-password emails through Brevo SMTP
- the production Site URL is `https://stockwiseapp.com`
- the callback allow-list must include `https://stockwiseapp.com/auth/callback`

Check:

- Supabase Auth SMTP settings still point to the approved Brevo sender
- the affected template still preserves the required Supabase link variable
- the template keeps a visible CTA, fallback plain link text, support mailto, and "ignore this email" security note
- the HTML remains simple, UTF-8-safe, and email-client compatible
- Brevo delivery logs show accepted/sent status for the recipient
- the recipient provider did not put the message in spam, quarantine, promotions, or a blocked-sender rule

2026-06-05 QA note:

- controlled inboxes received confirm signup, resend confirmation, and reset password messages
- button and fallback links followed Brevo wrappers and reached StockWise after Supabase verification/recovery
- after the 2026-06-05 deployment, reset-password links were verified to reach `/update-password`, update the password through Supabase Auth, return to `/login`, and preserve normal onboarding/dashboard routing after sign-in
- login-before-confirmation was verified to show the resend panel; the resend button sent another Brevo-backed confirmation email and displayed the 60-second cooldown state
- spam placement remains a provider-specific risk because the disposable test inbox had no separate spam/quarantine folder

### Reset password email opens the app but does not show a password update screen

Expected production behavior after the 2026-06-05 recovery fix:

- reset-password button and fallback links exchange the Supabase recovery token successfully
- `/auth/callback` detects the Supabase password recovery event or recovery URL marker
- recovery sessions route to `/update-password` before normal membership-based onboarding/dashboard routing
- the update screen applies the new password through Supabase Auth and then returns the user to `/login`

If a reset link goes directly to `/onboarding` or `/dashboard`, check the auth callback recovery marker first. The fix must preserve Supabase Auth as the only auth system and must not change company membership authority, entitlement logic, Platform Control permissions, finance, inventory, POS, invoice, settlement, valuation, schema, or RLS behavior.

### User can sign in but cannot use the app

Check these separately:

- authentication succeeded
- the user still has an active company membership
- the company is not expired, suspended, or disabled
- the user is not being routed correctly to `/company-access`

## Point of Sale

### POS prefills the wrong price

The intended source is `items.unit_price`.

Check:

- the item is configured as a sellable role
- the item has a default sell price
- no code path is falling back to weighted-average cost or stock valuation

### POS cannot post a simple walk-in sale

Check:

- stock exists in the chosen source bin
- the company has or can create the default cash customer
- the user has `OPERATOR+` authority
- Supabase logs for the dedicated operator sale RPC

## Tauri Desktop and Android

### Version, title, or package metadata looks stale

Run:

```bash
npm run tauri:prepare
```

Then re-check:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/gen/android/app/tauri.properties`

### Android build prerequisites are missing

Check:

- `JAVA_HOME`
- `ANDROID_HOME` or `ANDROID_SDK_ROOT`
- Android SDK installation
- NDK installation
- Rust Android targets

Use:

```bash
npm run tauri:android:init
```

or the current Android release commands from [TAURI_RELEASE_WORKFLOW.md](TAURI_RELEASE_WORKFLOW.md).

### Android package still shows old branding

Check:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/gen/android/app/src/main/res/values/strings.xml`
- current icon assets under `src-tauri/icons`

## Edge Function and Email

### Company-access emails fail

Check:

- required Supabase Edge secrets are present
- the mailer Edge Function is deployed
- the selected company has a canonical recipient
- Supabase Edge Function logs

## When to Escalate

Escalate only after you have the concrete failing command, route, RPC, or log line. StockWise is now past the stage where "it seems broken" is a useful diagnosis.
