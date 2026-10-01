'use strict';

/**
 * Bilder fürs PDF so groß einbetten, wie sie auf der Seite gezeichnet werden.
 * Mindestens etwa 150 dpi, mit einem Boden, damit eine Produktkarte nicht
 * auf ~100 px zusammenschrumpft. Transparente Freisteller bleiben PNG
 * (kein Weiß- oder Schwarz-Hof). Was schon klein genug ist, bleibt bytegleich.
 */

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

/** Klar über 150 dpi, damit Linien und Fotos beim Druck nicht weich werden. */
const MIN_DPI = 200;
const PX_PER_PT = MIN_DPI / 72;
/** Lange Kante einer Produktkarte. 150 dpi einer 78-pt-Karte wären nur ~160 px. */
const FLOOR_LONG_PX = 640;

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

/** Bilinear, Farbe vormischt, damit transparente Ränder nicht weiß oder schwarz aufhellen. */
function resizeRgbaOnce(src, sw, sh, tw, th) {
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

function resizeRgba(src, sw, sh, tw, th) {
  let data = src;
  let w = sw;
  let h = sh;
  while (w > tw * 2 && h > th * 2 && w > 2 && h > 2) {
    const nw = Math.max(tw, Math.floor(w / 2));
    const nh = Math.max(th, Math.floor(h / 2));
    data = resizeRgbaOnce(data, w, h, nw, nh);
    w = nw;
    h = nh;
  }
  if (w === tw && h === th) return data;
  return resizeRgbaOnce(data, w, h, tw, th);
}

function encodePng(data, width, height) {
  if (!hasTransparency(data)) {
    const rgb = Buffer.alloc(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      rgb[j] = data[i];
      rgb[j + 1] = data[i + 1];
      rgb[j + 2] = data[i + 2];
    }
    const png = new PNG({ width, height });
    png.data = rgb;
    // inputColorType muss zum Puffer passen. Sonst liest pngjs RGB als RGBA
    // und mischt auf Weiß — das Bild wird ein unleserlicher Brei.
    return PNG.sync.write(png, {
      colorType: 2,
      inputColorType: 2,
      inputHasAlpha: false,
      deflateLevel: 9,
    });
  }
  const png = new PNG({ width, height });
  png.data = data;
  return PNG.sync.write(png, {
    colorType: 6,
    inputColorType: 6,
    inputHasAlpha: true,
    deflateLevel: 9,
  });
}

/**
 * Zielpixel für die gezeichnete Größe. null = Original behalten (nicht hochskalieren).
 * @param {number} drawW gezeichnete Breite in PDF-Punkten
 * @param {number} drawH gezeichnete Höhe in PDF-Punkten
 */
function pixelsForDraw(drawW, drawH, srcW, srcH) {
  const dw = Number(drawW);
  const dh = Number(drawH);
  if (!(dw > 0) || !(dh > 0) || !(srcW > 0) || !(srcH > 0)) return null;
  let tw = Math.max(1, Math.round(dw * PX_PER_PT));
  let th = Math.max(1, Math.round(dh * PX_PER_PT));
  const longEdge = Math.max(tw, th);
  if (longEdge < FLOOR_LONG_PX) {
    const f = FLOOR_LONG_PX / longEdge;
    tw = Math.max(1, Math.round(tw * f));
    th = Math.max(1, Math.round(th * f));
  }
  if (tw >= srcW && th >= srcH) return null;
  const cap = Math.min(1, srcW / tw, srcH / th);
  if (cap < 1) {
    tw = Math.max(1, Math.round(tw * cap));
    th = Math.max(1, Math.round(th * cap));
  }
  if (tw >= srcW - 1 && th >= srcH - 1) return null;
  return { tw, th };
}

/**
 * @param {Buffer} buf
 * @param {number} drawW gezeichnete Breite in PDF-Punkten
 * @param {number} drawH gezeichnete Höhe in PDF-Punkten
 * @returns {Buffer|null} neues Bild, oder null wenn das Original schon passt
 */
function rasterForDraw(buf, drawW, drawH, opts = {}) {
  const img = readRgba(buf);
  if (!img) return null;
  const target = pixelsForDraw(drawW, drawH, img.width, img.height);
  if (!target) return null;
  const { tw, th } = target;
  const data = resizeRgba(img.data, img.width, img.height, tw, th);
  const transparent = hasTransparency(data) || hasTransparency(img.data);
  // Freisteller nie als JPEG: jpeg-js verwirft Alpha und lässt Schwarz stehen.
  if (!transparent && (img.kind === 'jpeg' || opts.asJpeg)) {
    const encoded = jpeg.encode({ data, width: tw, height: th }, 85);
    return Buffer.from(encoded.data);
  }
  return encodePng(data, tw, th);
}

module.exports = {
  isPng,
  isJpeg,
  hasTransparency,
  pixelsForDraw,
  rasterForDraw,
  MIN_DPI,
  FLOOR_LONG_PX,
};
