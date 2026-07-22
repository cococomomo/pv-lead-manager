#!/usr/bin/env node
'use strict';

/**
 * Merge aus Backup B in aktuelle DB A (CRM-Wiederherstellung):
 * - Jede Zeile aus B: Treffer in A per id → anfrage → e-mail → Adresse (Straße+PLZ+Ort)
 * - Kein Treffer → INSERT (alle gemeinsamen Spalten außer id)
 * - Treffer → Überschreiben: status, archived_at, notizen, reonic_status
 *
 *   node scripts/merge-leads-from-backup.js [pfad-backup.db] [--dry-run]
 *
 * Standard-Backup: data/leads.db.pre-restore-20260417100439
 * Ziel: SQLITE_LEADS_DB oder data/leads.db
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const PROJECT_ROOT = path.join(__dirname, '..');

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

/**
 * @param {import('better-sqlite3').Database} current
 * @param {Record<string, unknown>} br — Backup-Zeile
 * @returns {number[]}
 */
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

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const pathArg = argv.find((a) => !a.startsWith('--'));
  const backupPath = pathArg
    ? path.isAbsolute(pathArg)
      ? pathArg
      : path.resolve(PROJECT_ROOT, pathArg)
    : path.join(PROJECT_ROOT, 'data', 'leads.db.pre-restore-20260417100439');
  const currentPath = defaultCurrentPath();

  if (!fs.existsSync(backupPath)) {
    console.error('[merge-leads] Backup nicht gefunden:', backupPath);
    process.exit(1);
  }
  if (!fs.existsSync(currentPath)) {
    console.error('[merge-leads] Aktuelle DB nicht gefunden:', currentPath);
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
    console.error('[merge-leads] Keine gemeinsamen Spalten.');
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
        `UPDATE leads SET
          status = @status,
          archived_at = @archived_at,
          notizen = @notizen,
          reonic_status = @reonic_status,
          last_updated = datetime('now')
        WHERE id = @id`,
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
      const notizen = br.notizen != null ? br.notizen : null;
      const reonicStatus = br.reonic_status != null ? String(br.reonic_status) : '';

      for (const id of ids) {
        const cur = current.prepare(`SELECT id FROM leads WHERE id = ?`).get(id);
        if (!cur) continue;
        if (dryRun) {
          updated += 1;
        } else {
          updStmt.run({
            id,
            status,
            archived_at: archivedAt,
            notizen,
            reonic_status: reonicStatus,
          });
          updated += 1;
        }
      }
    }
  };

  if (dryRun) {
    work();
  } else {
    current.transaction(work)();
  }

  backup.close();
  current.close();

  console.log(`${updated} Leads aktualisiert, ${inserted} Leads neu hinzugefügt`);
  if (skippedInsertDup) console.log(`[merge-leads] übersprungen (UNIQUE): ${skippedInsertDup}`);
  console.log(`[merge-leads] backup=${backupPath}\ncurrent=${currentPath}\ndryRun=${dryRun}`);
}

main();
