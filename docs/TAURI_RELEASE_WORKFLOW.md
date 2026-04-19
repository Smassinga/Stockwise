# Tauri Release Workflow

This is the authoritative release workflow for StockWise desktop and Android packaging.

## Current Product Assumption

The Tauri builds package the current StockWise app as it exists on the web:

- current StockWise branding
- current Point of Sale route and naming
- current onboarding/import workspace
- current access-control and Platform Control routes
- current Android-first shell behavior

If the frontend is stale, the packaged apps will also be stale.

## Maintained Baseline

- Tauri 2.x
- `package.json` is the single version source of truth
- current package identifier remains `com.stockwise.app`
- current product name is `StockWise`
- the Rust crate/binary remains `stockwise`

## Version Sync

Run:

```bash
npm run tauri:prepare
```

This syncs:

- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/gen/android/app/tauri.properties`

Android versioning rule:

- `versionName = package.json version`
- `versionCode = major * 10000 + minor * 100 + patch`

## Desktop Development

```bash
npm run tauri:dev
```

This launches the current frontend inside the desktop shell after version sync.

## Desktop Release Build

```bash
npm run tauri:desktop:build
```

Expected artifacts land under:

- `src-tauri/target/release/stockwise.exe`
- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

Current caveats:

- Windows code signing is not configured in-repo
- desktop auto-update is not configured

## Android Project Generation

If the generated Android project is missing:

```bash
npm run tauri:android:init
```

This generates the Gradle project and then reapplies the maintained StockWise Android overrides from `scripts/templates/tauri-android/`.

## Android Release Build

Primary direct-sharing build:

```bash
npm run tauri:android:apk
```

Optional split-per-ABI build:

```bash
npm run tauri:android:apk:split
```

Expected artifact roots:

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/`
- `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`
- `src-tauri/gen/android/app/build/outputs/apk/arm/release/`

## Signing Inputs

Do not commit Android signing secrets.

Supported local inputs:

1. `src-tauri/gen/android/keystore.properties`
2. environment variables:
   - `STOCKWISE_ANDROID_KEYSTORE_PATH`
   - `STOCKWISE_ANDROID_KEYSTORE_PASSWORD`
   - `STOCKWISE_ANDROID_KEY_ALIAS`
   - `STOCKWISE_ANDROID_KEY_PASSWORD`

## Why StockWise Uses the Gradle Release Path on Windows

On Windows, the Tauri Android helper still hits a symlink-sensitive native-library step. StockWise therefore uses the generated Gradle project directly for release APK builds, with explicit environment setup and copy-based native-library handling in the local script path.

## Release Readiness Checks

Before treating a Tauri build as release-ready:

1. run `npm run lint:js`
2. run `npm run build`
3. run `npm run test:finance-regression` when the packaged release includes workflow-sensitive changes
4. run `npm run tauri:prepare`
5. verify current branding, route naming, and mobile/app-shell assumptions

## Stability Notes

- keep `com.stockwise.app` for continuity unless there is a deliberate package-id migration plan
- keep signing assets outside the repo
- keep the packaged app aligned with current web UX instead of maintaining a separate desktop-only or Android-only product story
