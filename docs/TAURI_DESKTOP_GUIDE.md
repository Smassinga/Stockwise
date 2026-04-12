# Tauri Desktop Guide

This file is the current desktop-specific guide for Stockwise's Tauri shell.

For the combined desktop + Android release workflow, see [TAURI_RELEASE_WORKFLOW.md](TAURI_RELEASE_WORKFLOW.md).

## Current baseline

- Tauri 2.x is the maintained baseline.
- `package.json` is the version source of truth.
- `npm run tauri:prepare` syncs the app version into:
  - `src-tauri/tauri.conf.json`
  - `src-tauri/Cargo.toml`
  - `src-tauri/gen/android/app/tauri.properties` when the Android project exists
- Desktop permissions are declared through Tauri 2 capabilities in `src-tauri/capabilities/main.json`.
- The desktop shell packages the current Vite output from `dist/` through `beforeBuildCommand: npm run build`.

## Desktop development

```bash
npm run tauri:dev
```

This syncs the version metadata, starts the frontend dev server, and launches the Tauri desktop shell.

## Desktop release build

```bash
npm run tauri:desktop:build
```

Expected outputs:

- `src-tauri/target/release/stockwise.exe`
- `src-tauri/target/release/bundle/nsis/Stockwise_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Stockwise_<version>_x64_en-US.msi`

## Notes

- The current bundle identifier remains `com.stockwise.app` for continuity with the existing Android package id. Tauri warns about the `.app` suffix on desktop builds, but changing it now would break package continuity on Android.
- Windows code signing is not configured in-repo. Desktop builds are reproducible, but signed desktop release distribution remains a separate operational step.
- Updater configuration is not enabled. Desktop releases are currently direct-file distribution builds.
