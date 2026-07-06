'use strict';

require('./load-env');
const { getDb } = require('./database');
const { reonicV2OffersConfigured, postReonicRestV2Offer } = require('./integrations/reonic');

/**
 * Übermittelt einen Lead an Reonic (REST v2 offers) und setzt `reonic_exported` / `reonic_transferred` / `reonic_synced`.
 * @param {number|string} leadId — SQLite `leads.id`
 * @returns {Promise<{ ok: true } | { ok: false, error: string }>}
 */
async function transferLeadToReonicById(leadId) {
  if (!reonicV2OffersConfigured()) {
    return { ok: false, error: 'REONIC nicht konfiguriert (REONIC_API_KEY fehlt oder Client-ID ungültig)' };
  }
  const idNum = parseInt(String(leadId), 10);
  if (!Number.isFinite(idNum) || idNum < 1) {
    return { ok: false, error: 'Ungültige Lead-ID' };
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(idNum);
  if (!row) return { ok: false, error: 'Lead nicht gefunden' };
  const st = String(row.reonic_status || '').trim().toLowerCase();
  const existingId = String(row.reonic_id || '').trim();
  if (st === 'success' || existingId) {
    return { ok: false, error: 'Lead wurde bereits an Reonic übermittelt' };
  }
  if (Number(row.reonic_exported) === 1 || Number(row.reonic_transferred) === 1) {
    return { ok: false, error: 'Lead wurde bereits an Reonic übermittelt' };
  }

  const res = await postReonicRestV2Offer(row);
  if (!res.ok) {
    const err = res.error || 'REONIC-Fehler';
    console.error('[REONIC v2]', err);
    return { ok: false, error: err };
  }
  const rid = res.reonicId && String(res.reonicId).trim()
    ? String(res.reonicId).trim().slice(0, 512)
    : '';
  db.prepare(`
    UPDATE leads SET reonic_status = 'success', reonic_id = ?, reonic_exported = 1, reonic_transferred = 1,
      reonic_synced = 1, last_updated = datetime('now')
    WHERE id = ?
  `).run(rid, idNum);
  console.log(`[NOORTEC] REONIC v2: Lead id=${idNum} übermittelt${rid ? ` (reonic_id=${rid})` : ''}.`);
  return { ok: true, reonicId: rid };
}

module.exports = {
  transferLeadToReonicById,
  reonicV2OffersConfigured,
  /** @deprecated */
  reonicConfigured: reonicV2OffersConfigured,
};
