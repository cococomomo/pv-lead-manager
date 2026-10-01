'use strict';

/**
 * Bilder fürs PDF nur so groß einbetten, wie sie gezeichnet werden.
 * Transparente PNG bleiben PNG. Was schon in die doppelte Zeichnungsgröße passt,
 * wird nicht noch einmal komprimiert.
 */

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function isPng(buf) {
  return buf && buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

function isJpeg(buf) {
  return buf && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
}

function readRgba(buf) {
  if (isPng(buf)) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data, kind: 'png' };
  }
  if (isJpeg(buf)) {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: Buffer.from(img.data), kind: 'jpeg' };
  }
  return null;
}

function hasTransparency(data) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/** Bilinear, Farbe vormischt, damit transparente Ränder nicht weiß aufhellen. */
function resizeRgba(src, sw, sh, tw, th) {
  const out = Buffer.alloc(tw * th * 4);
  for (let y = 0; y < th; y += 1) {
    const sy = ((y + 0.5) * sh) / th - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.min(1, Math.max(0, sy - y0));
    for (let x = 0; x < tw; x += 1) {
      const sx = ((x + 0.5) * sw) / tw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.min(1, Math.max(0, sx - x0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      let a = 0;
      const prem = [0, 0, 0];
      const samples = [
        [i00, (1 - fx) * (1 - fy)],
        [i10, fx * (1 - fy)],
        [i01, (1 - fx) * fy],
        [i11, fx * fy],
      ];
      for (const [i, w] of samples) {
        const alpha = src[i + 3] / 255;
        a += alpha * w;
        prem[0] += src[i] * alpha * w;
        prem[1] += src[i + 1] * alpha * w;
        prem[2] += src[i + 2] * alpha * w;
      }
      const di = (y * tw + x) * 4;
      const alphaByte = Math.round(Math.min(1, Math.max(0, a)) * 255);
      out[di + 3] = alphaByte;
      if (a > 0.001) {
        out[di] = Math.round(Math.min(255, prem[0] / a));
        out[di + 1] = Math.round(Math.min(255, prem[1] / a));
        out[di + 2] = Math.round(Math.min(255, prem[2] / a));
      }
    }
  }
  return out;
}

function encodePng(data, width, height) {
  if (!hasTransparency(data)) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    const png = new PNG({ width, height, colorType: 2, inputColorType: 2 });
    png.data = rgb;
    return PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
  }
  const png = new PNG({ width, height, colorType: 6 });
  png.data = data;
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

/**
 * @param {Buffer} buf
 * @param {number} drawW gezeichnete Breite in PDF-Punkten
 * @param {number} drawH gezeichnete Höhe in PDF-Punkten
 * @returns {Buffer|null} neues Bild, oder null wenn das Original schon klein genug ist
 */
function rasterForDraw(buf, drawW, drawH, opts = {}) {
  const img = readRgba(buf);
  if (!img) return null;
  const tw = Math.max(1, Math.round(Number(drawW) * 2));
  const th = Math.max(1, Math.round(Number(drawH) * 2));
  if (img.width <= tw && img.height <= th) return null;
  const data = resizeRgba(img.data, img.width, img.height, tw, th);
  if (img.kind === 'png' && !opts.asJpeg) return encodePng(data, tw, th);
  const encoded = jpeg.encode({ data, width: tw, height: th }, 85);
  return Buffer.from(encoded.data);
}

module.exports = {
  isPng,
  isJpeg,
  rasterForDraw,
};
