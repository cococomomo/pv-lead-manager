'use strict';

/**
 * Entfernt historische Wien-Stephansplatz-Fallback-Koordinaten aus der DB (lat/lng → NULL).
 * Exakt: 48.2082 / 16.3738 (wie früher in geocode-address-cascade).
 *
 * Usage: node scripts/clear-wien-fallback-geocoords.js [--dry-run]
 */

require('../src/load-env');
const { initDb } = require('../src/database');

const FALLBACK_LAT = 48.2082;
const FALLBACK_LON = 16.3738;
const EPS = 1e-6;

function main() {
  const dry = process.argv.includes('--dry-run');
  const db = initDb();
  const sel = db.prepare(`
    SELECT id, latitude, longitude FROM leads
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      AND ABS(latitude - ?) < ?
      AND ABS(longitude - ?) < ?
  `);
  const rows = sel.all(FALLBACK_LAT, EPS, FALLBACK_LON, EPS);
  console.log(`[clear-wien-fallback-geocoords] Treffer: ${rows.length} Zeile(n)${dry ? ' (dry-run)' : ''}`);
  if (!rows.length) return;
  if (dry) {
    for (const r of rows.slice(0, 20)) {
      console.log(`  id=${r.id} lat=${r.latitude} lon=${r.longitude}`);
    }
    if (rows.length > 20) console.log(`  … und ${rows.length - 20} weitere`);
    return;
  }
  const upd = db.prepare('UPDATE leads SET latitude = NULL, longitude = NULL, last_updated = datetime(\'now\') WHERE id = ?');
  const tx = db.transaction((ids) => {
    for (const id of ids) upd.run(id);
  });
  tx(rows.map((r) => r.id));
  console.log(`[clear-wien-fallback-geocoords] ${rows.length} Zeile(n) auf NULL gesetzt.`);
}

main();
