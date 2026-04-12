#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const tauriAndroidDir = resolve(repoRoot, 'src-tauri', 'gen', 'android');
const tauriAndroidTemplateDir = resolve(repoRoot, 'scripts', 'templates', 'tauri-android');
const gradleWrapper = resolve(tauriAndroidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

function fail(message) {
  console.error(message);
  process.exit(1);
}

function resolveCommand(command) {
  if (process.platform !== 'win32') {
    return command;
  }

  if (command === 'npx') {
    return 'npx.cmd';
  }

  if (command === 'npm') {
    return 'npm.cmd';
  }

  return command;
}

function quoteWindowsArg(value) {
  if (!value || /[\s"]/u.test(value)) {
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }
  return String(value);
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function loadSimplePropertiesFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .reduce((properties, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex < 0) {
        properties[line] = '';
        return properties;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      properties[key] = value;
      return properties;
    }, {});
}

function syncDirectory(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (entry.isDirectory()) {
      syncDirectory(sourcePath, targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
  }
}

function syncAndroidProjectOverrides() {
  if (!existsSync(tauriAndroidDir) || !existsSync(tauriAndroidTemplateDir)) {
    return;
  }

  syncDirectory(tauriAndroidTemplateDir, tauriAndroidDir);
}

function run(command, args, options = {}) {
  const commandName = resolveCommand(command);
  const spawnOptions = {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  };

  const result =
    process.platform === 'win32'
      ? spawnSync(
          'C:\\Windows\\System32\\cmd.exe',
          ['/d', '/s', '/c', [commandName, ...args].map(quoteWindowsArg).join(' ')],
          spawnOptions,
        )
      : spawnSync(commandName, args, spawnOptions);

  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    process.exit(result.status);
  }
}

function runGradle(args, options = {}) {
  run(gradleWrapper, args, {
    cwd: tauriAndroidDir,
    ...options,
  });
}

function ensureRustTargets() {
  const requiredTargets = ['aarch64-linux-android', 'armv7-linux-androideabi'];
  const installed = spawnSync('rustup', ['target', 'list', '--installed'], {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (installed.error || installed.status !== 0) {
    fail('Unable to inspect installed Rust targets. Make sure rustup is available before building Android artifacts.');
  }

  const installedTargets = new Set(
    installed.stdout
      .split(/\r?\n/)
      .map((target) => target.trim())
      .filter(Boolean),
  );

  const missing = requiredTargets.filter((target) => !installedTargets.has(target));
  if (missing.length > 0) {
    run('rustup', ['target', 'add', ...missing]);
  }
}

function buildAndroidEnv() {
  const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '', 'AppData', 'Local');

  const javaHome = resolveExistingPath([
    process.env.JAVA_HOME,
    'C:\\Program Files\\Android\\Android Studio\\jbr',
  ]);
  if (!javaHome) {
    fail('Android build is blocked because JAVA_HOME is not configured and Android Studio JBR was not found at the default location.');
  }

  const androidHome = resolveExistingPath([
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    join(localAppData, 'Android', 'Sdk'),
  ]);
  if (!androidHome) {
    fail('Android build is blocked because ANDROID_HOME / ANDROID_SDK_ROOT is not configured and the default Android SDK path was not found.');
  }

  const env = { ...process.env };
  env.JAVA_HOME = javaHome;
  env.ANDROID_HOME = androidHome;
  env.ANDROID_SDK_ROOT = androidHome;
  const ndkHome =
    process.env.NDK_HOME ||
    (() => {
      const ndkRoot = join(androidHome, 'ndk');
      if (!existsSync(ndkRoot)) {
        return null;
      }

      const versions = readdirSync(ndkRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

      return versions.length > 0 ? join(ndkRoot, versions[0]) : null;
    })();
  if (ndkHome) {
    env.NDK_HOME = ndkHome;
    const ndkBin = join(ndkHome, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin');
    const minSdk = '24';
    const linkerMap = {
      aarch64_linux_android: join(ndkBin, `aarch64-linux-android${minSdk}-clang.cmd`),
      armv7_linux_androideabi: join(ndkBin, `armv7a-linux-androideabi${minSdk}-clang.cmd`),
      i686_linux_android: join(ndkBin, `i686-linux-android${minSdk}-clang.cmd`),
      x86_64_linux_android: join(ndkBin, `x86_64-linux-android${minSdk}-clang.cmd`),
    };
    const llvmAr = join(ndkBin, 'llvm-ar.exe');

    for (const [envSuffix, linkerPath] of Object.entries(linkerMap)) {
      if (existsSync(linkerPath)) {
        env[`CARGO_TARGET_${envSuffix.toUpperCase()}_LINKER`] = linkerPath;
        env[`CC_${envSuffix}`] = linkerPath;
      }
      if (existsSync(llvmAr)) {
        env[`AR_${envSuffix}`] = llvmAr;
      }
    }
  }

  const keystoreProperties = loadSimplePropertiesFile(join(tauriAndroidDir, 'keystore.properties'));
  if (!env.STOCKWISE_ANDROID_KEYSTORE_PATH && keystoreProperties.storeFile) {
    env.STOCKWISE_ANDROID_KEYSTORE_PATH = keystoreProperties.storeFile;
  }
  if (!env.STOCKWISE_ANDROID_KEYSTORE_PASSWORD && keystoreProperties.storePassword) {
    env.STOCKWISE_ANDROID_KEYSTORE_PASSWORD = keystoreProperties.storePassword;
  }
  if (!env.STOCKWISE_ANDROID_KEY_ALIAS && keystoreProperties.keyAlias) {
    env.STOCKWISE_ANDROID_KEY_ALIAS = keystoreProperties.keyAlias;
  }
  if (!env.STOCKWISE_ANDROID_KEY_PASSWORD && keystoreProperties.keyPassword) {
    env.STOCKWISE_ANDROID_KEY_PASSWORD = keystoreProperties.keyPassword;
  }

  const inheritedPath = env.PATH || env.Path || '';

  const pathEntries = [
    join(javaHome, 'bin'),
    join(androidHome, 'platform-tools'),
    join(androidHome, 'cmdline-tools', 'latest', 'bin'),
    join(androidHome, 'cmdline-tools', 'bin'),
    join(androidHome, 'tools', 'bin'),
    ndkHome ? join(ndkHome, 'toolchains', 'llvm', 'prebuilt', 'windows-x86_64', 'bin') : null,
    inheritedPath,
  ];
  const combinedPath = pathEntries.filter(Boolean).join(process.platform === 'win32' ? ';' : ':');
  env.PATH = combinedPath;
  env.Path = combinedPath;

  return env;
}

const env = buildAndroidEnv();
const [command = 'build', ...args] = process.argv.slice(2);

if (command === 'init' || command === 'build' || command === 'dev' || command === 'run' || command === 'release-apk') {
  ensureRustTargets();
}

if (command === 'init') {
  run('npx', ['tauri', 'android', 'init', ...args], { env });
  syncAndroidProjectOverrides();
} else {
  if (!existsSync(tauriAndroidDir)) {
    run('npx', ['tauri', 'android', 'init', '--ci', 'true'], { env });
  }

  syncAndroidProjectOverrides();
}

if (command === 'init') {
  process.exit(0);
}

if (command === 'release-apk') {
  const wantsSplitPerAbi = args.includes('--split-per-abi');
  const gradleArgs = wantsSplitPerAbi
    ? ['assembleArm64Release', 'assembleArmRelease']
    : ['assembleUniversalRelease'];
  runGradle(gradleArgs, { env });
} else {
  run('npx', ['tauri', 'android', command, ...args], { env });
}
