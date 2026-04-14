'use strict';

/**
 * Map-Vollständigkeit: Leads ohne gültige Koordinaten finden, in data/import_errors.log schreiben,
 * optional mit gleicher Kaskade wie Import nachziehen (--fix).
 *
 *   node scripts/audit-leads-coords.js           # nur prüfen + log
 *   node scripts/audit-leads-coords.js --fix    # Kaskade anwenden und DB updaten
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');
const { initDb } = require('../src/database');
const { geocodeAddressCascade } = require('../src/geocode-address-cascade');

const LOG_REL = path.join('data', 'import_errors.log');

function logPath() {
  return path.join(__dirname, '..', LOG_REL);
}

function appendLog(text) {
  const p = logPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, text, 'utf8');
}

function isBadCoord(lat, lon) {
  if (lat == null || lon == null) return true;
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return true;
  if (la === 0 && lo === 0) return true;
  return false;
}

async function main() {
  const argv = process.argv.slice(2);
  const doFix = argv.includes('--fix');

  const db = initDb();
  const bad = db.prepare(`
    SELECT id, anfrage, email, namen, strasse, plz, ort, latitude, longitude
    FROM leads
    WHERE (archived_at IS NULL OR archived_at = '')
    AND (
      latitude IS NULL OR longitude IS NULL
      OR (latitude = 0 AND longitude = 0)
    )
    ORDER BY id ASC
  `).all();

  const ts = new Date().toISOString();
  appendLog(`\n# --- audit-leads-coords ${ts} (${bad.length} ohne gültige lat/lng) ---\n`);
  for (const row of bad) {
    appendLog(
      `id=${row.id}\tanfrage=${row.anfrage || ''}\temail=${row.email || ''}\t` +
        `addr=${(row.strasse || '').replace(/\t/g, ' ')}|${row.plz || ''}|${row.ort || ''}\t` +
        `lat=${row.latitude}\tlon=${row.longitude}\n`
    );
  }

  console.log(`Audit: ${bad.length} aktive Lead(s) ohne gültige Koordinaten (NULL/0). Log: ${LOG_REL}`);

  if (doFix && bad.length > 0) {
    const upd = db.prepare('UPDATE leads SET latitude = ?, longitude = ? WHERE id = ?');
    for (const row of bad) {
      const g = await geocodeAddressCascade({
        strasse: row.strasse,
        plz: row.plz,
        ort: row.ort,
      });
      upd.run(g.lat, g.lon, row.id);
      appendLog(`# FIX id=${row.id} → ${g.label} (${g.lat}, ${g.lon})\n`);
      console.log(`Fix id=${row.id}: ${g.label}`);
    }
    console.log('Fix abgeschlossen.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
