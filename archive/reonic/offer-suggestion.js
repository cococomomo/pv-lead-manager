'use strict';

/**
 * ARCHIV — wird von src/sheets.js nicht mehr aufgerufen.
 * Früher hat ein Statuswechsel auf „Termin vereinbart“ dieses Objekt an den Client
 * gegeben und dort den Confirm-Dialog ausgelöst.
 */
const { reonicV2OffersConfigured } = require('./reonic');

function reonicOfferSuggestionPayload(db, leadId, newStatus) {
  const s = String(newStatus || '').trim();
  if (s !== 'Termin vereinbart') return {};
  if (!reonicV2OffersConfigured()) return {};
  const r = db.prepare(`
    SELECT COALESCE(reonic_exported, 0) AS rx, COALESCE(reonic_transferred, 0) AS rt,
      COALESCE(reonic_synced, 0) AS rs,
      lower(trim(COALESCE(reonic_status, ''))) AS rst,
      trim(COALESCE(reonic_id, '')) AS rid
    FROM leads WHERE id = ?
  `).get(leadId);
  if (!r) return {};
  if (r.rst === 'success' || r.rid) return {};
  if (Number(r.rx) === 1 || Number(r.rt) === 1 || Number(r.rs) === 1) return {};
  return { reonicOfferSuggested: true, pvlDbId: leadId };
}

module.exports = { reonicOfferSuggestionPayload };
