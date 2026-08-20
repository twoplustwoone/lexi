#!/usr/bin/env node

/**
 * Build the app icons from their SVG sources.
 *
 * Usage:
 *   npm i --no-save sharp
 *   node scripts/generate-icons.mjs
 *
 * sharp is not a project dependency — icons change about once a year, and it
 * ships platform-specific binaries that would slow every install down for
 * everyone. Install it ad hoc when you actually need to regenerate.
 *
 * Sources live in apps/web/src/icons so that Vite processes the mark when the
 * app imports it: the header logo ends up inlined in the content-hashed bundle
 * rather than fetched from a stable URL, which is what let a stale icon survive
 * a deploy. Everything written to apps/web/public/icons is generated from them.
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

import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = path.join(ROOT, 'apps/web/src/icons');
const OUT_DIR = path.join(ROOT, 'apps/web/public/icons');

/** [source svg, output png, pixel size] */
const RASTER_TARGETS = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon-maskable.svg', 'apple-touch-icon.png', 180],
];

/** Copied verbatim because the manifest and the favicon link reference them. */
const COPY_TARGETS = ['icon.svg'];

async function main() {
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    console.error('sharp is not installed. Run: npm i --no-save sharp');
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  for (const [src, out, size] of RASTER_TARGETS) {
    await sharp(path.join(SRC_DIR, src))
      .resize(size, size)
      .png({ compressionLevel: 9 })
      .toFile(path.join(OUT_DIR, out));
    console.log(`${out.padEnd(24)} ${size}x${size}  <- ${src}`);
  }

  for (const name of COPY_TARGETS) {
    await copyFile(path.join(SRC_DIR, name), path.join(OUT_DIR, name));
    console.log(`${name.padEnd(24)} copied    <- ${name}`);
  }
}

await main();
