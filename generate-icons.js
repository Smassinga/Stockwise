/**
 * Script to generate PNG icons from SVG files
 * Run this script with Node.js after installing dependencies:
 * npm install sharp
 */

import sharp from 'sharp';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const sizes = [16, 32, 48, 64, 128, 192, 256, 512];
const svgSource = path.join(__dirname, 'public', 'svgs', 'stockwise-C-badge.svg');
const svgSourceDark = path.join(__dirname, 'public', 'svgs', 'stockwise-C-badge-dark.svg');
const outputDir = path.join(__dirname, 'public');

async function generateIcons() {
  try {
    // Ensure the output directory exists
    await fs.mkdir(outputDir, { recursive: true });
    
    // Generate light theme icons
    console.log('Generating light theme icons...');
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `icon-${size}.png`);
      await sharp(svgSource)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated: icon-${size}.png`);
    }
    
    // Generate dark theme icons
    console.log('Generating dark theme icons...');
    for (const size of sizes) {
      const outputPath = path.join(outputDir, `icon-${size}-dark.png`);
      await sharp(svgSourceDark)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated: icon-${size}-dark.png`);
    }
    
    // Generate apple touch icons
    console.log('Generating Apple touch icons...');
    const appleSizes = [180, 192, 512];
    for (const size of appleSizes) {
      const outputPath = path.join(outputDir, `apple-touch-icon${size === 180 ? '' : `-${size}`}.png`);
      await sharp(svgSource)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated: apple-touch-icon${size === 180 ? '' : `-${size}`}.png`);
    }
    
    // Generate maskable icons
    console.log('Generating maskable icons...');
    for (const size of [192, 512]) {
      const outputPath = path.join(outputDir, `maskable-${size}.png`);
      await sharp(svgSource)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated: maskable-${size}.png`);
    }
    
    for (const size of [192, 512]) {
      const outputPath = path.join(outputDir, `maskable-${size}-dark.png`);
      await sharp(svgSourceDark)
        .resize(size, size)
        .png()
        .toFile(outputPath);
      console.log(`Generated: maskable-${size}-dark.png`);
    }
    
    console.log('All icons generated successfully!');
  } catch (error) {
    console.error('Error generating icons:', error);
  }
}

// Run the script
generateIcons();