'use strict';

require('./load-env');
const { getDb, getDbPath } = require('./database');
const { geocodeAddressCascade } = require('./geocode-address-cascade');
const { syncReonicAfterTerminVereinbart } = require('./reonic-sync');
const { getProfile } = require('./user-profile');
const { readUsers, normalizeUserRole } = require('./users');

function trimCell(v) {
  return String(v ?? '').trim().replace(/\u00a0/g, ' ');
}

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
  set('Termintyp', out['Termintyp'] || firstMatch((t) => t === 'termintyp' || t === 'termin_typ' || t.includes('termintyp')));
  set('Meet-Link', out['Meet-Link'] || firstMatch((t) => t === 'meet_link' || t === 'meetlink' || t.includes('meet-link') || (t.includes('meet') && t.includes('link'))));
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

function parseCoord(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function dbRowToApiLead(row) {
  const emailNorm = String(row.email || row.col_14 || '').trim();
  const lat = parseCoord(row.latitude);
  const lng = parseCoord(row.longitude);
  const base = {
    anfrage: row.anfrage ?? '',
    namen: row.namen ?? '',
    telefon: row.telefon ?? '',
    email: emailNorm,
    strasse: row.strasse ?? '',
    plz: row.plz ?? '',
    ort: row.ort ?? '',
    land: row.land ?? '',
    quelle: row.quelle ?? '',
    anfragezeitpunkt: row.anfragezeitpunkt ?? '',
    info: row.info ?? '',
    betreuer: row.betreuer ?? '',
    notizen: row.notizen ?? '',
    col_14: row.col_14 ?? '',
    'Anfrage NR': row.anfrage != null ? String(row.anfrage) : '',
    'Nachname + Vorname': row.namen ?? '',
    'E-Mail': emailNorm,
    Telefon: row.telefon ?? '',
    Straße: row.strasse ?? '',
    PLZ: row.plz ?? '',
    Ort: row.ort ?? '',
    Land: row.land ?? '',
    Quelle: row.quelle ?? '',
    Anfragezeitpunkt: row.anfragezeitpunkt ?? '',
    Info: row.info ?? '',
    'Betreut Durch': row.betreuer ?? '',
    Notizen: row.notizen ?? '',
    Status: row.status ?? '',
    'Nachfass bis': row.nachfass_bis ?? '',
    Termin: row.termin ?? '',
    termin_typ: row.termin_typ ?? 'vor_ort',
    meet_link: row.meet_link ?? '',
    Termintyp: row.termin_typ === 'online' ? 'online' : 'vor_ort',
    'Meet-Link': row.meet_link ?? '',
    reonic_synced: row.reonic_synced ? 1 : 0,
    last_updated: row.last_updated || '',
    created_at: row.created_at || '',
    archived_at: row.archived_at == null ? '' : String(row.archived_at),
    latitude: lat,
    longitude: lng,
    assigned_to_user_id: row.assigned_to_user_id != null && row.assigned_to_user_id !== ''
      ? Number(row.assigned_to_user_id)
      : null,
    __pvlLegacy: false,
  };
  const out = applyCanonicalFieldAliases(base);
  out.pvlDbId = row.id;
  return out;
}

function normalizeTerminTypDbValue(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (s === 'online' || s === 'onlinetermin' || s === 'google meet') return 'online';
  return 'vor_ort';
}

const PATCH_COLUMN_TO_SQL = {
  'betreut durch': 'betreuer',
  betreuer: 'betreuer',
  notizen: 'notizen',
  status: 'status',
  'nachfass bis': 'nachfass_bis',
  nachfass: 'nachfass_bis',
  termin: 'termin',
  termintyp: 'termin_typ',
  termin_typ: 'termin_typ',
  'meet-link': 'meet_link',
  'meet link': 'meet_link',
  meet_link: 'meet_link',
  'e-mail': 'email',
  email: 'email',
  telefon: 'telefon',
  'straße': 'strasse',
  strasse: 'strasse',
  plz: 'plz',
  ort: 'ort',
};

function resolvePatchColumn(columnHeader) {
  const key = trimCell(columnHeader).toLowerCase().replace(/\s+/g, ' ');
  if (PATCH_COLUMN_TO_SQL[key]) return PATCH_COLUMN_TO_SQL[key];
  const compact = key.replace(/\s+/g, '');
  if (PATCH_COLUMN_TO_SQL[compact]) return PATCH_COLUMN_TO_SQL[compact];
  const sorted = Object.entries(PATCH_COLUMN_TO_SQL).sort((a, b) => b[0].length - a[0].length);
  for (const [k, col] of sorted) {
    if (key.includes(k)) return col;
  }
  return null;
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
    const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{2}))?)?/);
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

function nextAnfrageNr(db) {
  const row = db.prepare(`
    SELECT MAX(CAST(anfrage AS INTEGER)) AS m
    FROM leads
    WHERE anfrage GLOB '[0-9]*' AND length(trim(anfrage)) <= 12
  `).get();
  const m = row && Number.isFinite(row.m) ? row.m : 0;
  return m + 1;
}

async function getAllLeads(opts = {}) {
  const includeArchived = !!(opts && opts.includeArchived);
  const db = getDb();
  const whereArchived = includeArchived
    ? ''
    : 'WHERE archived_at IS NULL OR archived_at = \'\'';
  const rows = db.prepare(`
    SELECT * FROM leads
    ${whereArchived}
    ORDER BY datetime(COALESCE(NULLIF(trim(last_updated), ''), created_at)) DESC, id DESC
  `).all();
  const leads = rows.map(dbRowToApiLead);
  return dedupeLeadsKeepNewest(leads);
}

async function leadExists(email) {
  if (!email) return false;
  const db = getDb();
  const e = String(email).trim().toLowerCase();
  const row = db.prepare(`
    SELECT 1 AS x FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    LIMIT 1
  `).get(e);
  return !!row;
}

/** True wenn diese E-Mail irgendwo in `leads` vorkommt (inkl. CRM-Archiv). Für IMAP-Dedupe / Aufräumen. */
function leadEmailExistsInDatabase(email) {
  if (!email) return false;
  const db = getDb();
  const e = String(email).trim().toLowerCase();
  if (!e) return false;
  const row = db.prepare(`
    SELECT 1 AS x FROM leads WHERE lower(trim(email)) = ? LIMIT 1
  `).get(e);
  return !!row;
}

/**
 * @param {object} lead — Felder wie vom LLM-Extractor (name, phone, email, …)
 */
function iso8601FromLeadDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return new Date().toISOString();
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
  return new Date().toISOString();
}

async function appendLead(lead) {
  const db = getDb();
  const nr = nextAnfrageNr(db);
  const email = String(lead.email || '').trim();
  const lat = parseCoord(lead.latitude);
  const lng = parseCoord(lead.longitude);
  const createdAt = iso8601FromLeadDate(lead.date);
  const stmt = db.prepare(`
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
  const info = stmt.run({
    anfrage: String(nr),
    namen: lead.name != null ? String(lead.name) : '',
    telefon: lead.phone != null ? String(lead.phone) : '',
    email,
    strasse: lead.street != null ? String(lead.street) : '',
    plz: lead.zip != null ? String(lead.zip) : '',
    ort: lead.city != null ? String(lead.city) : '',
    land: lead.country != null ? String(lead.country) : 'Österreich',
    quelle: lead.source != null ? String(lead.source) : '',
    anfragezeitpunkt: lead.date != null ? String(lead.date) : '',
    info: lead.info != null ? String(lead.info) : '',
    betreuer: '',
    notizen: '',
    col_14: email,
    created_at: createdAt,
    latitude: lat,
    longitude: lng,
  });
  const rid = Number(info.lastInsertRowid);
  const needsGeo = rid > 0 && (lat == null || lng == null || lat === 0 || lng === 0);
  if (needsGeo) {
    const r = db.prepare('SELECT strasse, plz, ort FROM leads WHERE id = ?').get(rid);
    if (r) {
      const g = await geocodeAddressCascade({
        strasse: r.strasse || '',
        plz: r.plz || '',
        ort: r.ort || '',
      });
      db.prepare('UPDATE leads SET latitude = ?, longitude = ?, last_updated = datetime(\'now\') WHERE id = ?').run(
        g.lat,
        g.lon,
        rid,
      );
    }
  }
}

async function updateLeadField(email, columnHeader, value) {
  const col = resolvePatchColumn(columnHeader);
  if (!col) return {};
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  const row = db.prepare(`
    SELECT id FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e);
  if (!row) return {};
  if (col === 'email') {
    const em = String(value ?? '').trim();
    db.prepare(`UPDATE leads SET email = ?, col_14 = ?, last_updated = datetime('now') WHERE id = ?`).run(em, em, row.id);
    return {};
  }
  let v = String(value ?? '');
  if (col === 'termin_typ') v = normalizeTerminTypDbValue(v);
  if (col === 'meet_link') v = String(value ?? '').trim();
  db.prepare(`UPDATE leads SET ${col} = ?, last_updated = datetime('now') WHERE id = ?`).run(v, row.id);
  let reonic = null;
  if (col === 'status' && String(v).trim() === 'Termin vereinbart') {
    reonic = await syncReonicAfterTerminVereinbart(row.id);
  }
  return { reonic };
}

/**
 * Mehrere CRM-/Kontaktfelder in einem Schritt (E-Mail zuletzt, damit Lookup per alter E-Mail funktioniert).
 * @param {string} currentEmail
 * @param {Record<string, string>} updates — z. B. { 'E-Mail': '…', Telefon: '…', Straße: '…', PLZ: '…', Ort: '…' }
 */
async function updateLeadFieldsBulk(currentEmail, updates) {
  if (!updates || typeof updates !== 'object') throw new Error('updates fehlt');
  const db = getDb();
  const e0 = String(currentEmail || '').trim().toLowerCase();
  const row = db.prepare(`
    SELECT id FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e0);
  if (!row) throw new Error('Lead nicht gefunden');
  const { id } = row;

  const allowedCols = new Set(Object.values(PATCH_COLUMN_TO_SQL));
  const pairs = [];
  let newEmail = null;
  let bulkStatusVal = null;
  for (const [header, rawVal] of Object.entries(updates)) {
    const col = resolvePatchColumn(header);
    if (!col || !allowedCols.has(col)) continue;
    if (col === 'email') {
      newEmail = String(rawVal ?? '').trim();
      continue;
    }
    if (col === 'status') bulkStatusVal = String(rawVal ?? '');
    pairs.push([col, String(rawVal ?? '')]);
  }
  for (const [col, val] of pairs) {
    let v = val;
    if (col === 'termin_typ') v = normalizeTerminTypDbValue(v);
    if (col === 'meet_link') v = String(v ?? '').trim();
    db.prepare(`UPDATE leads SET ${col} = ?, last_updated = datetime('now') WHERE id = ?`).run(v, id);
  }
  if (newEmail !== null) {
    db.prepare(`UPDATE leads SET email = ?, col_14 = ?, last_updated = datetime('now') WHERE id = ?`).run(newEmail, newEmail, id);
  }
  let reonic = null;
  if (String(bulkStatusVal || '').trim() === 'Termin vereinbart') {
    reonic = await syncReonicAfterTerminVereinbart(id);
  }
  return { reonic };
}

const STATUS_VALUES = new Set([
  'Neu', 'Nicht erreicht', 'Angerufen', 'Nachfassen', 'Termin vereinbart', 'Lead verloren', 'Archivieren',
]);

/**
 * Setzt CRM-Status; bei „Archivieren“ wird der Lead archiviert (wie /archive).
 */
async function setLeadStatus(email, status) {
  const s = String(status || '').trim();
  if (!STATUS_VALUES.has(s)) throw new Error('Ungültiger Status');
  if (s === 'Archivieren') {
    await archiveLead(email);
    return { archived: true };
  }
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  const row = db.prepare(`
    SELECT id FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e);
  if (!row) return { ok: false };
  db.prepare(`UPDATE leads SET status = ?, last_updated = datetime('now') WHERE id = ?`).run(s, row.id);
  let reonic = null;
  if (s === 'Termin vereinbart') {
    reonic = await syncReonicAfterTerminVereinbart(row.id);
  }
  return { ok: true, reonic };
}

async function archiveLead(email) {
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  db.prepare(`
    UPDATE leads SET archived_at = datetime('now'), last_updated = datetime('now')
    WHERE id = (
      SELECT id FROM leads
      WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
      ORDER BY id DESC
      LIMIT 1
    )
  `).run(e);
}

/** CRM-Archiv zurücknehmen: Zeile wieder aktiv, Status „Neu“. */
async function restoreArchivedLead(email) {
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new Error('E-Mail erforderlich');
  const info = db.prepare(`
    UPDATE leads SET archived_at = NULL, status = 'Neu', last_updated = datetime('now')
    WHERE id = (
      SELECT id FROM leads
      WHERE lower(trim(email)) = ?
        AND archived_at IS NOT NULL AND trim(archived_at) != ''
      ORDER BY id DESC
      LIMIT 1
    )
  `).run(e);
  if (!info.changes) return { ok: false };
  return { ok: true };
}

async function getLeadByEmail(email) {
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  const row = db.prepare(`
    SELECT * FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e);
  return row ? dbRowToApiLead(row) : null;
}

/**
 * Vertriebler-Zuweisung (SQLite `users.id`); setzt `betreuer` auf Anzeigename.
 * @param {string|null|undefined} email — Lead-E-Mail
 * @param {number|null|undefined} sqliteUserId — `users.id` oder null zum Entfernen
 */
async function setLeadAssignedToUserId(email, sqliteUserId) {
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new Error('E-Mail erforderlich');
  const row = db.prepare(`
    SELECT id FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e);
  if (!row) throw new Error('Lead nicht gefunden');

  if (sqliteUserId == null || sqliteUserId === '' || Number.isNaN(Number(sqliteUserId))) {
    db.prepare(`
      UPDATE leads SET assigned_to_user_id = NULL, last_updated = datetime('now') WHERE id = ?
    `).run(row.id);
    return { ok: true, assigned_to_user_id: null };
  }

  const idNum = parseInt(String(sqliteUserId), 10);
  if (!Number.isFinite(idNum) || idNum < 1) throw new Error('Ungültige Benutzer-Id');

  const urow = db.prepare('SELECT username FROM users WHERE id = ?').get(idNum);
  if (!urow || !urow.username) throw new Error('Benutzer nicht gefunden');

  const jsonUsers = await readUsers();
  const ju = jsonUsers.find((x) => String(x.username).toLowerCase() === String(urow.username).toLowerCase());
  if (!ju) throw new Error('Benutzer nicht in der Anmeldungsliste');
  const r = normalizeUserRole(ju.role);
  if (r !== 'sales' && r !== 'admin') {
    throw new Error('Nur Vertrieb (sales) oder Admin zuweisbar');
  }

  const prof = getProfile(urow.username) || {};
  const bet = String(prof.voller_name || '').trim() || String(urow.username).trim();

  db.prepare(`
    UPDATE leads SET assigned_to_user_id = ?, betreuer = ?, last_updated = datetime('now') WHERE id = ?
  `).run(idNum, bet, row.id);

  return { ok: true, assigned_to_user_id: idNum, betreuer: bet };
}

async function getLeadsSheetDebug() {
  const dbPath = getDbPath();
  try {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) AS c FROM leads').get().c;
    const active = db.prepare(`SELECT COUNT(*) AS c FROM leads WHERE archived_at IS NULL OR archived_at = ''`).get().c;
    const archived = db.prepare('SELECT COUNT(*) AS c FROM leads WHERE archived_at IS NOT NULL AND archived_at != \'\'').get().c;
    return {
      backend: 'sqlite',
      storage: 'sqlite',
      table: 'leads',
      /** Pfadname nur aus Kompatibilität; gleiche Daten wie `GET /api/debug/leads-db`. */
      legacyUrlNote: '/api/debug/leads-sheet bleibt erreichbar; Quelle ist immer SQLite-Tabelle `leads`.',
      dbPath,
      totalRowCount: total,
      activeRowCount: active,
      archivedRowCount: archived,
    };
  } catch (err) {
    return {
      backend: 'sqlite',
      storage: 'sqlite',
      table: 'leads',
      dbPath,
      error: err.message,
    };
  }
}

/** Aktive Leads ohne gültigen Kartenpunkt (NULL oder 0). */
function countLeadsMissingMapCoords() {
  const db = getDb();
  return db.prepare(`
    SELECT COUNT(*) AS c FROM leads
    WHERE (archived_at IS NULL OR archived_at = '')
      AND (
        latitude IS NULL OR longitude IS NULL
        OR latitude = 0 OR longitude = 0
      )
  `).get().c;
}

function getLeadsMissingMapCoordsList() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM leads
    WHERE (archived_at IS NULL OR archived_at = '')
      AND (
        latitude IS NULL OR longitude IS NULL
        OR latitude = 0 OR longitude = 0
      )
    ORDER BY datetime(COALESCE(NULLIF(trim(last_updated), ''), created_at)) DESC, id DESC
  `).all();
  return rows.map((row) => dbRowToApiLead(row));
}

/**
 * Adresse speichern + Nominatim-Kaskade (AT) + lat/lng schreiben.
 * @param {number|string} id — SQLite `leads.id`
 */
async function updateLeadAddressAndGeocodeById(id) {
  const idNum = parseInt(String(id), 10);
  if (!Number.isFinite(idNum) || idNum < 1) throw new Error('Ungültige Lead-ID');
  const db = getDb();
  const row = db.prepare(`
    SELECT id, strasse, plz, ort FROM leads
    WHERE id = ? AND (archived_at IS NULL OR archived_at = '')
  `).get(idNum);
  if (!row) throw new Error('Lead nicht gefunden');
  const g = await geocodeAddressCascade({
    strasse: row.strasse || '',
    plz: row.plz || '',
    ort: row.ort || '',
  });
  db.prepare(`
    UPDATE leads SET latitude = ?, longitude = ?, last_updated = datetime('now') WHERE id = ?
  `).run(g.lat, g.lon, idNum);
  const full = db.prepare('SELECT * FROM leads WHERE id = ?').get(idNum);
  return { lead: dbRowToApiLead(full), geocodeLabel: g.label, nominatimHit: g.nominatimHit };
}

/** Aktuelle Adresse aus DB neu geocodieren (nach Speichern im CRM-Detail). */
async function regeocodeLeadByEmail(email) {
  const db = getDb();
  const e = String(email || '').trim().toLowerCase();
  const row = db.prepare(`
    SELECT id FROM leads
    WHERE lower(trim(email)) = ? AND (archived_at IS NULL OR archived_at = '')
    ORDER BY id DESC
    LIMIT 1
  `).get(e);
  if (!row) throw new Error('Lead nicht gefunden');
  return updateLeadAddressAndGeocodeById(row.id);
}

async function updateLeadStreetPlzOrtById(id, strasse, plz, ort) {
  const idNum = parseInt(String(id), 10);
  if (!Number.isFinite(idNum) || idNum < 1) throw new Error('Ungültige Lead-ID');
  const db = getDb();
  const row = db.prepare(`
    SELECT id FROM leads WHERE id = ? AND (archived_at IS NULL OR archived_at = '')
  `).get(idNum);
  if (!row) throw new Error('Lead nicht gefunden');
  db.prepare(`
    UPDATE leads SET strasse = ?, plz = ?, ort = ?, last_updated = datetime('now') WHERE id = ?
  `).run(String(strasse ?? '').trim(), String(plz ?? '').trim(), String(ort ?? '').trim(), idNum);
}

/** Status/Archiv per DB-ID (für Leads ohne E-Mail). */
async function setLeadStatusByDbId(id, status) {
  const s = String(status || '').trim();
  if (!STATUS_VALUES.has(s)) throw new Error('Ungültiger Status');
  const idNum = parseInt(String(id), 10);
  if (!Number.isFinite(idNum) || idNum < 1) throw new Error('Ungültige Lead-ID');
  const db = getDb();
  const row = db.prepare(`SELECT id FROM leads WHERE id = ? AND (archived_at IS NULL OR archived_at = '')`).get(idNum);
  if (!row) throw new Error('Lead nicht gefunden');
  if (s === 'Archivieren') {
    db.prepare(`UPDATE leads SET archived_at = datetime('now'), last_updated = datetime('now') WHERE id = ?`).run(idNum);
    return { archived: true };
  }
  db.prepare(`UPDATE leads SET status = ?, last_updated = datetime('now') WHERE id = ?`).run(s, idNum);
  let reonic = null;
  if (s === 'Termin vereinbart') {
    reonic = await syncReonicAfterTerminVereinbart(idNum);
  }
  return { ok: true, reonic };
}

function csvEscapeCell(v) {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Alle Zeilen inkl. Archiv — für Backup/Export. */
function buildLeadsExportCsv() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, anfrage, namen, telefon, email, strasse, plz, ort, land, quelle,
      anfragezeitpunkt, info, betreuer, notizen, col_14, status, nachfass_bis, termin,
      termin_typ, meet_link, reonic_synced, assigned_to_user_id,
      archived_at, created_at, last_updated, latitude, longitude
    FROM leads
    ORDER BY id ASC
  `).all();
  const headers = [
    'id', 'anfrage', 'namen', 'telefon', 'email', 'strasse', 'plz', 'ort', 'land', 'quelle',
    'anfragezeitpunkt', 'info', 'betreuer', 'notizen', 'col_14', 'status', 'nachfass_bis', 'termin',
    'termin_typ', 'meet_link', 'reonic_synced', 'assigned_to_user_id',
    'archived_at', 'created_at', 'last_updated', 'latitude', 'longitude',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscapeCell(r[h])).join(','));
  }
  return lines.join('\r\n');
}

module.exports = {
  appendLead,
  getAllLeads,
  leadExists,
  leadEmailExistsInDatabase,
  updateLeadField,
  updateLeadFieldsBulk,
  archiveLead,
  restoreArchivedLead,
  getLeadsSheetDebug,
  setLeadStatus,
  getLeadByEmail,
  setLeadAssignedToUserId,
  countLeadsMissingMapCoords,
  getLeadsMissingMapCoordsList,
  updateLeadAddressAndGeocodeById,
  updateLeadStreetPlzOrtById,
  setLeadStatusByDbId,
  buildLeadsExportCsv,
  regeocodeLeadByEmail,
};
