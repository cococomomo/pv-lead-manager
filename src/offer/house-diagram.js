'use strict';

/**
 * House system diagram for „Auf einen Blick“.
 * Base art: house-system-diagram.png (Useini-style reference).
 * Selected offer components stay in color; others are desaturated.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const BASE = path.join(__dirname, 'assets', 'products', 'house-system-diagram.png');

/**
 * Normalized regions [x0,y0,x1,y1] on the 1536×1024 reference.
 * Include nearby labels / local arrows so greying reads clearly.
 */
const REGIONS = {
  // Always-on context (never greyed)
  netz: [0.00, 0.28, 0.13, 0.72],
  verteiler: [0.52, 0.36, 0.68, 0.64],
  hausverbraucher: [0.78, 0.72, 0.99, 0.99],

  // Offer-dependent products
  smartMeter: [0.11, 0.36, 0.29, 0.70],
  notstrom: [0.26, 0.32, 0.43, 0.64],
  inverter: [0.37, 0.20, 0.56, 0.50],
  battery: [0.35, 0.48, 0.56, 0.80],
  pv: [0.40, 0.00, 0.74, 0.30],
  // Include AC feed arrows from Verteiler so unused loads grey with their products
  waermepumpe: [0.62, 0.14, 0.94, 0.50],
  wallbox: [0.62, 0.44, 0.88, 0.76],
  ev: [0.78, 0.38, 0.99, 0.82],
};

/** Product keys that can be greyed (context keys omitted). */
const PRODUCT_KEYS = [
  'pv',
  'inverter',
  'battery',
  'smartMeter',
  'notstrom',
  'waermepumpe',
  'wallbox',
  'ev',
];

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
  // optionen with mode=fix may only appear in preis.inkludiert after computeOffer
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
 * @returns {{ flags: Record<string, boolean>, greyKeys: string[] }}
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

  // Smart Meter: in Speicherstückliste, or explicit option / nachrüstung line
  const hasSmartMeter = hasBattery
    || inkl.has('smartmeter')
    || namesMatch(names, /smart.?meter|zähler|zaehler|stromsensor|sigen.?sensor/);

  const hasNotstrom = inkl.has('notstrom')
    || namesMatch(names, /notstrom|umschalt|gateway|netztren|backup.?box/);

  const hasWallbox = inkl.has('wallbox')
    || namesMatch(names, /wallbox|wattpilot|e-?ladestation|ladestation/);

  const hasWaermepumpe = klimaFix.length > 0
    || namesMatch(names, /wärmepumpe|waermepumpe|klima|innengerät|außengerät|lg standard/)
    || !!(cfg.klima && (cfg.klima.enabled || cfg.klima.packageId
      || (Array.isArray(cfg.klima) && cfg.klima.length)));

  // EV visual follows Wallbox (no separate offer line)
  const hasEv = hasWallbox;

  const flags = {
    netz: true,
    verteiler: true,
    hausverbraucher: true,
    pv: !!hasPv,
    inverter: !!hasInverter,
    battery: !!hasBattery,
    smartMeter: !!hasSmartMeter,
    notstrom: !!hasNotstrom,
    waermepumpe: !!hasWaermepumpe,
    wallbox: !!hasWallbox,
    ev: !!hasEv,
  };

  const greyKeys = PRODUCT_KEYS.filter((k) => !flags[k]);
  return { flags, greyKeys };
}

/**
 * Strong mute: full desaturate + wash toward slate grey so even light/white
 * product icons (and already-grey hardware) clearly read as „not in offer“.
 */
function mutePixel(r, g, b) {
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  // Pull toward #9a9a9a — inactive but still readable
  const target = 154;
  const t = 0.78;
  const muted = gray * (1 - 0.35) + target * 0.35;
  return {
    r: Math.round(r * (1 - t) + muted * t),
    g: Math.round(g * (1 - t) + muted * t),
    b: Math.round(b * (1 - t) + muted * t),
  };
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
        // Keep pure page white; mute everything else in the box (incl. labels)
        if (r >= 252 && g >= 252 && b >= 252) continue;
        const { r: nr, g: ng, b: nb } = mutePixel(r, g, b);
        png.data[i] = nr;
        png.data[i + 1] = ng;
        png.data[i + 2] = nb;
      }
    }
  }
}

/**
 * Render diagram PNG buffer for this offer (full color + greyed inactive parts).
 * Falls back to raw base file bytes if pngjs fails.
 */
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

/** Write rendered diagram to a temp path for pdfkit (returns path or null). */
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
  resolveHouseDiagramSelection,
  renderHouseDiagramPng,
  writeHouseDiagramTemp,
};
