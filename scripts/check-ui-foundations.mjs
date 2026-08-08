import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(scriptDir, '..')
const sourceRoot = path.join(root, 'src')
const baselinePath = path.join(scriptDir, 'ui-foundations-baseline.json')
const directSemanticColour = /(?:text|bg|border|ring|fill|stroke|outline|shadow)-(?:green|red|yellow|orange|blue|purple|emerald|amber|rose|sky|violet|cyan)(?:-|\/|\b)/g

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(absolutePath, files)
    else if (/\.(?:css|ts|tsx)$/.test(entry.name)) files.push(absolutePath)
  }
  return files
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
const current = new Map()

for (const absolutePath of walk(sourceRoot)) {
  const source = fs.readFileSync(absolutePath, 'utf8')
  const count = source.match(directSemanticColour)?.length ?? 0
  if (count > 0) current.set(path.relative(root, absolutePath).replaceAll('\\', '/'), count)
}

const violations = []
for (const [file, count] of current) {
  const allowed = baseline.files[file] ?? 0
  if (count > allowed) violations.push(`${file}: ${count} direct colour utilities (baseline ${allowed})`)
}

if (violations.length > 0) {
  console.error('check-ui-foundations: new direct Tailwind semantic-colour usage detected')
  for (const violation of violations) console.error(`  ${violation}`)
  console.error('Use the status token family (for example text-status-warning-foreground) or document a genuine brand/data-series exception.')
  process.exit(1)
}

const total = [...current.values()].reduce((sum, count) => sum + count, 0)
const baselineTotal = Object.values(baseline.files).reduce((sum, count) => sum + count, 0)
console.log(`check-ui-foundations: OK (${total} legacy occurrences; baseline maximum ${baselineTotal}; no path increased)`)
