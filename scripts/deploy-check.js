'use strict';

/**
 * Lokale / Server-Vorabprüfung: Node-Version, data/-Ordner, Schreibtest, better-sqlite3 laden.
 * Nutzung: node scripts/deploy-check.js
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

function fail(msg) {
  console.error('[deploy-check] FEHLER:', msg);
  process.exit(1);
}

function ok(msg) {
  console.log('[deploy-check] OK:', msg);
}

async function main() {
  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 18) fail(`Node >= 18 erforderlich, gefunden: ${process.version}`);
  ok(`Node ${process.version}`);

  fs.mkdirSync(dataDir, { recursive: true });
  ok(`Verzeichnis ${path.relative(process.cwd(), dataDir)} existiert / angelegt`);

  const probe = path.join(dataDir, '.write_probe_tmp');
  try {
    fs.writeFileSync(probe, `ok ${new Date().toISOString()}\n`, 'utf8');
    fs.unlinkSync(probe);
  } catch (e) {
    fail(`Kein Schreibzugriff auf data/: ${e.message}`);
  }
  ok('Schreibzugriff auf data/');

  try {
    require('better-sqlite3');
  } catch (e) {
    fail(`better-sqlite3 lädt nicht: ${e.message} — auf Linux ggf. sudo apt install build-essential`);
  }
  ok('better-sqlite3 lädt');

  try {
    require('csv-parse/sync');
  } catch (e) {
    fail(`csv-parse lädt nicht: ${e.message}`);
  }
  ok('csv-parse lädt');

  console.log('[deploy-check] Fertig. Auf dem Server: npm ci && node scripts/deploy-check.js');
}

main();
