#!/usr/bin/env node
/**
 * Atomically bumps the version string in both js/version.js and sw.js.
 * Usage: node scripts/bump-version.mjs v33
 *
 * Updates:
 *   - js/version.js  → ODTAULAI_RELEASE.version, .buildDate, .swCache
 *   - sw.js          → CACHE_NAME
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node scripts/bump-version.mjs <version>');
  console.error('Example: node scripts/bump-version.mjs v33');
  process.exit(1);
}

const cacheName = `odtaulai-${version}`;
const buildDate = new Date().toISOString().slice(0, 10);

// ── Update js/version.js ──────────────────────────────────────────────────
const versionPath = resolve(root, 'js/version.js');
const newVersionJs = `/** Single source for release identity — keep sw.js CACHE_NAME and pwa.js inline CACHE in sync. */
window.ODTAULAI_RELEASE = {
  version: '${version}',
  buildDate: '${buildDate}',
  swCache: '${cacheName}',
};
`;
writeFileSync(versionPath, newVersionJs, 'utf-8');

// ── Update sw.js CACHE_NAME ───────────────────────────────────────────────
const swPath = resolve(root, 'sw.js');
let swSrc = readFileSync(swPath, 'utf-8');
swSrc = swSrc.replace(
  /const\s+CACHE_NAME\s*=\s*'[^']+'/,
  `const CACHE_NAME = '${cacheName}'`
);
writeFileSync(swPath, swSrc, 'utf-8');

// ── Update js/pwa.js inline-SW fallback string ────────────────────────────
// The version-sync test asserts this stays in lock-step with version.js, so
// keep it bumped alongside sw.js to avoid red CI on every release.
const pwaPath = resolve(root, 'js/pwa.js');
let pwaSrc = readFileSync(pwaPath, 'utf-8');
pwaSrc = pwaSrc.replace(
  /:\s*'odtaulai-v[^']+'/,
  `: '${cacheName}'`
);
writeFileSync(pwaPath, pwaSrc, 'utf-8');

console.log(`✅ Bumped to ${version}`);
console.log(`   js/version.js  → version:'${version}', swCache:'${cacheName}', buildDate:'${buildDate}'`);
console.log(`   sw.js           → CACHE_NAME:'${cacheName}'`);
console.log(`   js/pwa.js       → inline fallback:'${cacheName}'`);
