#!/usr/bin/env node
/**
 * PDF-Bildgröße und Alpha: kein 100-px-Brei, keine Weiß-/Schwarz-Höfe.
 * Run: node scripts/test-image-raster.js
 */
'use strict';

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const {
  rasterForDraw,
  pixelsForDraw,
  hasTransparency,
  MIN_DPI,
  FLOOR_LONG_PX,
} = require('../src/offer/image-raster');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ok  ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

function solidPng(w, h, paint) {
  const rgba = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a] = paint(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  const png = new PNG({ width: w, height: h });
  png.data = rgba;
  return PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    deflateLevel: 9,
  });
}

function testOpaquePattern() {
  console.log('opakes PNG bleibt lesbar');
  const raw = solidPng(800, 400, (x) => (x < 400 ? [220, 20, 20, 255] : [20, 20, 220, 255]));
  const out = rasterForDraw(raw, 40, 20);
  assert(Buffer.isBuffer(out), 'großes opak wird neu kodiert');
  if (!out) return;
  const decoded = PNG.sync.read(out);
  assert(decoded.colorType === 2, `opak wird RGB (colorType ${decoded.colorType})`);
  assert(Math.max(decoded.width, decoded.height) >= FLOOR_LONG_PX
    || (decoded.width === 80 && decoded.height === 40), 'Boden oder Original');
  let weird = 0;
  const n = decoded.width * decoded.height;
  for (let y = 0; y < decoded.height; y += 1) {
    for (let x = 0; x < decoded.width; x += 1) {
      const i = (y * decoded.width + x) * 4;
      const r = decoded.data[i];
      const b = decoded.data[i + 2];
      const left = x < decoded.width / 2;
      const ok = left ? (r > 160 && b < 80) : (b > 160 && r < 80);
      if (!ok) weird += 1;
    }
  }
  assert(weird < n * 0.08, `Farbflächen bleiben (${weird}/${n} abweichend)`);
}

function testCutoutAlpha() {
  console.log('Freisteller behält Alpha');
  const raw = solidPng(400, 800, (x, y) => {
    const inside = x > 80 && x < 320 && y > 40 && y < 760;
    return inside ? [30, 30, 30, 255] : [0, 0, 0, 0];
  });
  const out = rasterForDraw(raw, 40, 78, { asJpeg: true });
  assert(out[0] === 0x89, 'trotz asJpeg kein JPEG');
  const decoded = PNG.sync.read(out);
  assert(decoded.colorType === 6, `Alpha-PNG (colorType ${decoded.colorType})`);
  assert(hasTransparency(decoded.data), 'durchsichtige Pixel bleiben');
  const corner = decoded.data[3];
  assert(corner === 0, `Ecke bleibt transparent (alpha ${corner}), kein Hof`);
  const longEdge = Math.max(decoded.width, decoded.height);
  assert(longEdge >= FLOOR_LONG_PX, `lange Kante ${longEdge} >= ${FLOOR_LONG_PX}`);
  const dpiH = decoded.height / (78 / 72);
  assert(dpiH >= 150, `Höhe etwa ${Math.round(dpiH)} dpi`);
}

function testNoUpscale() {
  console.log('nicht hochskalieren');
  const target = pixelsForDraw(100, 78, 201, 225);
  assert(target === null, 'kleines Original bleibt (Gak-Größe)');
  const big = pixelsForDraw(47, 78, 1000, 1600);
  assert(big && Math.max(big.tw, big.th) >= FLOOR_LONG_PX, 'großes Foto nutzt den Boden');
  assert(big.tw <= 1000 && big.th <= 1600, 'nicht über die Quelle hinaus');
  const dpi = big.th / (78 / 72);
  assert(dpi >= MIN_DPI, `Kartenhöhe ${Math.round(dpi)} dpi`);
}

function testJpegPhoto() {
  console.log('JPEG-Foto bleibt JPEG');
  const w = 900;
  const h = 900;
  const data = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 40;
    data[i + 1] = 80;
    data[i + 2] = 120;
  }
  const raw = Buffer.from(jpeg.encode({ data, width: w, height: h }, 90).data);
  const out = rasterForDraw(raw, 78, 78);
  assert(out[0] === 0xff && out[1] === 0xd8, 'JPEG bleibt JPEG');
  const img = jpeg.decode(out, { useTArray: true, formatAsRGBA: true });
  assert(Math.max(img.width, img.height) >= FLOOR_LONG_PX, `JPEG-Kante ${Math.max(img.width, img.height)}`);
}

testOpaquePattern();
testCutoutAlpha();
testNoUpscale();
testJpegPhoto();

console.log(`\n${passed} ok, ${failed} failed`);
if (failed) process.exit(1);
