import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import toIco from 'to-ico'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')

const sizes = [16, 32, 48, 64, 128, 192, 256, 512]
const appleSizes = [180, 192, 512]
const maskableSizes = [192, 512]
const ogSize = { width: 1200, height: 630 }

export const brandPaths = {
  sourceLogo: path.join(repoRoot, 'src', 'assets', 'brand', 'source', 'stockwise-approved-logo.png'),
  logo: path.join(repoRoot, 'src', 'assets', 'brand', 'stockwise-logo.png'),
  mark: path.join(repoRoot, 'src', 'assets', 'brand', 'stockwise-mark.png'),
  appIcon: path.join(repoRoot, 'src', 'assets', 'brand', 'stockwise-app-icon.png'),
  publicDir: path.join(repoRoot, 'public'),
  publicBrandDir: path.join(repoRoot, 'public', 'brand'),
}

function isNearWhite(r, g, b, a, threshold = 244) {
  return a > 0 && r >= threshold && g >= threshold && b >= threshold
}

function isForeground(r, g, b, a, threshold = 244) {
  return a > 0 && (r < threshold || g < threshold || b < threshold)
}

function findBounds(data, info) {
  let minX = info.width
  let minY = info.height
  let maxX = -1
  let maxY = -1

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const idx = (y * info.width + x) * info.channels
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (!isForeground(r, g, b, a)) continue
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < 0 || maxY < 0) {
    throw new Error('Could not detect a visible logo area in the approved source asset.')
  }

  return { minX, minY, maxX, maxY }
}

function expandBounds(bounds, info, padding) {
  return {
    left: Math.max(0, bounds.minX - padding),
    top: Math.max(0, bounds.minY - padding),
    width: Math.min(info.width - Math.max(0, bounds.minX - padding), bounds.maxX - bounds.minX + 1 + padding * 2),
    height: Math.min(info.height - Math.max(0, bounds.minY - padding), bounds.maxY - bounds.minY + 1 + padding * 2),
  }
}

function stripOuterBackground(data, info) {
  const visited = new Uint8Array(info.width * info.height)
  const queue = []

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) return
    const key = y * info.width + x
    if (visited[key]) return
    const idx = key * info.channels
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    const a = data[idx + 3]
    if (!isNearWhite(r, g, b, a)) return
    visited[key] = 1
    queue.push(key)
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x, 0)
    enqueue(x, info.height - 1)
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(0, y)
    enqueue(info.width - 1, y)
  }

  while (queue.length) {
    const key = queue.shift()
    const x = key % info.width
    const y = Math.floor(key / info.width)
    enqueue(x + 1, y)
    enqueue(x - 1, y)
    enqueue(x, y + 1)
    enqueue(x, y - 1)
  }

  const out = Buffer.from(data)
  for (let key = 0; key < visited.length; key += 1) {
    if (!visited[key]) continue
    out[key * info.channels + 3] = 0
  }
  return out
}

function findMarkSplit(data, info) {
  const activeColumns = Array.from({ length: info.width }, () => 0)

  for (let x = 0; x < info.width; x += 1) {
    let active = 0
    for (let y = 0; y < info.height; y += 1) {
      const idx = (y * info.width + x) * info.channels
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const a = data[idx + 3]
      if (isForeground(r, g, b, a)) active += 1
    }
    activeColumns[x] = active
  }

  const activeThreshold = 3
  let seenForeground = false
  let gapRun = 0
  let fallbackEnd = Math.floor(info.width * 0.24)

  for (let x = 0; x < activeColumns.length; x += 1) {
    if (activeColumns[x] > activeThreshold) {
      seenForeground = true
      gapRun = 0
      fallbackEnd = x
      continue
    }

    if (!seenForeground) continue
    gapRun += 1
    if (gapRun >= 18) {
      return Math.max(0, x - gapRun)
    }
  }

  return fallbackEnd
}

function svgTextOverlay({ width, height, headline, body, dark = false }) {
  const textColor = dark ? '#F8FAFC' : '#071427'
  const subColor = dark ? '#CBD5E1' : '#42526B'
  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .headline { font: 700 46px "Segoe UI", "Inter", sans-serif; fill: ${textColor}; }
        .body { font: 400 24px "Segoe UI", "Inter", sans-serif; fill: ${subColor}; }
      </style>
      <text x="88" y="420" class="headline">${headline}</text>
      <text x="88" y="466" class="body">${body}</text>
    </svg>
  `)
}

async function writePng(buffer, info, outputPath) {
  await sharp(buffer, { raw: info }).png().toFile(outputPath)
}

async function generateLogoCrops() {
  const { data, info } = await sharp(brandPaths.sourceLogo)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const fullBounds = expandBounds(findBounds(data, info), info, 24)
  const cropped = await sharp(brandPaths.sourceLogo)
    .extract(fullBounds)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const transparentLogo = stripOuterBackground(cropped.data, cropped.info)
  await writePng(transparentLogo, cropped.info, brandPaths.logo)

  const splitX = findMarkSplit(cropped.data, cropped.info)
  const markRaw = await sharp(cropped.data, { raw: cropped.info })
    .extract({
      left: 0,
      top: 0,
      width: Math.max(1, splitX + 18),
      height: cropped.info.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const markBounds = expandBounds(findBounds(markRaw.data, markRaw.info), markRaw.info, 12)
  const markCrop = await sharp(markRaw.data, { raw: markRaw.info })
    .extract(markBounds)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const transparentMark = stripOuterBackground(markCrop.data, markCrop.info)
  await writePng(transparentMark, markCrop.info, brandPaths.mark)
}

async function generateSquareIcon(background) {
  const markBuffer = await sharp(brandPaths.mark).resize(690, 690, { fit: 'contain' }).png().toBuffer()
  return sharp({
    create: {
      width: 1024,
      height: 1024,
      channels: 4,
      background,
    },
  })
    .composite([{ input: markBuffer, left: 167, top: 167 }])
    .png()
    .toBuffer()
}

async function generatePublicAssets(lightIcon, darkIcon) {
  await fs.mkdir(brandPaths.publicDir, { recursive: true })
  await fs.mkdir(brandPaths.publicBrandDir, { recursive: true })

  await sharp(brandPaths.logo).png().toFile(path.join(brandPaths.publicBrandDir, 'stockwise-logo.png'))
  await sharp(brandPaths.mark).png().toFile(path.join(brandPaths.publicBrandDir, 'stockwise-mark.png'))

  for (const size of sizes) {
    await sharp(lightIcon).resize(size, size).png().toFile(path.join(brandPaths.publicDir, `icon-${size}.png`))
    await sharp(darkIcon).resize(size, size).png().toFile(path.join(brandPaths.publicDir, `icon-${size}-dark.png`))
  }

  const faviconIco = await toIco([
    await sharp(lightIcon).resize(16, 16).png().toBuffer(),
    await sharp(lightIcon).resize(32, 32).png().toBuffer(),
    await sharp(lightIcon).resize(48, 48).png().toBuffer(),
  ])
  await fs.writeFile(path.join(brandPaths.publicDir, 'favicon.ico'), faviconIco)

  for (const size of appleSizes) {
    const name = size === 180 ? 'apple-touch-icon.png' : `apple-touch-icon-${size}.png`
    await sharp(lightIcon).resize(size, size).png().toFile(path.join(brandPaths.publicDir, name))
  }

  for (const size of maskableSizes) {
    await sharp(lightIcon).resize(size, size).png().toFile(path.join(brandPaths.publicDir, `maskable-${size}.png`))
    await sharp(darkIcon).resize(size, size).png().toFile(path.join(brandPaths.publicDir, `maskable-${size}-dark.png`))
  }
}

async function generateOgCovers() {
  const lightBackground = Buffer.from(`
    <svg width="${ogSize.width}" height="${ogSize.height}" viewBox="0 0 ${ogSize.width} ${ogSize.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F8FBFF"/>
          <stop offset="100%" stop-color="#EEF4FF"/>
        </linearGradient>
      </defs>
      <rect width="${ogSize.width}" height="${ogSize.height}" fill="url(#bg)"/>
      <circle cx="1040" cy="112" r="160" fill="#DCEBFF"/>
      <circle cx="180" cy="544" r="180" fill="#EAF2FF"/>
    </svg>
  `)
  const darkBackground = Buffer.from(`
    <svg width="${ogSize.width}" height="${ogSize.height}" viewBox="0 0 ${ogSize.width} ${ogSize.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#071427"/>
          <stop offset="100%" stop-color="#0B1220"/>
        </linearGradient>
      </defs>
      <rect width="${ogSize.width}" height="${ogSize.height}" fill="url(#bg)"/>
      <circle cx="1050" cy="118" r="170" fill="#0E2748"/>
      <circle cx="170" cy="548" r="190" fill="#102B4D"/>
    </svg>
  `)

  const logoBuffer = await sharp(brandPaths.logo).resize({ width: 520 }).png().toBuffer()

  await sharp(lightBackground)
    .composite([
      { input: logoBuffer, left: 84, top: 132 },
      {
        input: svgTextOverlay({
          width: ogSize.width,
          height: ogSize.height,
          headline: 'Stock, finance, and operations in one workspace',
          body: 'Inventory control, orders, settlements, and finance discipline for Mozambique-based teams.',
        }),
      },
    ])
    .png()
    .toFile(path.join(brandPaths.publicDir, 'og-cover.png'))

  await sharp(darkBackground)
    .composite([
      { input: logoBuffer, left: 84, top: 132 },
      {
        input: svgTextOverlay({
          width: ogSize.width,
          height: ogSize.height,
          headline: 'Stock, finance, and operations in one workspace',
          body: 'Inventory control, orders, settlements, and finance discipline for Mozambique-based teams.',
          dark: true,
        }),
      },
    ])
    .png()
    .toFile(path.join(brandPaths.publicDir, 'og-cover-dark.png'))
}

export async function generateBrandAssets() {
  await fs.mkdir(path.dirname(brandPaths.logo), { recursive: true })

  await generateLogoCrops()

  const lightIcon = await generateSquareIcon('#FFFFFF')
  const darkIcon = await generateSquareIcon('#071427')

  await sharp(lightIcon).png().toFile(brandPaths.appIcon)
  await generatePublicAssets(lightIcon, darkIcon)
  await generateOgCovers()
}

if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  generateBrandAssets().catch((error) => {
    console.error('[brand-assets] generation failed')
    console.error(error)
    process.exitCode = 1
  })
}
