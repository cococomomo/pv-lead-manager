'use strict';

require('dotenv').config();
const { google } = require('googleapis');
const path = require('path');

const CREDENTIALS_PATH = path.join(__dirname, '../auth/google-credentials.json');
const TOKEN_PATH = path.join(__dirname, '../auth/google-token.json');

const SPREADSHEET_ID         = process.env.GOOGLE_SPREADSHEET_ID;
const ARCHIVE_SPREADSHEET_ID = process.env.GOOGLE_ARCHIVE_SPREADSHEET_ID;
/** Tab mit den Leads – muss exakt dem Blattnamen in Google Sheets entsprechen */
const SHEET_NAME = (process.env.GOOGLE_SHEET_NAME || process.env.GOOGLE_SHEET_TAB || 'Tabellenblatt2').trim();
/** Optionales zweites Blatt (z. B. alte Leads) – nur Anzeige/Karte, Schreiben nur im Hauptblatt */
const LEGACY_SHEET_NAME = (process.env.GOOGLE_SHEET_LEGACY_NAME || '').trim();
const ARCHIVE_TAB            = 'Cosimo';
/** Datenbereich (Spalten); bei vielen CRM-Spalten ggf. erweitern */
const DATA_RANGE = `${SHEET_NAME}!A1:ZZ`;
const HEADER_RANGE = `${SHEET_NAME}!A1:ZZ1`;
const COL_A_RANGE = `${SHEET_NAME}!A:A`;

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
  const credentials = require(CREDENTIALS_PATH);
  const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
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
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: HEADER_RANGE,
  });
  return res.data.values?.[0] || [];
}

async function fetchLeadsForTab(sheetTitle) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetTitle}!A1:ZZ`,
  });
  const [header, ...rows] = res.data.values || [];
  if (!header) return [];
  return rows.map((row) => {
    const obj = {};
    header.forEach((col, i) => { obj[col] = row[i] || ''; });
    return obj;
  });
}

async function appendLead(lead) {
  const sheets = await getSheets();
  const header = await getHeader(sheets);

  const countRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: COL_A_RANGE,
  });
  const nextNr = Math.max(0, (countRes.data.values?.length || 1) - 1) + 1;

  const headerToField = Object.fromEntries(
    Object.entries(FIELD_MAP).map(([field, col]) => [col, field])
  );

  const row = header.map((colHeader) => {
    if (colHeader.trim() === 'Anfrage NR') return String(nextNr);
    const field = headerToField[colHeader];
    if (!field) return '';
    const val = lead[field];
    return val === null || val === undefined ? '' : String(val);
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });
}

async function getAllLeads() {
  if (!SPREADSHEET_ID) {
    throw new Error('GOOGLE_SPREADSHEET_ID fehlt in der Konfiguration');
  }
  const primaryRows = await fetchLeadsForTab(SHEET_NAME);
  const primary = primaryRows.map((o) => ({ ...o, __pvlLegacy: false }));

  const leg = LEGACY_SHEET_NAME;
  if (!leg || leg === SHEET_NAME) return primary;

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

  return [...primary, ...legacy];
}

async function leadExists(email) {
  if (!email) return false;
  const rows = await fetchLeadsForTab(SHEET_NAME);
  return rows.some((l) => l['E-Mail']?.toLowerCase() === email.toLowerCase());
}

// Update a single cell by column header (e.g. 'Betreut Durch', 'Notizen')
async function updateLeadField(email, columnHeader, value) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: DATA_RANGE,
  });
  const [header, ...rows] = res.data.values || [];
  if (!header) return;

  const emailColIdx  = header.indexOf('E-Mail');
  const targetColIdx = header.indexOf(columnHeader);
  if (emailColIdx < 0 || targetColIdx < 0) return;

  const rowIndex = rows.findIndex(
    (r) => r[emailColIdx]?.toLowerCase() === email.toLowerCase()
  );
  if (rowIndex < 0) return;

  const sheetRow  = rowIndex + 2; // +1 header, +1 for 1-based
  const colLetter = columnIndexToLetter(targetColIdx);

  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!${colLetter}${sheetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

// Copy lead row to archive spreadsheet "Cosimo" tab, then delete from Leads
async function archiveLead(email) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: DATA_RANGE,
  });
  const [header, ...rows] = res.data.values || [];
  if (!header) return;

  const emailColIdx = header.indexOf('E-Mail');
  const rowIndex = rows.findIndex(
    (r) => r[emailColIdx]?.toLowerCase() === email.toLowerCase()
  );
  if (rowIndex < 0) return;

  const rowData = rows[rowIndex];

  // Ensure archive tab exists with header
  await ensureArchiveTab(sheets, header);

  // Append to archive
  await sheets.spreadsheets.values.append({
    spreadsheetId: ARCHIVE_SPREADSHEET_ID,
    range: `${ARCHIVE_TAB}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowData] },
  });

  // Delete row from Leads sheet
  const sheetInfo = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const leadsSheet = sheetInfo.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  const sheetId = leadsSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [{
        deleteDimension: {
          range: {
            sheetId,
            dimension: 'ROWS',
            startIndex: rowIndex + 1, // +1 for header (0-indexed)
            endIndex:   rowIndex + 2,
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
    range: `${ARCHIVE_TAB}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [header] },
  });
}

async function getLeadsSheetDebug() {
  const base = {
    sheetTab: SHEET_NAME,
    legacySheetTab: LEGACY_SHEET_NAME || null,
    spreadsheetConfigured: !!SPREADSHEET_ID,
  };
  try {
    if (!SPREADSHEET_ID) return { ...base, primaryRowCount: 0, legacyRowCount: 0, mergedCount: 0 };
    const p = await fetchLeadsForTab(SHEET_NAME);
    let legacyC = 0;
    if (LEGACY_SHEET_NAME && LEGACY_SHEET_NAME !== SHEET_NAME) {
      legacyC = (await fetchLeadsForTab(LEGACY_SHEET_NAME)).length;
    }
    const merged = await getAllLeads();
    return {
      ...base,
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
