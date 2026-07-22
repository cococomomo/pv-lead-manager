'use strict';

/**
 * Strukturbasis für künftige Klimaleads (Import / CRM).
 * Noch kein Persistenz-Pfad – Spalten und Normalisierung sind vorbereitet,
 * damit CSV-/Webhook-Import später einheitlich andocken kann.
 */

const LEAD_INTEREST_TYPES = Object.freeze({
  pv: 'pv',
  klima: 'klima',
  combo: 'combo',
  unknown: 'unknown',
});

/** Empfohlene Zusatzfelder für Klimaleads (neben den bestehenden Lead-Spalten). */
const KLIMA_LEAD_FIELDS = Object.freeze([
  { key: 'Interesse', description: 'pv | klima | combo' },
  { key: 'Klima-Paket', description: 'Paket-ID z. B. lg-std2-multi-41' },
  { key: 'Klima-Außen-kW', description: 'Zahl, z. B. 4.1' },
  { key: 'Klima-Innen', description: 'Freitext z. B. 2x2.5 + 1x3.5' },
  { key: 'Klima-Leitung-m', description: 'Gesamtlaufmeter Kältemittel (optional)' },
  { key: 'Klima-Kondensatpumpe', description: 'ja/nein' },
  { key: 'Klima-Notizen', description: 'Freitext' },
]);

/**
 * Erkennt grob das Interesse aus Freitext / Importzeile.
 * @returns {'pv'|'klima'|'combo'|'unknown'}
 */
function detectLeadInterest(textOrRow) {
  const s = typeof textOrRow === 'string'
    ? textOrRow
    : [
      textOrRow && textOrRow.Interesse,
      textOrRow && textOrRow.Info,
      textOrRow && textOrRow.Notizen,
      textOrRow && textOrRow['Klima-Paket'],
    ].filter(Boolean).join(' ');
  const t = String(s || '').toLowerCase();
  const wantsKlima = /klima|klimaanlage|split|innengerät|außengerät|lg\s*standard|kühl/.test(t);
  const wantsPv = /photovoltaik|\bpv\b|solar|speicher|kwp|modul|paneel|wallbox|sigenergy|fronius/.test(t);
  if (wantsKlima && wantsPv) return LEAD_INTEREST_TYPES.combo;
  if (wantsKlima) return LEAD_INTEREST_TYPES.klima;
  if (wantsPv) return LEAD_INTEREST_TYPES.pv;
  const explicit = String((textOrRow && textOrRow.Interesse) || '').toLowerCase().trim();
  if (LEAD_INTEREST_TYPES[explicit]) return LEAD_INTEREST_TYPES[explicit];
  return LEAD_INTEREST_TYPES.unknown;
}

/**
 * Normalisiert eine Importzeile zu einem Klima-Teildatensatz (ohne DB-Schreiben).
 */
function normalizeKlimaLeadRow(row) {
  const r = row && typeof row === 'object' ? row : {};
  const interest = detectLeadInterest(r);
  return {
    interest,
    klimaPackageId: String(r['Klima-Paket'] || r.klimaPackageId || '').trim() || null,
    outdoorKw: r['Klima-Außen-kW'] != null && r['Klima-Außen-kW'] !== ''
      ? Number(String(r['Klima-Außen-kW']).replace(',', '.'))
      : null,
    indoorRaw: String(r['Klima-Innen'] || '').trim() || null,
    pipingMeters: r['Klima-Leitung-m'] != null && r['Klima-Leitung-m'] !== ''
      ? Number(String(r['Klima-Leitung-m']).replace(',', '.'))
      : null,
    condensatePump: /^(1|ja|true|yes|x)$/i.test(String(r['Klima-Kondensatpumpe'] || '').trim()),
    notes: String(r['Klima-Notizen'] || '').trim() || null,
  };
}

module.exports = {
  LEAD_INTEREST_TYPES,
  KLIMA_LEAD_FIELDS,
  detectLeadInterest,
  normalizeKlimaLeadRow,
};
