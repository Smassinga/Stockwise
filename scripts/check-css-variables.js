import fs from 'node:fs';
import path from 'node:path';

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const root = process.cwd();
const tailwindPath = path.join(root, 'tailwind.config.cjs');
if (!fs.existsSync(tailwindPath)) {
  console.log('check-css-variables: tailwind.config.cjs not found, skipping.');
  process.exit(0);
}

const tailwind = fs.readFileSync(tailwindPath, 'utf8');
const used = new Set();
for (const match of tailwind.matchAll(/var\(--([A-Za-z0-9_-]+)\)/g)) {
  used.add(match[1]);
}

const cssFiles = walk(path.join(root, 'src')).filter((f) => f.endsWith('.css'));
const defined = new Set();
for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  for (const match of css.matchAll(/--([A-Za-z0-9_-]+)\s*:/g)) {
    defined.add(match[1]);
  }
}

const ignoredPatterns = [/^radix-/];
const missing = [...used]
  .filter((name) => !defined.has(name))
  .filter((name) => !ignoredPatterns.some((pattern) => pattern.test(name)))
  .sort();

if (missing.length) {
  console.error('check-css-variables: undefined CSS variables referenced in tailwind.config.cjs');
  for (const name of missing) console.error(`  --${name}`);
  process.exit(1);
}

console.log(`check-css-variables: OK (${used.size} vars referenced, ${defined.size} vars defined)`);
