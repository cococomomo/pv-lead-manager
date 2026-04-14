'use strict';

require('./load-env');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');
const DEFAULT_DB_PATH = path.join(PROJECT_ROOT, 'data', 'leads.db');

/**
 * SQLite-Datei — immer relativ zum Projektroot aufgelöst (wichtig für PM2 / beliebiges cwd).
 * Ohne SQLITE_LEADS_DB: `<repo>/data/leads.db`.
 */
function getDbPath() {
  const raw = String(process.env.SQLITE_LEADS_DB || '').trim();
  if (!raw) return DEFAULT_DB_PATH;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(PROJECT_ROOT, raw);
}

function getProjectRoot() {
  return PROJECT_ROOT;
}

/** CSV-Spalten (sheet1) + CRM-Felder + Metadaten */
const LEADS_DDL = `
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  anfrage TEXT,
  namen TEXT,
  telefon TEXT,
  email TEXT,
  strasse TEXT,
  plz TEXT,
  ort TEXT,
  land TEXT,
  quelle TEXT,
  anfragezeitpunkt TEXT,
  info TEXT,
  betreuer TEXT,
  notizen TEXT,
  col_14 TEXT,
  status TEXT NOT NULL DEFAULT 'Neu',
  nachfass_bis TEXT NOT NULL DEFAULT '',
  termin TEXT NOT NULL DEFAULT '',
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_updated TEXT,
  latitude REAL,
  longitude REAL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_anfrage ON leads(anfrage)
  WHERE anfrage IS NOT NULL AND length(trim(anfrage)) > 0;
CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON leads(lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_leads_archived ON leads(archived_at);
CREATE INDEX IF NOT EXISTS idx_leads_last_updated ON leads(last_updated);
CREATE INDEX IF NOT EXISTS idx_leads_coords ON leads(latitude, longitude);
`;

let _db = null;

function initSchema(db) {
  db.exec(LEADS_DDL);
}

function migrateLeadsTable(db) {
  const cols = db.prepare('PRAGMA table_info(leads)').all();
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('last_updated')) {
    db.exec('ALTER TABLE leads ADD COLUMN last_updated TEXT');
    db.exec(`UPDATE leads SET last_updated = COALESCE(created_at, datetime('now')) WHERE last_updated IS NULL`);
  }
  if (!names.has('latitude')) {
    db.exec('ALTER TABLE leads ADD COLUMN latitude REAL');
  }
  if (!names.has('longitude')) {
    db.exec('ALTER TABLE leads ADD COLUMN longitude REAL');
  }
  db.prepare(`UPDATE leads SET status = 'Neu' WHERE status IS NULL OR trim(status) = ''`).run();
}

/**
 * @returns {import('better-sqlite3').Database}
 */
function getDb() {
  if (_db) return _db;
  const filePath = getDbPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  _db = new Database(filePath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  migrateLeadsTable(_db);
  return _db;
}

/** Nur Schema anlegen / migrieren (z. B. Import-Skript). */
function initDb() {
  return getDb();
}

module.exports = { getDb, getDbPath, getProjectRoot, initDb };
