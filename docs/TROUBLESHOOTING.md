# StockWise Troubleshooting

This file records the current practical troubleshooting cases for this repo. It is not a generic frontend FAQ.

## Supabase Migration Workflow

### `db pull` creates `*_remote_schema.sql`

Cause:

- `npx supabase db pull` can emit a synthetic remote-schema artifact even when replay succeeds.

What to do:

1. review whether the file represents a real intentional schema delta
2. do not treat it as canonical by default
3. keep it out of commits unless it is explicitly accepted
4. run `npm run check:migrations`

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
