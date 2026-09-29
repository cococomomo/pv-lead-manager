'use strict';

/**
 * House system diagram for „Auf einen Blick“.
 * Base art: house-system-diagram.png (= house-system-diagram-v2.png).
 *
 * Always full color: Öffentliches Netz, utility Smart Meter, Haupt-Verteilerkasten,
 * Allgemeine Hausverbraucher, house shell, AC/DC flow arrows.
 *
 * Sellable products: full color if in this offer; otherwise pale icon+label only.
 * Wiring in v2 art is authoritative — do not redraw arrows.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BASE = path.join(__dirname, 'assets', 'products', 'house-system-diagram.png');

/**
 * Tight icon+label boxes for v2 artwork (1536×1024).
 * Fractions are [x0, y0, x1, y1].
 */
const REGIONS = {
  // Always-on context — never muted
  netz: [0.01, 0.40, 0.12, 0.74],
  smartMeter: [0.11, 0.48, 0.24, 0.74],
  verteiler: [0.50, 0.48, 0.66, 0.74],
  hausverbraucher: [0.62, 0.72, 0.84, 0.96],

  // Sellable — glyph + caption only
  notstrom: [0.23, 0.48, 0.37, 0.74],
  pv: [0.28, 0.01, 0.56, 0.30],
  inverter: [0.34, 0.30, 0.50, 0.56],
  battery: [0.34, 0.62, 0.50, 0.92],
  klimaInnen: [0.64, 0.26, 0.82, 0.50],
  klimaAussen: [0.82, 0.26, 0.99, 0.54],
  wallbox: [0.64, 0.50, 0.80, 0.72],
  ev: [0.78, 0.55, 0.99, 0.88],
};

/** Sellable product keys muted when not in the offer. */
const PRODUCT_KEYS = [
  'pv',
  'inverter',
  'battery',
  'notstrom',
  'klimaInnen',
  'klimaAussen',
  'wallbox',
  'ev',
];

/** Context keys — always full color. */
const ALWAYS_COLOR_KEYS = ['netz', 'smartMeter', 'verteiler', 'hausverbraucher'];

function itemNames(offer) {
  const names = [];
  for (const section of (offer && offer.sections) || []) {
    for (const item of section.items || []) {
      if (item && item.name) names.push(String(item.name));
    }
  }
  // Offer builder often puts lines at top level (no sections[])
  for (const item of (offer && offer.lines) || []) {
    if (item && item.name) names.push(String(item.name));
  }
  return names;
}

function includedOptionKeys(offer) {
  const keys = new Set();
  const inkl = (offer && offer.preis && Array.isArray(offer.preis.inkludiert))
    ? offer.preis.inkludiert
    : [];
  for (const e of inkl) {
    if (e && e.key) keys.add(String(e.key).toLowerCase());
  }
  const cfg = (offer && offer.config) || {};
  if (Array.isArray(cfg.inkludierteOptionen)) {
    cfg.inkludierteOptionen.forEach((k) => keys.add(String(k).toLowerCase()));
  }
  if (Array.isArray(cfg.optionen)) {
    for (const o of cfg.optionen) {
      if (o && o.mode === 'fix' && o.key) keys.add(String(o.key).toLowerCase());
    }
  }
  return keys;
}

function namesMatch(names, re) {
  return names.some((n) => re.test(String(n).toLowerCase()));
}

/**
 * Resolve which diagram parts are in color for this offer.
 * @returns {{ flags: Record<string, boolean>, greyKeys: string[], alwaysColor: string[] }}
 */
function resolveHouseDiagramSelection(offer) {
  const cfg = (offer && offer.config) || {};
  const names = itemNames(offer);
  const inkl = includedOptionKeys(offer);
  const klimaFix = (offer && offer.klima && Array.isArray(offer.klima.fix)) ? offer.klima.fix : [];

  const hasPv = cfg.includePv !== false
    && (Number(cfg.moduleCount) > 0 || Number(cfg.kwp) > 0 || Number(cfg.kwpCalculated) > 0
      || namesMatch(names, /modul|das-|aiko|photovoltaik|unterkonstruktion/));

  const hasBattery = Number(cfg.speicher) > 0
    || Number(cfg.speicherBasis) > 0
    || Number(cfg.speicherGesamt) > 0
    || namesMatch(names, /speicher|batter|reserva|sigenstor bat|\bbat\b/);

  const hasInverter = hasPv
    || !!(cfg.inverter)
    || namesMatch(names, /wechselrichter|hybrid|inverter|gen24|sigenstor ec|sun2000/);

  const hasNotstrom = inkl.has('notstrom')
    || namesMatch(names, /notstrom|umschalt|gateway|netztren|backup.?box/);

  const hasWallbox = inkl.has('wallbox')
    || namesMatch(names, /wallbox|wattpilot|e-?ladestation|ladestation/);

  // Klimaanlage Innen+Außen (v2) — same offer flag as Wärmepumpe/Klima
  const hasKlima = klimaFix.length > 0
    || namesMatch(names, /wärmepumpe|waermepumpe|klima|innengerät|außengerät|lg standard/)
    || !!(cfg.klima && (cfg.klima.enabled || cfg.klima.packageId
      || (Array.isArray(cfg.klima) && cfg.klima.length)));

  const hasEv = hasWallbox;

  const flags = {
    netz: true,
    smartMeter: true,
    verteiler: true,
    hausverbraucher: true,
    pv: !!hasPv,
    inverter: !!hasInverter,
    battery: !!hasBattery,
    notstrom: !!hasNotstrom,
    klimaInnen: !!hasKlima,
    klimaAussen: !!hasKlima,
    waermepumpe: !!hasKlima, // alias for callers / glance rows
    wallbox: !!hasWallbox,
    ev: !!hasEv,
  };

  const greyKeys = PRODUCT_KEYS.filter((k) => !flags[k]);
  return { flags, greyKeys, alwaysColor: ALWAYS_COLOR_KEYS.slice() };
}

function mutePixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const pale = Math.min(238, gray * 0.22 + 218 * 0.78);
  const v = Math.round(pale);
  return { r: v, g: v, b: v };
}

function isBackgroundWash(r, g, b) {
  if (r >= 248 && g >= 248 && b >= 248) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Light house shell / roof wash
  if (sat < 28 && lum > 195) return true;
  if (sat < 18 && lum > 175) return true;
  return false;
}

/** AC green + DC blue flow strokes (v2 palette). */
function isFlowArrowCandidate(r, g, b) {
  // DC blue
  if (b >= 140 && r <= 130 && (b - r) >= 40 && (b - g) >= 15) return true;
  // AC green
  if (g >= 110 && g > r + 20 && g > b + 12 && r < 190 && b < 190) return true;
  // Refrigerant red (Klima Innen↔Außen) — keep as infrastructure
  if (r >= 150 && r > g + 40 && r > b + 40) return true;
  return false;
}

/**
 * Flood-fill flow-colored components (green AC / blue DC / refrigerant).
 * Keep only large/elongated strokes that extend outside a mute box.
 */
function collectFlowComponents(png) {
  const w = png.width;
  const h = png.height;
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (w * y + x) << 2;
      if (isFlowArrowCandidate(png.data[i], png.data[i + 1], png.data[i + 2])) {
        cand[y * w + x] = 1;
      }
    }
  }
  const comps = [];
  const seen = new Uint8Array(n);
  const qx = new Int32Array(n);
  const qy = new Int32Array(n);
  let labelId = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const start = y * w + x;
      if (!cand[start] || seen[start]) continue;
      labelId += 1;
      let qh = 0;
      let qt = 0;
      qx[qt] = x;
      qy[qt] = y;
      qt += 1;
      seen[start] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      const pix = [];
      while (qh < qt) {
        const cx = qx[qh];
        const cy = qy[qh];
        qh += 1;
        const idx = cy * w + cx;
        pix.push(idx);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (!dx && !dy) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (!cand[ni] || seen[ni]) continue;
            seen[ni] = 1;
            qx[qt] = nx;
            qy[qt] = ny;
            qt += 1;
          }
        }
      }
      comps.push({
        id: labelId,
        count: pix.length,
        minX,
        maxX,
        minY,
        maxY,
        pixels: pix,
      });
    }
  }
  return { w, h, comps };
}

function buildArrowMaskForBox(components, boxPx) {
  const { w, h, comps } = components;
  const n = w * h;
  const mask = new Uint8Array(n);
  const [x0, y0, x1, y1] = boxPx;
  for (const c of comps) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    const longAxis = Math.max(bw, bh);
    if (c.count < 120 || longAxis < 28) continue;
    const outside = c.minX < x0 - 2 || c.maxX > x1 + 2 || c.minY < y0 - 2 || c.maxY > y1 + 2;
    if (!outside) continue;
    for (let k = 0; k < c.pixels.length; k += 1) mask[c.pixels[k]] = 1;
  }
  const dil = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        dil[ny * w + nx] = 1;
      }
    }
  }
  return dil;
}

function applyGreyRegions(png, greyKeys, components) {
  const w = png.width;
  const h = png.height;
  for (const key of greyKeys) {
    const box = REGIONS[key];
    if (!box) continue;
    const x0 = Math.max(0, Math.floor(box[0] * w));
    const y0 = Math.max(0, Math.floor(box[1] * h));
    const x1 = Math.min(w, Math.ceil(box[2] * w));
    const y1 = Math.min(h, Math.ceil(box[3] * h));
    const arrowMask = buildArrowMaskForBox(components, [x0, y0, x1, y1]);
    const insetX = Math.max(4, Math.round((x1 - x0) * 0.12));
    const insetY = Math.max(4, Math.round((y1 - y0) * 0.10));
    const cx0 = x0 + insetX;
    const cy0 = y0 + insetY;
    const cx1 = x1 - insetX;
    const cy1 = y1 - insetY;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const pi = y * w + x;
        const inCore = x >= cx0 && x < cx1 && y >= cy0 && y < cy1;
        if (!inCore && arrowMask[pi]) continue;
        const i = pi << 2;
        const r = png.data[i];
        const g = png.data[i + 1];
        const b = png.data[i + 2];
        if (isBackgroundWash(r, g, b)) continue;
        // Never mute flow strokes even in core if clearly AC/DC green/blue arrow
        if (arrowMask[pi] && isFlowArrowCandidate(r, g, b)) continue;
        const { r: nr, g: ng, b: nb } = mutePixel(r, g, b);
        png.data[i] = nr;
        png.data[i + 1] = ng;
        png.data[i + 2] = nb;
      }
    }
  }
}

function renderHouseDiagramPng(offer) {
  if (!fs.existsSync(BASE)) return null;
  const { greyKeys } = resolveHouseDiagramSelection(offer);
  try {
    const raw = fs.readFileSync(BASE);
    if (!greyKeys.length) return raw;
    const png = PNG.sync.read(raw);
    const components = collectFlowComponents(png);
    applyGreyRegions(png, greyKeys, components);
    return PNG.sync.write(png);
  } catch (err) {
    console.warn('[NOORTEC] house-diagram render:', err.message);
    return fs.readFileSync(BASE);
  }
}

function writeHouseDiagramTemp(offer, tmpDir = null) {
  const buf = renderHouseDiagramPng(offer);
  if (!buf) return null;
  const dir = tmpDir || path.join(require('os').tmpdir(), 'noortec-offer');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `house-diagram-${process.pid}-${Date.now()}.png`);
  fs.writeFileSync(out, buf);
  return out;
}

module.exports = {
  BASE,
  REGIONS,
  PRODUCT_KEYS,
  ALWAYS_COLOR_KEYS,
  resolveHouseDiagramSelection,
  renderHouseDiagramPng,
  writeHouseDiagramTemp,
};
