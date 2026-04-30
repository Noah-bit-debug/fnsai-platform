#!/usr/bin/env node
/**
 * Copy PDF.js's runtime assets (WASM image decoders, cMaps,
 * standard fonts) from node_modules into public/pdfjs/ so Vite
 * serves them at /pdfjs/* in both dev and build.
 *
 * Why we need these:
 *
 *   wasm/openjpeg.wasm  — decodes JPEG2000 images. Government
 *                         PDFs (e.g. Harris County Sheriff's
 *                         Housing Access Request Form) embed
 *                         their letterhead/logo as JPX. Without
 *                         this, PDF.js silently leaves the image
 *                         area blank — which is exactly the
 *                         "top of the PDF doesn't come up" bug
 *                         from the QA report.
 *   wasm/jbig2.wasm     — decodes JBIG2 (used by some scanners).
 *   wasm/qcms_bg.wasm   — color-management for CMYK images.
 *   cmaps/              — CID character maps for non-Latin
 *                         scripts; without these, exotic glyphs
 *                         render as boxes.
 *   standard_fonts/     — fallback for the 14 standard PDF fonts
 *                         (Helvetica, Times, etc.) when a doc
 *                         references but doesn't embed them.
 *
 * Auto-runs as `prebuild` and `predev`. Idempotent — safe to
 * run repeatedly. Uses Node's cpSync (16+) so no shell utility
 * dependency, which matters for Railway's Linux container.
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here    = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'node_modules', 'pdfjs-dist');
const dstRoot = join(here, '..', 'public', 'pdfjs');

if (!existsSync(srcRoot)) {
  console.warn('[copy-pdfjs-assets] pdfjs-dist not installed — skipping.');
  process.exit(0);
}

mkdirSync(dstRoot, { recursive: true });

for (const dir of ['wasm', 'cmaps', 'standard_fonts']) {
  const src = join(srcRoot, dir);
  const dst = join(dstRoot, dir);
  if (!existsSync(src)) {
    console.warn(`[copy-pdfjs-assets] ${dir}/ missing in pdfjs-dist — skipping.`);
    continue;
  }
  cpSync(src, dst, { recursive: true });
  console.log(`[copy-pdfjs-assets] ${dir}/ → public/pdfjs/${dir}/`);
}
