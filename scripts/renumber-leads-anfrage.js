'use strict';

/**
 * Alle Zeilen in `leads` neu durchnummerieren: ältester Eintrag = 0001, dann fortlaufend.
 * Sortierung: `created_at` (aufsteigend), sonst `anfragezeitpunkt` / `last_updated`, tie-breaker `id`.
 *
 * Nutzung:
 *   node scripts/renumber-leads-anfrage.js --dry-run
 *   node scripts/renumber-leads-anfrage.js
 *
 * Wichtig: Dienst anhalten oder kurz laufen lassen; einmalige Migration.
 */

require('../src/load-env');
const { initDb, getDbPath } = require('../src/database');
const { formatAnfrageNumber } = require('../src/anfrage-format');

const TEMP_PREFIX = '__pvl_renum_';

function main() {
  const dry = process.argv.includes('--dry-run');
  const db = initDb();
  const path = getDbPath();

  const rows = db
    .prepare(
      `
    SELECT id,
      anfrage AS old_anfrage,
      created_at,
      anfragezeitpunkt,
      last_updated
    FROM leads
    ORDER BY
      datetime(COALESCE(
        NULLIF(trim(created_at), ''),
        NULLIF(trim(anfragezeitpunkt), ''),
        NULLIF(trim(last_updated), ''),
        '1970-01-01T00:00:00.000Z'
      )) ASC,
      id ASC
  `,
    )
    .all();

  if (rows.length === 0) {
    console.log(`[renumber] Keine Leads in ${path}`);
    return;
  }

  if (dry) {
    const head = rows.slice(0, 5);
    const tail = rows.length > 10 ? rows.slice(-3) : [];
    console.log(`[renumber] --dry-run: ${rows.length} Zeilen würden neu nummeriert (0001…${formatAnfrageNumber(rows.length)}), DB: ${path}`);
    for (const r of head) {
      console.log(`  id=${r.id} alt=${r.old_anfrage || '(leer)'} created=${r.created_at || '—'}`);
    }
    if (tail.length) {
      console.log('  …');
      for (const r of tail) {
        console.log(`  id=${r.id} alt=${r.old_anfrage || '(leer)'} created=${r.created_at || '—'}`);
      }
    }
    return;
  }

  const dropIdx = db.prepare(`DROP INDEX IF EXISTS idx_leads_anfrage`);
  const toTemp = db.prepare(`UPDATE leads SET anfrage = ? WHERE id = ?`);
  const toFinal = db.prepare(`UPDATE leads SET anfrage = ? WHERE id = ?`);

  const run = db.transaction((list) => {
    dropIdx.run();
    for (const r of list) {
      toTemp.run(`${TEMP_PREFIX}${r.id}`, r.id);
    }
    let n = 0;
    for (const r of list) {
      n += 1;
      toFinal.run(formatAnfrageNumber(n), r.id);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_anfrage ON leads(anfrage)
      WHERE anfrage IS NOT NULL AND length(trim(anfrage)) > 0`);
  });

  run(rows);

  const maxRow = db.prepare(`SELECT anfrage FROM leads ORDER BY CAST(anfrage AS INTEGER) DESC LIMIT 1`).get();
  const maxN = maxRow && maxRow.anfrage != null ? String(maxRow.anfrage) : '';
  console.log(
    `[renumber] Fertig: ${rows.length} Leads, Anfrage-Nr. 0001 … ${maxN}, DB: ${path}. Nächste freie Nummer vergibt die App per MAX+1.`,
  );
}

try {
  main();
} catch (e) {
  console.error(e);
  process.exit(1);
}
