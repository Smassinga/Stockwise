#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..');
const packageJsonPath = resolve(repoRoot, 'package.json');
const cargoTomlPath = resolve(repoRoot, 'src-tauri', 'Cargo.toml');
const tauriConfigPath = resolve(repoRoot, 'src-tauri', 'tauri.conf.json');
const androidTauriPropertiesPath = resolve(repoRoot, 'src-tauri', 'gen', 'android', 'app', 'tauri.properties');

function parseVersionCode(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format "${version}". Expected semantic versioning like 1.2.0.`);
  }

  const [, major, minor, patch] = match;
  return Number(major) * 10000 + Number(minor) * 100 + Number(patch);
}

function replaceCargoVersion(contents, version) {
  return contents.replace(/^version = ".*"$/m, `version = "${version}"`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const version = packageJson.version;
const versionCode = Number(process.env.STOCKWISE_ANDROID_VERSION_CODE || parseVersionCode(version));

const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
tauriConfig.version = version;
writeFileSync(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, 'utf8');

const cargoToml = readFileSync(cargoTomlPath, 'utf8');
writeFileSync(cargoTomlPath, replaceCargoVersion(cargoToml, version), 'utf8');

if (existsSync(dirname(androidTauriPropertiesPath))) {
  writeFileSync(
    androidTauriPropertiesPath,
    `tauri.android.versionCode=${versionCode}\ntauri.android.versionName=${version}\n`,
    'utf8',
  );
}

console.log(`Synced Tauri release version ${version} (Android versionCode ${versionCode}).`);
