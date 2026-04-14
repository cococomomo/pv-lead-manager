'use strict';

/**
 * Nur Leads ohne gültige Koordinaten: Nominatim (AT, countrycodes=at) mit Kaskade,
 * danach immer gültige Zahlen — bei API-Miss wird Wien-Zentrum gesetzt (wie geocode-address-cascade).
 *
 * Nutzung:
 *   node scripts/fix-missing-coords.js [--dry-run] [--include-archived]
 */

require('../src/load-env');
const { initDb } = require('../src/database');
const { geocodeAddressCascade, WIEN_ZENTRUM_1 } = require('../src/geocode-address-cascade');

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const includeArchived = argv.includes('--include-archived');
  const db = initDb();

  const onlyLat = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE latitude IS NULL OR latitude = 0
  `).get().c;
  console.log('[check] SELECT COUNT(*) … latitude IS NULL OR latitude = 0  → ', onlyLat);

  const arch = includeArchived ? '' : 'AND (archived_at IS NULL OR archived_at = \'\')';
  const rows = db.prepare(`
    SELECT id, strasse, plz, ort, latitude, longitude
    FROM leads
    WHERE 1=1 ${arch}
      AND (
        latitude IS NULL OR longitude IS NULL
        OR latitude = 0 OR longitude = 0
      )
    ORDER BY id ASC
  `).all();

  console.log('[fix-missing-coords] Zeilen ohne gültigen Kartenpunkt (lat/lng):', rows.length, dry ? '(dry-run)' : '');

  if (!rows.length) {
    console.log('Fertig — nichts zu tun.');
    return;
  }

  const upd = db.prepare('UPDATE leads SET latitude = ?, longitude = ?, last_updated = datetime(\'now\') WHERE id = ?');

  for (const row of rows) {
    const g = await geocodeAddressCascade({
      strasse: row.strasse || '',
      plz: row.plz || '',
      ort: row.ort || '',
    });
    let lat = g.lat;
    let lon = g.lon;
    let label = g.label;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      lat = WIEN_ZENTRUM_1.lat;
      lon = WIEN_ZENTRUM_1.lon;
      label = 'Hard-Fallback Wien (ungültige Kaskade-Rückgabe)';
    }
    if (!g.nominatimHit) {
      label += ' → Wien-Zentrum (hart)';
    }
    console.log(`id ${row.id}: ${label}`);
    if (!dry) upd.run(lat, lon, row.id);
  }

  const after = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE latitude IS NULL OR latitude = 0
  `).get().c;
  console.log('[check] Nachlauf latitude NULL/0 (alle Zeilen):', after);
  if (!dry && after > 0) {
    console.warn('[fix-missing-coords] Hinweis: Es bleiben Zeilen mit latitude NULL/0 — DB prüfen.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
