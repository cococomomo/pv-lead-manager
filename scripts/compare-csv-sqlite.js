'use strict';

/**
 * Vergleicht CSV-Datenzeilen (ohne Header) mit SQLite `leads` (alle Zeilen inkl. Archiv).
 * Nutzung: node scripts/compare-csv-sqlite.js <pfad.csv>
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initDb } = require('../src/database');

function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const csvPath = argv[0] || process.env.LEADS_CSV_PATH;
  if (!csvPath) {
    console.error('Usage: node scripts/compare-csv-sqlite.js <path-to.csv>');
    process.exit(1);
  }
  const abs = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }
  const content = fs.readFileSync(abs, 'utf8');
  const rows = parse(content, { relax_column_count: true, skip_empty_lines: true, bom: true });
  if (!rows.length) {
    console.error('CSV is empty');
    process.exit(1);
  }
  const dataRows = rows.slice(1);
  const nonEmpty = dataRows.filter((cells) => cells.some((c) => String(c || '').trim())).length;

  const db = initDb();
  const totalDb = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
  const activeDb = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE archived_at IS NULL OR archived_at = ''`).get().c;

  console.log('--- CSV vs SQLite ---');
  console.log('CSV-Datei:', abs);
  console.log('CSV Datenzeilen (inkl. leer):', dataRows.length);
  console.log('CSV nicht-leere Zeilen:', nonEmpty);
  console.log('SQLite leads (alle):', totalDb);
  console.log('SQLite leads (aktiv, nicht archiviert):', activeDb);
  console.log('Differenz (nicht-leer CSV − alle DB-Zeilen):', nonEmpty - totalDb);
  console.log('Hinweis: Import überspringt Duplikate (gleiche anfrage/E-Mail); Archiv zählt in SQLite mit.');
}

main();
