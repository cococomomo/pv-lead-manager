#!/usr/bin/env node
'use strict';

/**
 * Finale DB-Reparatur: aktive leads.db mit „Gold“-Backup abgleichen.
 *
 * Ziel (Standard): /root/pv-lead-manager/data/leads.db
 * Quelle (Argument): z. B. /opt/pv-lead-manager/data/leads.db (249 Leads + Stati)
 *
 * 1) Fehlende Leads aus dem Backup einfügen (gleiche Spalten wie Ziel, ohne id),
 *    Abgleich: id → Adresse (Straße+PLZ+Ort) → anfrage → E-Mail
 * 2) Für alle Treffer: status + archived_at aus Backup überschreiben
 *
 *   node scripts/final-db-repair.js [pfad-zur-backup.db] [--dry-run]
 *
 * Ohne Argument: /opt/pv-lead-manager/data/leads.db (falls vorhanden), sonst Fehlerhinweis.
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');

const DEFAULT_GOLD = '/opt/pv-lead-manager/data/leads.db';

function defaultCurrentPath() {
  const raw = String(process.env.SQLITE_LEADS_DB || '').trim();
  if (raw) return path.isAbsolute(raw) ? raw : path.resolve(PROJECT_ROOT, raw);
  return path.join(PROJECT_ROOT, 'data', 'leads.db');
}

function normAnfrage(a) {
  return String(a == null ? '' : a).trim();
}

function normEmail(e) {
  return String(e == null ? '' : e).trim().toLowerCase();
}

function normStr(s) {
  return String(s == null ? '' : s).trim();
}

function leadMatchIds(current, br) {
  const bid = br.id;
  if (bid != null && bid !== '') {
    const n = Number(bid);
    if (Number.isFinite(n) && n > 0) {
      const r = current.prepare('SELECT id FROM leads WHERE id = ?').get(n);
      if (r) return [r.id];
    }
  }
  const str = normStr(br.strasse).toLowerCase();
  const plz = normStr(br.plz);
  const ort = normStr(br.ort).toLowerCase();
  if (str && plz && ort) {
    const r = current
      .prepare(
        `SELECT id FROM leads WHERE lower(trim(coalesce(strasse,''))) = ?
         AND trim(coalesce(plz,'')) = ?
         AND lower(trim(coalesce(ort,''))) = ?`,
      )
      .all(str, plz, ort);
    if (r.length) return r.map((x) => x.id);
  }
  const an = normAnfrage(br.anfrage);
  if (an) {
    const r = current.prepare(`SELECT id FROM leads WHERE trim(anfrage) = ?`).all(an);
    if (r.length) return r.map((x) => x.id);
  }
  const em = normEmail(br.email);
  if (em) {
    const r = current.prepare(`SELECT id FROM leads WHERE lower(trim(email)) = ?`).all(em);
    if (r.length) return r.map((x) => x.id);
  }
  return [];
}

function getLeadsColumns(db) {
  return db
    .prepare(`PRAGMA table_info(leads)`)
    .all()
    .map((c) => c.name)
    .filter((n) => n !== 'id');
}

function resolveBackupPath(argv) {
  const pathArg = argv.find((a) => !a.startsWith('--'));
  if (pathArg) {
    return path.isAbsolute(pathArg) ? pathArg : path.resolve(PROJECT_ROOT, pathArg);
  }
  if (fs.existsSync(DEFAULT_GOLD)) return DEFAULT_GOLD;
  return null;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const backupPath = resolveBackupPath(argv);
  const currentPath = defaultCurrentPath();

  if (!backupPath || !fs.existsSync(backupPath)) {
    console.error('[final-db-repair] Backup nicht gefunden. Bitte Pfad angeben, z. B.:');
    console.error('  node scripts/final-db-repair.js /opt/pv-lead-manager/data/leads.db');
    process.exit(1);
  }
  if (!fs.existsSync(currentPath)) {
    console.error('[final-db-repair] Ziel-DB nicht gefunden:', currentPath);
    process.exit(1);
  }

  const current = new Database(currentPath);
  current.pragma('journal_mode = WAL');
  current.pragma('foreign_keys = ON');

  const backup = new Database(backupPath, { readonly: true });
  backup.pragma('foreign_keys = ON');

  const cols = getLeadsColumns(current);
  const backupCols = new Set(getLeadsColumns(backup));
  const insertCols = cols.filter((c) => backupCols.has(c));
  if (!insertCols.length) {
    console.error('[final-db-repair] Keine gemeinsamen Spalten.');
    current.close();
    backup.close();
    process.exit(1);
  }

  const placeholders = insertCols.map((c) => `@${c}`).join(', ');
  const insertSql = `INSERT INTO leads (${insertCols.join(', ')}) VALUES (${placeholders})`;
  const insertStmt = dryRun ? null : current.prepare(insertSql);

  const updStmt = dryRun
    ? null
    : current.prepare(
        `UPDATE leads SET status = @status, archived_at = @archived_at, last_updated = datetime('now') WHERE id = @id`,
      );

  const backupRows = backup.prepare(`SELECT * FROM leads`).all();
  let inserted = 0;
  let updated = 0;
  let skippedInsertDup = 0;

  const work = () => {
    for (const br of backupRows) {
      const ids = leadMatchIds(current, br);
      if (!ids.length) {
        if (dryRun) {
          inserted += 1;
          continue;
        }
        try {
          const payload = {};
          for (const c of insertCols) payload[c] = br[c] == null ? null : br[c];
          insertStmt.run(payload);
          inserted += 1;
        } catch (e) {
          if (e && String(e.message).includes('UNIQUE')) skippedInsertDup += 1;
          else throw e;
        }
        continue;
      }

      const status = br.status != null ? String(br.status) : 'Neu';
      const archivedAt = br.archived_at != null ? br.archived_at : null;
      for (const id of ids) {
        const cur = current.prepare(`SELECT id FROM leads WHERE id = ?`).get(id);
        if (!cur) continue;
        if (dryRun) updated += 1;
        else {
          updStmt.run({ id, status, archived_at: archivedAt });
          updated += 1;
        }
      }
    }
  };

  if (dryRun) work();
  else current.transaction(work)();

  if (!dryRun) {
    try {
      current.pragma('wal_checkpoint(TRUNCATE)');
    } catch (e) {
      console.warn('[final-db-repair] wal_checkpoint:', e && e.message);
    }
  }

  backup.close();
  current.close();

  const totalAfter = new Database(currentPath, { readonly: true });
  const n = totalAfter.prepare(`SELECT count(*) AS c FROM leads`).get().c;
  totalAfter.close();

  console.log(`[final-db-repair] Quelle=${backupPath}`);
  console.log(`[final-db-repair] Ziel=${currentPath}`);
  console.log(`[final-db-repair] eingefügt=${inserted} | status/archiv aktualisiert=${updated} | UNIQUE übersprungen=${skippedInsertDup} | dryRun=${dryRun}`);
  console.log(`[final-db-repair] Leads gesamt (Ziel): ${n}`);
}

main();
