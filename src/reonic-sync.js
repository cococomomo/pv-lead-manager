'use strict';

require('./load-env');
const { getDb } = require('./database');
const { reonicCreateConfigured, postReonicH360CreateRequest } = require('./integrations/reonic');

/**
 * Nach Status „Termin vereinbart“: optional an REONIC übertragen und `reonic_synced` setzen.
 * @param {number|string} leadId — SQLite `leads.id`
 * @returns {Promise<
 *   { ok: true, synced: true }
 *   | { ok: true, skipped: true, reason: string }
 *   | { ok: false, error: string, discreetHint: string }
 * >}
 */
async function syncReonicAfterTerminVereinbart(leadId) {
  if (!reonicCreateConfigured()) {
    return { ok: true, skipped: true, reason: 'not_configured' };
  }
  const idNum = parseInt(String(leadId), 10);
  if (!Number.isFinite(idNum) || idNum < 1) {
    return { ok: true, skipped: true, reason: 'invalid_id' };
  }
  const db = getDb();
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(idNum);
  if (!row) return { ok: true, skipped: true, reason: 'no_row' };
  if (String(row.status || '').trim() !== 'Termin vereinbart') {
    return { ok: true, skipped: true, reason: 'wrong_status' };
  }
  if (Number(row.reonic_synced) === 1) {
    return { ok: true, skipped: true, reason: 'already_synced' };
  }

  const res = await postReonicH360CreateRequest(row);
  if (!res.ok) {
    const err = res.error || 'REONIC-Fehler';
    console.error('[REONIC]', err);
    return {
      ok: false,
      error: err,
      discreetHint: 'Status wurde gespeichert. Die Übergabe an REONIC ist fehlgeschlagen (Details in data/integration_errors.log).',
    };
  }
  db.prepare(`UPDATE leads SET reonic_synced = 1, last_updated = datetime('now') WHERE id = ?`).run(idNum);
  console.log(`[NOORTEC] REONIC: Lead id=${idNum} übermittelt (inkl. lat/lng sofern in der DB).`);
  return { ok: true, synced: true };
}

module.exports = {
  syncReonicAfterTerminVereinbart,
  /** @deprecated — nutze `reonicCreateConfigured` aus `integrations/reonic`; Alias für Kompatibilität */
  reonicConfigured: reonicCreateConfigured,
};
