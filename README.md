# Enhanced Vite React TypeScript Template

This template includes built-in detection for missing CSS variables between your Tailwind config and CSS files.

## Brand Kit

This project includes a StockWise Concept C Brand Kit implementation. For instructions on how to generate icons and use the brand assets, see [BRAND_KIT_INSTRUCTIONS.md](BRAND_KIT_INSTRUCTIONS.md).

## Features

- **CSS Variable Detection**: Automatically detects if CSS variables referenced in `tailwind.config.cjs` are defined in `src/index.css`
- **Enhanced Linting**: Includes ESLint, Stylelint, and custom CSS variable validation
- **Shadcn/ui**: Pre-configured with all Shadcn components
- **Modern Stack**: Vite + React + TypeScript + Tailwind CSS
- **Mobile-First Design**: Fully responsive design optimized for all device sizes
- **Desktop Support**: Tauri integration for native desktop applications

## Available Scripts

```bash
# Run all linting (includes CSS variable check)
npm run lint

# Check only CSS variables
npm run check:css-vars

# Individual linting
npm run lint:js    # ESLint
npm run lint:css   # Stylelint

# Tauri desktop application
npm run tauri      # Tauri CLI
npm run tauri:dev  # Run Tauri development version
npm run tauri:build # Build Tauri application for distribution
```

For detailed Tauri setup and usage instructions, see [Tauri Desktop Guide](docs/TAURI_DESKTOP_GUIDE.md).

> **Note for Windows users**: If you encounter PATH issues with Rust after installation, try running `scripts\add-rust-to-path.bat` or restart your terminal/command prompt.

The template includes a custom script that:

1. **Parses `tailwind.config.cjs`** to find all `var(--variable)` references
2. **Parses `src/index.css`** to find all defined CSS variables (`--variable:`)
3. **Cross-references** them to find missing definitions
4. **Reports undefined variables** with clear error messages

### Example Output

When CSS variables are missing:
```
❌ Undefined CSS variables found in tailwind.config.cjs:
   --sidebar-background
   --sidebar-foreground
   --sidebar-primary

Add these variables to src/index.css
```

When all variables are defined:
```
✅ All CSS variables in tailwind.config.cjs are defined
```

## How It Works

The detection happens during the `npm run lint` command, which will:
- Exit with error code 1 if undefined variables are found
- Show exactly which variables need to be added to your CSS file
- Integrate seamlessly with your development workflow

This prevents runtime CSS issues where Tailwind classes reference undefined CSS variables.

## Mobile Optimization

Stockwise is designed with a mobile-first approach and includes:

- **Responsive Layout**: Adapts to all screen sizes from mobile to desktop
- **Touch-Friendly Controls**: All interactive elements meet WCAG touch target requirements
- **Performance Optimized**: Lightweight implementation for mobile networks
- **Accessibility Compliant**: Works with screen readers and assistive technologies

For detailed information about mobile optimization, see [Mobile Optimization Guide](docs/MOBILE_OPTIMIZATION.md).

## Documentation

Comprehensive documentation is available in the [docs](docs/) directory:

- [Project Overview](docs/README.md)
- [Development Guide](docs/DEVELOPMENT.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Components](docs/COMPONENTS.md)
- [API Documentation](docs/API.md)
- [Data Model](docs/DATA_MODEL.md)
- [Testing Strategy](docs/TESTING.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Contributing Guide](docs/CONTRIBUTING.md)
- [Code of Conduct](docs/CODE_OF_CONDUCT.md)
- [Mobile Optimization Guide](docs/MOBILE_OPTIMIZATION.md)
- [Tauri Desktop Guide](docs/TAURI_DESKTOP_GUIDE.md)
- [Executive Summary](docs/STOCKWISE_EXECUTIVE_SUMMARY.md)
- [Features Overview](docs/STOCKWISE_FEATURES_OVERVIEW.md)
- [Technical Specification](docs/STOCKWISE_TECHNICAL_SPECIFICATION.md)
- [User Guide](docs/STOCKWISE_USER_GUIDE.md)
- [Deployment Guide](docs/STOCKWISE_DEPLOYMENT_GUIDE.md)
- [Database Schema](docs/STOCKWISE_DATABASE_SCHEMA.md)

For detailed information about the Stockwise inventory management system, please refer to the documentation files.