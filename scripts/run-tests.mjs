/**
 * Discover tests/*.mjs and run `node --test` on them.
 * Avoids shell glob quirks (Windows `node --test tests/` treats `tests` as a module path).
 */
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = join(root, 'tests');

const names = await readdir(testsDir);
const files = names
  .filter((n) => n.endsWith('.test.mjs'))
  .map((n) => join(testsDir, n))
  .sort();

if (!files.length) {
  console.error('No test files found in tests/ (*.test.mjs)');
  process.exit(1);
}

const r = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: root,
  shell: false,
});

process.exit(r.status === 0 ? 0 : r.status ?? 1);
