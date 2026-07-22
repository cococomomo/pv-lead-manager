'use strict';

/**
 * Server-seitiger Belegungsplan-Render: Orthofoto-Kacheln + Dach/Module/Pfeile → PNG.
 * Unabhängig vom Browser-CORS (html2canvas).
 */

const https = require('https');
const http = require('http');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const mapProviders = require('./map-providers');

const TILE = 256;

function deg2rad(d) {
  return (Number(d) * Math.PI) / 180;
}

function latLngToWorldPixel(lat, lng, zoom) {
  const scale = TILE * (2 ** zoom);
  const x = ((Number(lng) + 180) / 360) * scale;
  const sinLat = Math.sin(deg2rad(lat));
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function fetchBuffer(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const lib = String(url).startsWith('https') ? https : http;
    const req = lib.get(url, { headers: { 'User-Agent': 'NOORTEC-PVL/1.0', Accept: 'image/*,*/*' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchBuffer(res.headers.location, timeoutMs).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
  });
}

function decodeImageToRgba(buf) {
  if (!buf || buf.length < 4) return null;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    try {
      const png = PNG.sync.read(buf);
      return { width: png.width, height: png.height, data: png.data };
    } catch (_) { /* fallthrough */ }
  }
  // JPEG
  try {
    const jpg = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    if (jpg && jpg.data) return { width: jpg.width, height: jpg.height, data: Buffer.from(jpg.data) };
  } catch (_) { /* ignore */ }
  return null;
}

function collectPlanPoints(plan) {
  const pts = [];
  const roofs = Array.isArray(plan.roofs) ? plan.roofs : [];
  roofs.forEach((r) => (r.ring || []).forEach((p) => pts.push(p)));
  if (!pts.length && Array.isArray(plan.roof)) plan.roof.forEach((p) => pts.push(p));
  (plan.obstacles || []).forEach((ring) => (ring || []).forEach((p) => pts.push(p)));
  (plan.modules || []).forEach((m) => {
    if (!m || m.lat == null || m.lng == null) return;
    // Modul-Ecken grob einbeziehen (nicht nur Mittelpunkt)
    const latOff = (Math.max(Number(m.heightM) || 1.8, Number(m.widthM) || 1.1) / 2) / 111320;
    const lngOff = latOff / Math.max(0.2, Math.cos(deg2rad(m.lat)));
    pts.push({ lat: m.lat, lng: m.lng });
    pts.push({ lat: m.lat + latOff, lng: m.lng + lngOff });
    pts.push({ lat: m.lat - latOff, lng: m.lng - lngOff });
    pts.push({ lat: m.lat + latOff, lng: m.lng - lngOff });
    pts.push({ lat: m.lat - latOff, lng: m.lng + lngOff });
  });
  // plan.center bewusst nicht – Kartenmitte bläht den Ausschnitt sonst auf
  return pts;
}

function chooseZoom(spanPxAtZ20) {
  // Hohe Zoomstufe: Objekt füllt den Frame, wenig Umfeld
  let z = 20;
  let span = spanPxAtZ20;
  while (z > 18 && span > 1500) {
    z -= 1;
    span /= 2;
  }
  while (z < 20 && span < 780) {
    z += 1;
    span *= 2;
  }
  return Math.max(18, Math.min(20, z));
}

function rotatePoint(p, angleRad) {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function moduleCornersWorld(m, zoom) {
  const c = latLngToWorldPixel(m.lat, m.lng, zoom);
  // grobe Meter→Pixel bei Zoom (WebMercator am Äquator 156543.03/2^z m/px, korrigiert mit cos(lat))
  const mpp = (156543.03392 * Math.cos(deg2rad(m.lat))) / (2 ** zoom);
  const hw = ((Number(m.widthM) || 1) / 2) / mpp;
  const hh = ((Number(m.heightM) || 1) / 2) / mpp;
  const angle = deg2rad(m.azimuth || 0);
  // azimuth in Editor = math. angle (Ost=0, CCW) in lokaler XY; World-Pixel Y zeigt nach Süden
  // Editor-XY: x Ost, y Nord → World: x Ost, y Süd ⇒ y flip vor Rotation analog
  return [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ].map((p) => {
    const r = rotatePoint(p, angle);
    return { x: c.x + r.x, y: c.y - r.y }; // Nord → negativ in World-Y
  });
}

function ringToWorld(ring, zoom) {
  return (ring || []).map((p) => latLngToWorldPixel(p.lat, p.lng, zoom));
}

function setPixel(data, w, h, x, y, r, g, b, a) {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return;
  const i = (yi * w + xi) * 4;
  const aa = a / 255;
  const inv = 1 - aa;
  data[i] = Math.round(r * aa + data[i] * inv);
  data[i + 1] = Math.round(g * aa + data[i + 1] * inv);
  data[i + 2] = Math.round(b * aa + data[i + 2] * inv);
  data[i + 3] = 255;
}

function blendPixel(data, w, h, x, y, r, g, b, a) {
  setPixel(data, w, h, x, y, r, g, b, a);
}

function drawLine(data, w, h, x0, y0, x1, y1, r, g, b, a, width) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len * 1.5);
  const half = Math.max(0.5, (width || 1) / 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = x0 + dx * t;
    const y = y0 + dy * t;
    for (let oy = -half; oy <= half; oy++) {
      for (let ox = -half; ox <= half; ox++) {
        if (ox * ox + oy * oy <= half * half + 0.2) {
          blendPixel(data, w, h, x + ox, y + oy, r, g, b, a);
        }
      }
    }
  }
}

function fillPolygon(data, w, h, pts, r, g, b, a) {
  if (!pts || pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  pts.forEach((p) => {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  minY = Math.floor(minY);
  maxY = Math.ceil(maxY);
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const yi = pts[i].y;
      const yj = pts[j].y;
      if ((yi > y) !== (yj > y)) {
        const x = pts[i].x + ((y - yi) * (pts[j].x - pts[i].x)) / ((yj - yi) || 1e-9);
        xs.push(x);
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.floor(xs[k]);
      const x1 = Math.ceil(xs[k + 1]);
      for (let x = x0; x <= x1; x++) blendPixel(data, w, h, x, y, r, g, b, a);
    }
  }
}

function strokePolygon(data, w, h, pts, r, g, b, a, width) {
  if (!pts || pts.length < 2) return;
  for (let i = 0; i < pts.length; i++) {
    const aPt = pts[i];
    const bPt = pts[(i + 1) % pts.length];
    drawLine(data, w, h, aPt.x, aPt.y, bPt.x, bPt.y, r, g, b, a, width);
  }
}

function arrowLenFromTilt(tiltDeg, refPx) {
  const t = Math.max(0, Math.min(75, Number(tiltDeg) || 0));
  const ref = Math.max(6, Number(refPx) || 12);
  return ref * (0.22 + 0.78 * Math.min(1, t / 60));
}

function tileUrlFor(providerId, z, x, y) {
  const list = mapProviders.listMapProviders ? mapProviders.listMapProviders() : [];
  const p = list.find((i) => i.id === providerId && i.url) || list.find((i) => i.enabled && i.url);
  if (!p || !p.url) {
    return `https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/${z}/${y}/${x}.jpeg`;
  }
  return p.url
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/**
 * @param {object} plan
 * @param {object} [opts]
 * @returns {Promise<Buffer>} PNG
 */
async function renderLayoutOrthoPng(plan, opts = {}) {
  const planObj = plan && typeof plan === 'object' ? plan : {};
  const pts = collectPlanPoints(planObj);
  if (pts.length < 1) throw new Error('Plan ohne Geometrie');

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  pts.forEach((p) => {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng); maxLng = Math.max(maxLng, p.lng);
  });
  const midLat = (minLat + maxLat) / 2;
  const mPerDegLat = 111320;
  const mPerDegLng = 111320 * Math.max(0.25, Math.cos(deg2rad(midLat)));

  // Framing: Gebäude ~80–85 % der Bildfläche, Umland ~15–20 %
  // → je Seite ca. 9–11 % der Objektspanne als Rand
  const TARGET_CONTENT_FRAC = opts.contentFrac != null
    ? Math.min(0.95, Math.max(0.6, Number(opts.contentFrac)))
    : 0.82;
  let spanLat = Math.max(maxLat - minLat, 1e-9);
  let spanLng = Math.max(maxLng - minLng, 1e-9);
  // Nur bei winzigen Geometrien ein Minimum (~6 m), sonst kein künstliches Aufblasen
  const MIN_SPAN_M = 6;
  const minSpanLat = MIN_SPAN_M / mPerDegLat;
  const minSpanLng = MIN_SPAN_M / mPerDegLng;
  if (spanLat < minSpanLat) {
    const d = (minSpanLat - spanLat) / 2;
    minLat -= d; maxLat += d;
    spanLat = maxLat - minLat;
  }
  if (spanLng < minSpanLng) {
    const d = (minSpanLng - spanLng) / 2;
    minLng -= d; maxLng += d;
    spanLng = maxLng - minLng;
  }
  const padLat = (spanLat / TARGET_CONTENT_FRAC - spanLat) / 2;
  const padLng = (spanLng / TARGET_CONTENT_FRAC - spanLng) / 2;
  minLat -= padLat; maxLat += padLat;
  minLng -= padLng; maxLng += padLng;

  const spanZ20 = latLngToWorldPixel(minLat, maxLng, 20).x - latLngToWorldPixel(minLat, minLng, 20).x;
  const spanY20 = latLngToWorldPixel(minLat, minLng, 20).y - latLngToWorldPixel(maxLat, minLng, 20).y;
  const zoom = opts.zoom != null ? Number(opts.zoom) : chooseZoom(Math.max(spanZ20, spanY20));

  const tl = latLngToWorldPixel(maxLat, minLng, zoom);
  const br = latLngToWorldPixel(minLat, maxLng, zoom);
  const contentW = Math.max(64, br.x - tl.x);
  const contentH = Math.max(64, br.y - tl.y);

  // Nur knapper Pixelrand gegen Schnitt der Strichstärke (Umland steckt schon in der BBox)
  const padFrac = 0.02;
  const padWorld = Math.max(4, Math.min(contentW, contentH) * padFrac);
  const worldW = contentW + padWorld * 2;
  const worldH = contentH + padWorld * 2;
  const targetMin = opts.targetMinPx != null ? Number(opts.targetMinPx) : 1200;
  const scale = Math.max(1, targetMin / Math.max(worldW, worldH));

  const originX = tl.x - padWorld;
  const originY = tl.y - padWorld;
  const outW = Math.max(64, Math.ceil(worldW * scale));
  const outH = Math.max(64, Math.ceil(worldH * scale));

  // Tile-Fenster in World-Pixeln (Zoom-Ebene)
  const tMinX = Math.floor(originX / TILE);
  const tMinY = Math.floor(originY / TILE);
  const tMaxX = Math.floor((originX + worldW - 1) / TILE);
  const tMaxY = Math.floor((originY + worldH - 1) / TILE);

  const png = new PNG({ width: outW, height: outH });
  // Fallback-Hintergrund
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 180;
    png.data[i + 1] = 186;
    png.data[i + 2] = 192;
    png.data[i + 3] = 255;
  }

  const providerId = opts.basemapProvider || planObj.basemapProvider || 'basemap_at';
  const jobs = [];
  for (let ty = tMinY; ty <= tMaxY; ty++) {
    for (let tx = tMinX; tx <= tMaxX; tx++) {
      jobs.push({ tx, ty });
    }
  }

  // Parallel mit Limit
  const concurrency = 6;
  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const my = jobs[idx++];
      const url = tileUrlFor(providerId, zoom, my.tx, my.ty);
      try {
        const buf = await fetchBuffer(url);
        const img = decodeImageToRgba(buf);
        if (!img) continue;
        const destX0 = Math.floor((my.tx * TILE - originX) * scale);
        const destY0 = Math.floor((my.ty * TILE - originY) * scale);
        const destW = Math.ceil(TILE * scale);
        const destH = Math.ceil(TILE * scale);
        for (let row = 0; row < destH; row++) {
          const dy = destY0 + row;
          if (dy < 0 || dy >= outH) continue;
          const srcRow = Math.min(img.height - 1, Math.floor(row / scale));
          for (let col = 0; col < destW; col++) {
            const dx = destX0 + col;
            if (dx < 0 || dx >= outW) continue;
            const srcCol = Math.min(img.width - 1, Math.floor(col / scale));
            const si = (srcRow * img.width + srcCol) * 4;
            const di = (dy * outW + dx) * 4;
            png.data[di] = img.data[si];
            png.data[di + 1] = img.data[si + 1];
            png.data[di + 2] = img.data[si + 2];
            png.data[di + 3] = 255;
          }
        }
      } catch (_) {
        /* Kachel fehlt – Hintergrund bleibt */
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

  function toImg(p) {
    return { x: (p.x - originX) * scale, y: (p.y - originY) * scale };
  }

  const lw = Math.max(1.5, 2.2 * scale);
  const roofs = Array.isArray(planObj.roofs) && planObj.roofs.length
    ? planObj.roofs
    : (planObj.roof ? [{ ring: planObj.roof, tilt: (planObj.meta && planObj.meta.tilt) || 30 }] : []);
  const obstacles = planObj.obstacles || [];
  const modules = planObj.modules || [];

  roofs.forEach((roof) => {
    const ring = ringToWorld(roof.ring, zoom).map(toImg);
    fillPolygon(png.data, outW, outH, ring, 59, 130, 246, 70);
    strokePolygon(png.data, outW, outH, ring, 29, 78, 216, 230, lw);
  });
  obstacles.forEach((ring) => {
    const ptsR = ringToWorld(ring, zoom).map(toImg);
    fillPolygon(png.data, outW, outH, ptsR, 239, 68, 68, 100);
    strokePolygon(png.data, outW, outH, ptsR, 185, 28, 28, 230, lw * 0.9);
  });

  modules.forEach((m) => {
    const corners = moduleCornersWorld(m, zoom).map(toImg);
    fillPolygon(png.data, outW, outH, corners, 96, 165, 250, 200);
    strokePolygon(png.data, outW, outH, corners, 30, 64, 175, 240, Math.max(1.2, 1.4 * scale));

    const tilt = m.tilt != null ? Number(m.tilt) : ((planObj.meta && planObj.meta.tilt) || 30);
    const c = toImg(latLngToWorldPixel(m.lat, m.lng, zoom));
    const mpp = (156543.03392 * Math.cos(deg2rad(m.lat))) / (2 ** zoom);
    const refPx = ((Math.min(Number(m.widthM) || 1, Number(m.heightM) || 1) * 0.7) / mpp) * scale;
    const len = arrowLenFromTilt(tilt, refPx);

    // Traufe = erste Kante des enthaltenden Dachs
    let ux = 0;
    let uy = 1;
    for (const roof of roofs) {
      const ring = roof.ring || [];
      if (ring.length < 2) continue;
      const a = toImg(latLngToWorldPixel(ring[0].lat, ring[0].lng, zoom));
      const b = toImg(latLngToWorldPixel(ring[1].lat, ring[1].lng, zoom));
      const edx = b.x - a.x;
      const edy = b.y - a.y;
      const elen = Math.hypot(edx, edy) || 1;
      let nx = -edy / elen;
      let ny = edx / elen;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if ((c.x - mid.x) * nx + (c.y - mid.y) * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      ux = nx;
      uy = ny;
      break;
    }
    const tip = { x: c.x + ux * len * 0.5, y: c.y + uy * len * 0.5 };
    const base = { x: c.x - ux * len * 0.5, y: c.y - uy * len * 0.5 };
    drawLine(png.data, outW, outH, base.x, base.y, tip.x, tip.y, 232, 121, 169, 240, Math.max(1.5, 2 * scale));
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const al = Math.hypot(dx, dy) || 1;
    const head = Math.max(4, 4 * scale);
    const hx = (-dy / al) * head;
    const hy = (dx / al) * head;
    const bx = tip.x - (dx / al) * (head * 1.7);
    const by = tip.y - (dy / al) * (head * 1.7);
    fillPolygon(png.data, outW, outH, [
      tip,
      { x: bx + hx, y: by + hy },
      { x: bx - hx, y: by - hy },
    ], 232, 121, 169, 245);
  });

  return PNG.sync.write(png);
}

module.exports = {
  renderLayoutOrthoPng,
  collectPlanPoints,
};
