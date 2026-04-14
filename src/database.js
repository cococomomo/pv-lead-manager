'use strict';

require('./load-env');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY COLLATE NOCASE,
  voller_name TEXT NOT NULL DEFAULT '',
  telefon TEXT NOT NULL DEFAULT '',
  email_kontakt TEXT NOT NULL DEFAULT '',
  smtp_host TEXT NOT NULL DEFAULT '',
  smtp_port TEXT NOT NULL DEFAULT '587',
  smtp_user TEXT NOT NULL DEFAULT '',
  smtp_pass TEXT NOT NULL DEFAULT ''
);
`;

function migrateUsersTable(db) {
  db.exec(USERS_DDL);
  const uCols = db.prepare('PRAGMA table_info(users)').all();
  const unames = new Set(uCols.map((c) => c.name));
  if (!unames.has('voller_name')) db.exec(`ALTER TABLE users ADD COLUMN voller_name TEXT NOT NULL DEFAULT ''`);
  if (!unames.has('telefon')) db.exec(`ALTER TABLE users ADD COLUMN telefon TEXT NOT NULL DEFAULT ''`);
  if (!unames.has('email_kontakt')) db.exec(`ALTER TABLE users ADD COLUMN email_kontakt TEXT NOT NULL DEFAULT ''`);
  if (!unames.has('smtp_host')) db.exec(`ALTER TABLE users ADD COLUMN smtp_host TEXT NOT NULL DEFAULT ''`);
  if (!unames.has('smtp_port')) db.exec(`ALTER TABLE users ADD COLUMN smtp_port TEXT NOT NULL DEFAULT '587'`);
  if (!unames.has('smtp_user')) db.exec(`ALTER TABLE users ADD COLUMN smtp_user TEXT NOT NULL DEFAULT ''`);
  if (!unames.has('smtp_pass')) db.exec(`ALTER TABLE users ADD COLUMN smtp_pass TEXT NOT NULL DEFAULT ''`);
}

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
  longitude REAL,
  termin_typ TEXT NOT NULL DEFAULT 'vor_ort',
  meet_link TEXT NOT NULL DEFAULT '',
  reonic_synced INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_anfrage ON leads(anfrage)
  WHERE anfrage IS NOT NULL AND length(trim(anfrage)) > 0;
CREATE INDEX IF NOT EXISTS idx_leads_email_lower ON leads(lower(trim(email)));
CREATE INDEX IF NOT EXISTS idx_leads_archived ON leads(archived_at);
`;

let _db = null;

function initSchema(db) {
  db.exec(LEADS_DDL);
  db.exec(USERS_DDL);
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
  if (!names.has('termin_typ')) {
    db.exec(`ALTER TABLE leads ADD COLUMN termin_typ TEXT NOT NULL DEFAULT 'vor_ort'`);
  }
  if (!names.has('meet_link')) {
    db.exec(`ALTER TABLE leads ADD COLUMN meet_link TEXT NOT NULL DEFAULT ''`);
  }
  if (!names.has('reonic_synced')) {
    db.exec(`ALTER TABLE leads ADD COLUMN reonic_synced INTEGER NOT NULL DEFAULT 0`);
  }
  db.prepare(`UPDATE leads SET status = 'Neu' WHERE status IS NULL OR trim(status) = ''`).run();
}

/** Indizes auf Spalten, die per ALTER nachgerüstet werden — erst nach migrateLeadsTable. */
function ensureLeadsSecondaryIndexes(db) {
  const cols = db.prepare('PRAGMA table_info(leads)').all();
  const names = new Set(cols.map((c) => c.name));
  if (names.has('last_updated')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_leads_last_updated ON leads(last_updated)');
  }
  if (names.has('latitude') && names.has('longitude')) {
    db.exec('CREATE INDEX IF NOT EXISTS idx_leads_coords ON leads(latitude, longitude)');
  }
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
  ensureLeadsSecondaryIndexes(_db);
  migrateUsersTable(_db);
  return _db;
}

/** Nur Schema anlegen / migrieren (z. B. Import-Skript). */
function initDb() {
  return getDb();
}

module.exports = { getDb, getDbPath, getProjectRoot, initDb };
