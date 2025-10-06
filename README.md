# Enhanced Vite React TypeScript Template

This template includes built-in detection for missing CSS variables between your Tailwind config and CSS files.

## Features

- **CSS Variable Detection**: Automatically detects if CSS variables referenced in `tailwind.config.cjs` are defined in `src/index.css`
- **Enhanced Linting**: Includes ESLint, Stylelint, and custom CSS variable validation
- **Shadcn/ui**: Pre-configured with all Shadcn components
- **Modern Stack**: Vite + React + TypeScript + Tailwind CSS
- **Mobile-First Design**: Fully responsive design optimized for all device sizes

## Available Scripts

```bash
# Run all linting (includes CSS variable check)
npm run lint

# Check only CSS variables
npm run check:css-vars

# Individual linting
npm run lint:js    # ESLint
npm run lint:css   # Stylelint
```

## CSS Variable Detection

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
- [Mobile Optimization Guide](docs/MOBILE_OPTIMIZATION.md)

For detailed information about the Stockwise inventory management system, please refer to the documentation files.