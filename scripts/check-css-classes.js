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
const cssFiles = walk(path.join(root, 'src')).filter((f) => f.endsWith('.css'));

const invalid = new Map();
for (const file of cssFiles) {
  const css = fs.readFileSync(file, 'utf8');
  for (const match of css.matchAll(/\.([_A-Za-z][-_A-Za-z0-9]*)/g)) {
    const className = match[1];
    if (/[A-Z]/.test(className)) {
      if (!invalid.has(file)) invalid.set(file, new Set());
      invalid.get(file).add(className);
    }
  }
}

if (invalid.size) {
  console.error('check-css-classes: uppercase CSS class names found (use kebab-case).');
  for (const [file, names] of invalid.entries()) {
    console.error(`  ${path.relative(root, file)} -> ${[...names].sort().join(', ')}`);
  }
  process.exit(1);
}

console.log(`check-css-classes: OK (${cssFiles.length} CSS files scanned)`);
