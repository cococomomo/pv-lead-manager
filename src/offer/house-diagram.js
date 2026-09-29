'use strict';

/**
 * House system diagram for „Auf einen Blick“.
 * Base art: house-system-diagram.png (customer-supplied reference).
 *
 * Always full color (never B&W) — Noortec does not sell / always present:
 *   Öffentliches Netz, utility Smart Meter (Zähler), Haupt-Verteilerkasten,
 *   Allgemeine Hausverbraucher, house shell.
 *
 * Sellable products: full color if in this offer; otherwise pale black-and-white
 * so it is obvious they are not part of the quote.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BASE = path.join(__dirname, 'assets', 'products', 'house-system-diagram.png');

/**
 * Tight icon+label boxes only (no surrounding arrows / house lines).
 * Pixel filter additionally protects blue Stromfluss arrows & house shell.
 */
const REGIONS = {
  // Always-on context — never muted
  netz: [0.02, 0.24, 0.12, 0.52],
  smartMeter: [0.145, 0.30, 0.255, 0.52],
  verteiler: [0.54, 0.32, 0.67, 0.56],
  hausverbraucher: [0.66, 0.72, 0.84, 0.94],

  // Sellable products — tight around glyph + caption (not surrounding arrows)
  notstrom: [0.275, 0.28, 0.375, 0.54],
  pv: [0.34, 0.02, 0.58, 0.26],
  inverter: [0.38, 0.30, 0.51, 0.50],
  battery: [0.38, 0.52, 0.52, 0.74],
  waermepumpe: [0.74, 0.14, 0.92, 0.42],
  wallbox: [0.72, 0.44, 0.85, 0.70],
  ev: [0.84, 0.40, 0.98, 0.72],
};

/** Sellable product keys muted when not in the offer. */
const PRODUCT_KEYS = [
  'pv',
  'inverter',
  'battery',
  'notstrom',
  'waermepumpe',
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

  const hasWaermepumpe = klimaFix.length > 0
    || namesMatch(names, /wärmepumpe|waermepumpe|klima|innengerät|außengerät|lg standard/)
    || !!(cfg.klima && (cfg.klima.enabled || cfg.klima.packageId
      || (Array.isArray(cfg.klima) && cfg.klima.length)));

  const hasEv = hasWallbox;

  const flags = {
    netz: true,
    smartMeter: true, // utility Zähler — never tied to SigenStor Smart Meter line
    verteiler: true,
    hausverbraucher: true, // Allgemeine Hausverbraucher — always color
    pv: !!hasPv,
    inverter: !!hasInverter,
    battery: !!hasBattery,
    notstrom: !!hasNotstrom,
    waermepumpe: !!hasWaermepumpe,
    wallbox: !!hasWallbox,
    ev: !!hasEv,
  };

  const greyKeys = PRODUCT_KEYS.filter((k) => !flags[k]);
  return { flags, greyKeys, alwaysColor: ALWAYS_COLOR_KEYS.slice() };
}

/**
 * Pale black-and-white for icon/label ink (strong enough to read as “not in offer”).
 */
function mutePixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  // Lift toward paper white so muted icons look washed-out, not just darker grey
  const pale = Math.min(238, gray * 0.22 + 218 * 0.78);
  const v = Math.round(pale);
  return { r: v, g: v, b: v };
}

/** Near-white / soft house wash — never mute. */
function isBackgroundWash(r, g, b) {
  if (r >= 248 && g >= 248 && b >= 248) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max - min;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (sat < 22 && lum > 200) return true;
  if (sat < 16 && lum > 185) return true;
  return false;
}

/** Candidate Stromfluss blue (tight — matches thick flow arrows ~rgb(5,104,219)). */
function isFlowBlueCandidate(r, g, b) {
  return b >= 175 && r <= 110 && g >= 60 && g <= 175 && (b - r) >= 70 && (b - g) >= 30;
}

/**
 * Flood-fill flow-blue components. A component is treated as a Stromfluss arrow
 * only if it is large/elongated AND extends outside the mute box (true flows),
 * so blue icon accents (Blitz etc.) inside the box still get muted.
 */
function collectBlueComponents(png) {
  const w = png.width;
  const h = png.height;
  const n = w * h;
  const cand = new Uint8Array(n);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (w * y + x) << 2;
      if (isFlowBlueCandidate(png.data[i], png.data[i + 1], png.data[i + 2])) {
        cand[y * w + x] = 1;
      }
    }
  }
  const label = new Int32Array(n);
  const comps = []; // { count, minX, maxX, minY, maxY, pixels: Int32Array of indices }
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
        label[idx] = labelId;
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
  return { w, h, label, comps };
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
    if (c.count < 160 || longAxis < 32) continue;
    // Must extend outside this mute box → real flow, not an icon-local blitz
    const outside = c.minX < x0 - 2 || c.maxX > x1 + 2 || c.minY < y0 - 2 || c.maxY > y1 + 2;
    if (!outside) continue;
    for (let k = 0; k < c.pixels.length; k += 1) mask[c.pixels[k]] = 1;
  }
  // Dilate 1px for anti-alias
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
    // Icon core: mute ALL ink (incl. blue blitz). Only the rim may keep arrow strokes.
    const insetX = Math.max(4, Math.round((x1 - x0) * 0.14));
    const insetY = Math.max(4, Math.round((y1 - y0) * 0.12));
    const cx0 = x0 + insetX;
    const cy0 = y0 + insetY;
    const cx1 = x1 - insetX;
    const cy1 = y1 - insetY;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const pi = y * w + x;
        const inCore = x >= cx0 && x < cx1 && y >= cy0 && y < cy1;
        if (!inCore && arrowMask[pi]) continue; // Stromfluss in the rim stays
        const i = pi << 2;
        const r = png.data[i];
        const g = png.data[i + 1];
        const b = png.data[i + 2];
        if (isBackgroundWash(r, g, b)) continue;
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
    const components = collectBlueComponents(png);
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
