'use strict';

const { readUsers } = require('./users');
const { getProfile } = require('./user-profile');

/**
 * Ordnet „Betreut durch“-Text einem Benutzerprofil zu (Name oder Login).
 * @param {string} betreuerStr
 * @returns {Promise<{ name: string, tel: string, email: string } | null>}
 */
async function resolveBetreuerContact(betreuerStr) {
  const q = String(betreuerStr || '').trim().toLowerCase();
  if (!q) return null;
  const users = await readUsers();
  for (const u of users) {
    const un = String(u.username || '').trim();
    const prof = getProfile(un) || {};
    const vn = String(prof.voller_name || '').trim();
    const candidates = [vn, un].filter(Boolean);
    for (const cand of candidates) {
      const c = cand.toLowerCase();
      if (!c) continue;
      if (c === q || c.includes(q) || q.includes(c)) {
        return {
          name: vn || un,
          tel: String(prof.telefon || '').trim(),
          email: String(prof.email_kontakt || '').trim(),
        };
      }
    }
  }
  return null;
}

module.exports = { resolveBetreuerContact };
