#!/usr/bin/env node

/**
 * Tauri Setup Script for Stockwise
 * 
 * This script helps automate the initial Tauri setup process
 * for the Stockwise application.
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

console.log('🔧 Setting up Tauri for Stockwise...\n');

// Check if Rust is installed
let rustInstalled = false;
try {
  const rustcVersion = execSync('rustc --version', { encoding: 'utf8' });
  console.log(`✅ Rust is installed: ${rustcVersion.trim()}`);
  rustInstalled = true;
} catch (error) {
  console.log('⚠️  Rust is not found in PATH. Checking alternative locations...');
  
  // Try to find Rust in the default installation location
  const rustupPath = join(process.env.USERPROFILE || '', '.rustup', 'toolchains');
  if (existsSync(rustupPath)) {
    const toolchains = execSync(`dir "${rustupPath}" /b`, { encoding: 'utf8' }).trim().split('\n');
    if (toolchains.length > 0) {
      const latestToolchain = toolchains[0].trim(); // Get the first toolchain (usually the latest)
      const rustcPath = join(rustupPath, latestToolchain, 'bin', 'rustc.exe');
      
      if (existsSync(rustcPath)) {
        console.log(`✅ Found Rust installation at: ${join(rustupPath, latestToolchain)}`);
        rustInstalled = true;
        
        // Try to add to PATH temporarily
        const binPath = join(rustupPath, latestToolchain, 'bin');
        process.env.PATH = `${binPath};${process.env.PATH}`;
        
        // Verify it works now
        try {
          const rustcVersion = execSync('rustc --version', { encoding: 'utf8' });
          console.log(`✅ Rust is now accessible: ${rustcVersion.trim()}`);
        } catch (retryError) {
          console.log('⚠️  Unable to make Rust accessible. You may need to restart your terminal or add Rust to your PATH manually.');
        }
      }
    }
  }
  
  if (!rustInstalled) {
    console.error('❌ Rust is not installed. Please install Rust from https://www.rust-lang.org/tools/install');
    console.log('\nAfter installing Rust, please restart your terminal/command prompt and run this script again.');
    process.exit(1);
  }
}

// Check if Tauri CLI is installed
try {
  execSync('npm list @tauri-apps/cli', { stdio: 'ignore' });
  console.log('✅ Tauri CLI is already installed');
} catch (error) {
  console.log('📦 Installing Tauri CLI...');
  try {
    execSync('npm install -D @tauri-apps/cli', { stdio: 'inherit' });
    console.log('✅ Tauri CLI installed successfully');
  } catch (installError) {
    console.error('❌ Failed to install Tauri CLI');
    process.exit(1);
  }
}

// Check if Tauri API is installed
try {
  execSync('npm list @tauri-apps/api', { stdio: 'ignore' });
  console.log('✅ Tauri API is already installed');
} catch (error) {
  console.log('📦 Installing Tauri API...');
  try {
    execSync('npm install @tauri-apps/api', { stdio: 'inherit' });
    console.log('✅ Tauri API installed successfully');
  } catch (installError) {
    console.error('❌ Failed to install Tauri API');
    process.exit(1);
  }
}

// Check if Tauri Plugins are installed
const plugins = ['@tauri-apps/plugin-dialog', '@tauri-apps/plugin-shell', '@tauri-apps/plugin-fs'];
for (const plugin of plugins) {
  try {
    execSync(`npm list ${plugin}`, { stdio: 'ignore' });
    console.log(`✅ ${plugin} is already installed`);
  } catch (error) {
    console.log(`📦 Installing ${plugin}...`);
    try {
      execSync(`npm install ${plugin}`, { stdio: 'inherit' });
      console.log(`✅ ${plugin} installed successfully`);
    } catch (installError) {
      console.error(`❌ Failed to install ${plugin}`);
      process.exit(1);
    }
  }
}

// Check if Tauri is already initialized
if (existsSync(join(process.cwd(), 'src-tauri'))) {
  console.log('✅ Tauri is already initialized');
} else {
  console.log('🔧 Initializing Tauri...');
  console.log('⚠️  You will need to answer the following prompts:');
  console.log('   - What is your app name?: Stockwise');
  console.log('   - What should the window title be?: Stockwise');
  console.log('   - Where are your web assets located?: ../dist');
  console.log('   - What is the url of your dev server?: http://localhost:3000\n');
  
  try {
    execSync('npm run tauri init', { stdio: 'inherit' });
    console.log('✅ Tauri initialized successfully');
  } catch (initError) {
    console.error('❌ Failed to initialize Tauri');
    process.exit(1);
  }
}

// Create/update package.json scripts
console.log('🔧 Updating package.json scripts...');
try {
  // Add Tauri scripts if they don't exist
  let updated = false;

  try {
    execSync('npm pkg get scripts.tauri', { stdio: 'ignore' });
  } catch (error) {
    execSync('npm pkg set scripts.tauri="tauri"', { stdio: 'inherit' });
    updated = true;
  }

  try {
    execSync('npm pkg get scripts.tauri:dev', { stdio: 'ignore' });
  } catch (error) {
    execSync('npm pkg set scripts.tauri:dev="tauri dev"', { stdio: 'inherit' });
    updated = true;
  }

  try {
    execSync('npm pkg get scripts.tauri:build', { stdio: 'ignore' });
  } catch (error) {
    execSync('npm pkg set scripts.tauri:build="tauri build"', { stdio: 'inherit' });
    updated = true;
  }

  if (updated) {
    console.log('✅ Added Tauri scripts to package.json');
  } else {
    console.log('✅ Tauri scripts already exist in package.json');
  }
} catch (error) {
  console.error('❌ Failed to update package.json scripts');
  console.error('Please add the following scripts manually to your package.json:');
  console.error('  "tauri": "tauri"');
  console.error('  "tauri:dev": "tauri dev"');
  console.error('  "tauri:build": "tauri build"');
}

// Create icons directory if it doesn't exist
const iconsDir = join(process.cwd(), 'src-tauri', 'icons');
if (!existsSync(iconsDir)) {
  mkdirSync(iconsDir, { recursive: true });
  console.log('📁 Created icons directory');
}

console.log('\n🎉 Tauri setup completed!');
console.log('\nNext steps:');
console.log('1. Create app icons in src-tauri/icons/ (32x32.png, 128x128.png, 128x128@2x.png, icon.icns, icon.ico)');
console.log('2. Review and update src-tauri/tauri.conf.json as needed');
console.log('3. Run "npm run tauri:dev" to start the development version');
console.log('4. Run "npm run tauri:build" to create a production build');

console.log('\n📝 Note: If you encounter any issues, make sure to restart your terminal/command prompt after installing Rust.');