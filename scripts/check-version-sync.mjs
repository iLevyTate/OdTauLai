#!/usr/bin/env node
/**
 * CI check: ensures the CACHE_NAME in sw.js matches swCache in js/version.js.
 * Run: node scripts/check-version-sync.mjs
 * Exits 0 on match, 1 on mismatch.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const versionSrc = readFileSync(resolve(root, 'js/version.js'), 'utf-8');
const swSrc      = readFileSync(resolve(root, 'sw.js'), 'utf-8');

// Extract swCache from version.js
const versionMatch = versionSrc.match(/swCache\s*:\s*['"]([^'"]+)['"]/);
if (!versionMatch) {
  console.error('❌ Could not find swCache in js/version.js');
  process.exit(1);
}
const versionCache = versionMatch[1];

// Extract CACHE_NAME from sw.js
const swMatch = swSrc.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
if (!swMatch) {
  console.error('❌ Could not find CACHE_NAME in sw.js');
  process.exit(1);
}
const swCache = swMatch[1];

if (versionCache !== swCache) {
  console.error(`❌ Version drift detected!`);
  console.error(`   js/version.js  swCache:   '${versionCache}'`);
  console.error(`   sw.js          CACHE_NAME: '${swCache}'`);
  console.error(`\n   Run: node scripts/bump-version.mjs <new-version>`);
  process.exit(1);
}

console.log(`✅ Version sync OK: '${versionCache}'`);
