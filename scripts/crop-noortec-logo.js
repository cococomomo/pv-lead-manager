'use strict';

/**
 * Einmaliges Build-Hilfsskript: schneidet aus dem vollen Noortec-Logo
 * (Sonne + Wortmarke + "We see the light.") nur die farbige Lockup
 * (Sonne + "noortec") aus, damit sie sauber in den Angebots-PDF-Header passt.
 *
 * Quelle ist faktisch ein JPEG (trotz .png-Endung) → Dekodierung via jpeg-js.
 * Untertitel ist schwarz → über gelb/orange-Erkennung ausgeschlossen.
 * Aufruf: node scripts/crop-noortec-logo.js
 */

const fs = require('fs');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '../src/offer/assets/noortec-logo-full.png');
const OUT = path.join(__dirname, '../src/offer/assets/noortec-logo.png');

function isBrandPixel(r, g, b) {
  const nearWhite = r > 232 && g > 232 && b > 232;
  if (nearWhite) return false;
  return r > 150 && g > 90 && b < 175 && (r - b) > 35;
}

function main() {
  const raw = jpeg.decode(fs.readFileSync(SRC), { useTArray: true });
  const { width, height, data } = raw; // RGBA

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      if (isBrandPixel(data[idx], data[idx + 1], data[idx + 2])) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('Keine farbigen Logo-Pixel gefunden.');

  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(width - 1, maxX + pad);
  maxY = Math.min(height - 1, maxY + pad);

  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  const out = new PNG({ width: cropW, height: cropH });

  for (let y = 0; y < cropH; y += 1) {
    for (let x = 0; x < cropW; x += 1) {
      const sIdx = (width * (minY + y) + (minX + x)) << 2;
      const dIdx = (cropW * y + x) << 2;
      // Fast-weiße Pixel auf reines Weiß ziehen (sauberer Hintergrund)
      let r = data[sIdx];
      let g = data[sIdx + 1];
      let b = data[sIdx + 2];
      if (r > 240 && g > 240 && b > 240) { r = 255; g = 255; b = 255; }
      out.data[dIdx] = r;
      out.data[dIdx + 1] = g;
      out.data[dIdx + 2] = b;
      out.data[dIdx + 3] = 255;
    }
  }

  fs.writeFileSync(OUT, PNG.sync.write(out));
  console.log(`Logo zugeschnitten: ${cropW}x${cropH} -> ${OUT}`);
}

main();
