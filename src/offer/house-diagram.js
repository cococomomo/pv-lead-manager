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
 * Normalized regions [x0,y0,x1,y1] on the 1536×1024 reference graphic.
 * Boxes include nearby labels / local feed arrows.
 */
const REGIONS = {
  // Always-on context — never muted
  netz: [0.01, 0.20, 0.14, 0.56],
  smartMeter: [0.13, 0.26, 0.27, 0.56], // utility/grid Zähler (≠ SigenStor product)
  verteiler: [0.52, 0.28, 0.69, 0.60],
  hausverbraucher: [0.60, 0.66, 0.88, 0.96],

  // Offer-dependent sellable products
  notstrom: [0.24, 0.18, 0.40, 0.54],
  pv: [0.30, 0.00, 0.64, 0.30],
  inverter: [0.35, 0.26, 0.54, 0.54],
  battery: [0.34, 0.48, 0.56, 0.80],
  waermepumpe: [0.68, 0.08, 0.94, 0.44],
  wallbox: [0.66, 0.40, 0.86, 0.70],
  ev: [0.80, 0.36, 0.99, 0.74],
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
 * True pale black-and-white: full desaturate + lighten so missing products
 * read as obviously „not in this offer“.
 */
function mutePixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  // Blend grayscale toward light grey (~#d0d0d0) — blass / schwarz-weiß
  const pale = Math.min(235, gray * 0.35 + 210 * 0.65);
  const v = Math.round(pale);
  return { r: v, g: v, b: v };
}

function applyGreyRegions(png, greyKeys) {
  const w = png.width;
  const h = png.height;
  for (const key of greyKeys) {
    const box = REGIONS[key];
    if (!box) continue;
    const x0 = Math.max(0, Math.floor(box[0] * w));
    const y0 = Math.max(0, Math.floor(box[1] * h));
    const x1 = Math.min(w, Math.ceil(box[2] * w));
    const y1 = Math.min(h, Math.ceil(box[3] * h));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (w * y + x) << 2;
        const r = png.data[i];
        const g = png.data[i + 1];
        const b = png.data[i + 2];
        // Keep pure page white clean
        if (r >= 252 && g >= 252 && b >= 252) continue;
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
    applyGreyRegions(png, greyKeys);
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
