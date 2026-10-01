'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, getProjectRoot } = require('../database');
const { appendLead } = require('../sheets');
const { resolveCustomerNames } = require('./names');

const LAYOUTS_DIR = path.join(getProjectRoot(), 'data', 'layouts');
const OFFERS_DIR = path.join(getProjectRoot(), 'data', 'offers');

function ensureDirs() {
  fs.mkdirSync(LAYOUTS_DIR, { recursive: true });
  fs.mkdirSync(OFFERS_DIR, { recursive: true });
}

function rowLayout(r) {
  if (!r) return null;
  let plan = {};
  try { plan = JSON.parse(r.plan_json || '{}'); } catch (_) { plan = {}; }
  return {
    id: r.id,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    customerEmail: r.customer_email || '',
    title: r.title || '',
    addressText: r.address_text || '',
    lat: r.lat != null ? Number(r.lat) : null,
    lng: r.lng != null ? Number(r.lng) : null,
    basemapProvider: r.basemap_provider || 'basemap_at',
    plan,
    snapshotPath: r.snapshot_path || '',
    snapshotUrl: r.snapshot_path ? `/api/layouts/${r.id}/snapshot-file` : null,
    moduleCount: Number(r.module_count) || 0,
    moduleWp: Number(r.module_wp) || 455,
    moduleType: (plan.meta && plan.meta.moduleType) || null,
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowOffer(r) {
  if (!r) return null;
  let config = {};
  let variants = [];
  try { config = JSON.parse(r.config_json || '{}'); } catch (_) { config = {}; }
  try { variants = JSON.parse(r.variants_json || '[]'); } catch (_) { variants = []; }
  let customer = {};
  try { customer = JSON.parse(r.customer_json || '{}'); } catch (_) { customer = {}; }
  if (!customer || typeof customer !== 'object') customer = {};
  const customerVersion = Math.max(1, Number(r.customer_version) || 1);
  const filenameBase = r.filename_base || '';
  return {
    id: r.id,
    leadId: r.lead_id != null ? Number(r.lead_id) : null,
    customerEmail: r.customer_email || '',
    angebotsnummer: r.angebotsnummer || '',
    customerVersion,
    filenameBase,
    label: filenameBase || `${r.angebotsnummer || ('#' + r.id)}-V${customerVersion}`,
    status: r.status || 'draft',
    config,
    variants,
    emailSubject: r.email_subject || '',
    emailBody: r.email_body || '',
    customer,
    layoutPlanId: r.layout_plan_id != null ? Number(r.layout_plan_id) : null,
    pdfPath: r.pdf_path || '',
    pdfUrl: r.pdf_path ? `/api/offer/versions/${r.id}/pdf-file` : null,
    createdBy: r.created_by || '',
    createdAt: r.created_at,
    sentAt: r.sent_at || null,
  };
}

/** Nächste Kunden-Version Vn für Lead bzw. E-Mail (max + 1). */
function peekNextCustomerVersion(leadId, email) {
  const db = getDb();
  const id = Number(leadId);
  let row = null;
  if (Number.isFinite(id)) {
    row = db.prepare(
      `SELECT MAX(customer_version) AS mx FROM offer_versions WHERE lead_id = ?`
    ).get(id);
  }
  if ((!row || row.mx == null) && email) {
    const e = String(email || '').trim().toLowerCase();
    if (e) {
      row = db.prepare(
        `SELECT MAX(customer_version) AS mx FROM offer_versions WHERE lower(trim(customer_email)) = ?`
      ).get(e);
    }
  }
  const mx = row && row.mx != null ? Number(row.mx) : 0;
  return Math.max(1, (Number.isFinite(mx) ? mx : 0) + 1);
}

function findLeadIdByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return null;
  const db = getDb();
  const row = db.prepare(
    `SELECT id FROM leads WHERE lower(trim(email)) = ? ORDER BY id DESC LIMIT 1`
  ).get(e);
  return row ? Number(row.id) : null;
}

function listLayoutsForLead(leadId) {
  const db = getDb();
  const id = Number(leadId);
  if (!Number.isFinite(id)) return [];
  return db.prepare(
    `SELECT * FROM layout_plans WHERE lead_id = ? ORDER BY updated_at DESC, id DESC`
  ).all(id).map(rowLayout);
}

function listLayoutsForEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return [];
  const db = getDb();
  return db.prepare(
    `SELECT * FROM layout_plans WHERE lower(trim(customer_email)) = ? ORDER BY updated_at DESC, id DESC`
  ).all(e).map(rowLayout);
}

function getLayout(id) {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM layout_plans WHERE id = ?`).get(Number(id));
  return rowLayout(row);
}

function createLayout(input, createdBy = '') {
  ensureDirs();
  const db = getDb();
  const email = String(input.customerEmail || '').trim().toLowerCase();
  let leadId = input.leadId != null ? Number(input.leadId) : null;
  if (!Number.isFinite(leadId)) leadId = findLeadIdByEmail(email);
  const planJson = JSON.stringify(input.plan && typeof input.plan === 'object' ? input.plan : {});
  const info = db.prepare(`
    INSERT INTO layout_plans (
      lead_id, customer_email, title, address_text, lat, lng, basemap_provider,
      plan_json, snapshot_path, module_count, module_wp, created_by, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  `).run(
    leadId,
    email,
    String(input.title || '').trim() || 'Belegungsplan',
    String(input.addressText || '').trim(),
    input.lat != null ? Number(input.lat) : null,
    input.lng != null ? Number(input.lng) : null,
    String(input.basemapProvider || 'basemap_at'),
    planJson,
    '',
    Number(input.moduleCount) || 0,
    Number(input.moduleWp) || 455,
    String(createdBy || '').trim(),
  );
  return getLayout(info.lastInsertRowid);
}

function updateLayout(id, input) {
  const db = getDb();
  const cur = getLayout(id);
  if (!cur) return null;
  const planJson = input.plan != null
    ? JSON.stringify(input.plan && typeof input.plan === 'object' ? input.plan : {})
    : JSON.stringify(cur.plan || {});
  const email = input.customerEmail != null
    ? String(input.customerEmail).trim().toLowerCase()
    : cur.customerEmail;
  let leadId = input.leadId !== undefined
    ? (input.leadId != null ? Number(input.leadId) : null)
    : cur.leadId;
  if (leadId == null && email) leadId = findLeadIdByEmail(email);

  db.prepare(`
    UPDATE layout_plans SET
      lead_id = ?,
      customer_email = ?,
      title = ?,
      address_text = ?,
      lat = ?,
      lng = ?,
      basemap_provider = ?,
      plan_json = ?,
      module_count = ?,
      module_wp = ?,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(
    leadId,
    email,
    input.title != null ? String(input.title).trim() : cur.title,
    input.addressText != null ? String(input.addressText).trim() : cur.addressText,
    input.lat !== undefined ? (input.lat != null ? Number(input.lat) : null) : cur.lat,
    input.lng !== undefined ? (input.lng != null ? Number(input.lng) : null) : cur.lng,
    input.basemapProvider != null ? String(input.basemapProvider) : cur.basemapProvider,
    planJson,
    input.moduleCount != null ? Number(input.moduleCount) : cur.moduleCount,
    input.moduleWp != null ? Number(input.moduleWp) : cur.moduleWp,
    Number(id),
  );
  return getLayout(id);
}

function deleteLayout(id) {
  const cur = getLayout(id);
  if (!cur) return false;
  const db = getDb();
  if (cur.snapshotPath) {
    const abs = path.isAbsolute(cur.snapshotPath)
      ? cur.snapshotPath
      : path.join(getProjectRoot(), cur.snapshotPath);
    try { fs.unlinkSync(abs); } catch (_) { /* ignore */ }
  }
  db.prepare(`DELETE FROM layout_plans WHERE id = ?`).run(Number(id));
  return true;
}

/**
 * Speichert den Belegungsplan (JPEG vom Orthofoto oder PNG vom Client).
 * @returns {{ snapshotPath, snapshotUrl }}
 */
function saveLayoutSnapshot(id, data) {
  ensureDirs();
  const cur = getLayout(id);
  if (!cur) throw new Error('Layout nicht gefunden');
  let buf;
  if (Buffer.isBuffer(data)) {
    buf = data;
  } else {
    const s = String(data || '');
    const m = s.match(/^data:image\/\w+;base64,(.+)$/);
    buf = Buffer.from(m ? m[1] : s, 'base64');
  }
  if (!buf || buf.length < 32) throw new Error('Ungültiges Snapshot-Bild');
  const ext = (buf[0] === 0xff && buf[1] === 0xd8) ? '.jpg' : '.png';
  const rel = path.join('data', 'layouts', `layout-${id}${ext}`);
  const abs = path.join(getProjectRoot(), rel);
  fs.writeFileSync(abs, buf);
  if (cur.snapshotPath && cur.snapshotPath !== rel) {
    const oldAbs = path.isAbsolute(cur.snapshotPath)
      ? cur.snapshotPath
      : path.join(getProjectRoot(), cur.snapshotPath);
    if (oldAbs !== abs && fs.existsSync(oldAbs)) {
      try { fs.unlinkSync(oldAbs); } catch (_) { /* alter Snapshot bleibt liegen */ }
    }
  }
  const db = getDb();
  db.prepare(`
    UPDATE layout_plans SET snapshot_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(rel, Number(id));
  return { snapshotPath: rel, snapshotUrl: `/api/layouts/${id}/snapshot-file` };
}

/** Speichert den Server-Render (JPEG) oder ein Client-PNG als Snapshot. */
function saveLayoutSnapshotBuffer(id, buf) {
  return saveLayoutSnapshot(id, buf);
}

function getLayoutSnapshotAbsPath(id) {
  const cur = getLayout(id);
  if (!cur || !cur.snapshotPath) return null;
  return path.isAbsolute(cur.snapshotPath)
    ? cur.snapshotPath
    : path.join(getProjectRoot(), cur.snapshotPath);
}

function listOffersForLead(leadId) {
  const db = getDb();
  const id = Number(leadId);
  if (!Number.isFinite(id)) return [];
  return db.prepare(
    `SELECT * FROM offer_versions WHERE lead_id = ? ORDER BY COALESCE(sent_at, created_at) DESC, id DESC`
  ).all(id).map(rowOffer);
}

function listOffersForEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return [];
  const db = getDb();
  return db.prepare(
    `SELECT * FROM offer_versions WHERE lower(trim(customer_email)) = ? ORDER BY COALESCE(sent_at, created_at) DESC, id DESC`
  ).all(e).map(rowOffer);
}

function getOfferVersion(id) {
  const db = getDb();
  return rowOffer(db.prepare(`SELECT * FROM offer_versions WHERE id = ?`).get(Number(id)));
}

function leadHasSentOffer(leadId) {
  const id = Number(leadId);
  if (!Number.isFinite(id)) return false;
  const db = getDb();
  const row = db.prepare(
    `SELECT 1 AS ok FROM offer_versions WHERE lead_id = ? AND status = 'sent' LIMIT 1`
  ).get(id);
  return !!row;
}

/** Map lead_id → true für alle Leads mit gesendetem Angebot (für Pin-Badges). */
function leadIdsWithSentOffers() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT DISTINCT lead_id FROM offer_versions WHERE status = 'sent' AND lead_id IS NOT NULL`
  ).all();
  const set = new Set();
  for (const r of rows) set.add(Number(r.lead_id));
  return set;
}

/**
 * Nachgezogen: Leads mit gesendetem Angebot → Status „Angebot gesendet“ + Nachfass +14 Tage.
 * Überschreibt keine Endstatus (Termin / verloren / Archiv).
 * Die Karte ruft das nicht mehr auf. Nach dem Versand setzt nur die Ja-Frage den Status.
 * @returns {number} Anzahl aktualisierter Leads
 */
function syncLeadStatusFromSentOffers() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT ov.lead_id AS lead_id, MIN(COALESCE(ov.sent_at, ov.created_at)) AS first_sent
    FROM offer_versions ov
    INNER JOIN leads l ON l.id = ov.lead_id
    WHERE ov.status = 'sent' AND ov.lead_id IS NOT NULL
      AND (l.archived_at IS NULL OR trim(l.archived_at) = '')
      AND lower(trim(coalesce(l.status, ''))) NOT IN ('lead verloren', 'termin vereinbart', 'archivieren')
      AND (
        lower(trim(coalesce(l.status, ''))) != 'angebot gesendet'
        OR trim(coalesce(l.nachfass_bis, '')) = ''
      )
    GROUP BY ov.lead_id
  `).all();

  let n = 0;
  const upd = db.prepare(`
    UPDATE leads SET
      status = 'Angebot gesendet',
      nachfass_bis = CASE
        WHEN trim(coalesce(nachfass_bis, '')) = '' THEN ?
        ELSE nachfass_bis
      END,
      last_updated = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `);
  for (const r of rows) {
    const id = Number(r.lead_id);
    if (!Number.isFinite(id)) continue;
    let nachfassBis = '';
    try {
      const raw = String(r.first_sent || '').slice(0, 10);
      const d = new Date(`${raw}T12:00:00Z`);
      if (!Number.isNaN(d.getTime())) {
        d.setUTCDate(d.getUTCDate() + 14);
        nachfassBis = d.toISOString().slice(0, 10);
      }
    } catch (_) { /* ignore */ }
    if (!nachfassBis) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + 14);
      nachfassBis = d.toISOString().slice(0, 10);
    }
    const info = upd.run(nachfassBis, id);
    if (info.changes) n += 1;
  }
  return n;
}

/** Name aus `Nachname_Vorname_2026-0001-V1`, sonst leer. */
function parseNameFromFilenameBase(filenameBase) {
  const base = String(filenameBase || '').trim();
  if (!base) return resolveCustomerNames({});
  const stripped = base.replace(/_(\d{4})(?:-\d+)?-V\d+$/i, '');
  const parts = stripped.split('_').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return resolveCustomerNames({});
  return resolveCustomerNames({
    nachname: parts[0],
    vorname: parts.slice(1).join(' '),
  });
}

function normalizeNameKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** „Straße 1, 1220 Wien“ → Straße, PLZ, Ort. */
function parseAddressText(text) {
  const address = String(text || '').trim();
  if (!address) return { street: '', zip: '', city: '', address: '' };
  const m = address.match(/^(.*?)[,\s]+(\d{4})\s+(.+)$/);
  if (!m) return { street: address, zip: '', city: '', address };
  return {
    street: String(m[1] || '').replace(/,\s*$/, '').trim(),
    zip: m[2],
    city: String(m[3] || '').trim(),
    address,
  };
}

function customerJsonIsEmpty(raw) {
  const s = String(raw || '').trim();
  if (!s || s === '{}' || s === 'null') return true;
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== 'object') return true;
    return !String(o.name || o.email || o.address || o.phone || '').trim();
  } catch (_) {
    return true;
  }
}

/**
 * Kundendaten für customer_json und die Lead-Suche.
 * Name, Adresse, Telefon, E-Mail — plus Straße/PLZ/Ort für den Abgleich.
 */
function normalizeCustomer(input) {
  const src = input && input.customer && typeof input.customer === 'object' ? input.customer : {};
  const fromFile = parseNameFromFilenameBase(input && input.filenameBase);
  const explicit = resolveCustomerNames({
    vorname: src.vorname,
    nachname: src.nachname,
    name: src.name || src.leadOrderName || '',
  });
  const names = (explicit.vorname || explicit.nachname) ? explicit : fromFile;
  const streetIn = String(src.street || src.strasse || '').trim();
  const zipIn = String(src.zip || src.plz || '').trim();
  const cityIn = String(src.city || src.ort || '').trim();
  let address = String(src.address || '').trim();
  if (!address) {
    const cityLine = [zipIn, cityIn].filter(Boolean).join(' ');
    address = [streetIn, cityLine].filter(Boolean).join(', ');
  }
  const parsed = parseAddressText(address);
  const street = streetIn || parsed.street || '';
  const zip = zipIn || parsed.zip || '';
  const city = cityIn || parsed.city || '';
  const cityLine = [zip, city].filter(Boolean).join(' ');
  const fullAddress = address || [street, cityLine].filter(Boolean).join(', ');
  const email = String((input && input.customerEmail) || src.email || '').trim().toLowerCase();
  const phone = String(src.phone || src.telefon || '').trim();
  return {
    vorname: names.vorname || '',
    nachname: names.nachname || '',
    name: names.displayName || names.leadOrderName || '',
    leadOrderName: names.leadOrderName || names.displayName || '',
    address: fullAddress,
    street,
    zip,
    city,
    phone,
    email,
  };
}

function buildCustomerJson(customer) {
  const c = customer || {};
  return {
    name: c.name || c.leadOrderName || '',
    address: c.address || '',
    phone: c.phone || '',
    email: c.email || '',
    street: c.street || '',
    zip: c.zip || '',
    city: c.city || '',
    vorname: c.vorname || '',
    nachname: c.nachname || '',
  };
}

/** Gleicher Name (Reihenfolge egal) und gleiche PLZ. Archivierte Zeilen nur, wenn nichts Aktives passt. */
function findLeadIdByNameAndPlz(name, plz) {
  const key = normalizeNameKey(name);
  const z = String(plz || '').trim();
  if (!key || key.length < 2 || !z) return null;
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, namen, archived_at FROM leads WHERE trim(coalesce(plz, '')) = ?
  `).all(z);
  const hits = rows.filter((r) => normalizeNameKey(r.namen) === key);
  if (!hits.length) return null;
  hits.sort((a, b) => {
    const aa = a.archived_at && String(a.archived_at).trim() ? 1 : 0;
    const bb = b.archived_at && String(b.archived_at).trim() ? 1 : 0;
    if (aa !== bb) return aa - bb;
    return Number(b.id) - Number(a.id);
  });
  return Number(hits[0].id);
}

/** Leere Uploader-Felder ergänzen. Gesetzte Werte bleiben. */
function fillEmptyLeadFields(db, leadId, customer) {
  const row = db.prepare(`
    SELECT namen, telefon, email, strasse, plz, ort, quelle, col_14
    FROM leads WHERE id = ?
  `).get(leadId);
  if (!row) return false;
  const sets = [];
  const params = [];
  const take = (col, value) => {
    const next = String(value ?? '').trim();
    if (!next) return;
    if (String(row[col] ?? '').trim()) return;
    sets.push(`${col} = ?`);
    params.push(next);
  };
  take('namen', customer.leadOrderName || customer.name);
  take('telefon', customer.phone);
  take('email', customer.email);
  take('strasse', customer.street);
  take('plz', customer.zip);
  take('ort', customer.city);
  take('quelle', 'Angebot');
  if (!String(row.col_14 ?? '').trim() && customer.email) {
    sets.push('col_14 = ?');
    params.push(customer.email);
  }
  if (!sets.length) return false;
  sets.push(`last_updated = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  params.push(leadId);
  db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return true;
}

/**
 * Lead finden oder anlegen: vorhandene lead_id, sonst E-Mail, sonst Name+PLZ, sonst Quelle Angebot.
 * @returns {Promise<{ leadId: number|null, created: boolean, customer: object }>}
 */
async function ensureLeadForOffer(input) {
  const customer = normalizeCustomer(input || {});
  const db = getDb();
  let leadId = input && input.leadId != null ? Number(input.leadId) : NaN;
  if (!Number.isFinite(leadId) || leadId < 1) leadId = null;
  else if (!db.prepare('SELECT id FROM leads WHERE id = ?').get(leadId)) leadId = null;

  let created = false;
  if (!leadId && customer.email) leadId = findLeadIdByEmail(customer.email);
  if (!leadId) leadId = findLeadIdByNameAndPlz(customer.leadOrderName || customer.name, customer.zip);
  if (!leadId) {
    const lead = {
      name: customer.leadOrderName || customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      street: customer.street || '',
      zip: customer.zip || '',
      city: customer.city || '',
      country: 'Österreich',
      source: 'Angebot',
      date: (input && (input.sentAt || input.createdAt)) || new Date().toISOString(),
      info: '',
    };
    if (input && input.latitude != null && input.longitude != null) {
      lead.latitude = input.latitude;
      lead.longitude = input.longitude;
    }
    const out = await appendLead(lead);
    leadId = out && out.id ? Number(out.id) : null;
    created = !!leadId;
  } else {
    fillEmptyLeadFields(db, leadId, customer);
  }
  return { leadId, created, customer };
}

/** Status „Angebot gesendet“ nur für offene Leads. Endstatus bleiben. */
function markLeadAngebotGesendet(db, leadId, sentAt) {
  const id = Number(leadId);
  if (!Number.isFinite(id) || id < 1) return false;
  const sentDay = String(sentAt || new Date().toISOString()).slice(0, 10);
  let nachfassBis = '';
  try {
    const d = new Date(`${sentDay}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() + 14);
      nachfassBis = d.toISOString().slice(0, 10);
    }
  } catch (_) { /* ignore */ }
  const info = db.prepare(`
    UPDATE leads SET
      status = 'Angebot gesendet',
      nachfass_bis = CASE
        WHEN trim(coalesce(nachfass_bis, '')) = '' OR date(substr(trim(nachfass_bis),1,10)) < date(?)
          THEN ?
        ELSE nachfass_bis
      END,
      last_updated = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
      AND (archived_at IS NULL OR trim(archived_at) = '')
      AND (
        status IS NULL OR trim(status) = ''
        OR lower(trim(status)) IN (
          'neu', 'nachfassen', 'nicht erreicht', 'angerufen', 'termin vereinbart', 'angebot gesendet'
        )
      )
  `).run(nachfassBis || sentDay, nachfassBis || sentDay, id);
  return !!info.changes;
}

/** Ja nach dem Versand: derselbe Schritt, Status plus Nachfass in 14 Tagen. */
function markLeadAngebotGesendetById(leadId, sentAt) {
  return markLeadAngebotGesendet(getDb(), leadId, sentAt);
}

function collectLayoutPlanIds(input) {
  const ids = new Set();
  const add = (v) => {
    const n = v != null ? Number(v) : NaN;
    if (Number.isFinite(n) && n > 0) ids.add(n);
  };
  if (input) {
    add(input.layoutPlanId);
    if (Array.isArray(input.variants)) {
      for (const v of input.variants) add(v && v.layoutPlanId);
    }
  }
  return [...ids];
}

/** lead_id nur setzen, wo sie noch leer ist. */
function linkMatchingLayouts(db, leadId, { email, layoutIds } = {}) {
  const id = Number(leadId);
  if (!Number.isFinite(id) || id < 1) return 0;
  let n = 0;
  const ids = Array.isArray(layoutIds) ? layoutIds.filter((x) => Number.isFinite(Number(x)) && Number(x) > 0) : [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    const info = db.prepare(`
      UPDATE layout_plans
      SET lead_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id IN (${placeholders}) AND (lead_id IS NULL OR lead_id = 0)
    `).run(id, ...ids.map(Number));
    n += info.changes;
  }
  const e = String(email || '').trim().toLowerCase();
  if (e) {
    const info = db.prepare(`
      UPDATE layout_plans
      SET lead_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE (lead_id IS NULL OR lead_id = 0) AND lower(trim(customer_email)) = ?
    `).run(id, e);
    n += info.changes;
  }
  return n;
}

function enrichCustomerFromLayouts(customer, layouts) {
  const c = { ...customer };
  for (const layout of layouts) {
    if (!layout) continue;
    const addr = parseAddressText(layout.address_text || layout.addressText || '');
    const streetOk = addr.street && (addr.zip || /\d/.test(addr.street));
    if (!c.street && streetOk) c.street = addr.street;
    if (!c.zip && addr.zip) c.zip = addr.zip;
    if (!c.city && addr.city) c.city = addr.city;
    if (!c.address && (addr.zip || addr.street)) c.address = addr.address;
    if (!c.email) {
      const em = String(layout.customer_email || layout.customerEmail || '').trim().toLowerCase();
      if (em) c.email = em;
    }
  }
  if (!c.address) {
    const cityLine = [c.zip, c.city].filter(Boolean).join(' ');
    c.address = [c.street, cityLine].filter(Boolean).join(', ');
  }
  const names = resolveCustomerNames({
    vorname: c.vorname,
    nachname: c.nachname,
    name: c.name,
  });
  c.vorname = names.vorname || c.vorname || '';
  c.nachname = names.nachname || c.nachname || '';
  c.name = names.displayName || c.name || '';
  c.leadOrderName = names.leadOrderName || c.leadOrderName || c.name || '';
  return c;
}

async function saveOfferVersion(input, createdBy = '') {
  ensureDirs();
  const db = getDb();
  const status = input.status === 'sent' ? 'sent' : 'draft';
  const sentAt = status === 'sent'
    ? (input.sentAt || new Date().toISOString())
    : null;
  const filenameBase = String(input.filenameBase || '').trim();
  const ensured = await ensureLeadForOffer({
    ...input,
    filenameBase,
    sentAt,
    status,
  });
  const customer = ensured.customer;
  const email = customer.email || String(input.customerEmail || '').trim().toLowerCase();
  const leadId = ensured.leadId;
  const customerJson = JSON.stringify(buildCustomerJson(customer));

  let customerVersion = input.customerVersion != null ? Number(input.customerVersion) : NaN;
  if (!Number.isFinite(customerVersion) || customerVersion < 1) {
    customerVersion = peekNextCustomerVersion(leadId, email);
  }

  const info = db.prepare(`
    INSERT INTO offer_versions (
      lead_id, customer_email, angebotsnummer, customer_version, filename_base, status,
      config_json, variants_json, email_subject, email_body,
      layout_plan_id, pdf_path, created_by, sent_at, customer_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leadId,
    email,
    String(input.angebotsnummer || '').trim(),
    customerVersion,
    filenameBase,
    status,
    JSON.stringify(input.config && typeof input.config === 'object' ? input.config : {}),
    JSON.stringify(Array.isArray(input.variants) ? input.variants : []),
    String(input.emailSubject || '').trim(),
    String(input.emailBody || '').trim(),
    input.layoutPlanId != null ? Number(input.layoutPlanId) : null,
    String(input.pdfPath || ''),
    String(createdBy || '').trim(),
    sentAt,
    customerJson,
  );

  // Versand setzt den Status nicht mit (PDF-Route: updateLeadStatus false).
  // Ein Entwurf bleibt „Neu“. Die Ja-Frage ruft markLeadAngebotGesendetById.
  if (status === 'sent' && leadId && input.updateLeadStatus !== false) {
    try {
      const changed = markLeadAngebotGesendet(db, leadId, sentAt);
      if (!changed) {
        console.warn('[NOORTEC] Lead-Status „Angebot gesendet“ nicht gesetzt (Lead', leadId, ')');
      }
    } catch (e) {
      console.warn('[NOORTEC] Lead-Status nach Angebot:', e.message);
    }
  }

  if (leadId) {
    try {
      linkMatchingLayouts(db, leadId, {
        email,
        layoutIds: collectLayoutPlanIds(input),
      });
    } catch (e) {
      console.warn('[NOORTEC] Belegungsplan verknüpfen:', e.message);
    }
  }

  return getOfferVersion(info.lastInsertRowid);
}

function backfillGroupKey(customer, rowId) {
  if (customer.email) return `email:${customer.email}`;
  const key = normalizeNameKey(customer.leadOrderName || customer.name);
  if (key) return `name:${key}`;
  return `row:${rowId}`;
}

/**
 * Verwaiste Angebote (lead_id leer) nach E-Mail, sonst nach Namen aus filename_base,
 * an genau einen Lead hängen. Bestehende Lead-Spalten werden nicht überschrieben.
 * @returns {Promise<{ groups: number, created: number, linkedOffers: number, linkedLayouts: number, items: object[] }>}
 */
async function backfillOrphanOfferCustomers() {
  const db = getDb();
  const offers = db.prepare(`
    SELECT * FROM offer_versions
    WHERE lead_id IS NULL OR lead_id = 0
    ORDER BY id ASC
  `).all();
  const layouts = db.prepare(`SELECT * FROM layout_plans`).all();
  const layoutsById = new Map(layouts.map((r) => [Number(r.id), r]));
  const layoutsByEmail = new Map();
  for (const layout of layouts) {
    const em = String(layout.customer_email || '').trim().toLowerCase();
    if (!em) continue;
    if (!layoutsByEmail.has(em)) layoutsByEmail.set(em, []);
    layoutsByEmail.get(em).push(layout);
  }

  const groups = new Map();
  for (const row of offers) {
    let customer = normalizeCustomer({
      customerEmail: row.customer_email,
      filenameBase: row.filename_base,
      customer: (() => {
        try { return JSON.parse(row.customer_json || '{}'); } catch (_) { return {}; }
      })(),
    });
    const related = [];
    if (row.layout_plan_id && layoutsById.has(Number(row.layout_plan_id))) {
      related.push(layoutsById.get(Number(row.layout_plan_id)));
    }
    const em = customer.email || String(row.customer_email || '').trim().toLowerCase();
    if (em && layoutsByEmail.has(em)) related.push(...layoutsByEmail.get(em));
    customer = enrichCustomerFromLayouts(customer, related);
    const key = backfillGroupKey(customer, row.id);
    if (!groups.has(key)) groups.set(key, { customer, rows: [], layoutIds: new Set() });
    const g = groups.get(key);
    g.rows.push(row);
    g.customer = enrichCustomerFromLayouts(g.customer, related);
    for (const id of collectLayoutPlanIds(row)) g.layoutIds.add(id);
    if (row.layout_plan_id) g.layoutIds.add(Number(row.layout_plan_id));
  }

  let created = 0;
  let linkedOffers = 0;
  let linkedLayouts = 0;
  const items = [];

  for (const [key, group] of groups) {
    const sample = group.rows[0];
    const sentRows = group.rows.filter((r) => r.status === 'sent');
    const sentAt = sentRows
      .map((r) => r.sent_at || r.created_at)
      .filter(Boolean)
      .sort()[0] || null;
    const ensured = await ensureLeadForOffer({
      customer: group.customer,
      customerEmail: group.customer.email,
      filenameBase: sample.filename_base,
      sentAt: sentAt || sample.created_at,
      createdAt: sample.created_at,
    });
    if (ensured.created) created += 1;
    const leadId = ensured.leadId;
    if (ensured.created && sentRows.length && leadId) {
      try { markLeadAngebotGesendet(db, leadId, sentAt); } catch (e) {
        console.warn('[NOORTEC] Nachzug Status:', e.message);
      }
    }
    const customerJson = JSON.stringify(buildCustomerJson({
      ...group.customer,
      ...ensured.customer,
      name: ensured.customer.name || group.customer.name,
      address: ensured.customer.address || group.customer.address,
      phone: ensured.customer.phone || group.customer.phone,
      email: ensured.customer.email || group.customer.email,
      street: ensured.customer.street || group.customer.street,
      zip: ensured.customer.zip || group.customer.zip,
      city: ensured.customer.city || group.customer.city,
    }));
    for (const row of group.rows) {
      const writeJson = customerJsonIsEmpty(row.customer_json);
      const info = db.prepare(`
        UPDATE offer_versions
        SET lead_id = ?,
            customer_json = CASE WHEN ? = 1 THEN ? ELSE customer_json END
        WHERE id = ? AND (lead_id IS NULL OR lead_id = 0)
      `).run(leadId, writeJson ? 1 : 0, customerJson, row.id);
      if (info.changes) linkedOffers += 1;
    }
    if (leadId) {
      linkedLayouts += linkMatchingLayouts(db, leadId, {
        email: group.customer.email,
        layoutIds: [...group.layoutIds],
      });
    }
    const lead = leadId
      ? db.prepare(`SELECT id, namen, email, status, quelle, telefon, strasse, plz, ort FROM leads WHERE id = ?`).get(leadId)
      : null;
    items.push({
      key,
      created: ensured.created,
      leadId,
      name: lead ? lead.namen : '',
      email: lead ? lead.email : '',
      status: lead ? lead.status : '',
      quelle: lead ? lead.quelle : '',
      offerIds: group.rows.map((r) => r.id),
    });
  }

  return { groups: groups.size, created, linkedOffers, linkedLayouts, items };
}

function saveOfferPdfFile(versionId, pdfBuffer) {
  ensureDirs();
  const cur = getOfferVersion(versionId);
  if (!cur) throw new Error('Angebotsversion nicht gefunden');
  const rel = path.join('data', 'offers', `offer-${versionId}.pdf`);
  const abs = path.join(getProjectRoot(), rel);
  fs.writeFileSync(abs, pdfBuffer);
  getDb().prepare(`UPDATE offer_versions SET pdf_path = ? WHERE id = ?`).run(rel, Number(versionId));
  return rel;
}

function getOfferPdfAbsPath(versionId) {
  const cur = getOfferVersion(versionId);
  if (!cur || !cur.pdfPath) return null;
  return path.isAbsolute(cur.pdfPath)
    ? cur.pdfPath
    : path.join(getProjectRoot(), cur.pdfPath);
}

/**
 * Belegungsplan-IDs je Angebotsvariante (für PDF-Export pro Variante).
 * @param {object|array} offerOrVariants  Angebot (rowOffer) oder variants[]
 * @returns {(number|null)[]}
 */
function layoutPlanIdsByVariant(offerOrVariants) {
  const variants = Array.isArray(offerOrVariants)
    ? offerOrVariants
    : (offerOrVariants && Array.isArray(offerOrVariants.variants) ? offerOrVariants.variants : []);
  if (!variants.length && offerOrVariants && typeof offerOrVariants === 'object' && !Array.isArray(offerOrVariants)) {
    const legacy = offerOrVariants.layoutPlanId != null ? Number(offerOrVariants.layoutPlanId) : NaN;
    return [Number.isFinite(legacy) ? legacy : null];
  }
  return variants.map((v) => {
    const n = v && v.layoutPlanId != null ? Number(v.layoutPlanId) : NaN;
    return Number.isFinite(n) ? n : null;
  });
}

module.exports = {
  LAYOUTS_DIR,
  OFFERS_DIR,
  findLeadIdByEmail,
  findLeadIdByNameAndPlz,
  normalizeCustomer,
  buildCustomerJson,
  ensureLeadForOffer,
  backfillOrphanOfferCustomers,
  listLayoutsForLead,
  listLayoutsForEmail,
  getLayout,
  createLayout,
  updateLayout,
  deleteLayout,
  saveLayoutSnapshot,
  saveLayoutSnapshotBuffer,
  getLayoutSnapshotAbsPath,
  listOffersForLead,
  listOffersForEmail,
  getOfferVersion,
  saveOfferVersion,
  markLeadAngebotGesendetById,
  parseNameFromFilenameBase,
  saveOfferPdfFile,
  getOfferPdfAbsPath,
  layoutPlanIdsByVariant,
  peekNextCustomerVersion,
  leadHasSentOffer,
  leadIdsWithSentOffers,
  syncLeadStatusFromSentOffers,
};
