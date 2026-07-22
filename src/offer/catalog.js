'use strict';

/**
 * NOORTEC PV-Angebotsgenerator — Katalog, Preislogik & Stückliste.
 * Preisliste Q1/2025 (brutto). Alle Regeln laut Vertriebsvorgabe.
 */

const MWST_RATE = 0.20;

/**
 * Angebotsvarianten / Marken:
 * - sigenergy / fronius: Hybrid + Speicher (bestehende Bruttopreise)
 * - huawei / fronius_symo: PV ohne Speicher (gleiche Nettopreise → brutto = netto × 1,20)
 */
const BRAND_META = {
  sigenergy: {
    id: 'sigenergy',
    label: 'Sigenergy (mit Speicher)',
    shortLabel: 'Sigenergy',
    hasStorage: true,
    group: 'hybrid',
  },
  fronius: {
    id: 'fronius',
    label: 'Fronius GEN24 + Reserva (mit Speicher)',
    shortLabel: 'Fronius GEN24',
    hasStorage: true,
    group: 'hybrid',
  },
  huawei: {
    id: 'huawei',
    label: 'Huawei SUN2000 (ohne Speicher)',
    shortLabel: 'Huawei',
    hasStorage: false,
    group: 'pv_only',
  },
  fronius_symo: {
    id: 'fronius_symo',
    label: 'Fronius Symo (ohne Speicher)',
    shortLabel: 'Fronius Symo',
    hasStorage: false,
    group: 'pv_only',
  },
};

function normalizeBrand(brand) {
  const s = String(brand || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (s === 'fronius' || s === 'fronius_gen24' || s === 'gen24') return 'fronius';
  if (s === 'sigenergy' || s === 'sigen' || s === 'sig') return 'sigenergy';
  if (s === 'huawei' || s === 'sun2000' || s === 'huawei_sun2000') return 'huawei';
  if (s === 'fronius_symo' || s === 'symo' || s === 'fronius_symo_classic') return 'fronius_symo';
  return 'sigenergy';
}

function brandHasStorage(brand) {
  const meta = BRAND_META[normalizeBrand(brand)];
  return !!(meta && meta.hasStorage);
}

function brandLabel(brand) {
  const meta = BRAND_META[normalizeBrand(brand)];
  return (meta && (meta.shortLabel || meta.label)) || String(brand || '');
}

function listBrands() {
  return Object.keys(BRAND_META).map((id) => ({ ...BRAND_META[id] }));
}

/** Netto-Preisliste PV ohne Speicher (Huawei / Fronius Symo, gleiche Preise). */
const PV_ONLY_NETTO = {
  3.1: { modules: 7, netto: 6500 },
  4.4: { modules: 10, netto: 6700 },
  5.2: { modules: 12, netto: 6950 },
  6.1: { modules: 14, netto: 7500 },
  7.0: { modules: 16, netto: 8200 },
  8.7: { modules: 20, netto: 9250 },
  10.0: { modules: 23, netto: 10200 },
  12.3: { modules: 28, netto: 11500 },
  13.6: { modules: 32, netto: 11950 },
  14.8: { modules: 34, netto: 12950 },
  17.8: { modules: 41, netto: 14500 },
};

function buildPvOnlyPricelist() {
  const out = {};
  for (const [kwp, row] of Object.entries(PV_ONLY_NETTO)) {
    // Katalog intern brutto (wie Hybrid), damit MwSt-/Rundungslogik einheitlich bleibt
    out[Number(kwp)] = { 0: Math.round(Number(row.netto) * (1 + MWST_RATE)) };
  }
  return out;
}

// ── Preisliste (brutto in EUR) ────────────────────────────────────────────
// brand -> kWp -> { speicherKWh: bruttoPreis }  (0 = ohne Speicher)
const PRICELIST = {
  sigenergy: {
    5.01: { 6: 13200, 9: 14700, 12: 16500 },
    5.92: { 6: 14400, 9: 15900, 12: 17700 },
    7.28: { 6: 15000, 9: 16000, 12: 18300 },
    8.19: { 6: 15650, 9: 16250, 12: 18950 },
    10.01: { 6: 16400, 9: 17000, 12: 19700 },
    12.29: { 9: 18500, 12: 20500 },
    13.2: { 9: 19000, 12: 21000 },
    15.02: { 9: 21000, 12: 23000 },
    17.8: { 9: 23000, 12: 25000 },
  },
  fronius: {
    5.01: { 6.4: 14400, 9.5: 15720, 12.6: 17040, 15.8: 18360 },
    5.92: { 6.4: 15600, 9.5: 16920, 12.6: 18240, 15.8: 19560 },
    7.28: { 6.4: 16320, 9.5: 17640, 12.6: 18960, 15.8: 20280 },
    8.19: { 6.4: 17000, 9.5: 18320, 12.6: 19640, 15.8: 20960 },
    10.01: { 9.5: 19980, 12.6: 21300, 15.8: 22620 },
    12.29: { 9.5: 21500, 12.6: 22820, 15.8: 24140 },
    13.2: { 9.5: 22100, 12.6: 23420, 15.8: 24740 },
    15.02: { 9.5: 23000, 12.6: 24320, 15.8: 25640 },
    18.2: { 9.5: 25000, 12.6: 26320, 15.8: 27640 },
  },
  huawei: null,
  fronius_symo: null,
};
PRICELIST.huawei = buildPvOnlyPricelist();
PRICELIST.fronius_symo = buildPvOnlyPricelist();


// Speicherelemente / Erweiterungsblöcke
const SPEICHERBLOCK = {
  sigenergy: { 6: 3300, 9: 3960 },
  fronius: { 3.2: 1320 },
  huawei: {},
  fronius_symo: {},
};

/**
 * Fronius Reserva: physische Batteriemodule à ca. 3,2 kWh.
 * Ein Tower = 2–5 Module → 6,4 / 9,5 / 12,6 / 15,8 kWh.
 * Parallelbetrieb: bis zu 3 Speichertower (Vertriebsregel).
 * Aufpreis je zusätzlichem Modul = 1.320 € (aus Preisliste linear).
 */
const FRONIUS_MODULE_KWH = 3.2;
const FRONIUS_MODULE_PRICE = 1320;
const FRONIUS_MAX_MODULES_PER_TOWER = 5;
const FRONIUS_MAX_TOWERS = 3;
const FRONIUS_TOWER_KWH = Object.freeze({
  2: 6.4,
  3: 9.5,
  4: 12.6,
  5: 15.8,
});

// Manuell hinzufügbare Speicher-Erweiterungsblöcke (über die Tabellen-Stufen
// hinaus). Preise/Größen aus der Preislisten-Differenz abgeleitet, editierbar.
// Sigenergy: stapelbare 6er-/9er-Blöcke. Fronius: einzelne 3,2-kWh-Elemente.
const STORAGE_EXTENSIONS = {
  sigenergy: [
    { kwh: 6, price: 3300, label: '+6 kWh Speicherblock (SigenStor BAT)' },
    { kwh: 9, price: 3960, label: '+9 kWh Speicherblock (SigenStor BAT)' },
  ],
  fronius: [
    { kwh: 3.2, price: 1320, label: '+3,2 kWh Speicherelement (Fronius Reserva)' },
  ],
  huawei: [],
  fronius_symo: [],
};

// Module je Anlagengröße (kWp -> Anzahl Module) – Hybrid + PV-only
const MODULES_PER_KWP = {
  // Hybrid (Sigenergy / Fronius GEN24)
  5.01: 11, 5.92: 13, 7.28: 16, 8.19: 18, 10.01: 22,
  12.29: 27, 13.2: 29, 15.02: 33, 17.8: 41, 18.2: 40,
  // PV ohne Speicher (Huawei / Fronius Symo)
  3.1: 7, 4.4: 10, 5.2: 12, 6.1: 14, 7.0: 16, 8.7: 20,
  10.0: 23, 12.3: 28, 13.6: 32, 14.8: 34,
};

// Dachaufschläge (EUR pro kWp)
const DACH_AUFSCHLAG = {
  ziegel: 0,
  welleternit: 0,
  trapezblech: 0,
  falzblech: 0,
  'schindel-eternit': 80,
  rhombus: 80,
  biberschwanz: 80,
  'wiener tasche': 100,
  prefa: 100,
  flachdach: 30,
  'flachdach süd': 30,
  'flachdach südaufständerung': 30,
  'flachdach ost-west': 30,
  'freifläche süd': 30,
  'freifläche ost-west': 30,
};

/** Anzeige-Reihenfolge in der Angebotsmaske (Dropdown). */
const DACH_LABELS = [
  'Ziegel', 'Welleternit', 'Trapezblech', 'Falzblech',
  'Schindel-Eternit', 'Rhombus', 'Biberschwanz', 'Wiener Tasche', 'Prefa',
  // Flachdach: drei Varianten (allgemein + Ausrichtungen)
  'Flachdach',
  'Flachdach Ost-West',
  'Flachdach Südaufständerung',
  'Freifläche Ost-West',
  'Freifläche Süd',
];

// Optionen (brutto, laut Preisliste).
// Hybrid-Systeme: Smart Meter ist im Paketpreis enthalten (Stückliste ohne Aufpreis).
// Extra-Montage / Nachrüstung: Option smartmeter zu 500 €.
// Reihenfolge = Anzeige-Reihenfolge in der Eingabemaske. Preise sind in der UI
// editierbar (Default-Werte hier). mode (optional|fix) wird pro Angebot gesetzt.
const OPTIONS = {
  notstrom: { label: 'Notstrom / Gateway / Umschaltbox', price: 1500 },
  wallbox: { label: 'Wallbox 11 kW', price: 1800 },
  speichererweiterung: { label: 'Speichererweiterung (Sigenergy +6/+9 kWh · Fronius +3,2 kWh)', price: 3300 },
  optimierer: { label: 'Optimierer Huawei (1 pro Modul)', price: 50, perModule: true },
  ueberspannungsschutz: { label: 'Überspannungsschutz', price: 400 },
  lasttrennschalter: { label: 'Lasttrennschalter', price: 150 },
  fi_schalter: { label: 'FI-Zusatzschutz', price: 180 },
  zaehlersteckleiste: { label: 'Zählersteckleiste', price: 150 },
  zaehlerbrett: { label: 'Zählerplatz / Zählerbrett', price: 200 },
  wireless_access_point: { label: 'Wireless Access Point', price: 80 },
  et08_schloss: { label: 'ET08 Schloss', price: 360 },
  waermepumpe_anschluss: { label: 'Anschluss für Wärmepumpe (vorbereitet)', price: 800 },
  ohmpilot: { label: 'Ohmpilot (bis 9 kW, 3-phasig)', price: 1800 },
  smartmeter: { label: 'Smart Meter inkl. Montage (Nachrüstung)', price: 500 },
};

/** Brutto-Preis pro Optimierer (wenn nicht manuell gesetzt). */
const OPTIMIERER_UNIT_PRICE = 50;

// Komponentennamen für die Stückliste, wenn eine Option FIX ins Angebot kommt.
const OPTION_COMPONENT_NAMES = {
  optimierer: 'Optimierer Huawei',
  ueberspannungsschutz: 'Überspannungsschutz (Typ I+II)',
  lasttrennschalter: 'Lasttrennschalter',
  fi_schalter: 'FI-Zusatzschutz',
  zaehlersteckleiste: 'Zählersteckleiste',
  zaehlerbrett: 'Zählerplatz / Zählerbrett',
  wireless_access_point: 'Wireless Access Point',
  et08_schloss: 'ET08 Schloss',
  waermepumpe_anschluss: 'Anschluss für Wärmepumpe (vorbereitet)',
  ohmpilot: 'Ohmpilot (bis 9 kW, 3-phasig) – Warmwasser-Überschussnutzung',
  smartmeter: 'Smart Meter inkl. Montage',
};

// AIKO-Modul-Variante
const MODULE_TYPES = {
  das: { model: 'DAS-DH108ND-455', wp: 455, aufschlagProModul: 0,
    desc: 'Modul (bifazial Glas-Glas, TOPCon, Black Frame, 455 Wp | 25 J. Produktgarantie, 30 J. Leistungsgarantie)' },
  aiko: { model: 'AIKO Neostar', wp: 490, aufschlagProModul: 60,
    desc: 'Modul (AIKO, 490 Wp, Black Frame | 25 J. Produktgarantie, 30 J. Leistungsgarantie)' },
};

const ROUND_STEP = 100;
/** Zusätzliche Module über die Paketgröße hinaus (netto EUR, pro Modul). */
const EXTRA_MODULE_PRICE = 200;

/**
 * LG STANDARD II – Angebotspakete (Brutto-Installationspreise NOORTEC).
 * Innengeräte / Außengeräte-kW wie im Vertriebsfunnel; Modelle wo bekannt aus Datenblatt.
 */
const KLIMA_PACKAGES = [
  {
    id: 'lg-std2-single-25',
    label: 'LG STANDARD II Single-Split 2,5 kW',
    brand: 'LG STANDARD II',
    type: 'single',
    outdoorKw: 2.5,
    indoor: [{ kw: 2.5, qty: 1, model: 'S09EC.NSJS' }],
    outdoorModel: 'S09EC.UA3S',
    priceBrutto: 2400,
    features: ['R32', 'WLAN / ThinQ', 'AI Dual Inverter', 'Gold Fin'],
  },
  {
    id: 'lg-std2-single-35',
    label: 'LG STANDARD II Single-Split 3,5 kW',
    brand: 'LG STANDARD II',
    type: 'single',
    outdoorKw: 3.5,
    indoor: [{ kw: 3.5, qty: 1, model: 'S12EC.NSJS' }],
    outdoorModel: 'S12EC.UA3S',
    priceBrutto: 2600,
    features: ['R32', 'WLAN / ThinQ', 'AI Dual Inverter', 'Gold Fin'],
  },
  {
    id: 'lg-std2-multi-41',
    label: 'LG STANDARD II Multi-Split 4,1 kW (2× 2,5 kW Innen)',
    brand: 'LG STANDARD II',
    type: 'multi',
    outdoorKw: 4.1,
    indoor: [{ kw: 2.5, qty: 2, model: 'S09EC.NSJS' }],
    outdoorModel: 'Multi 4,1 kW',
    priceBrutto: 4500,
    features: ['R32', 'WLAN / ThinQ', 'AI Dual Inverter', 'Gold Fin'],
  },
  {
    id: 'lg-std2-multi-63',
    label: 'LG STANDARD II Multi-Split 6,3 kW (2× 2,5 + 1× 3,5 kW Innen)',
    brand: 'LG STANDARD II',
    type: 'multi',
    outdoorKw: 6.3,
    indoor: [
      { kw: 2.5, qty: 2, model: 'S09EC.NSJS' },
      { kw: 3.5, qty: 1, model: 'S12EC.NSJS' },
    ],
    outdoorModel: 'Multi 6,3 kW',
    priceBrutto: 7200,
    features: ['R32', 'WLAN / ThinQ', 'AI Dual Inverter', 'Gold Fin'],
  },
];

/** Zubehör / Aufschläge Klima (brutto). */
const KLIMA_EXTRAS = {
  piping: {
    key: 'piping_extra',
    label: 'Kältemittelleitung – Zusatzlaufmeter',
    pricePerMeter: 40,
    includedMetersPerIndoor: 10,
    hint: 'Inkl. max. 10 m je Innengerät; jeder weitere Laufmeter 40 € brutto',
  },
  condensatePump: {
    key: 'condensate_pump',
    label: 'Kondensatwasserpumpe',
    price: 240,
  },
};

/** Alias für API – Liste der wählbaren Pakete. */
const KLIMA_CATALOG = KLIMA_PACKAGES;

function getKlimaPackage(id) {
  return KLIMA_PACKAGES.find((p) => p.id === id) || null;
}

function countKlimaIndoorUnits(pkg) {
  if (!pkg || !Array.isArray(pkg.indoor)) return 0;
  return pkg.indoor.reduce((s, i) => s + (Number(i.qty) || 0), 0);
}

function formatKlimaIndoorSummary(pkg) {
  if (!pkg) return '';
  return (pkg.indoor || [])
    .map((i) => `${i.qty}× ${String(i.kw).replace('.', ',')} kW`)
    .join(' + ');
}

/**
 * Expandiert config.klima zu Preiszeilen.
 * config.klima = {
 *   enabled, mode:'fix'|'optional', packageId, qty,
 *   extraPipingMeters, condensatePump (bool|number qty)
 * }
 * oder Array von solchen Objekten / manuellen Zeilen { label, price, mode, qty }.
 */
function expandKlimaLines(klimaConfig) {
  const lines = [];
  const rawList = Array.isArray(klimaConfig)
    ? klimaConfig
    : (klimaConfig && typeof klimaConfig === 'object' && (klimaConfig.enabled || klimaConfig.packageId)
      ? [klimaConfig]
      : []);

  for (const entry of rawList) {
    if (!entry) continue;
    if (entry.enabled === false) continue;
    const mode = entry.mode === 'optional' ? 'optional' : 'fix';
    const qtyPkg = Math.max(1, Math.round(Number(entry.qty) || 1));

    if (entry.packageId || entry.id) {
      const pkg = getKlimaPackage(entry.packageId || entry.id);
      if (!pkg) continue;
      const indoorCount = countKlimaIndoorUnits(pkg) * qtyPkg;
      const indoorSum = formatKlimaIndoorSummary(pkg);
      lines.push({
        key: pkg.id,
        packageId: pkg.id,
        label: qtyPkg > 1 ? `${pkg.label} (${qtyPkg}×)` : pkg.label,
        desc: `Außen ${String(pkg.outdoorKw).replace('.', ',')} kW · Innen ${indoorSum} · ${pkg.brand}`,
        price: pkg.priceBrutto * qtyPkg,
        qty: qtyPkg,
        mode,
        indoorCount,
        package: pkg,
      });

      const extraM = Math.max(0, Number(entry.extraPipingMeters) || 0);
      if (extraM > 0) {
        const p = KLIMA_EXTRAS.piping;
        lines.push({
          key: p.key,
          label: `${p.label} (${extraM} m)`,
          desc: p.hint,
          price: extraM * p.pricePerMeter,
          qty: extraM,
          mode,
        });
      }

      const pumpQty = entry.condensatePump === true
        ? 1
        : (entry.condensatePump === false || entry.condensatePump == null
          ? 0
          : Math.max(0, Math.round(Number(entry.condensatePump) || 0)));
      if (pumpQty > 0) {
        const p = KLIMA_EXTRAS.condensatePump;
        lines.push({
          key: p.key,
          label: pumpQty > 1 ? `${p.label} (${pumpQty}×)` : p.label,
          desc: '',
          price: p.price * pumpQty,
          qty: pumpQty,
          mode,
        });
      }
      continue;
    }

    // Manuelle / bereits expandierte Zeile
    const label = String(entry.label || '').trim();
    let price = Number(entry.price);
    if (!label && !Number.isFinite(price)) continue;
    if (!Number.isFinite(price)) price = 0;
    const qty = Math.max(1, Math.round(Number(entry.qty) || 1));
    lines.push({
      key: entry.key || null,
      label: label || 'Klimaposition',
      desc: String(entry.desc || ''),
      price: price * (entry.total != null ? 1 : 1),
      qty,
      mode: entry.mode === 'optional' ? 'optional' : mode,
      total: entry.total != null ? Number(entry.total) : price * qty,
    });
  }

  // Normalize totals
  for (const l of lines) {
    if (l.total == null) l.total = Number(l.price) || 0;
  }
  return lines;
}

/**
 * Matcht freie Angaben (Außen-kW + Innen-Liste) auf ein Katalogpaket.
 * indoorSpec = [{ kw, qty }, ...]
 */
function matchKlimaPackage({ outdoorKw, indoor }) {
  const o = Number(outdoorKw);
  const ind = Array.isArray(indoor) ? indoor : [];
  const norm = (list) => list
    .map((i) => ({ kw: Number(i.kw), qty: Number(i.qty) || 1 }))
    .filter((i) => i.kw > 0 && i.qty > 0)
    .sort((a, b) => a.kw - b.kw || a.qty - b.qty);

  const want = norm(ind);
  for (const pkg of KLIMA_PACKAGES) {
    if (Math.abs(Number(pkg.outdoorKw) - o) > 0.15) continue;
    const have = norm(pkg.indoor);
    if (have.length !== want.length) continue;
    let ok = true;
    for (let i = 0; i < have.length; i++) {
      if (Math.abs(have[i].kw - want[i].kw) > 0.15 || have[i].qty !== want[i].qty) {
        ok = false;
        break;
      }
    }
    if (ok) return pkg;
  }
  return null;
}

function round100(x) {
  return Math.round(x / ROUND_STEP) * ROUND_STEP;
}

/** Brutto auf volle Euro (Preisliste enthält z. B. 15.650 / 15.720 – nicht auf 100 € runden). */
function roundEuro(x) {
  return Math.round(Number(x) || 0);
}

/** Berechnete Anlagenleistung aus Modulanzahl und Wp. */
function kwpFromModulesExact(moduleCount, wp) {
  const m = Number(moduleCount);
  const w = Number(wp);
  if (!Number.isFinite(m) || m <= 0 || !Number.isFinite(w) || w <= 0) return null;
  return Math.round((m * w) / 10) / 100; // 2 Nachkommastellen
}

/**
 * Größtes Preispaket mit MODULES_PER_KWP ≤ moduleCount (Floor).
 * Fallback: kleinstes verfügbares Paket der Marke.
 * @returns {{ kwpPackage: number, packageModules: number } | null}
 */
function resolvePackageForModules(brand, moduleCount) {
  const m = Number(moduleCount);
  const tiers = listKwpTiers(brand);
  if (!tiers.length) return null;
  if (!Number.isFinite(m) || m <= 0) {
    const t = tiers[0];
    return { kwpPackage: t, packageModules: MODULES_PER_KWP[t] || 0 };
  }
  let floor = null;
  for (const t of tiers) {
    const mc = MODULES_PER_KWP[t];
    if (mc == null) continue;
    if (mc <= m && (floor == null || mc > floor.packageModules)) {
      floor = { kwpPackage: t, packageModules: mc };
    }
  }
  if (floor) return floor;
  const t = tiers[0];
  return { kwpPackage: t, packageModules: MODULES_PER_KWP[t] || 0 };
}

/** kWp-Stufe aus gewünschter Modulanzahl (nächstgelegenes Paket – Legacy/KI). */
function kwpFromModuleCount(brand, modules) {
  const resolved = resolvePackageForModules(brand, modules);
  if (!resolved) return null;
  // Für KI/Legacy: nächstgelegen; Floor ist führend für Preise
  const m = Number(modules);
  if (!Number.isFinite(m) || m <= 0) return resolved.kwpPackage;
  const tiers = listKwpTiers(brand);
  let best = null;
  let bestDiff = Infinity;
  for (const t of tiers) {
    const mc = MODULES_PER_KWP[t];
    if (mc == null) continue;
    const d = Math.abs(mc - m);
    if (d < bestDiff - 1e-9) { bestDiff = d; best = t; }
  }
  return best != null ? best : resolved.kwpPackage;
}

/** Physische Sigenergy-BAT-Module – es gibt nur 6- und 9-kWh-Blöcke (beliebig kombinierbar). */
const SIGENERGY_PHYSICAL_KWH = [6, 9];

function isSigenergyPhysicalBase(kwh) {
  return SIGENERGY_PHYSICAL_KWH.some((t) => Math.abs(t - Number(kwh)) < 0.05);
}

/** Modulanzahl eines Fronius-Reserva-Tower-Labels (6,4→2 … 15,8→5). */
function froniusModulesForKwh(kwh) {
  const k = Number(kwh);
  if (!Number.isFinite(k) || k <= 0) return 0;
  for (const [mods, tier] of Object.entries(FRONIUS_TOWER_KWH)) {
    if (Math.abs(Number(tier) - k) < 0.25) return Number(mods);
  }
  if (k > 15.8 - 0.05) {
    const extra = Math.round((k - 15.8) / FRONIUS_MODULE_KWH);
    if (extra >= 0 && Math.abs((15.8 + extra * FRONIUS_MODULE_KWH) - k) < 0.35) {
      return FRONIUS_MAX_MODULES_PER_TOWER + extra;
    }
  }
  const approx = Math.round(k / FRONIUS_MODULE_KWH);
  return Math.max(2, Math.min(FRONIUS_MAX_TOWERS * FRONIUS_MAX_MODULES_PER_TOWER, approx));
}

/** Kommerzielle kWh-Bezeichnung für n Reserva-Module. */
function froniusKwhForModules(modules) {
  const m = Math.round(Number(modules));
  if (m <= 0) return 0;
  if (FRONIUS_TOWER_KWH[m] != null) return FRONIUS_TOWER_KWH[m];
  if (m > FRONIUS_MAX_MODULES_PER_TOWER) {
    return Math.round((15.8 + (m - FRONIUS_MAX_MODULES_PER_TOWER) * FRONIUS_MODULE_KWH) * 10) / 10;
  }
  return Math.round(m * FRONIUS_MODULE_KWH * 10) / 10;
}

/**
 * Wunsch-kWh → Modulanzahl (2…15). Bekannte Tower-Stufen haben Vorrang
 * vor reinem 3,2-Raster (9,5 ≠ 3×3,2).
 */
function froniusModulesFromDesired(desiredKWh) {
  const d = Number(desiredKWh);
  if (!Number.isFinite(d) || d <= 0) return 0;
  const maxMods = FRONIUS_MAX_TOWERS * FRONIUS_MAX_MODULES_PER_TOWER;

  const known = [
    [6.3, 2], [6.31, 2], [6.4, 2],
    [9.47, 3], [9.5, 3],
    [12.63, 4], [12.6, 4],
    [15.79, 5], [15.8, 5],
  ];
  for (const [k, m] of known) {
    if (Math.abs(d - k) < 0.2) return m;
  }

  let best = 2;
  let bestDiff = Infinity;
  for (let m = 2; m <= maxMods; m++) {
    const t = froniusKwhForModules(m);
    const diff = Math.abs(t - d);
    if (diff < bestDiff - 1e-9) {
      bestDiff = diff;
      best = m;
    }
  }
  return best;
}

function froniusExtBlock() {
  return {
    kwh: FRONIUS_MODULE_KWH,
    price: FRONIUS_MODULE_PRICE,
    label: '+3,2 kWh Speicherelement (Fronius Reserva)',
  };
}

/**
 * Fronius: Tower-Stufen aus der Preisliste + lineare +3,2-kWh-Elemente (1.320 €).
 * Mehrere Tower = zusätzliche Module über 15,8 hinaus (max. 3 Tower à 5 Module).
 */
function planStorageFronius(kwp, desiredKWh) {
  const desired = Number(desiredKWh);
  if (!Number.isFinite(desired) || desired <= 0) {
    return { baseKwh: null, blocks: [], totalKwh: 0, exact: true };
  }
  const tiers = listStorageTiers('fronius', kwp);
  if (!tiers.length) {
    return { baseKwh: null, blocks: [], totalKwh: desired, exact: false };
  }

  const maxMods = FRONIUS_MAX_TOWERS * FRONIUS_MAX_MODULES_PER_TOWER;
  let modules = froniusModulesFromDesired(desired);
  modules = Math.max(2, Math.min(maxMods, modules));

  const minTier = tiers[0];
  const maxTier = tiers[tiers.length - 1];
  const minMods = froniusModulesForKwh(minTier);
  const maxTierMods = froniusModulesForKwh(maxTier);

  if (modules < minMods) {
    return {
      baseKwh: minTier,
      blocks: [],
      totalKwh: minTier,
      exact: Math.abs(minTier - desired) < 0.25,
    };
  }

  if (modules <= maxTierMods) {
    const targetKwh = froniusKwhForModules(modules);
    const hit = tiers.find((t) => Math.abs(t - targetKwh) < 0.25);
    if (hit != null) {
      return { baseKwh: hit, blocks: [], totalKwh: hit, exact: true };
    }
    let base = minTier;
    for (const t of tiers) {
      if (froniusModulesForKwh(t) <= modules) base = t;
    }
    const baseMods = froniusModulesForKwh(base);
    const extra = Math.max(0, modules - baseMods);
    const blocks = Array.from({ length: extra }, () => froniusExtBlock());
    const totalKwh = Math.round((base + extra * FRONIUS_MODULE_KWH) * 10) / 10;
    return { baseKwh: base, blocks, totalKwh, exact: true };
  }

  const base = maxTier;
  const baseMods = maxTierMods;
  const extra = modules - baseMods;
  const blocks = Array.from({ length: extra }, () => froniusExtBlock());
  const totalKwh = Math.round((base + extra * FRONIUS_MODULE_KWH) * 10) / 10;
  return { baseKwh: base, blocks, totalKwh, exact: true };
}

/**
 * Zerlegt eine gewünschte Speichergröße in Tabellen-Basis + stapelbare Blöcke.
 * Sigenergy: nur physische 6-/9-kWh-Module. 12 in der Preisliste = 6+6 (gleicher Preis).
 * Fronius Reserva: 3,2-kWh-Module, Tower 6,4/9,5/12,6/15,8, max. 3 Tower.
 * @returns {{ baseKwh: number, blocks: Array<{kwh:number,price:number,label:string}>, totalKwh: number, exact: boolean }}
 */
function planStorage(brand, kwp, desiredKWh) {
  const b = normalizeBrand(brand);
  if (!brandHasStorage(b)) {
    return { baseKwh: 0, blocks: [], totalKwh: 0, exact: true };
  }
  if (b === 'fronius') return planStorageFronius(kwp, desiredKWh);

  const desired = Number(desiredKWh);
  if (!Number.isFinite(desired) || desired <= 0) {
    return { baseKwh: null, blocks: [], totalKwh: 0, exact: true };
  }

  const tiers = listStorageTiers(brand, kwp);
  const exts = (STORAGE_EXTENSIONS[brand] || []).slice().sort((a, b) => b.kwh - a.kwh);
  if (!tiers.length) {
    return { baseKwh: null, blocks: [], totalKwh: desired, exact: false };
  }

  if (!exts.length) {
    const snapped = snapStorage(brand, kwp, desired);
    return {
      baseKwh: snapped,
      blocks: [],
      totalKwh: snapped,
      exact: snapped != null && Math.abs(snapped - desired) < 0.15,
    };
  }

  const preferPhysical = brand === 'sigenergy';
  let best = null;
  for (const base of tiers) {
    if (base > desired + 0.05) continue;
    const remainder = Math.round((desired - base) * 10) / 10;
    const blocks = decomposeExtensionKwh(exts, remainder);
    if (!blocks) continue;
    const totalKwh = Math.round((base + blocks.reduce((s, b) => s + b.kwh, 0)) * 10) / 10;
    if (Math.abs(totalKwh - desired) > 0.15) continue;
    const extPrice = blocks.reduce((s, b) => s + b.price, 0);
    const basePrice = ((PRICELIST[brand] || {})[kwp] || {})[base] || 0;
    const score = basePrice + extPrice;
    const physical = preferPhysical && isSigenergyPhysicalBase(base);
    const better = !best
      || score < best.score - 1e-9
      || (Math.abs(score - best.score) < 1e-9 && physical && !best.physical)
      || (Math.abs(score - best.score) < 1e-9 && physical === best.physical
        && blocks.length < best.blocks.length);
    if (better) {
      best = { baseKwh: base, blocks, totalKwh, exact: true, score, physical };
    }
  }

  if (best) {
    return { baseKwh: best.baseKwh, blocks: best.blocks, totalKwh: best.totalKwh, exact: true };
  }

  const snapped = snapStorage(brand, kwp, desired);
  return { baseKwh: snapped, blocks: [], totalKwh: snapped, exact: false };
}

/**
 * Physische Modulaufschlüsselung.
 * Sigenergy: 6-/9-kWh-BAT (12 → 2×6). Fronius: alles in 3,2-kWh-Reserva-Elemente.
 * @returns {Array<{kwh:number, qty:number}>}
 */
function storageModuleBreakdown(brand, baseKwh, blocks) {
  if (brand === 'fronius') {
    const baseMods = froniusModulesForKwh(baseKwh);
    let extra = 0;
    for (const b of blocks || []) {
      const k = Number(b.kwh) || 0;
      if (Math.abs(k - FRONIUS_MODULE_KWH) < 0.15) extra += 1;
      else extra += froniusModulesForKwh(k);
    }
    const totalMods = baseMods + extra;
    if (totalMods <= 0) return [];
    return [{ kwh: FRONIUS_MODULE_KWH, qty: totalMods }];
  }

  const counts = new Map();
  const add = (kwh, qty = 1) => {
    const k = Math.round(Number(kwh) * 10) / 10;
    if (!(k > 0) || !(qty > 0)) return;
    counts.set(k, (counts.get(k) || 0) + qty);
  };

  const base = Number(baseKwh);
  if (Number.isFinite(base) && base > 0) {
    if (Math.abs(base - 12) < 0.05) {
      add(6, 2);
    } else if (!isSigenergyPhysicalBase(base)) {
      const exts = STORAGE_EXTENSIONS.sigenergy || [];
      const parts = decomposeExtensionKwh(exts, base);
      if (parts && parts.length) parts.forEach((b) => add(b.kwh, 1));
      else add(base, 1);
    } else {
      add(base, 1);
    }
  }

  for (const b of blocks || []) {
    if (Math.abs(Number(b.kwh) - 12) < 0.05) add(6, 2);
    else add(b.kwh, 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([kwh, qty]) => ({ kwh, qty }));
}

/** Lesbares Speicherlabel, z. B. "15 kWh (9+6)" / "12,6 kWh (4×3,2)" / "19 kWh (6×3,2 · 2 Tower)". */
function formatSpeicherLabel(brand, totalKwh, baseKwh, blocks) {
  const total = Number(totalKwh);
  if (!Number.isFinite(total) || total <= 0) return '—';

  if (brand === 'fronius') {
    const breakdown = storageModuleBreakdown(brand, baseKwh, blocks);
    const mods = breakdown[0] ? breakdown[0].qty : froniusModulesForKwh(total);
    if (mods <= 0) return `${formatNum(total)} kWh`;
    const towers = Math.ceil(mods / FRONIUS_MAX_MODULES_PER_TOWER);
    const towerHint = towers > 1 ? ` · ${towers} Tower` : '';
    return `${formatNum(total)} kWh (${mods}×${formatNum(FRONIUS_MODULE_KWH)}${towerHint})`;
  }

  if (brand !== 'sigenergy') return `${formatNum(total)} kWh`;
  const breakdown = storageModuleBreakdown(brand, baseKwh, blocks);
  if (!breakdown.length) return `${formatNum(total)} kWh`;
  if (breakdown.length === 1 && breakdown[0].qty === 1) {
    return `${formatNum(total)} kWh`;
  }
  const parts = breakdown.map(({ kwh, qty }) => (
    qty > 1 ? `${qty}×${formatNum(kwh)}` : formatNum(kwh)
  ));
  return `${formatNum(total)} kWh (${parts.join('+')})`;
}

/** Füllt Rest-kWh exakt mit Erweiterungsblöcken (kleinste Stückzahl, bei Gleichstand günstigster Preis). */
function decomposeExtensionKwh(exts, remainderKwh) {
  const target = Math.round(Number(remainderKwh) * 10) / 10;
  if (target < 0.05) return [];
  if (!exts.length) return null;

  const unitKwh = exts.map((e) => Number(e.kwh)).filter((k) => k > 0);
  const step = Math.min(...unitKwh);
  const maxUnits = Math.ceil(target / step) + 4;
  const memo = new Map();

  function solve(rem, depth) {
    if (rem < 0.05) return [];
    if (depth > maxUnits) return null;
    const key = `${rem.toFixed(1)}|${depth}`;
    if (memo.has(key)) return memo.get(key);

    let best = null;
    for (const ext of exts) {
      const k = Number(ext.kwh);
      if (!(k > 0)) continue;
      if (rem + 0.05 < k) continue;
      const sub = solve(Math.round((rem - k) * 10) / 10, depth + 1);
      if (sub === null) continue;
      const cand = [{ kwh: k, price: Number(ext.price) || 0, label: ext.label }, ...sub];
      const cost = cand.reduce((s, b) => s + b.price, 0);
      if (!best || cand.length < best.length || (cand.length === best.length && cost < best.cost)) {
        best = { blocks: cand, cost };
      }
    }
    memo.set(key, best ? best.blocks : null);
    return best ? best.blocks : null;
  }

  return solve(target, 0);
}

function listKwpTiers(brand) {
  return Object.keys(PRICELIST[brand] || {}).map(Number).sort((a, b) => a - b);
}

function listStorageTiers(brand, kwp) {
  const t = (PRICELIST[brand] || {})[kwp] || {};
  return Object.keys(t).map(Number).sort((a, b) => a - b);
}

/** Nächstgelegene verfügbare kWp-Stufe (>= bevorzugt, sonst nächste). */
function snapKwp(brand, desiredKwp) {
  const tiers = listKwpTiers(brand);
  if (!tiers.length) return null;
  const d = Number(desiredKwp);
  if (!Number.isFinite(d)) return tiers[0];
  let best = tiers[0];
  let bestDiff = Infinity;
  for (const t of tiers) {
    const diff = Math.abs(t - d);
    if (diff < bestDiff - 1e-9) { bestDiff = diff; best = t; }
  }
  return best;
}

/** Nächstgelegene Speichergröße für die gewählte Anlage. */
function snapStorage(brand, kwp, desiredKWh) {
  const tiers = listStorageTiers(brand, kwp);
  if (!tiers.length) return null;
  const d = Number(desiredKWh);
  if (!Number.isFinite(d)) return tiers[0];
  let best = tiers[0];
  let bestDiff = Infinity;
  for (const t of tiers) {
    const diff = Math.abs(t - d);
    if (diff < bestDiff - 1e-9) { bestDiff = diff; best = t; }
  }
  return best;
}

function normalizeDach(dachRaw) {
  const s = String(dachRaw || '').trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  if (!s) return { key: 'ziegel', label: 'Ziegel' };
  const ostWest = /ost\s*-?\s*west|ostwest|suedost|southeast/.test(s);
  const suedAuf = /suedaufst|sued\s*aufst|aufstaender|aufständer|suedausricht|ausrichtung\s*sued/.test(s)
    || ((/sued/.test(s) || /\bsouth\b/.test(s)) && !/suedost/.test(s) && (/flach|frei/.test(s) || /aufst/.test(s)));
  const sued = suedAuf || ((/(?:^|[^a-z])sued(?:[^a-z]|$)/.test(s) || s.includes('sued')) && !s.includes('suedost') && !ostWest);
  // Freifläche (Süd / Ost-West)
  if (/freiflaeche|freiland|ground\s*mount|open\s*field/.test(s)) {
    if (ostWest) return { key: 'freifläche ost-west', label: 'Freifläche Ost-West' };
    return { key: 'freifläche süd', label: 'Freifläche Süd' };
  }
  // "Eternit" / "Schindel" allein = Schindel-Eternit; nur "Welleternit" = 0
  if (s.includes('welleternit')) return { key: 'welleternit', label: 'Welleternit' };
  if (s === 'eternit' || (s.includes('eternit') && s.includes('schindel'))) {
    return { key: 'schindel-eternit', label: 'Schindel-Eternit' };
  }
  if (s.includes('eternit') || s.includes('schindel')) {
    return { key: 'schindel-eternit', label: 'Schindel-Eternit' };
  }
  if (s.includes('rhombus')) return { key: 'rhombus', label: 'Rhombus' };
  if (s.includes('biberschwanz')) return { key: 'biberschwanz', label: 'Biberschwanz' };
  if (s.includes('wiener') || s.includes('tasche')) return { key: 'wiener tasche', label: 'Wiener Tasche' };
  if (s.includes('prefa')) return { key: 'prefa', label: 'Prefa' };
  if (s.includes('flach')) {
    if (ostWest) return { key: 'flachdach ost-west', label: 'Flachdach Ost-West' };
    if (sued || /suedaufst|flachdach\s*sued/.test(s)) {
      return { key: 'flachdach südaufständerung', label: 'Flachdach Südaufständerung' };
    }
    return { key: 'flachdach', label: 'Flachdach' };
  }
  if (s.includes('falz')) return { key: 'falzblech', label: 'Falzblech' };
  if (s.includes('trapez')) return { key: 'trapezblech', label: 'Trapezblech' };
  if (s.includes('ziegel')) return { key: 'ziegel', label: 'Ziegel' };
  return { key: 'ziegel', label: dachRaw ? String(dachRaw).trim() : 'Ziegel' };
}

/** Familie für Doppelzählungs-Abgleich (Flachdach Süd ⊂ Flachdach). */
function dachFamilyKey(key) {
  const k = String(key || '');
  if (k.startsWith('flachdach')) return 'flachdach';
  if (k.startsWith('freifläche') || k.startsWith('freiflaeche')) return 'freifläche';
  return k;
}

/**
 * Verhindert Doppelzählung: „14 Flachdach, davon 11 Ost-West und 3 Süd“
 * → nur die Aufschlüsselung, nicht 14+11+3.
 * Wenn Summe der Segmente > moduleCountHint: proportional auf Gesamtmodule kappen.
 */
function reconcileDachSegmente(rawSegs, moduleCountHint) {
  const list = (Array.isArray(rawSegs) ? rawSegs : [])
    .map((s) => {
      if (!s) return null;
      const n = normalizeDach(s.dach || s.label || s.type || '');
      const modules = Math.max(0, Math.round(Number(s.modules != null ? s.modules : s.module_count) || 0));
      return { key: n.key, label: n.label, modules, generic: n.key === 'flachdach' };
    })
    .filter((s) => s && (s.modules > 0 || s.label));

  const byFam = new Map();
  for (const s of list) {
    const f = dachFamilyKey(s.key);
    if (!byFam.has(f)) byFam.set(f, []);
    byFam.get(f).push(s);
  }

  const out = [];
  for (const items of byFam.values()) {
    const generics = items.filter((i) => i.generic);
    const specifics = items.filter((i) => !i.generic);
    let keep = items;
    if (generics.length && specifics.length) {
      const specSum = specifics.reduce((a, i) => a + i.modules, 0);
      const genSum = generics.reduce((a, i) => a + i.modules, 0);
      if (specSum > 0 && (specSum === genSum || generics.some((g) => g.modules === specSum))) {
        keep = specifics;
      } else if (specSum > 0 && genSum > 0 && genSum + specSum > Math.max(genSum, specSum)) {
        // Aufschlüsselung + Gesamt → Doppelzählung: Aufschlüsselung bevorzugen, wenn plausibel
        keep = (specSum >= Math.min(...generics.map((g) => g.modules)) * 0.5) ? specifics : generics;
      }
    }
    const merged = new Map();
    for (const s of keep) {
      const prev = merged.get(s.key);
      if (prev) prev.modules += s.modules;
      else merged.set(s.key, { dach: s.label, modules: s.modules });
    }
    out.push(...merged.values());
  }

  // Kein proportionales Kappen über verschiedene Dachtypen (würde z. B. Falzblech verfälschen).
  // Doppelzählung innerhalb einer Familie ist oben bereinigt; module_count folgt der Segment-Summe.
  return out;
}

/** Optimierer: 50 € brutto / Modul, außer manueller Gesamtpreis > 0. */
function resolveOptimiererOption(o, moduleCount) {
  const n = Math.max(0, Number(moduleCount) || 0);
  const manual = Number(o && o.price);
  const hasManual = o && o.price != null && o.price !== '' && Number.isFinite(manual) && manual > 0;
  const price = hasManual ? manual : (OPTIMIERER_UNIT_PRICE * n);
  const hint = String((o && (o.hint || o.note || o.beschreibung)) || '').trim()
    || 'Ein Optimierer pro Modul für optimale Leistung.';
  return {
    key: 'optimierer',
    label: String((o && o.label) || OPTIONS.optimierer.label).trim() || OPTIONS.optimierer.label,
    price,
    hint,
    qty: n,
    unitPrice: hasManual && n > 0 ? Math.round(manual / n) : OPTIMIERER_UNIT_PRICE,
  };
}

function isOptimiererOption(o) {
  if (!o) return false;
  const key = String(o.key || '').toLowerCase();
  if (key === 'optimierer' || key === 'optimizer') return true;
  return /optimier/i.test(String(o.label || ''));
}

// ── Wechselrichter-Katalog (Datenblatt-Parameter) ─────────────────────────
/**
 * Sigenergy Sigen Hybrid Three Phase – Max. PV / MPPT laut Herstellerdatenblatt.
 * Fronius Symo GEN24 Plus 3–10 kW + GEN24 Plus SC 12.0 – Max. PV-Generatorleistung laut Datenblatt.
 */
const INVERTER_CATALOG = {
  sigenergy: [
    { id: 'sigen-5', acKw: 5, maxPvW: 8000, mppt: 2, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 5.0 TP' },
    { id: 'sigen-6', acKw: 6, maxPvW: 9600, mppt: 2, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 6.0 TP' },
    { id: 'sigen-8', acKw: 8, maxPvW: 12800, mppt: 2, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 8.0 TP' },
    { id: 'sigen-10', acKw: 10, maxPvW: 16000, mppt: 2, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 10.0 TP' },
    { id: 'sigen-12', acKw: 12, maxPvW: 19200, mppt: 3, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 12.0 TP' },
    { id: 'sigen-15', acKw: 15, maxPvW: 24000, mppt: 3, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 15.0 TP' },
    { id: 'sigen-17', acKw: 17, maxPvW: 27200, mppt: 3, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 17.0 TP' },
    { id: 'sigen-20', acKw: 20, maxPvW: 32000, mppt: 4, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 20.0 TP' },
    { id: 'sigen-25', acKw: 25, maxPvW: 40000, mppt: 4, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 25.0 TP' },
    { id: 'sigen-30', acKw: 30, maxPvW: 48000, mppt: 4, imaxMppt: 16, iscMppt: 20, vmaxDc: 1100,
      label: 'Sigen Hybrid Three Phase 30.0 TP' },
  ],
  fronius: [
    { id: 'gen24-3', acKw: 3, maxPvW: 4500, mppt: 2, imaxMppt: 12.5, iscMppt: 18.75, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 3.0 Plus' },
    { id: 'gen24-4', acKw: 4, maxPvW: 6000, mppt: 2, imaxMppt: 12.5, iscMppt: 18.75, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 4.0 Plus' },
    { id: 'gen24-5', acKw: 5, maxPvW: 7500, mppt: 2, imaxMppt: 12.5, iscMppt: 18.75, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 5.0 Plus' },
    { id: 'gen24-6', acKw: 6, maxPvW: 9000, mppt: 2, imaxMppt: 25, iscMppt: 37.5, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 6.0 Plus' },
    { id: 'gen24-8', acKw: 8, maxPvW: 12000, mppt: 2, imaxMppt: 25, iscMppt: 37.5, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 8.0 Plus' },
    { id: 'gen24-10', acKw: 10, maxPvW: 15000, mppt: 2, imaxMppt: 25, iscMppt: 37.5, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 10.0 Plus' },
    // Symo GEN24 Plus SC 12.0 – Max. PV-Generator 18 kWp (asym. MPPT 28/14 A)
    { id: 'gen24-12', acKw: 12, maxPvW: 18000, mppt: 2, imaxMppt: 28, iscMppt: 40, vmaxDc: 1000,
      label: 'Fronius Symo GEN24 12.0 Plus SC' },
  ],
  // Huawei SUN2000-(3–10)KTL-M1 High Current – nur PV ohne Speicher
  huawei: [
    { id: 'sun2000-3', acKw: 3, maxPvW: 4500, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-3KTL-M1' },
    { id: 'sun2000-4', acKw: 4, maxPvW: 6000, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-4KTL-M1' },
    { id: 'sun2000-5', acKw: 5, maxPvW: 7500, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-5KTL-M1' },
    { id: 'sun2000-6', acKw: 6, maxPvW: 9000, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-6KTL-M1' },
    { id: 'sun2000-8', acKw: 8, maxPvW: 12000, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-8KTL-M1' },
    { id: 'sun2000-10', acKw: 10, maxPvW: 15000, mppt: 2, imaxMppt: 13.5, iscMppt: 19.5, vmaxDc: 1100,
      label: 'Huawei SUN2000-10KTL-M1' },
  ],
  // Fronius Symo (klassisch, String-WR) – M-Varianten mit 2 MPPT; nur PV ohne Speicher
  fronius_symo: [
    { id: 'symo-3.0', acKw: 3, maxPvW: 6000, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 3.0-3-M' },
    { id: 'symo-3.7', acKw: 3.7, maxPvW: 7400, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 3.7-3-M' },
    { id: 'symo-4.5', acKw: 4.5, maxPvW: 9000, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 4.5-3-M' },
    { id: 'symo-5.0', acKw: 5, maxPvW: 10000, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 5.0-3-M' },
    { id: 'symo-6.0', acKw: 6, maxPvW: 12000, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 6.0-3-M' },
    { id: 'symo-7.0', acKw: 7, maxPvW: 14000, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 7.0-3-M' },
    { id: 'symo-8.2', acKw: 8.2, maxPvW: 16400, mppt: 2, imaxMppt: 16, iscMppt: 31, vmaxDc: 1000,
      label: 'Fronius Symo 8.2-3-M' },
    { id: 'symo-10.0', acKw: 10, maxPvW: 15000, mppt: 2, imaxMppt: 27, iscMppt: 56, vmaxDc: 1000,
      label: 'Fronius Symo 10.0-3-M' },
    { id: 'symo-12.5', acKw: 12.5, maxPvW: 18800, mppt: 2, imaxMppt: 27, iscMppt: 56, vmaxDc: 1000,
      label: 'Fronius Symo 12.5-3-M' },
    { id: 'symo-15.0', acKw: 15, maxPvW: 22500, mppt: 2, imaxMppt: 33, iscMppt: 68, vmaxDc: 1000,
      label: 'Fronius Symo 15.0-3-M' },
    { id: 'symo-17.5', acKw: 17.5, maxPvW: 26300, mppt: 2, imaxMppt: 33, iscMppt: 68, vmaxDc: 1000,
      label: 'Fronius Symo 17.5-3-M' },
    { id: 'symo-20.0', acKw: 20, maxPvW: 30000, mppt: 2, imaxMppt: 33, iscMppt: 68, vmaxDc: 1000,
      label: 'Fronius Symo 20.0-3-M' },
  ],
};

function listInverters(brand) {
  const b = normalizeBrand(brand);
  return (INVERTER_CATALOG[b] || []).map((x) => ({ ...x }));
}

function findInverterByAcKw(brand, acKw) {
  const n = Number(acKw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return listInverters(brand).find((i) => Math.abs(i.acKw - n) < 0.05) || null;
}

function findInverterByLabel(brand, label) {
  const s = String(label || '').trim().toLowerCase();
  if (!s) return null;
  const list = listInverters(brand);
  const exact = list.find((i) => i.label.toLowerCase() === s);
  if (exact) return exact;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*(?:kw|tp|ktl)?/);
  if (m) {
    const kw = Number(String(m[1]).replace(',', '.'));
    const byKw = findInverterByAcKw(brand, kw);
    if (byKw) return byKw;
  }
  return list.find((i) => s.includes(String(i.acKw).replace('.', ',')) || s.includes(String(i.acKw))) || null;
}

/**
 * WR wählen:
 * 1) Manuelles Label / bekannter Katalogeintrag
 * 2) Explizite AC-kW (Sprachbefehl / Formular)
 * 3) Kleinstes Modell mit maxPvW >= Modul-kWp
 */
function selectInverter(brand, opts = {}) {
  const b = normalizeBrand(brand);
  const list = listInverters(b);
  if (!list.length) return null;

  const manual = String(opts.manualLabel || opts.inverterModel || '').trim();
  if (manual) {
    const found = findInverterByLabel(b, manual);
    if (found) return { ...found, source: 'manual' };
    return {
      id: 'custom',
      acKw: null,
      maxPvW: null,
      mppt: null,
      label: manual,
      source: 'manual-custom',
    };
  }

  const explicit = opts.acKw != null ? Number(opts.acKw) : null;
  if (Number.isFinite(explicit) && explicit > 0) {
    const hit = findInverterByAcKw(b, explicit);
    if (hit) return { ...hit, source: 'explicit' };
  }

  const moduleKwp = Number(opts.moduleKwp != null ? opts.moduleKwp : opts.kwp);
  const needW = Number.isFinite(moduleKwp) && moduleKwp > 0 ? moduleKwp * 1000 : 0;
  if (needW > 0) {
    const fit = list.filter((i) => i.maxPvW >= needW - 1);
    if (fit.length) return { ...fit[0], source: 'max-pv' };
    return { ...list[list.length - 1], source: 'max-pv-overflow' };
  }

  // Fallback: nächstgelegene AC-Größe zur Paket-kWp (Altverhalten)
  const pkg = Number(opts.packageKwp != null ? opts.packageKwp : opts.kwp) || list[0].acKw;
  let best = list[0];
  let bestDiff = Infinity;
  for (const i of list) {
    const diff = Math.abs(i.acKw - pkg);
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) < 1e-9 && i.acKw > best.acKw)) {
      bestDiff = diff;
      best = i;
    }
  }
  return { ...best, source: 'snap-ac' };
}

/** @deprecated Kompatibilität – nutzt selectInverter (Max-PV). */
function snapInverterSize(kwp, sizes) {
  const d = Number(kwp);
  let best = sizes[0];
  let bestDiff = Infinity;
  for (const s of sizes) {
    const diff = Math.abs(s - d);
    if (diff < bestDiff - 1e-9 || (Math.abs(diff - bestDiff) < 1e-9 && s > best)) {
      bestDiff = diff; best = s;
    }
  }
  return best;
}

const SIGEN_INV_SIZES = INVERTER_CATALOG.sigenergy.map((i) => i.acKw);
const FRONIUS_INV_SIZES = INVERTER_CATALOG.fronius.map((i) => i.acKw);

function inverterModel(brand, kwp, opts = {}) {
  const b = normalizeBrand(brand);
  const sel = selectInverter(b, {
    moduleKwp: opts.moduleKwp != null ? opts.moduleKwp : kwp,
    packageKwp: opts.packageKwp != null ? opts.packageKwp : kwp,
    acKw: opts.acKw,
    manualLabel: opts.manualLabel || opts.inverterModel,
  });
  if (sel) return sel.label;
  if (b === 'fronius') return `Fronius Symo GEN24 ${Number(kwp).toFixed(1)} Plus`;
  if (b === 'huawei') return `Huawei SUN2000-${Number(kwp).toFixed(0)}KTL-M1`;
  if (b === 'fronius_symo') return `Fronius Symo ${Number(kwp).toFixed(1)}-3-M`;
  return `Sigen Hybrid Three Phase ${Number(kwp).toFixed(1)} TP`;
}

function inverterMetaLine(inv) {
  if (!inv || inv.source === 'manual-custom') return '';
  const parts = [];
  if (inv.maxPvW) parts.push(`Max. PV ${formatNum(inv.maxPvW / 1000)} kWp`);
  if (inv.mppt) parts.push(`${inv.mppt} MPPT`);
  if (inv.acKw) parts.push(`AC ${formatNum(inv.acKw)} kW`);
  return parts.join(' · ');
}

function storageModel(brand, kwh) {
  const b = normalizeBrand(brand);
  if (b === 'fronius') {
    const mods = froniusModulesForKwh(kwh);
    if (mods >= 2 && mods <= FRONIUS_MAX_MODULES_PER_TOWER && FRONIUS_TOWER_KWH[mods] != null) {
      return `Fronius Reserva ${formatNum(FRONIUS_TOWER_KWH[mods])} (${mods} Module)`;
    }
    return `Fronius Reserva (${formatNum(kwh)} kWh)`;
  }
  if (b === 'huawei' || b === 'fronius_symo') return null;
  return `SigenStor BAT (${formatNum(kwh)} kWh)`;
}

function smartMeterModel(brand) {
  const b = normalizeBrand(brand);
  if (b === 'fronius' || b === 'fronius_symo') return 'Fronius Smart Meter';
  if (b === 'huawei') return 'Huawei Smart Dongle / Power Sensor';
  return 'SigenStor Smart Meter';
}

function wallboxLabelComponent(brand) {
  const b = normalizeBrand(brand);
  if (b === 'fronius' || b === 'fronius_symo') return 'Fronius Wattpilot 11 kW – E-Ladestation';
  if (b === 'huawei') return 'Wallbox 11 kW – E-Ladestation';
  return 'Sigen EV AC Wallbox 11 kW – E-Ladestation';
}

function wallboxLabelOption(brand) {
  const b = normalizeBrand(brand);
  if (b === 'fronius' || b === 'fronius_symo') return 'Wallbox – Fronius Wattpilot (11 kW)';
  if (b === 'huawei') return 'Wallbox 11 kW';
  return 'Wallbox – Sigen EV AC Wallbox (11 kW)';
}

function notstromLabelOption(brand) {
  const b = normalizeBrand(brand);
  if (b === 'fronius') return 'Fronius Umschaltbox (Notstrom / Backup)';
  if (b === 'fronius_symo' || b === 'huawei') return 'Notstrom / Backup (falls verfügbar)';
  return 'SIG Energy Gateway (Umschaltbox / Notstrom)';
}

function notstromComponentDesc(brand, hint) {
  const b = normalizeBrand(brand);
  let base = 'Notstromschaltung und optionale Steuerfunktionen über SIG Energy Gateway';
  if (b === 'fronius') base = 'Notstrom-/Backup-Funktion über Fronius Umschaltbox';
  else if (b === 'fronius_symo' || b === 'huawei') base = 'Notstrom-/Backup-Option (netzparallel)';
  return hint ? String(hint).trim() : base;
}

function speichererweiterungOption(brand) {
  if (brand === 'fronius') {
    return { label: '+3,2 kWh Speicherelement – Fronius Reserva', price: 1320, kwh: 3.2 };
  }
  return { label: '+6 kWh Speicherblock – SigenStor BAT', price: 3300, kwh: 6 };
}

/**
 * Markenabhängige Speichererweiterung aus Option/KI auflösen.
 * Fronius: immer +3,2 (1320). Sigenergy: +6 (3300) oder +9 (3960) je nach Angabe.
 */
function resolveSpeicherErweiterungOption(brand, opt = {}) {
  const exts = listStorageExtensionOptions(brand);
  const fallback = speichererweiterungOption(brand);
  if (!exts.length) {
    return { key: 'speichererweiterung', label: fallback.label, price: fallback.price, kwh: fallback.kwh, hint: null };
  }

  const label = String(opt.label || '').toLowerCase();
  const hint = String(opt.hint || opt.note || '').trim() || null;
  let wantKwh = Number(opt.kwh != null ? opt.kwh : opt.speicherKwh);
  if (!Number.isFinite(wantKwh) || wantKwh <= 0) {
    const m = label.match(/(\d+(?:[.,]\d+)?)\s*kwh/) || String(opt.hint || '').toLowerCase().match(/(\d+(?:[.,]\d+)?)\s*kwh/);
    if (m) wantKwh = Number(String(m[1]).replace(',', '.'));
  }

  let hit = null;
  if (Number.isFinite(wantKwh) && wantKwh > 0) {
    hit = exts.find((e) => Math.abs(e.kwh - wantKwh) < 0.15);
  }
  if (!hit && /9/.test(label) && brand === 'sigenergy') {
    hit = exts.find((e) => Math.abs(e.kwh - 9) < 0.05);
  }
  if (!hit) hit = exts[0];

  const override = Number(opt.price);
  const price = (opt.price != null && opt.price !== '' && Number.isFinite(override) && override > 0)
    ? override
    : hit.price;

  return {
    key: 'speichererweiterung',
    label: String(opt.label || hit.label || fallback.label).trim() || hit.label,
    price,
    kwh: hit.kwh,
    hint: hint || hit.hint || null,
  };
}

/** Paketpreis (brutto) für Marke + kWp-Stufe + Speichergröße. */
function storagePackagePrice(brand, kwp, kwh) {
  const table = (PRICELIST[brand] || {})[kwp] || {};
  const key = Object.keys(table).map(Number).find((t) => Math.abs(t - Number(kwh)) < 0.05);
  if (key == null) return null;
  return table[key];
}

/**
 * Preisdifferenz beim Upgrade der Basis-Speicherstufe (nicht stapeln).
 * = Differenz der Paketpreise in PRICELIST für dieselbe kWp-Stufe.
 * Sigenergy z. B. 6→9: bei 5,01/5,92 = 1.500 €, bei 8,19/10,01 = 600 €.
 */
function storageUpgradeDiff(brand, kwp, fromKwh, toKwh) {
  const from = storagePackagePrice(brand, kwp, fromKwh);
  const to = storagePackagePrice(brand, kwp, toKwh);
  if (from == null || to == null) return null;
  const diff = to - from;
  return diff > 0 ? diff : null;
}

/** Alle größeren Speicherstufen als optionale Upgrades mit Preisdifferenz. */
function listStorageUpgrades(brand, kwp, fromKwh) {
  const from = Number(fromKwh);
  const tiers = listStorageTiers(brand, kwp);
  const out = [];
  for (const t of tiers) {
    if (!(t > from + 0.05)) continue;
    const diff = storageUpgradeDiff(brand, kwp, from, t);
    if (diff == null) continue;
    out.push({
      fromKwh: from,
      toKwh: t,
      priceDiff: diff,
      label: `Upgrade Speicher ${formatNum(from)} -> ${formatNum(t)} kWh (Preisdifferenz)`,
      hint: `Optional statt ${formatNum(from)} kWh: Upgrade auf ${formatNum(t)} kWh. Aufpreis = Differenz der Paketpreise.`,
    });
  }
  return out;
}

/** Markenabhängige Erweiterungsblöcke (zusätzlich zum Basis-Speicher). */
function listStorageExtensionOptions(brand) {
  return (STORAGE_EXTENSIONS[brand] || []).map((e) => ({
    kwh: e.kwh,
    price: e.price,
    label: e.label,
    hint: brand === 'fronius'
      ? 'Nachrüstbares Fronius-Reserva-Element (+3,2 kWh).'
      : `Zusätzlicher SigenStor-BAT-Block (+${formatNum(e.kwh)} kWh), stapelbar.`,
  }));
}

function resolveSpeicherUpgradeOption(brand, kwp, opt) {
  let fromKwh = Number(opt.upgradeFrom != null ? opt.upgradeFrom : opt.fromKwh);
  let toKwh = Number(opt.upgradeTo != null ? opt.upgradeTo : opt.toKwh);
  // Fallback: Stufen aus Label parsen (z. B. "Upgrade Speicher 6 -> 9 kWh")
  if (!Number.isFinite(fromKwh) || !Number.isFinite(toKwh)) {
    const m = String(opt.label || '').match(
      /(\d+(?:[.,]\d+)?)\s*(?:kwh|kw)?[^\d]{0,12}?(?:→|->|auf|zu)\s*(\d+(?:[.,]\d+)?)/i
    );
    if (m) {
      fromKwh = Number(String(m[1]).replace(',', '.'));
      toKwh = Number(String(m[2]).replace(',', '.'));
    }
  }
  if (!Number.isFinite(fromKwh) || !Number.isFinite(toKwh) || !(toKwh > fromKwh)) return null;
  const diff = storageUpgradeDiff(brand, kwp, fromKwh, toKwh);
  if (diff == null) return null;
  // Expliziter Preis nur wenn positiv – 0/null aus UI/KI überschreibt die Differenz nicht
  const override = Number(opt.price);
  const price = (opt.price != null && opt.price !== '' && Number.isFinite(override) && override > 0)
    ? override
    : diff;
  return {
    key: 'speicher_upgrade',
    label: String(opt.label || `Upgrade Speicher ${formatNum(fromKwh)} -> ${formatNum(toKwh)} kWh (Preisdifferenz)`)
      .replace(/\s*→\s*/g, ' -> ')
      .trim(),
    price,
    hint: String(opt.hint || `Optional statt ${formatNum(fromKwh)} kWh: Upgrade auf ${formatNum(toKwh)} kWh.`).trim(),
    upgradeFrom: fromKwh,
    upgradeTo: toKwh,
  };
}

function formatNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  // Ganzzahlen ohne Nachkomma; sonst bis 2 Stellen (Punkt als Dezimaltrenner wie Vorlagen)
  if (Number.isInteger(num)) return String(num);
  const rounded = Math.round(num * 100) / 100;
  return String(rounded);
}

function formatEUR(n) {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

/**
 * Hauptberechnung: nimmt eine Konfiguration und liefert das vollständige
 * Angebotsobjekt (Konfig-Karte, Stückliste, Summen, optionale Komponenten).
 *
 * Modulanzahl ist führend: Anzeige-kWp = Module × Wp / 1000.
 * Preispaket = größtes Paket mit ≤ Modulen; Extra-Module à EXTRA_MODULE_PRICE netto.
 * includePv=false → nur Klima; Kombi = PV + Klima.
 *
 * config = {
 *   includePv?, brand, kwp?, speicher, dach, moduleType, moduleCount,
 *   optionen, klima: { enabled, packageId, mode, extraPipingMeters, condensatePump, qty },
 *   bruttoOverride, inverterModel?, angebotsnummer, datum, vertrieb
 * }
 */
function computeOffer(config) {
  const brand = normalizeBrand(config.brand);
  const moduleType = MODULE_TYPES[config.moduleType] ? config.moduleType : 'das';
  const mod = MODULE_TYPES[moduleType];

  const requestedModules = Number(config.moduleCount);
  const hasExplicitModules = Number.isFinite(requestedModules) && requestedModules > 0;
  const hasExplicitKwp = config.kwp != null && Number.isFinite(Number(config.kwp));
  const klimaLinesEarly = expandKlimaLines(config.klima);
  const hasKlimaPkg = klimaLinesEarly.some((l) => l.packageId);
  let includePv = config.includePv;
  if (includePv == null) includePv = hasExplicitModules || hasExplicitKwp || !hasKlimaPkg;
  includePv = includePv !== false;

  let moduleCount = 0;
  let pkg = null;
  let kwpPackage = null;
  let packageModuleCount = 0;
  let extraModules = 0;
  let moduleExtraCostNetto = 0;
  let moduleExtraCost = 0;
  let kwpCalculated = 0;
  let kwp = 0;
  let speicher = null;
  let speicherBloecke = [];
  let speicherZusatzKwh = 0;
  let speicherZusatzPreis = 0;
  let speicherGesamt = 0;
  let dachAufschlag = 0;
  let dachSegmente = [];
  let dachLabel = '—';
  let basePrice = 0;
  let aikoAufschlag = 0;
  let moduleAufschlag = 0;
  let selectedInverter = null;

  if (includePv) {
    if (hasExplicitModules) {
      moduleCount = Math.round(requestedModules);
      pkg = resolvePackageForModules(brand, moduleCount);
    } else if (hasExplicitKwp) {
      const snapped = snapKwp(brand, config.kwp);
      pkg = { kwpPackage: snapped, packageModules: MODULES_PER_KWP[snapped] || Math.round((snapped * 1000) / mod.wp) };
      moduleCount = pkg.packageModules;
    } else {
      pkg = resolvePackageForModules(brand, 0);
      moduleCount = pkg ? pkg.packageModules : 11;
    }
    if (!pkg) {
      const tiers = listKwpTiers(brand);
      const t = tiers[0] || 5.01;
      pkg = { kwpPackage: t, packageModules: MODULES_PER_KWP[t] || moduleCount };
    }

    kwpPackage = pkg.kwpPackage;
    packageModuleCount = pkg.packageModules;
    extraModules = Math.max(0, moduleCount - packageModuleCount);
    moduleExtraCostNetto = extraModules * EXTRA_MODULE_PRICE;
    moduleExtraCost = moduleExtraCostNetto * (1 + MWST_RATE);
    kwpCalculated = kwpFromModulesExact(moduleCount, mod.wp) || kwpPackage;
    kwp = kwpCalculated;

    const desiredSpeicher = Number(config.speicherGesamt) || Number(config.speicher) || null;
    const manualZusatz = Array.isArray(config.speicherZusatz)
      ? config.speicherZusatz.filter((b) => b && (Number(b.kwh) || Number(b.price))) : [];
    if (!brandHasStorage(brand) || desiredSpeicher === 0 || config.speicher === 0) {
      speicher = 0;
      speicherBloecke = [];
      speicherZusatzKwh = 0;
      speicherZusatzPreis = 0;
      speicherGesamt = 0;
    } else if (manualZusatz.length) {
      speicher = snapStorage(brand, kwpPackage, config.speicher);
      for (const b of manualZusatz) {
        const k = Number(b.kwh) || 0;
        const p = Number(b.price) || 0;
        speicherBloecke.push({ kwh: k, price: p, label: String(b.label || `+${formatNum(k)} kWh Speichererweiterung`).trim() });
      }
    } else if (desiredSpeicher) {
      const plan = planStorage(brand, kwpPackage, desiredSpeicher);
      speicher = plan.baseKwh;
      speicherBloecke = plan.blocks.map((b) => ({ ...b }));
    } else {
      speicher = snapStorage(brand, kwpPackage, config.speicher);
    }
    if (brandHasStorage(brand) && speicher !== 0) {
      for (const b of speicherBloecke) {
        speicherZusatzKwh += b.kwh;
        speicherZusatzPreis += b.price;
      }
      speicherGesamt = (speicher || 0) + speicherZusatzKwh;
    } else {
      speicherBloecke = [];
      speicherZusatzKwh = 0;
      speicherZusatzPreis = 0;
      speicherGesamt = 0;
      speicher = brandHasStorage(brand) ? speicher : 0;
    }

    const rawSegs = Array.isArray(config.dachSegmente)
      ? config.dachSegmente.filter((s) => s && (s.dach || s.modules)) : null;
    if (rawSegs && rawSegs.length) {
      const reconciled = reconcileDachSegmente(rawSegs, moduleCount);
      const segs = reconciled.map((s) => ({ ...normalizeDach(s.dach), modules: Number(s.modules) || 0 }));
      const sumMods = segs.reduce((a, s) => a + s.modules, 0);
      for (const s of segs) {
        const share = sumMods > 0 ? s.modules / sumMods : 1 / segs.length;
        const segKwp = share * kwp;
        const auf = Math.round(((DACH_AUFSCHLAG[s.key] || 0) * segKwp) * 100) / 100;
        dachAufschlag += auf;
        dachSegmente.push({ key: s.key, label: s.label, modules: s.modules, aufschlag: auf, aufschlagProKwp: DACH_AUFSCHLAG[s.key] || 0 });
      }
      dachLabel = segs.map((s) => `${s.label}${s.modules ? ` (${s.modules} Mod.)` : ''}`).join(' + ');
    } else {
      const dach = normalizeDach(config.dach);
      dachAufschlag = Math.round(((DACH_AUFSCHLAG[dach.key] || 0) * kwp) * 100) / 100;
      dachLabel = dach.label;
      dachSegmente = [{ key: dach.key, label: dach.label, modules: moduleCount, aufschlag: dachAufschlag, aufschlagProKwp: DACH_AUFSCHLAG[dach.key] || 0 }];
    }

    basePrice = ((PRICELIST[brand] || {})[kwpPackage] || {})[speicher] || 0;
    aikoAufschlag = mod.aufschlagProModul * moduleCount;
    moduleAufschlag = aikoAufschlag + moduleExtraCost;

    selectedInverter = selectInverter(brand, {
      moduleKwp: kwpCalculated,
      packageKwp: kwpPackage,
      acKw: config.inverterKw != null ? config.inverterKw : config.acKw,
      manualLabel: config.inverterModel,
    });
  }

  let optionenSumme = 0;
  const inkludiert = [];
  const optionaleKomponenten = [];
  const optionenInput = Array.isArray(config.optionen) ? config.optionen : null;

  if (includePv) {
    if (optionenInput) {
      for (const o of optionenInput) {
        if (!o) continue;
        let key = o.key || null;
        // Synonyme für Speicher-Upgrade
        if (key && /speicher.?upgrade|upgrade.?speicher/i.test(key)) key = 'speicher_upgrade';

        if (key === 'speicher_upgrade') {
          const resolved = resolveSpeicherUpgradeOption(brand, kwpPackage, o);
          if (!resolved) continue;
          const mode = o.mode === 'fix' ? 'fix' : 'optional';
          const entry = {
            key: 'speicher_upgrade',
            label: resolved.label,
            price: resolved.price,
            hint: resolved.hint,
            upgradeFrom: resolved.upgradeFrom,
            upgradeTo: resolved.upgradeTo,
          };
          if (mode === 'fix') {
            optionenSumme += entry.price;
            inkludiert.push(entry);
          } else {
            optionaleKomponenten.push(entry);
          }
          continue;
        }

        // Optimierer (Katalog oder Label-Match)
        if (isOptimiererOption({ key, label: o.label })) {
          const resolved = resolveOptimiererOption(o, moduleCount);
          const mode = o.mode === 'optional' ? 'optional' : 'fix';
          const entry = {
            key: 'optimierer',
            label: resolved.label,
            price: resolved.price,
            hint: resolved.hint,
            qty: resolved.qty,
          };
          if (mode === 'fix') {
            optionenSumme += entry.price;
            inkludiert.push(entry);
          } else {
            optionaleKomponenten.push(entry);
          }
          continue;
        }

        if (key === 'speichererweiterung') {
          const resolved = resolveSpeicherErweiterungOption(brand, o);
          const mode = o.mode === 'fix' ? 'fix' : 'optional';
          const entry = {
            key: 'speichererweiterung',
            label: resolved.label,
            price: resolved.price,
            hint: resolved.hint || (brand === 'fronius'
              ? 'Optionales Reserva-Batteriemodul (+3,2 kWh).'
              : `Optionaler SigenStor-BAT-Block (+${formatNum(resolved.kwh)} kWh).`),
            kwh: resolved.kwh,
          };
          if (mode === 'fix') {
            optionenSumme += entry.price;
            inkludiert.push(entry);
          } else {
            optionaleKomponenten.push(entry);
          }
          continue;
        }

        const base = key && OPTIONS[key] ? OPTIONS[key] : null;
        if (base && base.alwaysIncluded) continue;
        let label = String(o.label || (base && base.label) || 'Position').trim();
        if (key === 'notstrom') label = notstromLabelOption(brand);
        if (key === 'wallbox') label = wallboxLabelOption(brand);
        let price = Number(o.price);
        if (o.price == null || o.price === '' || !Number.isFinite(price)) {
          if (key === 'wallbox') price = 1800;
          else if (key === 'notstrom') price = 1500;
          else if (key === 'optimierer') price = OPTIMIERER_UNIT_PRICE * moduleCount;
          else price = base ? (base.perModule ? base.price * moduleCount : base.price) : 0;
        }
        const mode = o.mode === 'fix' ? 'fix' : 'optional';
        const hint = String(o.hint || o.note || o.beschreibung || '').trim() || null;
        if (!label && !price) continue;
        const entry = { key, label, price, hint };
        if (mode === 'fix') {
          optionenSumme += price;
          inkludiert.push(entry);
        } else {
          optionaleKomponenten.push(entry);
        }
      }
    } else {
      const inkl = Array.isArray(config.inkludierteOptionen) ? config.inkludierteOptionen.slice() : [];
      for (const key of inkl) {
        const opt = OPTIONS[key];
        if (!opt || opt.alwaysIncluded) continue;
        const label = key === 'notstrom' ? notstromLabelOption(brand) : opt.label;
        optionenSumme += opt.price;
        inkludiert.push({ key, label, price: opt.price, hint: null });
      }
      if (config.standardOptionen !== false) {
        if (!inkl.includes('notstrom')) optionaleKomponenten.push({ key: 'notstrom', label: notstromLabelOption(brand), price: 1500, hint: null });
        if (!inkl.includes('wallbox')) optionaleKomponenten.push({ key: 'wallbox', label: wallboxLabelOption(brand), price: 1800, hint: null });
        if (brandHasStorage(brand)) {
          const se = speichererweiterungOption(brand);
          optionaleKomponenten.push({ key: 'speichererweiterung', label: se.label, price: se.price, hint: null });
        }
      }
    }
  }

  let klimaSumme = 0;
  const klimaFix = [];
  const klimaOptional = [];
  for (const line of expandKlimaLines(config.klima)) {
    const item = {
      key: line.key,
      packageId: line.packageId || null,
      label: line.label,
      desc: line.desc || '',
      price: line.total != null ? line.total : line.price,
      qty: line.qty || 1,
      total: line.total != null ? line.total : line.price,
      package: line.package || null,
    };
    if (line.mode === 'optional') {
      klimaOptional.push(item);
      optionaleKomponenten.push({ key: item.key, label: item.label, price: item.total });
    } else {
      klimaSumme += item.total;
      klimaFix.push(item);
    }
  }

  let brutto = 0;
  if (includePv) {
    // Gesamtsumme PV: Katalogpreise exakt übernehmen (kein Runden auf 100 € —
    // sonst z. B. Sigenergy 8,19/6 = 15.650 → fälschlich 15.700, Fronius 15.720 → 15.700).
    brutto = basePrice + dachAufschlag + aikoAufschlag + moduleExtraCost
      + optionenSumme + speicherZusatzPreis;
    brutto = roundEuro(brutto);
  }
  brutto += klimaSumme;
  if (klimaSumme) brutto = roundEuro(brutto);
  if (config.bruttoOverride != null && config.bruttoOverride !== '' && Number.isFinite(Number(config.bruttoOverride))) {
    brutto = Number(config.bruttoOverride);
  }
  const netto = brutto / (1 + MWST_RATE);
  const mwst = brutto - netto;

  const sections = [];
  if (includePv) {
    const unterkonstruktion = (dachSegmente.length > 1)
      ? dachSegmente.map((s) => ({ name: `Unterkonstruktion ${s.label}`, desc: 'ALU-Unterkonstruktion', qty: `${s.modules || 0} Stück` }))
      : [{ name: `Unterkonstruktion ${dachLabel}`, desc: 'ALU-Unterkonstruktion', qty: `${moduleCount} Stück` }];

    sections.push({
      title: 'Photovoltaikanlage',
      items: [
        { name: mod.model, desc: mod.desc, qty: `${moduleCount} Stück` },
        { name: (selectedInverter && selectedInverter.label) || config.inverterModel || inverterModel(brand, kwpCalculated, { moduleKwp: kwpCalculated, packageKwp: kwpPackage, acKw: config.inverterKw }),
          desc: 'Wechselrichter | 10 Jahre Garantie',
          qty: '1 Stück' },
        ...unterkonstruktion,
        { name: 'GAK Generatoranschlusskasten', desc: 'DC-Schutz Typ I+II, Erdung', qty: '2 Stück' },
        { name: 'Kabelkanal und Alurohr', desc: 'Kabelführung', qty: '1 Stück' },
        { name: 'Solarflex', desc: 'DC-Solarkabel, TÜV-zertifiziert', qty: '1 Stück' },
        { name: 'MC Buchse', desc: 'Steckverbinder Typ 4', qty: '1 Stück' },
        { name: 'MC Stecker', desc: 'Steckverbinder Typ 4', qty: '1 Stück' },
        { name: 'Kleinmaterial', desc: '', qty: '1 Stück' },
      ],
    });
    sections.push({
      title: 'Leistungen',
      items: [
        'Installation (AC- und DC-seitig, Montage Unterkonstruktion & Module)',
        'Netzanschluss (Standard Wien / NÖ + Wiener Netze)',
        'Verdrahtung Verteiler',
        'Erdung / Anbindung Potenzialausgleich',
        'Erstinbetriebnahme, Testlauf und Einschulung',
        'Einreichung (Förderung, Netze & Gemeinde)',
        'E-Befund PV nach ÖVE E8001-4-712',
      ].map((name) => ({ name, desc: '', qty: '1 Stück' })),
    });

    const speicherItems = [];
    if (speicherGesamt) {
      if (brand === 'sigenergy') {
        // Nur physische 6-/9-kWh-BAT-Module ausweisen (keine fiktive „12 kWh“-Einheit)
        const breakdown = storageModuleBreakdown(brand, speicher, speicherBloecke);
        for (const m of breakdown) {
          speicherItems.push({
            name: storageModel(brand, m.kwh),
            desc: `Stromspeicher ${formatNum(m.kwh)} kWh (SigenStor BAT) | 10 Jahre Garantie`,
            qty: `${m.qty} Stück`,
          });
        }
      } else if (brand === 'fronius') {
        // Reserva: einheitliche 3,2-kWh-Batteriemodule; Tower = 2–5 Module, max. 3 Tower
        const breakdown = storageModuleBreakdown(brand, speicher, speicherBloecke);
        const mods = breakdown[0] ? breakdown[0].qty : 0;
        if (mods > 0) {
          const towers = Math.ceil(mods / FRONIUS_MAX_MODULES_PER_TOWER);
          speicherItems.push({
            name: 'Fronius Reserva Batteriemodul (3,2 kWh)',
            desc: towers > 1
              ? `${mods} Module in ${towers} Speichertower (je max. ${FRONIUS_MAX_MODULES_PER_TOWER}) | LFP | 10 Jahre Garantie`
              : `Reserva-Tower mit ${mods} Modulen (${formatNum(speicherGesamt)} kWh nutzbar) | LFP | 10 Jahre Garantie`,
            qty: `${mods} Stück`,
          });
        }
      } else if (speicher) {
        speicherItems.push({
          name: storageModel(brand, speicher),
          desc: `Stromspeicher ${formatNum(speicher)} kWh | 10 Jahre Garantie`,
          qty: '1 Stück',
        });
        for (const b of speicherBloecke) {
          speicherItems.push({
            name: b.label,
            desc: `Speichererweiterung +${formatNum(b.kwh)} kWh | 10 Jahre Garantie`,
            qty: '1 Stück',
          });
        }
      }
      if (speicherItems.length) {
        speicherItems.push({
          name: smartMeterModel(brand),
          desc: 'Bidirektionaler Zähler / Eigenverbrauchsoptimierung',
          qty: '1 Stück',
        });
      }
    }
    if (speicherItems.length) sections.push({ title: 'Energiespeicher', items: speicherItems });

    const zusaetzlich = [];
    for (const it of inkludiert) {
      const hintDesc = it.hint ? String(it.hint).trim() : '';
      if (it.key === 'wallbox') zusaetzlich.push({ name: wallboxLabelComponent(brand), desc: hintDesc, qty: '1 Stück' });
      else if (it.key === 'speichererweiterung') zusaetzlich.push({ name: it.label || speichererweiterungOption(brand).label, desc: hintDesc || 'Erweiterung der Speicherkapazität', qty: '1 Stück' });
      else if (it.key === 'speicher_upgrade') zusaetzlich.push({ name: it.label, desc: hintDesc || 'Speicher-Upgrade (Preisdifferenz)', qty: '1 Stück' });
      else if (it.key === 'notstrom') zusaetzlich.push({ name: notstromLabelOption(brand), desc: notstromComponentDesc(brand, it.hint), qty: '1 Stück' });
      else if (it.key === 'optimierer') {
        const q = it.qty != null ? Number(it.qty) : moduleCount;
        zusaetzlich.push({
          name: OPTION_COMPONENT_NAMES.optimierer || 'Optimierer',
          desc: hintDesc || 'Ein Optimierer pro Modul für optimale Leistung.',
          qty: `${Math.max(0, q)} Stück`,
        });
      }
      else if (it.key && OPTION_COMPONENT_NAMES[it.key]) zusaetzlich.push({ name: OPTION_COMPONENT_NAMES[it.key], desc: hintDesc, qty: '1 Stück' });
      else zusaetzlich.push({ name: it.label, desc: hintDesc, qty: '1 Stück' });
    }
    if (zusaetzlich.length) sections.push({ title: 'Zusätzliche Komponenten', items: zusaetzlich });
  }

  const offerNotes = Array.isArray(config.offerNotes)
    ? config.offerNotes.map((n) => String(n || '').trim()).filter(Boolean)
    : (config.offerNote ? [String(config.offerNote).trim()].filter(Boolean) : []);

  const klimaItems = [];
  for (const k of klimaFix) {
    if (k.package) {
      const kp = k.package;
      klimaItems.push({
        name: k.label,
        desc: `${kp.brand} · Außen ${formatNum(kp.outdoorKw)} kW (${kp.outdoorModel}) · Innen ${formatKlimaIndoorSummary(kp)}`,
        qty: `${k.qty} Set`,
      });
      for (const inn of kp.indoor || []) {
        klimaItems.push({
          name: `Innengerät ${formatNum(inn.kw)} kW${inn.model ? ` (${inn.model})` : ''}`,
          desc: 'Wandgerät LG STANDARD II',
          qty: `${(inn.qty || 1) * (k.qty || 1)} Stück`,
        });
      }
      klimaItems.push({
        name: `Außengerät ${formatNum(kp.outdoorKw)} kW${kp.outdoorModel ? ` (${kp.outdoorModel})` : ''}`,
        desc: 'Außeneinheit LG STANDARD II',
        qty: `${k.qty} Stück`,
      });
      klimaItems.push({
        name: 'Kältemittelleitung & Montage',
        desc: `Inkl. bis ${KLIMA_EXTRAS.piping.includedMetersPerIndoor} m je Innengerät`,
        qty: '1 Pauschale',
      });
    } else {
      klimaItems.push({ name: k.label, desc: k.desc || 'Klimazubehör', qty: `${k.qty || 1} Stück` });
    }
  }
  if (klimaItems.length) sections.push({ title: 'Klimageräte (LG STANDARD II)', items: klimaItems });

  const hasKlimaAny = klimaFix.length + klimaOptional.length > 0;
  const offerKind = includePv && hasKlimaAny ? 'combo' : (hasKlimaAny && !includePv ? 'klima' : 'pv');

  return {
    meta: {
      angebotsnummer: config.angebotsnummer || '',
      datum: config.datum || new Date().toLocaleDateString('de-DE'),
      vertrieb: config.vertrieb || {},
      offerKind,
    },
    config: {
      includePv,
      brand,
      brandLabel: brandLabel(brand),
      kwp,
      kwpCalculated,
      kwpPackage,
      kwpLabel: includePv ? `${formatNum(kwpCalculated)} kWp` : '—',
      moduleCount,
      moduleCountPackage: packageModuleCount,
      extraModules,
      moduleExtraCost,
      moduleExtraCostNetto,
      speicher: speicherGesamt,
      speicherBasis: speicher,
      speicherZusatzKwh,
      speicherLabel: formatSpeicherLabel(brand, speicherGesamt, speicher, speicherBloecke),
      speicherModule: storageModuleBreakdown(brand, speicher, speicherBloecke),
      speicherBloecke,
      dach: dachLabel,
      dachSegmente,
      moduleType,
      moduleModel: mod.model,
      moduleWp: mod.wp,
      inverter: includePv
        ? ((selectedInverter && selectedInverter.label) || config.inverterModel || inverterModel(brand, kwpCalculated, { moduleKwp: kwpCalculated, packageKwp: kwpPackage, acKw: config.inverterKw }))
        : '—',
      inverterKw: selectedInverter && selectedInverter.acKw != null ? selectedInverter.acKw : null,
      inverterMppt: selectedInverter && selectedInverter.mppt != null ? selectedInverter.mppt : null,
      inverterMaxPvKwp: selectedInverter && selectedInverter.maxPvW
        ? selectedInverter.maxPvW / 1000
        : null,
      inverterMeta: inverterMetaLine(selectedInverter),
      klima: klimaFix.concat(klimaOptional),
    },
    statCards: {
      peak: includePv ? formatNum(kwpCalculated) : null,
      speicher: speicherGesamt ? formatNum(speicherGesamt) : null,
    },
    sections,
    optionaleKomponenten,
    offerNotes,
    klima: { fix: klimaFix, optional: klimaOptional },
    preis: {
      basePrice,
      dachAufschlag,
      dachAufschlagProKwp: dachSegmente.length === 1 ? dachSegmente[0].aufschlagProKwp : null,
      moduleAufschlag,
      moduleExtraCost,
      moduleExtraCostNetto,
      extraModules,
      speicherZusatzPreis,
      optionenSumme,
      klimaSumme,
      inkludiert,
      brutto,
      netto,
      mwst,
      mwstRate: MWST_RATE,
      bruttoOverride: config.bruttoOverride != null && config.bruttoOverride !== '' ? Number(config.bruttoOverride) : null,
      bruttoFmt: formatEUR(brutto),
      nettoFmt: formatEUR(netto),
      mwstFmt: formatEUR(mwst),
    },
  };
}

module.exports = {
  MWST_RATE,
  BRAND_META,
  PV_ONLY_NETTO,
  PRICELIST,
  SPEICHERBLOCK,
  STORAGE_EXTENSIONS,
  MODULES_PER_KWP,
  DACH_AUFSCHLAG,
  DACH_LABELS,
  INVERTER_CATALOG,
  OPTIONS,
  MODULE_TYPES,
  EXTRA_MODULE_PRICE,
  KLIMA_CATALOG,
  KLIMA_PACKAGES,
  KLIMA_EXTRAS,
  round100,
  roundEuro,
  normalizeBrand,
  brandHasStorage,
  brandLabel,
  listBrands,
  listKwpTiers,
  listStorageTiers,
  snapKwp,
  snapStorage,
  kwpFromModuleCount,
  kwpFromModulesExact,
  resolvePackageForModules,
  planStorage,
  planStorageFronius,
  storageModuleBreakdown,
  formatSpeicherLabel,
  froniusModulesForKwh,
  froniusKwhForModules,
  froniusModulesFromDesired,
  SIGENERGY_PHYSICAL_KWH,
  FRONIUS_MODULE_KWH,
  FRONIUS_MODULE_PRICE,
  FRONIUS_MAX_MODULES_PER_TOWER,
  FRONIUS_MAX_TOWERS,
  FRONIUS_TOWER_KWH,
  normalizeDach,
  dachFamilyKey,
  reconcileDachSegmente,
  resolveOptimiererOption,
  isOptimiererOption,
  OPTIMIERER_UNIT_PRICE,
  listInverters,
  findInverterByAcKw,
  selectInverter,
  inverterModel,
  inverterMetaLine,
  computeOffer,
  expandKlimaLines,
  matchKlimaPackage,
  getKlimaPackage,
  formatKlimaIndoorSummary,
  countKlimaIndoorUnits,
  notstromLabelOption,
  speichererweiterungOption,
  resolveSpeicherErweiterungOption,
  storagePackagePrice,
  storageUpgradeDiff,
  listStorageUpgrades,
  listStorageExtensionOptions,
  resolveSpeicherUpgradeOption,
  formatEUR,
  formatNum,
};
