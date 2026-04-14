'use strict';

/**
 * Fehlende latitude/longitude in SQLite nachziehen (Nominatim, 1,5 s Pause pro API-Aufruf).
 * Nutzung: node scripts/geocode-leads-db.js [--include-archived]
 */

require('../src/load-env');
const { initDb } = require('../src/database');
const { geocodeAddressCascade } = require('../src/geocode-address-cascade');

async function main() {
  const argv = process.argv.slice(2);
  const includeArchived = argv.includes('--include-archived');
  const db = initDb();
  const archFilter = includeArchived ? '' : 'AND (archived_at IS NULL OR archived_at = \'\')';
  const rows = db.prepare(`
    SELECT id, strasse, plz, ort
    FROM leads
    WHERE 1=1 ${archFilter}
      AND (
        latitude IS NULL OR longitude IS NULL
        OR latitude = 0 OR longitude = 0
      )
    ORDER BY id ASC
  `).all();

  const upd = db.prepare('UPDATE leads SET latitude = ?, longitude = ? WHERE id = ?');
  let noHit = 0;
  for (const row of rows) {
    const g = await geocodeAddressCascade({
      strasse: row.strasse,
      plz: row.plz,
      ort: row.ort,
    });
    upd.run(g.lat, g.lon, row.id);
    if (!g.nominatimHit) noHit += 1;
    console.log(`id ${row.id}: ${g.label}`);
  }
  console.log(
    `Geocode fertig: ${rows.length} Zeilen aktualisiert (${noHit}× ohne Nominatim-Treffer → lat/lng NULL), ` +
      `archiv=${includeArchived ? 'einbezogen' : 'ausgeschlossen'}, db: ${process.env.SQLITE_LEADS_DB || 'data/leads.db'}`,
  );

  const stillBad = db.prepare(`
    SELECT COUNT(*) AS c
    FROM leads
    WHERE (archived_at IS NULL OR archived_at = '')
      AND (
        latitude IS NULL OR longitude IS NULL
        OR (latitude = 0 AND longitude = 0)
      )
  `).get();
  const n = stillBad && Number.isFinite(stillBad.c) ? stillBad.c : 0;
  console.log(`${n} aktive Lead(s) ohne gültige Koordinaten`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
