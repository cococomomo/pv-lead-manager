'use strict';

/**
 * Nur Leads ohne gültige Koordinaten: Nominatim (AT, countrycodes=at) mit Kaskade.
 * Ohne Treffer: latitude/longitude bleiben NULL.
 *
 * Nutzung:
 *   node scripts/fix-missing-coords.js [--dry-run] [--include-archived]
 */

require('../src/load-env');
const { initDb } = require('../src/database');
const { geocodeAddressCascade } = require('../src/geocode-address-cascade');

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
    const lat = g.lat != null && Number.isFinite(g.lat) ? g.lat : null;
    const lon = g.lon != null && Number.isFinite(g.lon) ? g.lon : null;
    console.log(`id ${row.id}: ${g.label}`);
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
