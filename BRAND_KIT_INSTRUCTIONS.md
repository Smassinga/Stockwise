# StockWise Brand Kit Implementation Instructions

This document provides instructions on how to generate the required PNG icons from the SVG files in the brand kit.

## Prerequisites

1. Node.js installed on your system
2. NPM (Node Package Manager)

## Setup

1. Install the required dependencies:
   ```bash
   npm install
   ```

2. The `sharp` library has already been added to the package.json for image processing.

## Generate Icons

Run the icon generation script:
```bash
npm run generate-icons
```

This will generate all the required PNG icons from the SVG files and place them in the `public` directory.

## Icon Sizes Generated

The script will generate the following icon sizes:
- 16x16
- 32x32
- 48x48
- 64x64
- 128x128
- 192x192
- 256x256
- 512x512

Both light and dark theme versions will be created.

## Files Updated

The following files have been updated to use the new brand kit:
1. `public/manifest.webmanifest` - Updated theme colors and icon references
2. `index.html` - Updated favicon links and theme color
3. `src/components/brand/Mark.tsx` - Updated SVG logo to match brand kit
4. `src/index.css` - Imported new tokens.css
5. `src/tokens.css` - Added brand kit CSS variables
6. `src/components/layout/SwHeader.tsx` - New component using brand kit

## Manual Steps

If you prefer to manually create the icons instead of using the script:

1. Open `public/svgs/stockwise-C-badge.svg` in a graphics editor
2. Export PNG files in all the required sizes listed above
3. Save them in the `public` directory with the naming convention `icon-{size}.png`
4. Repeat for the dark version using `public/svgs/stockwise-C-badge-dark.svg`

## Brand Colors

The brand kit uses the following colors:
- Ink: `#0B1220`
- Blue: `#1565FF`
- Blue Accent (dark mode): `#4DA3FF`

These have been added as CSS variables in `tokens.css`.