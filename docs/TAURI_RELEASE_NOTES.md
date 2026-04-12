# Tauri Release Notes

## Packaging hardening summary

This release hardening pass brought Stockwise's Tauri packaging into a reproducible state for:

- Windows desktop installers
- Android APK distribution outside Play Store

## Main changes

- aligned Tauri app version metadata with `package.json`
- updated Tauri npm and Rust packages to the current 2.x line used in this repo
- moved the app to a shared mobile/desktop Rust entrypoint
- replaced stale Tauri 1-style permission config with Tauri 2 capabilities
- generated and versioned the Android Gradle project
- added maintained Android override templates so regenerated projects keep the Stockwise release behavior
- formalized Android release signing inputs through local-only keystore config or environment variables
- replaced the Windows-hostile Android release path with a direct Gradle release flow
- fixed Android release version fallback so APKs no longer default to `1.0` / `1`

## Authoritative guide

Use [TAURI_RELEASE_WORKFLOW.md](TAURI_RELEASE_WORKFLOW.md) for the maintained desktop and Android release instructions.
