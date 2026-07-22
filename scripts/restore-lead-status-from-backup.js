#!/usr/bin/env node
'use strict';

/**
 * PV Lead Manager — Status & Archivierung aus Backup zurückspielen
 *
 * ## Schema (leads) — aktuell & typisches Backup
 * Es gibt **keine** Spalten `is_archived`, `archived` oder `stage`.
 * Relevant für „abgearbeitet / archiviert“:
 * - `status` (TEXT, z. B. Neu, Termin vereinbart, Lead verloren, Archivieren)
 * - `archived_at` (TEXT, gesetzt wenn CRM-Archiv)
 *
 * ## Abgleich (pro Zeile im Backup)
 * 1. gleiche `id` in Ziel-DB
 * 2. sonst Adresse: normalisierte strasse + plz + ort
 * 3. sonst `anfrage` (trim)
 * 4. sonst E-Mail (lower trim)
 *
 * ## Schreiben
 * Überschreibt in der aktiven DB: `status`, `archived_at` (aus dem Backup).
 *
 *   node scripts/restore-lead-status-from-backup.js [backup.db] [--dry-run] [--verify-only]
 *
 * Standard-Backup: data/leads.db.pre-restore-20260417100439
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

function printSchema(db, label) {
  const rows = db.prepare(`PRAGMA table_info(leads)`).all();
  console.log(`\n--- ${label}: leads (${rows.length} Spalten) ---`);
  const statusLike = rows.filter((r) =>
    /status|archiv|stage|is_/i.test(String(r.name)),
  );
  for (const r of rows) {
    console.log(`  ${r.cid}|${r.name}|${r.type}|dflt=${r.dflt_value}`);
  }
  console.log('Status-relevante Spalten (Filter):', statusLike.map((x) => x.name).join(', ') || '(kein Namens-Treffer außer status/archived_at)');
}

function isDoneishBackupRow(br) {
  const a = br.archived_at != null && String(br.archived_at).trim() !== '';
  const st = String(br.status || '').trim().toLowerCase();
  const doneStatus =
    st === 'termin vereinbart' ||
    st === 'lead verloren' ||
    st === 'archivieren' ||
    st === 'termin' ||
    st === 'verloren';
  return a || doneStatus;
}

function verifyAfter(current, backup) {
  const backupRows = backup.prepare(`SELECT * FROM leads`).all();
  const interesting = backupRows.filter(isDoneishBackupRow);
  let ok = 0;
  let missing = 0;
  let mismatch = 0;
  const samples = [];
  for (const br of interesting) {
    const ids = leadMatchIds(current, br);
    if (!ids.length) {
      missing += 1;
      if (samples.length < 5) samples.push({ issue: 'no_match', backupId: br.id, email: br.email });
      continue;
    }
    for (const id of ids) {
      const cur = current.prepare(`SELECT id, status, archived_at FROM leads WHERE id = ?`).get(id);
      if (!cur) {
        missing += 1;
        continue;
      }
      const same =
        String(cur.status || '') === String(br.status || '') &&
        String(cur.archived_at || '') === String(br.archived_at || '');
      if (same) ok += 1;
      else {
        mismatch += 1;
        if (samples.length < 5) {
          samples.push({
            issue: 'field_mismatch',
            id: cur.id,
            backup: { status: br.status, archived_at: br.archived_at },
            current: { status: cur.status, archived_at: cur.archived_at },
          });
        }
      }
    }
  }
  return { interesting: interesting.length, ok, missing, mismatch, samples };
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const verifyOnly = argv.includes('--verify-only');
  const pathArg = argv.find((a) => !a.startsWith('--'));
  const backupPath = pathArg
    ? path.isAbsolute(pathArg)
      ? pathArg
      : path.resolve(PROJECT_ROOT, pathArg)
    : path.join(PROJECT_ROOT, 'data', 'leads.db.pre-restore-20260417100439');
  const currentPath = defaultCurrentPath();

  if (!fs.existsSync(backupPath)) {
    console.error('[restore-status] Backup nicht gefunden:', backupPath);
    process.exit(1);
  }
  if (!fs.existsSync(currentPath)) {
    console.error('[restore-status] Aktuelle DB nicht gefunden:', currentPath);
    process.exit(1);
  }

  const current = new Database(currentPath);
  current.pragma('journal_mode = WAL');
  current.pragma('foreign_keys = ON');
  const backup = new Database(backupPath, { readonly: true });
  backup.pragma('foreign_keys = ON');

  printSchema(backup, `Backup ${path.basename(backupPath)}`);
  printSchema(current, `Aktiv ${path.basename(currentPath)}`);

  if (verifyOnly) {
    const v = verifyAfter(current, backup);
    console.log('\n[verify-only] Abgleich „abgearbeitet/archiviert“ (nach Backup-Definition):');
    console.log(`  Backup-Zeilen (mit Archiv oder Abschluss-Status): ${v.interesting}`);
    console.log(`  Übereinstimmend (status+archived_at): ${v.ok}`);
    console.log(`  Kein Treffer in aktiver DB: ${v.missing}`);
    console.log(`  Abweichende Felder: ${v.mismatch}`);
    if (v.samples.length) console.log('  Beispiele:', JSON.stringify(v.samples, null, 2));
    backup.close();
    current.close();
    return;
  }

  const upd = dryRun
    ? null
    : current.prepare(
        `UPDATE leads SET status = @status, archived_at = @archived_at, last_updated = datetime('now') WHERE id = @id`,
      );

  const backupRows = backup.prepare(`SELECT * FROM leads`).all();
  let updated = 0;

  const work = () => {
    for (const br of backupRows) {
      const ids = leadMatchIds(current, br);
      if (!ids.length) continue;
      const status = br.status != null ? String(br.status) : 'Neu';
      const archivedAt = br.archived_at != null ? br.archived_at : null;
      for (const id of ids) {
        if (dryRun) {
          updated += 1;
        } else {
          upd.run({ id, status, archived_at: archivedAt });
          updated += 1;
        }
      }
    }
  };

  if (dryRun) work();
  else current.transaction(work)();

  console.log(`\n[restore-status] ${updated} Lead-Zeilen in der aktiven DB mit Status/Archiv aus Backup überschrieben (Treffer × Updates). dryRun=${dryRun}`);

  const v = verifyAfter(current, backup);
  console.log('\n[verify] Abgearbeitet/Archiv (Backup vs. aktiv nach Lauf):');
  console.log(`  geprüft (interessante Backup-Zeilen): ${v.interesting}`);
  console.log(`  OK: ${v.ok}`);
  console.log(`  kein Match: ${v.missing}`);
  console.log(`  Feld-Differenz: ${v.mismatch}`);
  if (v.samples.length) console.log('  Beispiele:', JSON.stringify(v.samples, null, 2));

  backup.close();
  current.close();
}

main();
