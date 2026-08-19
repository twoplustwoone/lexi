#!/usr/bin/env node

/**
 * Rasterise the app icons from their SVG sources.
 *
 * Usage:
 *   npm i --no-save sharp
 *   node scripts/generate-icons.mjs
 *
 * sharp is not a project dependency — icons change about once a year, and it
 * ships platform-specific binaries that would slow every install down for
 * everyone. Install it ad hoc when you actually need to regenerate.
 *
 * Two sources, because the platforms want different art:
 *
 *   icon.svg           rounded tile, mark at full size. Used as-is for the
 *                      manifest's `any` icons, which nothing masks.
 *   icon-maskable.svg  full bleed, mark held inside Android's safe circle
 *                      (80% of the icon's width). Android and iOS both apply
 *                      their own mask, so baked-in corners would be rounded
 *                      twice and anything near a corner would be clipped.
 *
 * Serving one file for both purposes is the bug this replaced: the corners of
 * the old icon were cropped away on Android home screens.
 */

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ICONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../apps/web/public/icons'
);

/** [source svg, output png, pixel size] */
const TARGETS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
];

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp is not installed. Run: npm i --no-save sharp');
    process.exit(1);
  }

  for (const [src, out, size] of TARGETS) {
    await sharp(path.join(ICONS_DIR, src))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS_DIR, out));
    console.log(`${out.padEnd(24)} ${size}x${size}  <- ${src}`);
  }
}

await main();
