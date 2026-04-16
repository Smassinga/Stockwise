import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { generateBrandAssets, brandPaths } from './scripts/generate-brand-assets.mjs'

async function main() {
  await generateBrandAssets()

  const tauriCliEntrypoint = fileURLToPath(new URL('./node_modules/@tauri-apps/cli/tauri.js', import.meta.url))
  const result = spawnSync(process.execPath, [tauriCliEntrypoint, 'icon', brandPaths.appIcon, '--output', 'src-tauri/icons'], {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

main().catch((error) => {
  console.error('[tauri-icons] generation failed')
  console.error(error)
  process.exit(1)
})
