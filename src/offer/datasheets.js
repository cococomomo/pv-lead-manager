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
    label: 'Fronius Symo (3–20 kW) – String-Wechselrichter ohne Speicher',
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
    id: 'sigen-hybrid',
    slug: 'sigen-hybrid-wechselrichter.pdf',
    label: 'Sigenergy Sigen Hybrid – Wechselrichter',
    brands: ['sigenergy'],
    kind: 'inverter',
    sourceNames: [
      'Energielösung für Zuhause - Sigen Hybrid Wechselrichter.pdf',
      'Energielösung für Zuhause - Sigen Hybrid Wechselrichter (1).pdf',
    ],
  },
  {
    id: 'sigen-batterie',
    slug: 'sigen-batterie.pdf',
    label: 'Sigenergy SigenStor – Batterie / Speicher',
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
    label: 'AIKO Neostar 2S – PV-Module (460–490 W)',
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

/**
 * Datenblätter passend zum Angebot – maximal ein Link je Komponente
 * (Module, Wechselrichter, Speicher).
 */
function selectDatasheetsForOffer(offer, opts = {}) {
  const cfg = (offer && offer.config) || {};
  const brandRaw = String(cfg.brand || '').toLowerCase();
  const brand = ['fronius', 'sigenergy', 'huawei', 'fronius_symo'].includes(brandRaw)
    ? brandRaw
    : null;
  const moduleType = cfg.moduleType === 'aiko' ? 'aiko' : 'das';
  const includePv = cfg.includePv !== false && Number(cfg.moduleCount) > 0;
  const hasSpeicher = !!(Number(cfg.speicher) || Number(cfg.speicherBasis) || Number(cfg.speicherGesamt));

  let acKw = Number(cfg.inverterKw);
  if (!Number.isFinite(acKw) && cfg.inverter) {
    const m = String(cfg.inverter).match(/(\d+(?:[.,]\d+)?)\s*(?:kw|tp)/i);
    if (m) acKw = Number(String(m[1]).replace(',', '.'));
  }
  const baseUrl = opts.baseUrl;

  const candidates = { module: null, inverter: null, storage: null };

  for (const entry of DATASHEET_CATALOG) {
    if (!includePv && entry.kind !== 'module') continue;

    let ok = false;
    if (entry.moduleTypes) {
      ok = includePv && entry.moduleTypes.includes(moduleType);
    } else if (entry.brands) {
      if (!brand || !entry.brands.includes(brand)) ok = false;
      else if (entry.kind === 'storage') ok = hasSpeicher;
      else if (entry.kind === 'inverter') {
        ok = true;
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
    if (!datasheetExists(entry) && !opts.includeMissing) continue;

    const kind = entry.kind === 'module' || entry.kind === 'inverter' || entry.kind === 'storage'
      ? entry.kind
      : null;
    if (!kind) continue;

    // Pro Komponente nur ein Datenblatt (erste passende / beste Match)
    if (candidates[kind]) continue;
    candidates[kind] = {
      id: entry.id,
      label: entry.label,
      slug: entry.slug,
      url: datasheetPublicUrl(entry, baseUrl, { openPage: true }),
      pdfUrl: datasheetPublicUrl(entry, baseUrl),
      available: datasheetExists(entry),
      kind,
    };
  }

  return ['module', 'inverter', 'storage'].map((k) => candidates[k]).filter(Boolean);
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
