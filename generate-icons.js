import { generateBrandAssets } from './scripts/generate-brand-assets.mjs'

generateBrandAssets().catch((error) => {
  console.error('[brand-assets] generation failed')
  console.error(error)
  process.exit(1)
})
