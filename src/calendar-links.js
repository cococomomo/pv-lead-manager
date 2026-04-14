'use strict';

/**
 * Kalender-Beschreibung (Google details / Outlook body / ICS DESCRIPTION).
 * @param {object} lead — API-Lead (deutsche + interne Feldnamen)
 * @param {string} partnerName
 */
function buildLeadCalendarDescription(lead, partnerName) {
  const tel = String(lead.Telefon ?? lead.telefon ?? '').trim();
  const email = String(lead['E-Mail'] ?? lead.email ?? '').trim();
  const st = String(lead['Straße'] ?? lead.strasse ?? '').trim();
  const plz = String(lead.PLZ ?? lead.plz ?? '').trim();
  const ort = String(lead.Ort ?? lead.ort ?? '').trim();
  const addrMid = [plz, ort].filter(Boolean).join(' ').trim();
  const addressStr = st ? `${st}, ${addrMid}`.trim() : addrMid;
  const notizen = String(lead.Notizen ?? lead.notizen ?? '').trim();
  const info = String(lead.Info ?? lead.info ?? '').trim();
  const notesBlock = [notizen || null, info || null].filter(Boolean).join('\n\n') || '(keine Angaben)';
  const partner = String(partnerName || '').trim() || '—';
  return [
    `📞 Tel: ${tel || '—'}`,
    `✉️ E-Mail: ${email || '—'}`,
    `📍 Adresse: ${addressStr || '—'}`,
    '---',
    '📝 Notizen/Beschreibung:',
    notesBlock,
    '',
    `Vertriebspartner: ${partner}`,
  ].join('\n');
}

/**
 * Deep-Links / ICS für Termine (Google, Outlook, Apple).
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {string} opts.customerAddress
 * @param {string} opts.partnerName
 * @param {object} opts.lead — für ausführliche DESCRIPTION
 */
function buildEventTexts({ customerName, customerAddress, partnerName, lead }) {
  const title = `PV - ${customerName || 'Kunde'}`;
  const location = String(customerAddress || '').trim();
  const description = buildLeadCalendarDescription(lead, partnerName);
  return { title, location, description };
}

/** Google Calendar compose (wie bisherige Web-UI). */
function buildGoogleCalendarUrl({ title, location, description, start, end }) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description,
    location,
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Outlook Web (consumer + work ähnliche URL). */
function buildOutlookCalendarUrl({ title, location, description, start, end }) {
  const toIsoLocal = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: title,
    body: description,
    startdt: toIsoLocal(start),
    enddt: toIsoLocal(end),
    location,
  });
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}

function formatIcsDateUtc(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** RFC 5545 ICS (Apple Kalender / Download). */
function buildAppleIcsContent({ title, location, description, start, end, uid }) {
  const stamp = formatIcsDateUtc(new Date());
  const dtStart = formatIcsDateUtc(start);
  const dtEnd = formatIcsDateUtc(end);
  const esc = (s) => String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//PV Lead Manager//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${esc(title)}`,
    location ? `LOCATION:${esc(location)}` : '',
    `DESCRIPTION:${esc(description)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].filter(Boolean).join('\r\n');
}

/**
 * @param {object} lead — API-Lead (Straße, PLZ, Ort, Nachname + Vorname, …)
 * @param {string} partnerName
 * @param {Date} start
 * @param {Date} end
 */
function generateCalendarLink(lead, partnerName, start, end) {
  const customerName = lead['Nachname + Vorname'] || lead.namen || lead['E-Mail'] || '';
  const customerAddress = [lead['Straße'] || lead.strasse, lead['PLZ'] || lead.plz, lead['Ort'] || lead.ort].filter(Boolean).join(', ');
  const { title, location, description } = buildEventTexts({
    customerName,
    customerAddress,
    partnerName,
    lead,
  });
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@pv-lead-manager`;
  return {
    title,
    location,
    description,
    googleUrl: buildGoogleCalendarUrl({ title, location, description, start, end }),
    outlookUrl: buildOutlookCalendarUrl({ title, location, description, start, end }),
    icsContent: buildAppleIcsContent({ title, location, description, start, end, uid }),
    icsFilename: `PV-Termin-${String(customerName).replace(/\s+/g, '_').slice(0, 40) || 'Lead'}.ics`,
  };
}

module.exports = {
  generateCalendarLink,
  buildLeadCalendarDescription,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildAppleIcsContent,
};
