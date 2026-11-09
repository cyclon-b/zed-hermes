/**
 * Static checks: syntax + catalog sanity. Runs in CI before tests.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  BUILTIN_ADVERTISED,
  DEFAULT_CATALOG,
  OPTIONAL_CATALOG,
  normalizeCatalog,
  shadowedByBuiltins,
} from '../lib/commands.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const failures = [];

for (const file of jsFiles(root)) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (cause) {
    failures.push(`syntax: ${file}: ${String(cause.stderr ?? cause.message).trim()}`);
  }
}

const catalog = normalizeCatalog(DEFAULT_CATALOG);
if (catalog.length !== DEFAULT_CATALOG.length) {
  failures.push('catalog: DEFAULT_CATALOG contains invalid or duplicate entries');
}
if (shadowedByBuiltins(catalog).length > 0) {
  failures.push(
    `catalog: default entries shadow Hermes commands: ${shadowedByBuiltins(catalog).join(', ')}`,
  );
}
for (const command of [...catalog, ...normalizeCatalog(OPTIONAL_CATALOG)]) {
  if (!command.description) failures.push(`catalog: ${command.name} has no description`);
}

const readme = readFileSync(join(root, 'README.md'), 'utf8');
for (const command of catalog) {
  if (!readme.includes(`/${command.name}`)) {
    failures.push(`docs: README.md does not mention /${command.name}`);
  }
}

const known = new Set([...catalog, ...normalizeCatalog(OPTIONAL_CATALOG)].map((c) => c.name));
for (const builtin of BUILTIN_ADVERTISED) {
  if (known.has(builtin)) failures.push(`catalog: ${builtin} duplicates a Hermes builtin`);
}

if (failures.length > 0) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
console.log(`ok: ${catalog.length} default commands, ${jsFiles(root).length} JS files checked`);

/** @param {string} dir */
function jsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === '.tmp') continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) out.push(...jsFiles(path));
    else if (entry.endsWith('.js') || entry.endsWith('.mjs')) out.push(path);
  }
  return out;
}
