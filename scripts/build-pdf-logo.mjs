/**
 * Generate a small, PDF-optimized Vantor wordmark from the full-resolution
 * `public/logo-light.png`. PDFs embed the full source PNG per image, so a
 * 349 KB source blows each PDF up to 650 KB–1.3 MB. Downsizing to ~2× the
 * display size (header is ~88pt wide) gives us crisp rendering at normal
 * zoom while keeping PDFs under ~20 KB.
 *
 *   node scripts/build-pdf-logo.mjs
 */

import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const SRC = path.resolve('public/logo-light.png');
const OUT = path.resolve('public/logo-light-pdf.png');

const srcBuf = fs.readFileSync(SRC);
const meta = await sharp(srcBuf).metadata();

// Header displays at 88pt wide. @2x for retina/zoom is 176px.
// Source aspect ratio is 1343 / 423 ≈ 3.17.
const targetWidth = 240;
const targetHeight = Math.round((targetWidth * meta.height) / meta.width);

const out = await sharp(srcBuf)
  .resize(targetWidth, targetHeight, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

fs.writeFileSync(OUT, out);

const before = (srcBuf.length / 1024).toFixed(1);
const after = (out.length / 1024).toFixed(1);
console.log(`logo-light.png      ${meta.width}×${meta.height}   ${before} KB`);
console.log(`logo-light-pdf.png  ${targetWidth}×${targetHeight}    ${after} KB`);
