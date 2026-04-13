'use strict';

require('./load-env');
const { google } = require('googleapis');
const path = require('path');
const { createGoogleOAuth2Client } = require('./google-client');

const TOKEN_PATH = path.join(__dirname, '../auth/google-token.json');

const SPREADSHEET_ID         = process.env.GOOGLE_SPREADSHEET_ID;
const ARCHIVE_SPREADSHEET_ID = process.env.GOOGLE_ARCHIVE_SPREADSHEET_ID;
/** Tab mit den Leads – muss exakt dem Blattnamen in Google Sheets entsprechen */
const SHEET_NAME = (process.env.GOOGLE_SHEET_NAME || process.env.GOOGLE_SHEET_TAB || 'Sheet1')
  .trim()
  .replace(/^\uFEFF/, '');
/** Optionales zweites Blatt (z. B. alte Leads) – nur Anzeige/Karte, Schreiben nur im Hauptblatt */
const LEGACY_SHEET_NAME = (process.env.GOOGLE_SHEET_LEGACY_NAME || '').trim().replace(/^\uFEFF/, '');
const ARCHIVE_TAB            = 'Cosimo';

/** A1-Notation: Blattname immer in einfachen Anführungszeichen (Google, z. B. Ziffern im Namen). */
function sheetRange(tab, a1Part) {
  const t = String(tab || '').trim().replace(/^\uFEFF/, '');
  if (!t) return `!${a1Part}`;
  const safe = t.replace(/'/g, "''");
  return `'${safe}'!${a1Part}`;
}

async function listSheetTabTitles(sheets) {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    fields: 'sheets.properties.title',
  });
  return (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
}

async function throwIfRangeParseError(sheets, sheetTitle, err) {
  const msg = String(err.message || err);
  if (!/Unable to parse range|parse range/i.test(msg)) throw err;
  let tabs = [];
  try {
    tabs = await listSheetTabTitles(sheets);
  } catch (_) {
    /* Meta-Lesen fehlgeschlagen — Originalfehler reicht */
  }
  const hint = tabs.length
    ? `Vorhandene Blätter: ${tabs.join(', ')}. In .env GOOGLE_SHEET_NAME= exakt so setzen (wie unten in Google Sheets).`
    : 'Prüfe GOOGLE_SPREADSHEET_ID und GOOGLE_SHEET_NAME in der .env.';
  throw new Error(`${msg} — Blatt "${sheetTitle}"? ${hint}`);
}

/** Datenbereich (Spalten); bei vielen CRM-Spalten ggf. erweitern */
const DATA_RANGE = sheetRange(SHEET_NAME, 'A1:ZZ');
const COL_A_RANGE = sheetRange(SHEET_NAME, 'A:A');

function trimCell(v) {
  return String(v ?? '').trim().replace(/\u00a0/g, ' ');
}

/** Erste sinnvolle Kopfzeile finden (viele Tabellen haben eine Titelzeile über den Spalten). */
function scoreHeaderRow(row) {
  if (!row || !row.length) return 0;
  let s = 0;
  for (const c of row) {
    const t = trimCell(c).toLowerCase();
    if (t === 'e-mail' || t === 'email' || t.endsWith(' e-mail')) s += 6;
    else if (t.includes('e-mail') || t === 'mail') s += 4;
    if (t.includes('nachname') || t.includes('vorname')) s += 3;
    if (t === 'namen') s += 4;
    if (t === 'plz' || t.includes('postleitzahl')) s += 2;
    if (t === 'ort' || t.includes('stadt')) s += 2;
    if (t.includes('telefon') || t === 'tel' || t.includes('handy')) s += 2;
    if (t.includes('straße') || t.includes('strasse') || t === 'strasse') s += 2;
    if (t.includes('quelle')) s += 1;
    if (t === 'anfrage') s += 2;
    if (t === 'anfragezeitpunkt' || (t.includes('anfrage') && t.includes('zeit'))) s += 3;
    else if (t.includes('anfrage') && t.includes('nr')) s += 2;
    if (t === 'betreuer') s += 1;
    if (t === 'notizen') s += 1;
    if (t === 'info') s += 1;
    if (t === 'land') s += 1;
    if (t === 'status') s += 1;
  }
  return s;
}

/** Datenzeilen enthalten oft echte E-Mails — keine Kopfzeile */
function rowLooksLikeDataNotHeader(row) {
  if (!row || !row.length) return false;
  for (const c of row) {
    const t = String(c || '').trim();
    if (!t) continue;
    if (t.includes('@') && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return true;
  }
  return false;
}

function detectBestHeaderRowIndex(values) {
  if (!values.length) return 0;
  let best = 0;
  let bestScore = -1e9;
  for (let i = 0; i < Math.min(values.length, 50); i++) {
    const row = values[i] || [];
    let sc = scoreHeaderRow(row);
    if (rowLooksLikeDataNotHeader(row)) sc -= 30;
    if (sc > bestScore) {
      bestScore = sc;
      best = i;
    }
  }
  return best;
}

/** CRM-/API-Spaltenname (lowercase) ↔ abweichende Tabellenköpfe (lowercase) */
const HEADER_SYNONYMS = {
  'e-mail': ['e-mail', 'email', 'mail', 'e mail'],
  'betreut durch': ['betreut durch', 'betreuer'],
  'nachname + vorname': ['nachname + vorname', 'namen', 'name'],
  'straße': ['straße', 'strasse'],
  'anfrage nr': ['anfrage nr', 'anfrage nr ', 'anfrage', 'anfragennr'],
  'anfragezeitpunkt': ['anfragezeitpunkt', 'datum'],
  'notizen': ['notizen'],
  'termin': ['termin'],
  'status': ['status'],
  'nachfass bis': ['nachfass bis', 'nachfass'],
  'info': ['info'],
  'quelle': ['quelle'],
  'land': ['land', 'country'],
  'plz': ['plz', 'postleitzahl'],
  'ort': ['ort', 'stadt'],
  'telefon': ['telefon', 'tel', 'handy'],
};

function findColIndex(headerCells, wantedLabel) {
  const want = trimCell(wantedLabel).toLowerCase().replace(/\s+/g, ' ');
  const cells = headerCells.map((h) => trimCell(h).toLowerCase());
  const variants = new Set([want]);
  for (const [crm, alts] of Object.entries(HEADER_SYNONYMS)) {
    if (crm === want || alts.includes(want)) {
      variants.add(crm);
      alts.forEach((a) => variants.add(a));
    }
  }
  for (const v of variants) {
    const i = cells.indexOf(v);
    if (i >= 0) return i;
  }
  if (want === 'e-mail' || want === 'email') {
    for (let i = 0; i < cells.length; i++) {
      const t = cells[i];
      if (t === 'e-mail' || t === 'email' || t === 'mail' || t === 'e mail') return i;
    }
  }
  return -1;
}

/** Bekannte Abweichungen in Spaltennamen → erwartete CRM-Schlüssel */
function applyCanonicalFieldAliases(lead) {
  const keys = Object.keys(lead);
  const normKey = (k) => trimCell(k).toLowerCase();
  const firstMatch = (pred) => {
    for (const k of keys) {
      if (pred(normKey(k))) return lead[k];
    }
    return '';
  };
  const out = { ...lead };
  const set = (canonical, val) => {
    const v = val == null ? '' : String(val).trim();
    if (v && !String(out[canonical] || '').trim()) out[canonical] = v;
  };
  set('E-Mail', out['E-Mail'] || firstMatch((t) => t === 'e-mail' || t === 'email' || t === 'mail'));
  set('Nachname + Vorname', out['Nachname + Vorname'] || firstMatch((t) => t === 'namen' || (t.includes('nachname') && t.includes('vorname')) || t === 'name' || t === 'kunde'));
  set('Telefon', out['Telefon'] || firstMatch((t) => t.includes('telefon') || t === 'tel' || t.includes('handy')));
  set('Straße', out['Straße'] || firstMatch((t) => t === 'strasse' || t.includes('straße') || t.includes('strasse') || t === 'adresse'));
  set('PLZ', out['PLZ'] || firstMatch((t) => t === 'plz' || t.includes('postleitzahl')));
  set('Ort', out['Ort'] || firstMatch((t) => t === 'ort' || t.includes('stadt')));
  set('Land', out['Land'] || firstMatch((t) => t === 'land' || t === 'country'));
  set('Quelle', out['Quelle'] || firstMatch((t) => t === 'quelle' || t.includes('quelle')));
  set('Anfragezeitpunkt', out['Anfragezeitpunkt'] || firstMatch((t) => t === 'anfragezeitpunkt' || t.includes('anfragezeit') || t === 'datum' || t.includes('datum anfrage')));
  set('Info', out['Info'] || firstMatch((t) => t === 'info' || t.includes('bemerkung')));
  set('Status', out['Status'] || firstMatch((t) => t === 'status'));
  set('Betreut Durch', out['Betreut Durch'] || firstMatch((t) => t === 'betreuer' || t.includes('betreut')));
  set('Notizen', out['Notizen'] || firstMatch((t) => t === 'notizen' || t.includes('notiz')));
  set('Nachfass bis', out['Nachfass bis'] || firstMatch((t) => t.includes('nachfass')));
  set('Termin', out['Termin'] || firstMatch((t) => t === 'termin'));
  const nr = out['Anfrage NR'] || out['Anfrage NR '] || firstMatch((t) => t === 'anfrage') || firstMatch((t) => t.replace(/\s/g, '').includes('anfrag') && t.includes('nr'));
  if (nr) {
    if (!String(out['Anfrage NR'] || '').trim()) out['Anfrage NR'] = String(nr).trim();
  }
  if (!String(out['E-Mail'] || '').trim()) {
    for (const v of Object.values(out)) {
      const s = String(v || '').trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
        out['E-Mail'] = s;
        break;
      }
    }
  }
  return out;
}

/** Tabellenkopf → FIELD_MAP-Schlüssel (für appendLead-Zeile) */
function fieldForColumnTitle(colHeader) {
  const t = trimCell(colHeader).toLowerCase().replace(/\s+/g, ' ');
  for (const [field, colName] of Object.entries(FIELD_MAP)) {
    if (trimCell(colName).toLowerCase() === t) return field;
  }
  if (t === 'email' || t === 'e-mail' || t === 'mail' || t === 'e mail') return 'email';
  if (t.includes('nachname') && t.includes('vorname')) return 'name';
  if (t === 'namen' || t === 'name' || t === 'kunde') return 'name';
  if (t.includes('telefon') || t === 'tel' || t.includes('handy')) return 'phone';
  if (t.includes('straße') || t.includes('strasse') || t === 'strasse') return 'street';
  if (t === 'plz' || t.includes('postleitzahl')) return 'zip';
  if (t === 'ort' || t.includes('stadt')) return 'city';
  if (t === 'land' || t === 'country') return 'country';
  if (t.includes('quelle') || t === 'quelle') return 'source';
  if (t === 'anfragezeitpunkt' || t.includes('anfragezeit') || t === 'datum' || t.includes('datum anfrage')) return 'date';
  if (t === 'info' || t.includes('bemerkung')) return 'info';
  return null;
}

function matrixToLeadObjects(values) {
  if (!values.length) return [];
  const hi = detectBestHeaderRowIndex(values);
  const header = (values[hi] || []).map((c) => trimCell(c));
  const dataRows = values.slice(hi + 1);
  const sample = dataRows.slice(0, Math.min(dataRows.length, 300));
  const width = Math.max(
    header.length,
    sample.reduce((m, r) => Math.max(m, (r || []).length), 0),
    1
  );
  const out = [];
  for (const row of dataRows) {
    const obj = {};
    for (let i = 0; i < width; i++) {
      const label = i < header.length ? header[i] : '';
      const val = row && i < row.length && row[i] != null ? String(row[i]) : '';
      const key = label || `_c${i}`;
      obj[key] = val;
    }
    const lead = applyCanonicalFieldAliases(obj);
    if (Object.values(lead).some((v) => String(v).trim())) out.push(lead);
  }
  return out;
}

function splitMatrixRawRows(values) {
  if (!values.length) return { headerRowIndex: 0, header: [], dataRows: [] };
  const hi = detectBestHeaderRowIndex(values);
  const header = (values[hi] || []).map((c) => trimCell(c));
  const dataRows = values.slice(hi + 1);
  return { headerRowIndex: hi, header, dataRows };
}

// Maps lead object fields → exact sheet column headers
const FIELD_MAP = {
  name:    'Nachname + Vorname',
  phone:   'Telefon',
  email:   'E-Mail',
  street:  'Straße',
  zip:     'PLZ',
  city:    'Ort',
  country: 'Land',
  source:  'Quelle',
  date:    'Anfragezeitpunkt',
  info:    'Info',
};

let _auth = null;

async function getAuth() {
  if (_auth) return _auth;
  const oAuth2Client = createGoogleOAuth2Client();
  try {
    const token = require(TOKEN_PATH);
    oAuth2Client.setCredentials(token);
  } catch {
    throw new Error('Google token not found. Run the OAuth flow first to generate auth/google-token.json');
  }
  _auth = oAuth2Client;
  return _auth;
}

async function getSheets() {
  const auth = await getAuth();
  return google.sheets({ version: 'v4', auth });
}

/** 0-basierter Spaltenindex → A, B, …, Z, AA, … */
function columnIndexToLetter(index) {
  let result = '';
  let i = index;
  while (i >= 0) {
    result = String.fromCharCode((i % 26) + 65) + result;
    i = Math.floor(i / 26) - 1;
  }
  return result;
}

async function getHeader(sheets) {
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });
  } catch (e) {
    await throwIfRangeParseError(sheets, SHEET_NAME, e);
  }
  const values = res.data.values || [];
  const { header } = splitMatrixRawRows(values);
  return header;
}

async function fetchLeadsForTab(sheetTitle) {
  const sheets = await getSheets();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: sheetRange(sheetTitle, 'A1:ZZ'),
    });
  } catch (e) {
    await throwIfRangeParseError(sheets, sheetTitle, e);
  }
  return matrixToLeadObjects(res.data.values || []);
}

async function appendLead(lead) {
  const sheets = await getSheets();
  const header = await getHeader(sheets);

  let countRes;
  try {
    countRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: COL_A_RANGE,
    });
  } catch (e) {
    await throwIfRangeParseError(sheets, SHEET_NAME, e);
  }
  const nextNr = Math.max(0, (countRes.data.values?.length || 1) - 1) + 1;

  const row = header.map((colHeader) => {
    const ch = trimCell(colHeader);
    const chLow = ch.toLowerCase();
    if (chLow === 'anfrage' || /^anfrage\s*nr$/i.test(ch.replace(/\s/g, ' ')) || ch.replace(/\s/g, '').toLowerCase() === 'anfragennr') {
      return String(nextNr);
    }
    const field = fieldForColumnTitle(ch);
    if (!field) return '';
    const val = lead[field];
    return val === null || val === undefined ? '' : String(val);
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(SHEET_NAME, 'A1'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

/** Gleicher Lead (E-Mail, sonst Name+Tel+PLZ) nur einmal; bei mehreren Zeilen gewinnt der neueste Eintrag. */
function dedupeLeadsKeepNewest(leads) {
  function dedupeKey(lead, rowIdx) {
    const e = String(lead['E-Mail'] || '').trim().toLowerCase();
    if (e) return `e:${e}`;
    const n = String(lead['Nachname + Vorname'] || '').trim().toLowerCase();
    const tel = String(lead['Telefon'] || '').replace(/\D/g, '');
    const plz = String(lead['PLZ'] || '').trim();
    if (n || tel || plz) return `x:${n}|${tel}|${plz}`;
    return `__row:${rowIdx}`;
  }

  function parseAnfragezeitpunktMs(lead) {
    const raw = String(lead['Anfragezeitpunkt'] || '').trim();
    if (!raw) return 0;
    let ms = Date.parse(raw);
    if (!Number.isNaN(ms)) return ms;
    const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
    if (m) {
      const d = parseInt(m[1], 10);
      const mo = parseInt(m[2], 10) - 1;
      const y = parseInt(m[3], 10);
      const hh = m[4] != null ? parseInt(m[4], 10) : 12;
      const mm = m[5] != null ? parseInt(m[5], 10) : 0;
      const ss = m[6] != null ? parseInt(m[6], 10) : 0;
      return Date.UTC(y, mo, d, hh, mm, ss);
    }
    return 0;
  }

  function requestNr(lead) {
    const raw = String(lead['Anfrage NR'] ?? lead['Anfrage NR '] ?? lead.anfrage ?? '').replace(/\D/g, '');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  }

  const best = new Map();
  for (let i = 0; i < leads.length; i += 1) {
    const lead = leads[i];
    const k = dedupeKey(lead, i);
    const t = parseAnfragezeitpunktMs(lead);
    const nr = requestNr(lead);
    const cur = best.get(k);
    if (!cur) {
      best.set(k, { lead, t, nr, i });
      continue;
    }
    if (t > cur.t) {
      best.set(k, { lead, t, nr, i });
      continue;
    }
    if (t < cur.t) continue;
    // gleicher Zeitstempel
    if (t === 0 && cur.t === 0) {
      if (nr > cur.nr || (nr === cur.nr && i > cur.i)) best.set(k, { lead, t, nr, i });
      continue;
    }
    if (i > cur.i) best.set(k, { lead, t, nr, i });
  }

  return Array.from(best.values())
    .sort((a, b) => (b.t - a.t) || (b.nr - a.nr) || (b.i - a.i))
    .map((x) => x.lead);
}

async function getAllLeads() {
  if (!SPREADSHEET_ID) {
    throw new Error('GOOGLE_SPREADSHEET_ID fehlt in der Konfiguration');
  }
  const primaryRows = await fetchLeadsForTab(SHEET_NAME);
  const primary = primaryRows.map((o) => ({ ...o, __pvlLegacy: false }));

  const leg = LEGACY_SHEET_NAME;
  if (!leg || leg === SHEET_NAME) return dedupeLeadsKeepNewest(primary);

  const legacyRows = await fetchLeadsForTab(leg);
  const primaryEmails = new Set(
    primary.map((l) => String(l['E-Mail'] || '').toLowerCase()).filter(Boolean)
  );
  const legacy = legacyRows
    .filter((l) => {
      const e = String(l['E-Mail'] || '').toLowerCase();
      return !e || !primaryEmails.has(e);
    })
    .map((o) => ({ ...o, __pvlLegacy: true }));

  return dedupeLeadsKeepNewest([...primary, ...legacy]);
}

async function leadExists(email) {
  if (!email) return false;
  const rows = await fetchLeadsForTab(SHEET_NAME);
  return rows.some((l) => l['E-Mail']?.toLowerCase() === email.toLowerCase());
}

// Update a single cell by column header (e.g. 'Betreut Durch', 'Notizen')
async function updateLeadField(email, columnHeader, value) {
  const sheets = await getSheets();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });
  } catch (e) {
    await throwIfRangeParseError(sheets, SHEET_NAME, e);
  }
  const { headerRowIndex, header, dataRows: rows } = splitMatrixRawRows(res.data.values || []);
  if (!header.length) return;

  const emailColIdx  = findColIndex(header, 'E-Mail');
  const targetColIdx = findColIndex(header, columnHeader);
  if (emailColIdx < 0 || targetColIdx < 0) return;

  const rowIndex = rows.findIndex(
    (r) => String(r[emailColIdx] || '').trim().toLowerCase() === email.toLowerCase()
  );
  if (rowIndex < 0) return;

  const sheetRow = headerRowIndex + rowIndex + 2;
  const colLetter = columnIndexToLetter(targetColIdx);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: sheetRange(SHEET_NAME, `${colLetter}${sheetRow}`),
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

// Copy lead row to archive spreadsheet "Cosimo" tab, then delete from Leads
async function archiveLead(email) {
  const sheets = await getSheets();
  let res;
  try {
    res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: DATA_RANGE,
    });
  } catch (e) {
    await throwIfRangeParseError(sheets, SHEET_NAME, e);
  }
  const { headerRowIndex, header, dataRows: rows } = splitMatrixRawRows(res.data.values || []);
  if (!header.length) return;

  const emailColIdx = findColIndex(header, 'E-Mail');
  if (emailColIdx < 0) return;
  const rowIndex = rows.findIndex(
    (r) => String(r[emailColIdx] || '').trim().toLowerCase() === email.toLowerCase()
  );
  if (rowIndex < 0) return;

  const rowData = rows[rowIndex];

  // Ensure archive tab exists with header
  await ensureArchiveTab(sheets, header);

  // Append to archive
  await sheets.spreadsheets.values.append({
    spreadsheetId: ARCHIVE_SPREADSHEET_ID,
    range: sheetRange(ARCHIVE_TAB, 'A1'),
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowData] },
  });

  // Delete row from Leads sheet
  const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const leadsSheet = sheetInfo.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!leadsSheet) return;
  const sheetId = leadsSheet.properties.sheetId;

  const delStart = headerRowIndex + 1 + rowIndex;
  const delEnd = delStart + 1;
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: delStart,
            endIndex:   delEnd,
          },
        },
      }],
    },
  });
}

async function ensureArchiveTab(sheets, header) {
  const info = await sheets.spreadsheets.get({ spreadsheetId: ARCHIVE_SPREADSHEET_ID });
  const exists = info.data.sheets.some((s) => s.properties.title === ARCHIVE_TAB);
  if (exists) return;

  // Create tab
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: ARCHIVE_SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: ARCHIVE_TAB } } }] },
  });

  // Write header row
  await sheets.spreadsheets.values.update({
    spreadsheetId: ARCHIVE_SPREADSHEET_ID,
    range: sheetRange(ARCHIVE_TAB, 'A1'),
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  });
}

async function getLeadsSheetDebug() {
  const base = {
    sheetTab: SHEET_NAME,
    legacySheetTab: LEGACY_SHEET_NAME || null,
    spreadsheetConfigured: !!SPREADSHEET_ID,
    /** Konfigurierte Lead-Tabelle (ID = Segment aus docs.google.com/spreadsheets/d/…/edit) */
    spreadsheetId: SPREADSHEET_ID || null,
  };
  try {
    if (!SPREADSHEET_ID) return { ...base, primaryRowCount: 0, legacyRowCount: 0, mergedCount: 0 };
    const p = await fetchLeadsForTab(SHEET_NAME);
    let legacyC = 0;
    if (LEGACY_SHEET_NAME && LEGACY_SHEET_NAME !== SHEET_NAME) {
      legacyC = (await fetchLeadsForTab(LEGACY_SHEET_NAME)).length;
    }
    const merged = await getAllLeads();
    const sh = await getSheets();
    let r;
    try {
      r = await sh.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: sheetRange(SHEET_NAME, 'A1:ZZ'),
      });
    } catch (e) {
      await throwIfRangeParseError(sh, SHEET_NAME, e);
    }
    const raw = splitMatrixRawRows(r.data.values || []);
    const meta = await sh.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: 'sheets.properties.title',
    });
    const sheetTabs = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
    return {
      ...base,
      sheetTabs,
      sheetTabMatches: sheetTabs.includes(SHEET_NAME),
      headerRowIndex: raw.headerRowIndex,
      rawRowCount: (raw.dataRows || []).length,
      primaryRowCount: p.length,
      legacyRowCount: legacyC,
      mergedCount: merged.length,
    };
  } catch (e) {
    return { ...base, error: e.message };
  }
}

module.exports = {
  appendLead, getAllLeads, leadExists, updateLeadField, archiveLead, getLeadsSheetDebug,
};
