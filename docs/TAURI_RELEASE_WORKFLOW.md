# Tauri Release Workflow

This is the authoritative packaging and release note for Stockwise's Tauri desktop and Android targets.

## State before hardening

- The project was already on Tauri 2, not Tauri 1.
- Desktop and Android metadata were inconsistent:
  - `package.json` was `1.2.0`
  - `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` were still `0.1.0`
- The generated Android project defaulted to:
  - `versionCode = 1`
  - `versionName = 1.0`
  when `app/tauri.properties` was missing.
- Android release signing was not formalized in-repo.
- Windows desktop packaging worked, but Android release packaging depended on ad hoc local toolchain state.
- The generated Android build path on Windows still hit a symlink-based `.so` copy step that fails when Developer Mode is not enabled.

## Current maintained baseline

- Tauri CLI: `2.10.1`
- Tauri Rust crates: `2.10.x`
- Plugins kept:
  - dialog
  - fs
  - shell
- Shared mobile/desktop entrypoint:
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/main.rs`
- Tauri 2 capability file:
  - `src-tauri/capabilities/main.json`
- Windows bundle override:
  - `src-tauri/tauri.windows.conf.json`
- Android override templates:
  - `scripts/templates/tauri-android/`

## Versioning rule

`package.json` is the single version source of truth.

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

Example:

- `1.2.0` -> `versionName 1.2.0`
- `1.2.0` -> `versionCode 10200`

## Desktop release flow

Command:

```bash
npm run tauri:desktop:build
```

What it does:

1. syncs version metadata
2. rebuilds the frontend
3. packages the current `dist/` bundle into the Tauri shell
4. emits Windows release artifacts

Expected outputs:

- `src-tauri/target/release/stockwise.exe`
- `src-tauri/target/release/bundle/nsis/Stockwise_<version>_x64-setup.exe`
- `src-tauri/target/release/bundle/msi/Stockwise_<version>_x64_en-US.msi`

Current caveats:

- Windows desktop code signing is not configured in-repo.
- Tauri updater is not configured.

## Android release flow

### One-time project generation

If `src-tauri/gen/android/` is missing:

```bash
npm run tauri:android:init
```

This generates the Android Gradle project from the Tauri 2 mobile shell.

Stockwise then reapplies its maintained Android overrides automatically from `scripts/templates/tauri-android/`, so the generated project keeps:

- release signing support
- copy-based JNI library placement on Windows
- explicit NDK linker wiring compatibility with the local release script

### Local signing inputs

Do not commit signing secrets.

Supported local inputs:

1. `src-tauri/gen/android/keystore.properties` from `keystore.properties.example`
2. environment variables:
   - `STOCKWISE_ANDROID_KEYSTORE_PATH`
   - `STOCKWISE_ANDROID_KEYSTORE_PASSWORD`
   - `STOCKWISE_ANDROID_KEY_ALIAS`
   - `STOCKWISE_ANDROID_KEY_PASSWORD`

The repo ignores:

- `src-tauri/gen/android/keystore.properties`
- `*.jks`
- `*.keystore`
- related private key material

### Release APK for direct sharing

Primary command:

```bash
npm run tauri:android:apk
```

What it does:

1. syncs version metadata
2. rebuilds the frontend
3. ensures Android SDK/JBR/NDK env resolution on Windows
4. ensures required Rust Android targets are installed
5. builds a signed universal release APK through Gradle

Expected output:

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`

Optional smaller ABI-specific APKs:

```bash
npm run tauri:android:apk:split
```

Expected outputs:

- `src-tauri/gen/android/app/build/outputs/apk/arm64/release/app-arm64-release.apk`
- `src-tauri/gen/android/app/build/outputs/apk/arm/release/app-arm-release.apk`

### Why the Android release path does not use `tauri android build`

On Windows, the current Tauri CLI Android helper still attempts a symlink-based native-library step for the generated project. That fails without Windows Developer Mode or elevated symlink permission.

Stockwise now uses the generated Gradle project directly for release APK builds, with explicit NDK linker wiring and a copy-based native-library step. This keeps the Android release path reproducible on this machine without weakening signing or version discipline.

## Current artifact locations

Desktop:

- `src-tauri/target/release/stockwise.exe`
- `src-tauri/target/release/bundle/nsis/`
- `src-tauri/target/release/bundle/msi/`

Android:

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/`
- `src-tauri/gen/android/app/build/outputs/apk/arm64/release/`
- `src-tauri/gen/android/app/build/outputs/apk/arm/release/`

## Likely provenance of the earlier WhatsApp APK

Repo evidence shows the Android path already existed in practice:

- Tauri mobile support was already present
- the Android project could be generated from the repo
- the package id was already `com.stockwise.app`

The most likely explanation is:

- someone previously built the APK from the existing Tauri Android path
- the generated Android project was using its fallback metadata
  - `versionCode = 1`
  - `versionName = 1.0`
- that is why the installed app showed a generic `Version 1` style value

What cannot be proven from repo state alone:

- whether that WhatsApp APK was debug or release-signed
- whether it was built through Android Studio or a Tauri CLI command

What is now explicit:

- the current supported direct-sharing artifact is the signed universal release APK
- the current controlled version is taken from `package.json`, not the Android default fallback

## Security and maintenance notes

- Keep the keystore outside the repo.
- Keep `keystore.properties` local-only.
- Do not change `com.stockwise.app` casually, because existing Android installs depend on that package id.
- The identifier suffix `.app` is not ideal for desktop naming, but it was retained to avoid breaking Android continuity.
