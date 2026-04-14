'use strict';

/**
 * CSV → SQLite leads.db
 * Nutzung: node scripts/import-csv.js "pfad/zur/datei.csv" [--dry-run] [--skip-geocode]
 * Standard: Nominatim-Geocoding mit Fallback-Kaskade (1,5 s Pause pro API-Aufruf).
 * --skip-geocode — keine Netzwerkaufrufe (nur CSV-Koordinaten, falls vorhanden).
 */

require('../src/load-env');
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { initDb } = require('../src/database');
const { geocodeAddressCascade } = require('../src/geocode-address-cascade');

const IMPORT_ERROR_LOG = path.join(__dirname, '..', 'data', 'import_errors.log');

function appendImportErrorLog(entry) {
  fs.mkdirSync(path.dirname(IMPORT_ERROR_LOG), { recursive: true });
  const addr = `${entry.strasse || ''}|${entry.plz || ''}|${entry.ort || ''}`.replace(/\t/g, ' ');
  const line =
    `${new Date().toISOString()}\t${entry.kind}\trow=${entry.rowN}/${entry.total}\t` +
    `anfrage=${entry.anfrage || ''}\temail=${entry.email || ''}\taddr=${addr}\t${entry.detail || ''}\n`;
  fs.appendFileSync(IMPORT_ERROR_LOG, line, 'utf8');
}

function createdAtIsoFromCell(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return new Date().toISOString();
  const ymd = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymd) {
    const y = parseInt(ymd[1], 10);
    const mo = parseInt(ymd[2], 10) - 1;
    const d = parseInt(ymd[3], 10);
    if (mo >= 0 && mo < 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, mo, d, 12, 0, 0, 0)).toISOString();
    }
  }
  let ms = Date.parse(s);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{2}))?)?/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const y = parseInt(m[3], 10);
    const hh = m[4] != null ? parseInt(m[4], 10) : 12;
    const mm = m[5] != null ? parseInt(m[5], 10) : 0;
    const ss = m[6] != null ? parseInt(m[6], 10) : 0;
    ms = Date.UTC(y, mo, d, hh, mm, ss);
    if (!Number.isNaN(ms)) return new Date(ms).toISOString();
  }
  console.warn('[import] created_at nicht parsebar, nutze jetzt:', JSON.stringify(s.slice(0, 80)));
  return new Date().toISOString();
}

function parseCoord(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

function normalizeHeaders(headerRow) {
  const seen = new Map();
  return headerRow.map((h, i) => {
    let t = String(h ?? '').trim().replace(/^\uFEFF/, '');
    if (!t) t = `col_${i}`;
    else t = t.toLowerCase();
    const n = (seen.get(t) || 0) + 1;
    seen.set(t, n);
    if (n > 1) return `${t}_${n}`;
    return t;
  });
}

function rowObject(headers, cells) {
  const o = {};
  for (let i = 0; i < headers.length; i += 1) {
    o[headers[i]] = cells[i] != null ? String(cells[i]) : '';
  }
  return o;
}

function strVal(o, ...keys) {
  for (const k of keys) {
    const v = o[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

const DB_COLUMNS = [
  'anfrage', 'namen', 'telefon', 'email', 'strasse', 'plz', 'ort', 'land', 'quelle',
  'anfragezeitpunkt', 'info', 'betreuer', 'notizen', 'col_14',
];

function pickLatLng(rec) {
  const lat =
    parseCoord(rec.latitude) ??
    parseCoord(rec.lat) ??
    parseCoord(rec.breitengrad) ??
    parseCoord(rec.breite);
  const lng =
    parseCoord(rec.longitude) ??
    parseCoord(rec.lon) ??
    parseCoord(rec.lng) ??
    parseCoord(rec.längengrad) ??
    parseCoord(rec.laengengrad) ??
    parseCoord(rec.lange) ??
    parseCoord(rec.laenge);
  return { lat, lng };
}

function toInsertRow(rec, { createdAtIso, lat, lng }) {
  const row = {};
  for (const c of DB_COLUMNS) {
    if (c === 'col_14') {
      const tail = rec.col_14 != null ? String(rec.col_14).trim() : '';
      const alt = rec.col_13 != null ? String(rec.col_13).trim() : '';
      row.col_14 = tail || alt;
      continue;
    }
    row[c] = rec[c] != null ? String(rec[c]).trim() : '';
  }
  row.created_at = createdAtIso;
  row.latitude = lat != null ? lat : null;
  row.longitude = lng != null ? lng : null;
  return row;
}

async function geocodeLeadWithCascade(rec) {
  const strasse = strVal(rec, 'strasse', 'straße', 'street', 'adresse');
  const plz = strVal(rec, 'plz', 'postleitzahl');
  const ort = strVal(rec, 'ort', 'stadt', 'wohnort');
  return geocodeAddressCascade({ strasse, plz, ort });
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry-run');
  const skipGeocode = argv.includes('--skip-geocode');
  const files = argv.filter((a) => !a.startsWith('--'));
  const csvPath = files[0] || process.env.LEADS_CSV_PATH;
  if (!csvPath) {
    console.error('Usage: node scripts/import-csv.js <path-to.csv> [--dry-run] [--skip-geocode]');
    console.error('   or: LEADS_CSV_PATH=... node scripts/import-csv.js');
    process.exit(1);
  }
  const abs = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }

  const content = fs.readFileSync(abs, 'utf8');
  const rows = parse(content, {
    relax_column_count: true,
    skip_empty_lines: true,
    bom: true,
  });
  if (!rows.length) {
    console.error('CSV is empty');
    process.exit(1);
  }

  const headers = normalizeHeaders(rows[0]);
  const dataRows = rows.slice(1);

  const staged = [];
  for (let r = 0; r < dataRows.length; r += 1) {
    const rec = rowObject(headers, dataRows[r]);
    if (!Object.values(rec).some((v) => String(v).trim())) continue;
    staged.push(rec);
  }

  const total = staged.length;
  const batch = [];
  for (let i = 0; i < staged.length; i += 1) {
    const rec = staged[i];
    const n = i + 1;
    let lat;
    let lng;
    let logLine;

    const fromCsv = pickLatLng(rec);
    if (fromCsv.lat != null && fromCsv.lng != null) {
      lat = fromCsv.lat;
      lng = fromCsv.lng;
      logLine = `Lead ${n}/${total}: Koordinaten aus CSV`;
    } else if (dry || skipGeocode) {
      lat = null;
      lng = null;
      logLine = `Lead ${n}/${total}: Geocoding übersprungen — keine Koordinaten in CSV`;
      if (!dry && skipGeocode) {
        appendImportErrorLog({
          kind: 'SKIP_GEOCODE_NO_COORDS',
          rowN: n,
          total,
          anfrage: rec.anfrage,
          email: rec.email,
          strasse: strVal(rec, 'strasse', 'straße', 'street', 'adresse'),
          plz: strVal(rec, 'plz', 'postleitzahl'),
          ort: strVal(rec, 'ort', 'stadt', 'wohnort'),
          detail: logLine,
        });
      }
    } else {
      const g = await geocodeLeadWithCascade(rec);
      lat = g.lat;
      lng = g.lon;
      logLine = `Lead ${n}/${total}: ${g.label}`;
      if (!g.nominatimHit) {
        appendImportErrorLog({
          kind: 'NOMINATIM_MISS_FALLBACK',
          rowN: n,
          total,
          anfrage: rec.anfrage,
          email: rec.email,
          strasse: strVal(rec, 'strasse', 'straße', 'street', 'adresse'),
          plz: strVal(rec, 'plz', 'postleitzahl'),
          ort: strVal(rec, 'ort', 'stadt', 'wohnort'),
          detail: g.label,
        });
      }
    }
    if (!dry) console.log(logLine);

    const az = strVal(rec, 'anfragezeitpunkt', 'datum', 'anfrage datum');
    const createdAtIso = createdAtIsoFromCell(az || rec.anfragezeitpunkt);
    batch.push(toInsertRow(rec, { createdAtIso, lat, lng }));
  }

  if (skipGeocode && !dry) {
    const missing = batch.filter((row) => row.latitude == null || row.longitude == null).length;
    if (missing > 0) {
      console.warn(
        `[import] Hinweis: ${missing} Zeile(n) ohne latitude/longitude (--skip-geocode). Für die Karte ohne Nachziehen erneut importieren.`
      );
    }
  }

  if (dry) {
    console.log(
      `[dry-run] ${batch.length} non-empty rows (from ${dataRows.length} data lines), headers: ${headers.join(', ')}`
    );
    process.exit(0);
  }

  const db = initDb();
  const insert = db.prepare(`
      INSERT INTO leads (
        anfrage, namen, telefon, email, strasse, plz, ort, land, quelle,
        anfragezeitpunkt, info, betreuer, notizen, col_14, status, last_updated,
        created_at, latitude, longitude
      ) VALUES (
        @anfrage, @namen, @telefon, @email, @strasse, @plz, @ort, @land, @quelle,
        @anfragezeitpunkt, @info, @betreuer, @notizen, @col_14, 'Neu', datetime('now'),
        @created_at, @latitude, @longitude
      )
    `);
  const dupCheck = db.prepare(`
      SELECT 1 AS x FROM leads
      WHERE (length(trim(@anfrage)) > 0 AND trim(anfrage) = trim(@anfrage))
         OR (length(trim(@email)) > 0 AND lower(trim(email)) = lower(trim(@email)))
      LIMIT 1
    `);

  let inserted = 0;
  let skippedDup = 0;
  const run = db.transaction((recs) => {
    for (const rec of recs) {
      if (dupCheck.get(rec)) {
        skippedDup += 1;
        continue;
      }
      insert.run(rec);
      inserted += 1;
    }
  });
  run(batch);
  const dbPath = process.env.SQLITE_LEADS_DB || 'data/leads.db';
  const activeInDb = db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE archived_at IS NULL OR archived_at = ''
  `).get().c;
  const totalInDb = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;

  console.log(
    `Import done: ${inserted} inserted, ${skippedDup} skipped (gleiche anfrage oder E-Mail), ${batch.length} Zeilen, db: ${dbPath}`
  );
  console.log(
    `Validierung: CSV-Datenzeilen=${dataRows.length}, Import-Batch (nicht-leer)=${batch.length}, neu eingefügt=${inserted}, übersprungen (Duplikat)=${skippedDup}`
  );
  console.log(
    `SQLite: aktive Leads=${activeInDb}, alle Zeilen (inkl. Archiv)=${totalInDb} | Hinweis: CSV-Zeilen − Batch = ${dataRows.length - batch.length} (leer/ignoriert); Batch − inserted = ${batch.length - inserted} (=Duplikate, wenn keine anderen Abbrüche)`
  );
  if (!skipGeocode) {
    console.log(`Geocoding-Fälle ohne Nominatim-Treffer (Wien-Fallback o. Ä.): siehe ${path.relative(process.cwd(), IMPORT_ERROR_LOG)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
