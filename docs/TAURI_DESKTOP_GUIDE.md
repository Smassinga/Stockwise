# Tauri Desktop Application Guide for Stockwise

This guide provides step-by-step instructions for adding Tauri desktop support to the Stockwise application, allowing you to build a native desktop executable for Windows, macOS, and Linux.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Project Setup](#project-setup)
5. [Configuration](#configuration)
6. [Development](#development)
7. [Building](#building)
8. [Troubleshooting](#troubleshooting)
9. [Maintenance](#maintenance)

## Overview

Tauri is a framework for building tiny, blazing fast binaries for all major desktop platforms. It leverages web technologies like HTML, CSS, and JavaScript/TypeScript to create cross-platform desktop applications with a small footprint.

> **Note**: This guide uses Tauri 2.x, which includes significant improvements over Tauri 1.x including better performance, enhanced security, and a more modular plugin system.

For Stockwise, this means:
- Leveraging your existing React/Vite application
- Creating native desktop installers for Windows (.exe), macOS (.app), and Linux (.deb/.AppImage)
- Accessing system APIs not available in web browsers
- Improved performance compared to Electron

## Prerequisites

Before starting, ensure you have:

1. **Rust** (required for Tauri):
   ```bash
   # Visit https://www.rust-lang.org/tools/install for official installation
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **Node.js** (you already have this for your Vite project):
   - Version 16 or higher

3. **System-specific dependencies**:
   - **Windows**: Visual Studio C++ Build Tools or Visual Studio Community
   - **macOS**: Xcode command line tools
   - **Linux**: WebView2 (for Ubuntu/Debian):
     ```bash
     sudo apt install libwebkit2gtk-4.0-dev build-essential curl wget libssl-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev
     ```

> **Note**: Tauri 2.x requires Rust 1.70 or higher.

## Installation

There are two ways to set up Tauri:

### Option 1: Automated Setup (Recommended)

Run the provided setup script which will automatically install dependencies and initialize Tauri:

```bash
node scripts/setup-tauri.mjs
```

### Option 2: Manual Setup

1. Install Tauri CLI as a dev dependency:
   ```bash
   npm install -D @tauri-apps/cli
   ```

2. Install Tauri API (for accessing system features):
   ```bash
   npm install @tauri-apps/api
   ```

3. Install Tauri Plugins (for extended functionality):
   ```bash
   npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-shell @tauri-apps/plugin-fs
   ```

> **Note**: This guide uses Tauri 2.x. If you have previously installed Tauri 1.x packages, you may need to uninstall them first:
> ```bash
> npm uninstall @tauri-apps/cli @tauri-apps/api
> ```

3. Initialize Tauri in your existing project:
   ```bash
   npm run tauri init
   ```

## Project Setup

Initialize Tauri in your existing project:

1. From your project root, run:
   ```bash
   npm run tauri init
   ```

2. When prompted, provide the following information:
   - **What is your app name?**: Stockwise
   - **What should the window title be?**: Stockwise
   - **Where are your web assets (HTML/CSS/JS) located, relative to the "<current dir>/src-tauri/tauri.conf.json" file that will be created?**: ../dist
   - **What is the url of your dev server?**: http://localhost:3000

This will create a `src-tauri` directory with the necessary configuration files.

## Configuration

### 1. Update package.json

Add Tauri scripts to your [package.json](file:///c:/Dev/Stockwise/package.json):

```json
{
  "scripts": {
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build"
  }
}
```

### 2. Configure tauri.conf.json

The Tauri configuration file is located at `src-tauri/tauri.conf.json`. Here's a recommended configuration for Stockwise:

```json
{
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devPath": "http://localhost:3000",
    "distDir": "../dist"
  },
  "package": {
    "productName": "Stockwise",
    "version": "0.1.0"
  },
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": {
        "all": false,
        "open": true
      },
      "dialog": {
        "all": true
      },
      "fs": {
        "all": true,
        "scope": ["$APPDATA/**", "$LOCALDATA/**"]
      },
      "path": {
        "all": true
      }
    },
    "bundle": {
      "active": true,
      "targets": "all",
      "identifier": "com.stockwise.app",
      "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
      ]
    },
    "security": {
      "csp": null
    },
    "windows": [
      {
        "fullscreen": false,
        "resizable": true,
        "title": "Stockwise",
        "width": 1200,
        "height": 800,
        "minWidth": 1024,
        "minHeight": 768
      }
    ]
  }
}
```

### 3. Create Icons

Create the required icons in `src-tauri/icons/`:
- 32x32.png
- 128x128.png
- 128x128@2x.png
- icon.icns (for macOS)
- icon.ico (for Windows)

You can generate these from your existing app logo using online tools or image editors.

## Development

### Running the Development Version

To run the Tauri development version with hot reloading:

```bash
npm run tauri:dev
```

This will:
1. Start your Vite development server on port 3000
2. Launch the Tauri desktop application
3. Automatically reload when you make changes to your frontend code

### Accessing Tauri APIs

To use Tauri APIs in your React components, you have two options:

1. **Direct imports** (requires handling fallbacks yourself):

```typescript
import { open } from '@tauri-apps/plugin-dialog';

// Example: Open a file dialog
const selected = await open({
  multiple: false,
  filters: [{
    name: 'Excel Files',
    extensions: ['xlsx', 'xls']
  }]
});
```

2. **Using the Stockwise Tauri wrapper** (recommended):

The project includes a wrapper library at [src/lib/tauri.ts](file:///c:/Dev/Stockwise/src/lib/tauri.ts) that provides graceful fallbacks for web browser environments:

```typescript
import { showOpenDialog, openPath, showMessageDialog } from '@/lib/tauri';

// Example: Open a file dialog
const selected = await showOpenDialog({
  multiple: false,
  filters: [{
    name: 'Excel Files',
    extensions: ['xlsx', 'xls']
  }]
});

// This will work in both Tauri and web browser contexts
```

There's also a demo component at [src/components/TauriDemo.tsx](file:///c:/Dev/Stockwise/src/components/TauriDemo.tsx) that shows practical usage examples.

## Building

### Creating a Production Build

To build the application for distribution:

```bash
npm run tauri:build
```

This will:
1. Build your Vite application (npm run build)
2. Bundle the Tauri application with your frontend
3. Create platform-specific installers in `src-tauri/target/release/bundle/`

### Build Output

The build process will generate:
- **Windows**: `.msi` and `.exe` installers
- **macOS**: `.app` bundle and `.dmg` installer
- **Linux**: `.deb` package and `.AppImage`

## Troubleshooting

### Common Issues

1. **Rust compilation errors**:
   ```bash
   # Update Rust
   rustup update
   
   # Update Tauri CLI
   cargo install tauri-cli --force
   ```

2. **'rustc' is not recognized as an internal or external command**:
   This error occurs when Rust is installed but not added to your system PATH. This can happen on Windows if:
   - You installed Rust but didn't restart your terminal
   - The installation didn't add Rust to PATH automatically
   
   **Solutions**:
   - Restart your terminal/command prompt after installing Rust
   - Manually add Rust to your PATH:
     - Default Rust installation path: `%USERPROFILE%\.cargo\bin`
     - Add this path to your system environment variables
   - On Windows, you can also try running the helper script: `scripts\add-rust-to-path.bat`
   - Run the setup script which will attempt to locate and use your Rust installation

3. **WebView2 missing (Windows)**:
   - Download and install the Evergreen Bootstrapper from Microsoft

4. **Permission errors**:
   - Ensure your allowlist configuration matches the APIs you're using
   - Check that file system scopes are properly configured

5. **CORS issues**:
   - Tauri apps don't have CORS restrictions, but ensure your backend allows requests from `tauri://localhost`

### Debugging

1. **Enable logging**:
   ```bash
   # Set environment variable for verbose logging
   set RUST_LOG=tauri=debug
   npm run tauri:dev
   ```

2. **Inspect elements**:
   - Right-click in the Tauri app and select "Inspect Element" (similar to browser dev tools)

## Maintenance

### Updating Tauri

To update Tauri to the latest version:

```bash
npm install @tauri-apps/cli@latest @tauri-apps/api@latest
```

### Version Management

Update the version in:
1. [package.json](file:///c:/Dev/Stockwise/package.json) - for npm package version
2. `src-tauri/tauri.conf.json` - for Tauri app version

### CI/CD Considerations

For automated builds:
1. Ensure your CI environment has Rust installed
2. Cache the `src-tauri/target` directory for faster builds
3. Use `tauri build --verbose` for detailed build logs

## Additional Features

### Custom Commands

You can create custom Rust functions that can be called from your frontend:

1. In `src-tauri/src/main.rs`:
   ```rust
   #[tauri::command]
   fn my_custom_command(payload: &str) -> String {
       format!("Received: {}", payload)
   }
   
   fn main() {
       tauri::Builder::default()
           .invoke_handler(tauri::generate_handler![my_custom_command])
           .run(tauri::generate_context!())
           .expect("error while running tauri application");
   }
   ```

2. In your React component:
   ```typescript
   import { invoke } from '@tauri-apps/api/tauri';
   
   const result = await invoke('my_custom_command', { payload: 'Hello Tauri!' });
   ```

### Tauri Plugins

The following Tauri plugins have been installed for enhanced functionality:

1. **@tauri-apps/plugin-dialog** - System dialogs (open/save file dialogs, message dialogs)
2. **@tauri-apps/plugin-shell** - Shell operations (opening URLs/files with default applications)
3. **@tauri-apps/plugin-fs** - File system operations (reading/writing files)

These plugins are already configured in the allowlist section of `tauri.conf.json`.

### System Tray

To add a system tray icon, modify your Tauri configuration and add the necessary Rust code.

### Auto-updater

Tauri includes an auto-updater feature that can be configured to automatically download and install updates.

## Next Steps

1. Implement any required Tauri APIs for desktop-specific features
2. Test the application on all target platforms
3. Set up automated builds for distribution
4. Configure code signing for production releases
5. Implement analytics or crash reporting if needed

## Resources

- [Official Tauri Documentation](https://tauri.app/)
- [Tauri API Documentation](https://tauri.app/v1/api/js/)
- [Tauri Examples](https://github.com/tauri-apps/tauri/tree/dev/examples)