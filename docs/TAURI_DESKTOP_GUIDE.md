# Tauri Desktop Guide

This is the desktop-specific companion to [TAURI_RELEASE_WORKFLOW.md](TAURI_RELEASE_WORKFLOW.md).

## Current Desktop Position

- StockWise desktop packages the same React frontend used on the web
- the shell should expose the same current naming and navigation as the web product, including Point of Sale and onboarding/import
- `package.json` remains the version source of truth
- desktop permissions are declared through `src-tauri/capabilities/main.json`

## Desktop Development

```bash
npm run tauri:dev
```

This runs version sync, starts the frontend dev server, and opens the desktop shell.

## Desktop Release Build

```bash
npm run tauri:desktop:build
```

Artifacts are emitted under:

- `src-tauri/target/release/stockwise.exe`
- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

## Desktop-Specific Limits

- Windows code signing is still a separate operational step
- updater support is not enabled in-repo
- the bundle identifier remains `com.stockwise.app` to preserve Android continuity

## What to Check Before Shipping Desktop

- branding is current StockWise branding
- desktop shell title matches the current product name
- primary routes, especially Point of Sale and Platform Control, still work inside the shell
- the build was prepared from the current frontend, not an older `dist/`
