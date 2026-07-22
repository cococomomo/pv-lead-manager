'use strict';

/**
 * Lead-Konvention: „Nachname Vorname“ (optional „Nachname, Vorname“).
 * @returns {{ vorname: string, nachname: string }}
 */
function splitNachnameVorname(namen) {
  const raw = String(namen || '').trim();
  if (!raw) return { vorname: '', nachname: '' };
  if (raw.includes(',')) {
    const [a, b] = raw.split(',').map((x) => String(x || '').trim());
    return { nachname: a || '', vorname: b || '' };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { vorname: '', nachname: parts[0] };
  return { nachname: parts[0], vorname: parts.slice(1).join(' ') };
}

/**
 * Kundendaten → Vor-/Nachname.
 * Bevorzugt explizite Felder; sonst Lead-Split auf `name`.
 */
function resolveCustomerNames(customer) {
  const c = customer && typeof customer === 'object' ? customer : {};
  let vorname = String(c.vorname || c.firstName || '').trim();
  let nachname = String(c.nachname || c.lastName || '').trim();
  if (!vorname && !nachname && c.name) {
    const s = splitNachnameVorname(c.name);
    vorname = s.vorname;
    nachname = s.nachname;
  }
  const displayName = [vorname, nachname].filter(Boolean).join(' ')
    || String(c.name || '').trim();
  const leadOrderName = [nachname, vorname].filter(Boolean).join(' ')
    || displayName;
  return { vorname, nachname, displayName, leadOrderName };
}

module.exports = {
  splitNachnameVorname,
  resolveCustomerNames,
};
