'use strict';

/**
 * NOORTEC PV-Angebotsgenerator — Katalog, Preislogik & Stückliste.
 * Preisliste Q1/2025 (brutto). Alle Regeln laut Vertriebsvorgabe.
 */

const MWST_RATE = 0.20;

// ── Preisliste (brutto in EUR) ────────────────────────────────────────────
// brand -> kWp -> { speicherKWh: bruttoPreis }
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
    5.01: { 6.4: 14400, 9.5: 15720, 12.6: 17040 },
    5.92: { 6.4: 15600, 9.5: 16920, 12.6: 18240 },
    7.28: { 6.4: 16320, 9.5: 17640, 12.6: 18960 },
    8.19: { 6.4: 17000, 9.5: 18320, 12.6: 19640 },
    10.01: { 9.5: 19980, 12.6: 21300 },
    12.29: { 9.5: 21500, 12.6: 22820 },
    15.02: { 9.5: 23000, 12.6: 24320 },
    18.2: { 9.5: 25000, 12.6: 26320 },
  },
};

// Speicherblöcke (zur Bewertung von Erweiterungen)
const SPEICHERBLOCK = {
  sigenergy: { 6: 3300, 9: 3960 },
  fronius: { 3.2: 1320 },
};

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
};

// Module je Anlagengröße (kWp -> Anzahl Module)
const MODULES_PER_KWP = {
  5.01: 11, 5.92: 13, 7.28: 16, 8.19: 18, 10.01: 22,
  12.29: 27, 13.2: 29, 15.02: 33, 17.8: 41, 18.2: 40,
};

// Dachaufschläge (EUR pro kWp)
const DACH_AUFSCHLAG = {
  ziegel: 0,
  welleternit: 0,
  trapezblech: 0,
  'schindel-eternit': 80,
  rhombus: 80,
  biberschwanz: 80,
  'wiener tasche': 100,
  prefa: 100,
  flachdach: 30,
};

// Optionen (brutto). Smart Meter ist IMMER im Systempreis enthalten -> nie extra.
// Reihenfolge = Anzeige-Reihenfolge in der Eingabemaske. Preise sind in der UI
// editierbar (Default-Werte hier). mode (optional|fix) wird pro Angebot gesetzt.
const OPTIONS = {
  notstrom: { label: 'Notstrom (Gateway/Umschaltbox)', price: 1500 },
  wallbox: { label: 'Wallbox 11 kW', price: 1800 },
  speichererweiterung: { label: 'Speichererweiterung (Sigenergy +6 kWh / Fronius +3,2 kWh)', price: 3300 },
  ueberspannungsschutz: { label: 'Überspannungsschutz', price: 400 },
  lasttrennschalter: { label: 'Lasttrennschalter', price: 150 },
  fi_schalter: { label: 'FI-Schalter (neu)', price: 150 },
  zaehlerbrett: { label: 'Zählerbrett / Zählerverteiler', price: 200 },
  waermepumpe_anschluss: { label: 'Anschluss für Wärmepumpe (vorbereitet)', price: 800 },
  ohmpilot: { label: 'Ohmpilot (bis 9 kW, 3-phasig)', price: 1800 },
  smartmeter: { label: 'Smart Meter (im Systempreis enthalten)', price: 0, alwaysIncluded: true },
};

// Komponentennamen für die Stückliste, wenn eine Option FIX ins Angebot kommt.
const OPTION_COMPONENT_NAMES = {
  ueberspannungsschutz: 'Überspannungsschutz (Typ I+II)',
  lasttrennschalter: 'Lasttrennschalter',
  fi_schalter: 'FI-Schalter (Fehlerstromschutzschalter)',
  zaehlerbrett: 'Zählerbrett / Zählerverteiler',
  waermepumpe_anschluss: 'Anschluss für Wärmepumpe (vorbereitet)',
  ohmpilot: 'Ohmpilot (bis 9 kW, 3-phasig) – Warmwasser-Überschussnutzung',
};

// AIKO-Modul-Variante
const MODULE_TYPES = {
  das: { model: 'DAS-DH108ND-455', wp: 455, aufschlagProModul: 0,
    desc: 'Modul (bifazial Glas-Glas, TOPCon, Black Frame, 455 Wp | 25 J. Produktgarantie, 30 J. Leistungsgarantie)' },
  aiko: { model: 'AIKO Neostar', wp: 490, aufschlagProModul: 60,
    desc: 'Modul (AIKO, 490 Wp, Black Frame | 25 J. Produktgarantie, 30 J. Leistungsgarantie)' },
};

const ROUND_STEP = 100;
/** Zusätzliche Module über die Paketgröße hinaus (brutto, pro Modul). */
const EXTRA_MODULE_PRICE = 200;

function round100(x) {
  return Math.round(x / ROUND_STEP) * ROUND_STEP;
}

/** kWp-Stufe aus gewünschter Modulanzahl (nächstgelegenes Paket). */
function kwpFromModuleCount(brand, modules) {
  const m = Number(modules);
  if (!Number.isFinite(m) || m <= 0) return null;
  const tiers = listKwpTiers(brand);
  let best = null;
  let bestDiff = Infinity;
  for (const t of tiers) {
    const mc = MODULES_PER_KWP[t];
    if (mc == null) continue;
    const d = Math.abs(mc - m);
    if (d < bestDiff - 1e-9) { bestDiff = d; best = t; }
  }
  return best;
}

/**
 * Zerlegt eine gewünschte Speichergröße in Tabellen-Basis + stapelbare Blöcke.
 * Sigenergy: 9+6=15, 9+9=18, 9+6+6=21, 2×9=18, …
 * @returns {{ baseKwh: number, blocks: Array<{kwh:number,price:number,label:string}>, totalKwh: number, exact: boolean }}
 */
function planStorage(brand, kwp, desiredKWh) {
  const desired = Number(desiredKWh);
  if (!Number.isFinite(desired) || desired <= 0) {
    return { baseKwh: null, blocks: [], totalKwh: 0, exact: true };
  }

  const tiers = listStorageTiers(brand, kwp);
  const exts = (STORAGE_EXTENSIONS[brand] || []).slice().sort((a, b) => b.kwh - a.kwh);
  if (!tiers.length) {
    return { baseKwh: null, blocks: [], totalKwh: desired, exact: false };
  }

  // Exakter Tabellenwert → keine Zusatzblöcke nötig
  if (tiers.some((t) => Math.abs(t - desired) < 0.05)) {
    return { baseKwh: desired, blocks: [], totalKwh: desired, exact: true };
  }

  if (!exts.length) {
    return { baseKwh: snapStorage(brand, kwp, desired), blocks: [], totalKwh: snapStorage(brand, kwp, desired), exact: false };
  }

  let best = null;
  for (const base of tiers) {
    if (base > desired + 0.05) continue;
    const remainder = Math.round((desired - base) * 10) / 10;
    const blocks = decomposeExtensionKwh(exts, remainder);
    if (!blocks) continue;
    const totalKwh = base + blocks.reduce((s, b) => s + b.kwh, 0);
    if (Math.abs(totalKwh - desired) > 0.15) continue;
    const extPrice = blocks.reduce((s, b) => s + b.price, 0);
    const basePrice = ((PRICELIST[brand] || {})[kwp] || {})[base] || 0;
    const score = basePrice + extPrice;
    if (!best || score < best.score - 1e-9) {
      best = { baseKwh: base, blocks, totalKwh, exact: true, score };
    }
  }

  if (best) {
    return { baseKwh: best.baseKwh, blocks: best.blocks, totalKwh: best.totalKwh, exact: true };
  }

  const snapped = snapStorage(brand, kwp, desired);
  return { baseKwh: snapped, blocks: [], totalKwh: snapped, exact: false };
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
  const s = String(dachRaw || '').trim().toLowerCase();
  if (!s) return { key: 'ziegel', label: 'Ziegel' };
  // "Eternit" allein = Schindel-Eternit; nur "Welleternit" = 0
  if (s.includes('welleternit')) return { key: 'welleternit', label: 'Welleternit' };
  if (s === 'eternit' || (s.includes('eternit') && s.includes('schindel'))) {
    return { key: 'schindel-eternit', label: 'Schindel-Eternit' };
  }
  if (s.includes('eternit')) return { key: 'schindel-eternit', label: 'Schindel-Eternit' };
  if (s.includes('rhombus')) return { key: 'rhombus', label: 'Rhombus' };
  if (s.includes('biberschwanz')) return { key: 'biberschwanz', label: 'Biberschwanz' };
  if (s.includes('wiener') || s.includes('tasche')) return { key: 'wiener tasche', label: 'Wiener Tasche' };
  if (s.includes('prefa')) return { key: 'prefa', label: 'Prefa' };
  if (s.includes('flach')) return { key: 'flachdach', label: 'Flachdach' };
  if (s.includes('trapez')) return { key: 'trapezblech', label: 'Trapezblech' };
  if (s.includes('ziegel')) return { key: 'ziegel', label: 'Ziegel' };
  return { key: 'ziegel', label: dachRaw ? String(dachRaw).trim() : 'Ziegel' };
}

// ── Wechselrichter-Modellnamen ────────────────────────────────────────────
// Verfügbare Wechselrichtergrößen (kW) laut Vertriebsvorgabe.
const SIGEN_INV_SIZES = [5, 6, 8, 10, 12, 15, 17, 20, 25, 30];
const FRONIUS_INV_SIZES = [3, 4, 5, 6, 8, 10, 12];

/** Nächstgelegene verfügbare Größe (bei Gleichstand: aufrunden). */
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

function sigenInverterSize(kwp) {
  return `${snapInverterSize(kwp, SIGEN_INV_SIZES).toFixed(1)}`;
}

function froniusInverterSize(kwp) {
  return `${snapInverterSize(kwp, FRONIUS_INV_SIZES).toFixed(1)}`;
}

function inverterModel(brand, kwp) {
  if (brand === 'fronius') {
    return `Fronius Symo GEN24 ${froniusInverterSize(kwp)} Plus`;
  }
  return `Sigen Hybrid 5-25 kW Three Phase ${sigenInverterSize(kwp)} TP`;
}

function storageModel(brand, kwh) {
  if (brand === 'fronius') return `Fronius Reserva (${formatNum(kwh)} kWh)`;
  return `SigenStor BAT (${formatNum(kwh)} kWh)`;
}

function smartMeterModel(brand) {
  return brand === 'fronius' ? 'Fronius Smart Meter' : 'SigenStor Smart Meter';
}

function wallboxLabelComponent(brand) {
  return brand === 'fronius' ? 'Fronius Wattpilot 11 kW – E-Ladestation' : 'Sigen EV AC Wallbox 11 kW – E-Ladestation';
}

function wallboxLabelOption(brand) {
  return brand === 'fronius' ? 'Wallbox – Fronius Wattpilot (11 kW)' : 'Wallbox – Sigen EV AC Wallbox (11 kW)';
}

function notstromLabelOption(brand) {
  return brand === 'fronius' ? 'Notstrom – Fronius Backup-Lösung' : 'Notstrom – Sigen Energie Gateway (Umschaltbox)';
}

function speichererweiterungOption(brand) {
  if (brand === 'fronius') {
    return { label: '+3,2 kWh Speichererweiterung – Fronius', price: 1320 };
  }
  return { label: '+6 kWh Speichererweiterung – SigenStor BAT (6 kWh)', price: 3300 };
}

function formatNum(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  // kWp/kWh wie in den Vorlagen mit Punkt als Dezimaltrenner (z. B. 10.01)
  return String(num);
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
 * config = {
 *   brand, kwp, speicher (kWh), dach, moduleType ('das'|'aiko'),
 *   inkludierteOptionen: ['wallbox','waermepumpe', ...],
 *   standardOptionen: true|false,
 *   bruttoOverride: number|null,
 *   inverterModel?: string (Override), angebotsnummer, datum, vertrieb {name,email,phone}
 * }
 */
function computeOffer(config) {
  const brand = (config.brand === 'fronius') ? 'fronius' : 'sigenergy';
  let kwp = snapKwp(brand, config.kwp);
  const moduleType = MODULE_TYPES[config.moduleType] ? config.moduleType : 'das';
  const mod = MODULE_TYPES[moduleType];

  // Modulanzahl: Paket-Standard oder explizite Angabe (z. B. 35 statt 33)
  const packageModuleCount = MODULES_PER_KWP[kwp] || Math.round((kwp * 1000) / mod.wp);
  const requestedModules = Number(config.moduleCount);
  const moduleCount = (Number.isFinite(requestedModules) && requestedModules > 0)
    ? Math.round(requestedModules)
    : packageModuleCount;
  if (Number.isFinite(requestedModules) && requestedModules > 0 && config.kwp == null) {
    const fromMods = kwpFromModuleCount(brand, moduleCount);
    if (fromMods != null) kwp = fromMods;
  }
  const extraModules = Math.max(0, moduleCount - (MODULES_PER_KWP[kwp] || packageModuleCount));
  const moduleExtraCost = extraModules * EXTRA_MODULE_PRICE;

  // ── Speicher: Tabellen-Basis + stapelbare Blöcke (z. B. 9+6=15 kWh) ─────
  const desiredSpeicher = Number(config.speicherGesamt) || Number(config.speicher) || null;
  const manualZusatz = Array.isArray(config.speicherZusatz)
    ? config.speicherZusatz.filter((b) => b && (Number(b.kwh) || Number(b.price))) : [];
  let speicher;
  let speicherBloecke = [];
  if (manualZusatz.length) {
    speicher = snapStorage(brand, kwp, config.speicher);
    for (const b of manualZusatz) {
      const k = Number(b.kwh) || 0;
      const p = Number(b.price) || 0;
      speicherBloecke.push({ kwh: k, price: p, label: String(b.label || `+${formatNum(k)} kWh Speichererweiterung`).trim() });
    }
  } else if (desiredSpeicher) {
    const plan = planStorage(brand, kwp, desiredSpeicher);
    speicher = plan.baseKwh;
    speicherBloecke = plan.blocks.map((b) => ({ ...b }));
  } else {
    speicher = snapStorage(brand, kwp, config.speicher);
  }
  let speicherZusatzKwh = 0;
  let speicherZusatzPreis = 0;
  for (const b of speicherBloecke) {
    speicherZusatzKwh += b.kwh;
    speicherZusatzPreis += b.price;
  }
  const speicherGesamt = (speicher || 0) + speicherZusatzKwh;

  // ── Dachflächen: einzeln (config.dach) oder gemischt (config.dachSegmente) ─
  // Aufschlag (EUR/kWp) wird anteilig nach Modulen auf die Gesamt-kWp verteilt.
  const rawSegs = Array.isArray(config.dachSegmente)
    ? config.dachSegmente.filter((s) => s && (s.dach || s.modules)) : null;
  let dachAufschlag = 0;
  let dachSegmente = [];
  let dachLabel = '';
  if (rawSegs && rawSegs.length) {
    const segs = rawSegs.map((s) => ({ ...normalizeDach(s.dach), modules: Number(s.modules) || 0 }));
    const sumMods = segs.reduce((a, s) => a + s.modules, 0);
    for (const s of segs) {
      const share = sumMods > 0 ? s.modules / sumMods : 1 / segs.length;
      const segKwp = share * kwp;
      const auf = (DACH_AUFSCHLAG[s.key] || 0) * segKwp;
      dachAufschlag += auf;
      dachSegmente.push({ key: s.key, label: s.label, modules: s.modules, aufschlag: auf, aufschlagProKwp: DACH_AUFSCHLAG[s.key] || 0 });
    }
    dachLabel = segs.map((s) => `${s.label}${s.modules ? ` (${s.modules} Mod.)` : ''}`).join(' + ');
  } else {
    const dach = normalizeDach(config.dach);
    dachAufschlag = (DACH_AUFSCHLAG[dach.key] || 0) * kwp;
    dachLabel = dach.label;
    dachSegmente = [{ key: dach.key, label: dach.label, modules: moduleCount, aufschlag: dachAufschlag, aufschlagProKwp: DACH_AUFSCHLAG[dach.key] || 0 }];
  }

  // ── Speicher-Erweiterung (manuelle Zusatzblöcke über die Tabellen-Stufe) ──
  // (bereits in speicherBloecke / speicherZusatz* erfasst)

  const basePrice = ((PRICELIST[brand] || {})[kwp] || {})[speicher] || 0;
  const moduleAufschlag = mod.aufschlagProModul * moduleCount + moduleExtraCost;

  // ── Optionen: optional (nicht im Preis) vs. fix (im Preis) ────────────────
  // Neues Modell: config.optionen = [{ key?, label, price, mode:'optional'|'fix' }]
  // Manuelle Positionen haben kein key. Smart Meter zählt nie extra.
  let optionenSumme = 0;
  const inkludiert = [];              // FIX → im Gesamtpreis + Stückliste
  const optionaleKomponenten = [];    // OPTIONAL → separat ausgewiesen
  const optionenInput = Array.isArray(config.optionen) ? config.optionen : null;

  if (optionenInput) {
    for (const o of optionenInput) {
      if (!o) continue;
      const key = o.key || null;
      const base = key && OPTIONS[key] ? OPTIONS[key] : null;
      if (base && base.alwaysIncluded) continue;
      const label = String(o.label || (base && base.label) || 'Position').trim();
      let price = Number(o.price);
      if (!Number.isFinite(price)) price = base ? base.price : 0;
      const mode = o.mode === 'fix' ? 'fix' : 'optional';
      if (!label && !price) continue;
      if (mode === 'fix') {
        optionenSumme += price;
        inkludiert.push({ key, label, price });
      } else {
        optionaleKomponenten.push({ key, label, price });
      }
    }
  } else {
    // Rückwärtskompatibel: altes Modell (inkludierteOptionen + standardOptionen)
    const inkl = Array.isArray(config.inkludierteOptionen) ? config.inkludierteOptionen.slice() : [];
    for (const key of inkl) {
      const opt = OPTIONS[key];
      if (!opt || opt.alwaysIncluded) continue;
      optionenSumme += opt.price;
      inkludiert.push({ key, label: opt.label, price: opt.price });
    }
    if (config.standardOptionen !== false) {
      if (!inkl.includes('notstrom')) optionaleKomponenten.push({ key: 'notstrom', label: notstromLabelOption(brand).label || notstromLabelOption(brand), price: 1500 });
      if (!inkl.includes('wallbox')) optionaleKomponenten.push({ key: 'wallbox', label: wallboxLabelOption(brand), price: 1800 });
      const se = speichererweiterungOption(brand);
      optionaleKomponenten.push({ key: 'speichererweiterung', label: se.label, price: se.price });
    }
  }

  let brutto = basePrice + dachAufschlag + moduleAufschlag + optionenSumme + speicherZusatzPreis;
  brutto = round100(brutto);
  if (config.bruttoOverride != null && config.bruttoOverride !== '' && Number.isFinite(Number(config.bruttoOverride))) {
    brutto = Number(config.bruttoOverride);
  }
  const netto = brutto / (1 + MWST_RATE);
  const mwst = brutto - netto;

  // ── Stückliste ──────────────────────────────────────────────────────────
  // Unterkonstruktion: je Dachfläche eine Zeile (bei gemischten Dächern).
  const unterkonstruktion = (dachSegmente.length > 1)
    ? dachSegmente.map((s) => ({ name: `Unterkonstruktion ${s.label}`, desc: 'ALU-Unterkonstruktion', qty: `${s.modules || 0} Stück` }))
    : [{ name: `Unterkonstruktion ${dachLabel}`, desc: 'ALU-Unterkonstruktion', qty: `${moduleCount} Stück` }];

  const pvItems = [
    { name: mod.model, desc: mod.desc, qty: `${moduleCount} Stück` },
    { name: config.inverterModel || inverterModel(brand, kwp), desc: 'Wechselrichter | 10 Jahre Garantie', qty: '1 Stück' },
    ...unterkonstruktion,
    { name: 'GAK Generatoranschlusskasten', desc: 'DC-Schutz Typ I+II, Erdung', qty: '2 Stück' },
    { name: 'Kabelkanal und Alurohr', desc: 'Kabelführung', qty: '1 Stück' },
    { name: 'Solarflex', desc: 'DC-Solarkabel, TÜV-zertifiziert', qty: '1 Stück' },
    { name: 'MC Buchse', desc: 'Steckverbinder Typ 4', qty: '1 Stück' },
    { name: 'MC Stecker', desc: 'Steckverbinder Typ 4', qty: '1 Stück' },
    { name: 'Kleinmaterial', desc: '', qty: '1 Stück' },
  ];

  const leistungen = [
    'Installation (AC- und DC-seitig, Montage Unterkonstruktion & Module)',
    'Netzanschluss (Standard Wien / NÖ + Wiener Netze)',
    'Verdrahtung Verteiler',
    'Erdung / Anbindung Potenzialausgleich',
    'Erstinbetriebnahme, Testlauf und Einschulung',
    'Einreichung (Förderung, Netze & Gemeinde)',
    'E-Befund PV nach ÖVE E8001-4-712',
  ].map((name) => ({ name, desc: '', qty: '1 Stück' }));

  const speicherItems = [];
  if (speicher) {
    speicherItems.push({ name: storageModel(brand, speicher), desc: `Stromspeicher ${formatNum(speicher)} kWh | 10 Jahre Garantie`, qty: '1 Stück' });
    for (const b of speicherBloecke) {
      speicherItems.push({ name: b.label, desc: `Speichererweiterung +${formatNum(b.kwh)} kWh | 10 Jahre Garantie`, qty: '1 Stück' });
    }
    speicherItems.push({ name: smartMeterModel(brand), desc: 'Bidirektionaler Zähler / Eigenverbrauchsoptimierung', qty: '1 Stück' });
  }

  // Zusätzliche (inkludierte/fix) Komponenten als eigene Sektion in der Liste
  const zusaetzlich = [];
  for (const it of inkludiert) {
    if (it.key === 'wallbox') zusaetzlich.push({ name: wallboxLabelComponent(brand), desc: '', qty: '1 Stück' });
    else if (it.key === 'speichererweiterung') zusaetzlich.push({ name: speichererweiterungOption(brand).label, desc: 'Erweiterung der Speicherkapazität', qty: '1 Stück' });
    else if (it.key === 'notstrom') zusaetzlich.push({ name: notstromLabelOption(brand).replace(/^Notstrom – /, ''), desc: 'Notstrom-/Ersatzstromfunktion', qty: '1 Stück' });
    else if (it.key && OPTION_COMPONENT_NAMES[it.key]) zusaetzlich.push({ name: OPTION_COMPONENT_NAMES[it.key], desc: '', qty: '1 Stück' });
    else zusaetzlich.push({ name: it.label, desc: '', qty: '1 Stück' });
  }

  const sections = [
    { title: 'Photovoltaikanlage', items: pvItems },
    { title: 'Leistungen', items: leistungen },
  ];
  if (speicherItems.length) sections.push({ title: 'Energiespeicher', items: speicherItems });
  if (zusaetzlich.length) sections.push({ title: 'Zusätzliche Komponenten', items: zusaetzlich });

  return {
    meta: {
      angebotsnummer: config.angebotsnummer || '',
      datum: config.datum || new Date().toLocaleDateString('de-DE'),
      vertrieb: config.vertrieb || {},
    },
    config: {
      brand,
      brandLabel: brand === 'fronius' ? 'Fronius' : 'Sigenergy',
      kwp,
      kwpLabel: `${formatNum(kwp)} kWp`,
      moduleCount,
      moduleCountPackage: MODULES_PER_KWP[kwp] || packageModuleCount,
      extraModules,
      moduleExtraCost,
      speicher: speicherGesamt,
      speicherBasis: speicher,
      speicherZusatzKwh,
      speicherLabel: speicherGesamt ? `${formatNum(speicherGesamt)} kWh` : '—',
      speicherBloecke,
      dach: dachLabel,
      dachSegmente,
      moduleType,
      moduleModel: mod.model,
      moduleWp: mod.wp,
      inverter: config.inverterModel || inverterModel(brand, kwp),
    },
    statCards: {
      peak: formatNum(kwp),
      speicher: speicherGesamt ? formatNum(speicherGesamt) : null,
    },
    sections,
    optionaleKomponenten,
    preis: {
      basePrice,
      dachAufschlag,
      dachAufschlagProKwp: dachSegmente.length === 1 ? dachSegmente[0].aufschlagProKwp : null,
      moduleAufschlag,
      moduleExtraCost,
      extraModules,
      speicherZusatzPreis,
      optionenSumme,
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
  PRICELIST,
  SPEICHERBLOCK,
  STORAGE_EXTENSIONS,
  MODULES_PER_KWP,
  DACH_AUFSCHLAG,
  OPTIONS,
  MODULE_TYPES,
  EXTRA_MODULE_PRICE,
  round100,
  listKwpTiers,
  listStorageTiers,
  snapKwp,
  snapStorage,
  kwpFromModuleCount,
  planStorage,
  normalizeDach,
  inverterModel,
  computeOffer,
  formatEUR,
  formatNum,
};
