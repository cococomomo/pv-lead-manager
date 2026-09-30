'use strict';

/**
 * Produktdatenblätter für Angebots-PDF (klickbare Links) und öffentliche Auslieferung.
 * Dateien liegen unter public/datenblaetter/<file>.
 */

const fs = require('fs');
const path = require('path');

const DATASHEETS_DIR = path.join(__dirname, '../../public/datenblaetter');

/** Statische Katalogeinträge (slug = URL-Pfad /datenblaetter/<slug>). */
const DATASHEET_CATALOG = [
  {
    id: 'fronius-reserva',
    slug: 'fronius-reserva.pdf',
    label: 'Fronius Reserva – Stromspeicher',
    brands: ['fronius'],
    kind: 'storage',
    sourceNames: [
      'SE_DB_Fronius_Reserva_DE (1).pdf',
      'SE_DB_Fronius_Reserva_DE.pdf',
      'SE_DS_Fronius_Reserva_DE.pdf',
    ],
  },
  {
    id: 'fronius-gen24',
    slug: 'fronius-symo-gen24-3-10.pdf',
    label: 'Fronius Symo GEN24 / GEN24 Plus (3–10 kW)',
    brands: ['fronius'],
    kind: 'inverter',
    maxAcKw: 10.5,
    sourceNames: [
      'SE_DS_Fronius_Symo_GEN24_GEN24Plus_3_to_10_kW_DE (1).pdf',
      'SE_DS_Fronius_Symo_GEN24_GEN24Plus_3_to_10_kW_DE.pdf',
    ],
  },
  {
    id: 'fronius-gen24sc-12',
    slug: 'fronius-symo-gen24sc-12.pdf',
    label: 'Fronius Symo GEN24 SC (12 kW)',
    brands: ['fronius'],
    kind: 'inverter',
    minAcKw: 11,
    sourceNames: [
      'SE_DS_Fronius_Symo_GEN24SC_12kW_DE (1).pdf',
      'SE_DS_Fronius_Symo_GEN24SC_12kW_DE.pdf',
    ],
  },
  {
    id: 'fronius-symo',
    slug: 'fronius-symo.pdf',
    label: 'Fronius Symo (3–20 kW, M) – String-Wechselrichter ohne Speicher',
    brands: ['fronius_symo'],
    kind: 'inverter',
    sourceNames: [
      'SE_DS_Fronius_Symo_DE.pdf',
      'SE_DS_Fronius_Symo_DE (1).pdf',
    ],
  },
  {
    id: 'huawei-sun2000',
    slug: 'huawei-sun2000-3-10ktl-m1.pdf',
    label: 'Huawei SUN2000-(3–10)KTL-M1 High Current',
    brands: ['huawei'],
    kind: 'inverter',
    sourceNames: [
      'Datasheet_SUN2000-3-10KTL-M1_DE_High_current.pdf',
      'SUN2000-3-10KTL-M1_High_Current_Version.pdf',
    ],
  },
  {
    id: 'sigen-hybrid-tp2',
    slug: 'sigen-hybrid-tp2.pdf',
    label: 'Sigen Hybrid Wechselrichter 3,0–12,0 kW TP2',
    brands: ['sigenergy'],
    kind: 'inverter',
    sourceNames: [
      'Hybrid-Inverter-TP2-Datasheet.pdf',
      'Sigen Hybrid Wechselrichter 3,0-12,0 kW TP2.pdf',
    ],
  },
  {
    id: 'sigen-batterie',
    slug: 'sigen-batterie.pdf',
    label: 'Sigenergy SigenStor BAT 6,0 / 9,0 kWh',
    brands: ['sigenergy'],
    kind: 'storage',
    sourceNames: [
      'Energielösung für Zuhause - Sigen Batterie.pdf',
      'Energielösung für Zuhause - Sigen Batterie (1).pdf',
    ],
  },
  {
    id: 'aiko-module',
    slug: 'aiko-mce54mb-460-490w.pdf',
    label: 'AIKO Neostar 3S54 (A-MCE54Mb, 460–490 W)',
    brands: null,
    moduleTypes: ['aiko'],
    kind: 'module',
    sourceNames: [
      'AIKO A MCE54Mb 460 490W.pdf',
      'AIKO A MCE54Mb 460-490W.pdf',
    ],
  },
  {
    id: 'das-module',
    slug: 'das-dh108nd-440-465.pdf',
    label: 'DAS Solar DH108ND – PV-Module (440–465 W, schwarzer Rahmen)',
    brands: null,
    moduleTypes: ['das'],
    kind: 'module',
    sourceNames: [
      'DAS-DH108ND_440-465_Schwarzer Rahmen_Datenblatt_DE-1.pdf',
      'DAS-DH108ND_440-465_Schwarzer Rahmen_Datenblatt_DE.pdf',
    ],
  },
  {
    id: 'fronius-smart-meter-ts',
    slug: 'fronius-smart-meter-ts.pdf',
    label: 'Fronius Smart Meter TS',
    brands: ['fronius', 'fronius_symo'],
    kind: 'meter',
    sourceNames: [
      'SE_DS_Fronius_Smart_Meter_TS_DE.pdf',
    ],
  },
  {
    id: 'sigen-gateway-home',
    slug: 'sigen-gateway-home.pdf',
    label: 'Sigenergy Gateway Home TP 30K',
    brands: ['sigenergy'],
    kind: 'gateway',
    sourceNames: [
      'Sigen Energy Gateway Home.pdf',
    ],
  },
  {
    id: 'enwitec-gen24-10015613',
    slug: 'enwitec-gen24-10015613.pdf',
    label: 'Enwitec Netzumschaltbox 10015613 – Fronius GEN24 Plus Full Backup',
    brands: ['fronius'],
    kind: 'gateway',
    // Blatt nennt Symo GEN24 Plus 6.0/8.0/10.0 und 12.0 SC. 3.0–5.0 Plus haben kein Full Backup.
    minAcKw: 6,
    sourceNames: [
      'DB_DE_Enwitec_Netzumschaltbox_Fronius_10015613.pdf',
    ],
  },
  {
    id: 'lg-std2-single-25',
    slug: 'lg-single-split.pdf',
    label: 'LG STANDARD II Single-Split 2,5 kW (S09EC.NSJS / S09EC.UA3S)',
    kind: 'climate',
    klimaPackages: ['lg-std2-single-25'],
  },
  {
    id: 'lg-std2-single-35',
    slug: 'lg-single-split.pdf',
    label: 'LG STANDARD II Single-Split 3,5 kW (S12EC.NSJS / S12EC.UA3S)',
    kind: 'climate',
    klimaPackages: ['lg-std2-single-35'],
  },
  {
    id: 'lg-std2-multi-41',
    slug: 'lg-multisplit.pdf',
    label: 'LG STANDARD II Multi-Split 4,1 kW (MU2R15.U13, Innengerät S09EC.NSJS)',
    kind: 'climate',
    klimaPackages: ['lg-std2-multi-41'],
  },
  {
    id: 'lg-std2-multi-63',
    slug: 'lg-multisplit.pdf',
    label: 'LG STANDARD II Multi-Split MU3R19.U23 (5,3 kW Kühlen / 6,3 kW Heizen; S09EC.NSJS, S12EC.NSJS)',
    kind: 'climate',
    klimaPackages: ['lg-std2-multi-63'],
  },
];

function datasheetAbsPath(slug) {
  const safe = path.basename(String(slug || ''));
  if (!safe || safe !== String(slug) || !safe.toLowerCase().endsWith('.pdf')) return null;
  return path.join(DATASHEETS_DIR, safe);
}

function datasheetExists(entry) {
  const abs = datasheetAbsPath(entry.slug);
  return !!(abs && fs.existsSync(abs) && fs.statSync(abs).size > 500);
}

/**
 * Öffentliche Absolute URL (ohne Login), z. B. https://pvl.lifeco.at/datenblaetter/….
 * opts.openPage=true → HTML-Zwischenseite, die das PDF in neuem Tab öffnet.
 */
function datasheetPublicUrl(entry, baseUrl, opts = {}) {
  const base = String(baseUrl || process.env.APP_BASE_URL || 'https://pvl.lifeco.at').replace(/\/$/, '');
  if (opts.openPage) return `${base}/datenblaetter/open/${entry.slug}`;
  return `${base}/datenblaetter/${entry.slug}`;
}

const OFFER_KINDS = ['module', 'inverter', 'storage', 'meter', 'gateway', 'climate'];
/** Diese Arten höchstens einmal (beste / erste passende Zeile). Klima darf mehrere Blätter haben. */
const SINGLE_KINDS = new Set(['module', 'inverter', 'storage', 'meter', 'gateway']);

function collectKlimaPackageIds(offer) {
  const ids = [];
  const push = (id) => {
    const s = String(id || '').trim();
    if (s) ids.push(s);
  };
  const blocks = [];
  const klima = offer && offer.klima;
  if (klima) blocks.push(...(klima.fix || []), ...(klima.optional || []));
  const raw = offer && offer.config && offer.config.klima;
  if (Array.isArray(raw)) blocks.push(...raw);
  else if (raw && typeof raw === 'object') blocks.push(raw);
  for (const line of blocks) {
    if (!line || line.enabled === false) continue;
    push(line.packageId || line.id || (line.package && line.package.id));
  }
  return [...new Set(ids)];
}

/** Fix enthaltene Options-Keys (Notstrom, Smart-Meter-Nachrüstung). Optionale Upsells zählen nicht. */
function includedOptionKeys(offer) {
  const keys = new Set();
  const inkludiert = offer && offer.preis && Array.isArray(offer.preis.inkludiert)
    ? offer.preis.inkludiert
    : null;
  if (inkludiert) {
    for (const it of inkludiert) {
      if (it && it.key) keys.add(String(it.key));
    }
    return keys;
  }
  const cfg = (offer && offer.config) || {};
  for (const key of cfg.inkludierteOptionen || []) keys.add(String(key));
  for (const o of cfg.optionen || []) {
    if (o && o.key && o.mode !== 'optional') keys.add(String(o.key));
  }
  return keys;
}

/**
 * Datenblätter passend zum Angebot.
 * Module, Wechselrichter, Speicher und Zähler: je ein Link.
 * Klima: je Paket die passenden Blätter (auch ohne PV).
 */
function selectDatasheetsForOffer(offer, opts = {}) {
  const cfg = (offer && offer.config) || {};
  const brandRaw = String(cfg.brand || '').toLowerCase();
  const brand = ['fronius', 'sigenergy', 'huawei', 'fronius_symo'].includes(brandRaw)
    ? brandRaw
    : null;
  const moduleType = cfg.moduleType === 'aiko' ? 'aiko' : 'das';
  const includePv = cfg.includePv !== false && Number(cfg.moduleCount) > 0;
  const presence = cfg.linePresence && typeof cfg.linePresence === 'object' ? cfg.linePresence : null;
  const hasSpeicher = presence
    ? !!presence.storage
    : !!(Number(cfg.speicher) || Number(cfg.speicherBasis) || Number(cfg.speicherGesamt));
  const klimaIds = collectKlimaPackageIds(offer);
  const optionKeys = includedOptionKeys(offer);

  let acKw = Number(cfg.inverterKw);
  if (!Number.isFinite(acKw) && cfg.inverter) {
    const m = String(cfg.inverter).match(/(\d+(?:[.,]\d+)?)\s*(?:kw|tp)/i);
    if (m) acKw = Number(String(m[1]).replace(',', '.'));
  }
  const baseUrl = opts.baseUrl;
  const taken = new Set();
  const selected = [];

  for (const entry of DATASHEET_CATALOG) {
    let ok = false;
    if (entry.klimaPackages) {
      ok = klimaIds.some((id) => entry.klimaPackages.includes(id));
    } else if (entry.moduleTypes) {
      ok = includePv && entry.moduleTypes.includes(moduleType);
      if (presence && presence.module === false) ok = false;
    } else if (entry.brands) {
      if (!brand || !entry.brands.includes(brand) || !includePv) ok = false;
      else if (entry.kind === 'storage') ok = hasSpeicher;
      else if (entry.kind === 'meter') {
        ok = presence ? !!presence.meter : (hasSpeicher || optionKeys.has('smartmeter'));
      }
      else if (entry.kind === 'gateway') {
        ok = presence ? !!presence.notstrom : optionKeys.has('notstrom');
        if (ok && Number.isFinite(acKw)) {
          if (entry.maxAcKw != null && acKw > entry.maxAcKw) ok = false;
          if (entry.minAcKw != null && acKw < entry.minAcKw) ok = false;
        }
      }
      else if (entry.kind === 'inverter') {
        ok = presence ? !!presence.inverter : true;
        if (Number.isFinite(acKw)) {
          if (entry.maxAcKw != null && acKw > entry.maxAcKw) ok = false;
          if (entry.minAcKw != null && acKw < entry.minAcKw) ok = false;
        } else if (entry.minAcKw != null) {
          // Ohne bekannte Leistung: Standard-WR (nicht SC-12)
          ok = false;
        }
      } else {
        ok = true;
      }
    }
    if (!ok) continue;
    if (!OFFER_KINDS.includes(entry.kind)) continue;
    if (SINGLE_KINDS.has(entry.kind) && taken.has(entry.kind)) continue;
    if (!datasheetExists(entry) && !opts.includeMissing) continue;

    taken.add(entry.kind);
    selected.push({
      id: entry.id,
      label: entry.label,
      slug: entry.slug,
      url: datasheetPublicUrl(entry, baseUrl, { openPage: true }),
      pdfUrl: datasheetPublicUrl(entry, baseUrl),
      available: datasheetExists(entry),
      kind: entry.kind,
    });
  }

  selected.sort((a, b) => OFFER_KINDS.indexOf(a.kind) - OFFER_KINDS.indexOf(b.kind));
  return selected;
}

/** Alle Katalog-Einträge (Admin/Deploy-Hilfe). */
function listDatasheetCatalog() {
  return DATASHEET_CATALOG.map((e) => ({
    ...e,
    available: datasheetExists(e),
    path: datasheetAbsPath(e.slug),
  }));
}

module.exports = {
  DATASHEETS_DIR,
  DATASHEET_CATALOG,
  datasheetAbsPath,
  datasheetExists,
  datasheetPublicUrl,
  selectDatasheetsForOffer,
  listDatasheetCatalog,
};
