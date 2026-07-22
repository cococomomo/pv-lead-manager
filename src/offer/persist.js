'use strict';

const fs = require('fs');
const path = require('path');
const { getDb, getProjectRoot } = require('../database');

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
 * Speichert Snapshot-PNG (Buffer oder base64 data-URL).
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
  const rel = path.join('data', 'layouts', `layout-${id}.png`);
  const abs = path.join(getProjectRoot(), rel);
  fs.writeFileSync(abs, buf);
  const db = getDb();
  db.prepare(`
    UPDATE layout_plans SET snapshot_path = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(rel, Number(id));
  return { snapshotPath: rel, snapshotUrl: `/api/layouts/${id}/snapshot-file` };
}

/** Speichert fertigen PNG-Buffer als Snapshot (Server-Render). */
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

function saveOfferVersion(input, createdBy = '') {
  ensureDirs();
  const db = getDb();
  const email = String(input.customerEmail || '').trim().toLowerCase();
  let leadId = input.leadId != null ? Number(input.leadId) : null;
  if (!Number.isFinite(leadId)) leadId = findLeadIdByEmail(email);
  const status = input.status === 'sent' ? 'sent' : 'draft';
  const sentAt = status === 'sent'
    ? (input.sentAt || new Date().toISOString())
    : null;

  let customerVersion = input.customerVersion != null ? Number(input.customerVersion) : NaN;
  if (!Number.isFinite(customerVersion) || customerVersion < 1) {
    customerVersion = peekNextCustomerVersion(leadId, email);
  }
  const filenameBase = String(input.filenameBase || '').trim();

  const info = db.prepare(`
    INSERT INTO offer_versions (
      lead_id, customer_email, angebotsnummer, customer_version, filename_base, status,
      config_json, variants_json, email_subject, email_body,
      layout_plan_id, pdf_path, created_by, sent_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );

  // Status am Lead auf „Angebot gesendet“ + Nachfass in 14 Tagen
  if (status === 'sent' && leadId && input.updateLeadStatus !== false) {
    try {
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
          AND (
            status IS NULL OR trim(status) = ''
            OR lower(trim(status)) IN (
              'neu', 'nachfassen', 'nicht erreicht', 'angerufen', 'termin vereinbart', 'angebot gesendet'
            )
          )
      `).run(nachfassBis || sentDay, nachfassBis || sentDay, leadId);
      if (!info.changes) {
        console.warn('[NOORTEC] Lead-Status „Angebot gesendet“ nicht gesetzt (Lead', leadId, ')');
      }
    } catch (e) {
      console.warn('[NOORTEC] Lead-Status nach Angebot:', e.message);
    }
  }

  return getOfferVersion(info.lastInsertRowid);
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

module.exports = {
  LAYOUTS_DIR,
  OFFERS_DIR,
  findLeadIdByEmail,
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
  saveOfferPdfFile,
  getOfferPdfAbsPath,
  peekNextCustomerVersion,
  leadHasSentOffer,
  leadIdsWithSentOffers,
  syncLeadStatusFromSentOffers,
};
