/**
 * Rasterize canonical SVGs in icons/ to PNGs for PWA surfaces.
 * Run after editing icon.svg, icon-maskable.svg, or icon-small.svg.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');

const jobs = [
  { input: 'icon-small.svg', output: 'favicon-32.png', size: 32 },
  { input: 'icon.svg', output: 'apple-touch-icon.png', size: 180 },
  { input: 'icon.svg', output: 'icon-192.png', size: 192 },
  { input: 'icon.svg', output: 'icon-512.png', size: 512 },
  { input: 'icon-maskable.svg', output: 'icon-maskable-512.png', size: 512 },
];

for (const { input, output, size } of jobs) {
  const svg = readFileSync(join(iconsDir, input), 'utf8');
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const pngData = resvg.render();
  writeFileSync(join(iconsDir, output), pngData.asPng());
  console.log(`icons/${output} (${size}×${size})`);
}
