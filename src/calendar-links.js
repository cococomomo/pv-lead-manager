'use strict';

/**
 * Kalender-Beschreibung (Google details / Outlook body / ICS DESCRIPTION).
 * @param {object} lead — API-Lead (deutsche + interne Feldnamen)
 * @param {string} partnerName
 */
function buildLeadCalendarDescription(lead, partnerName, extraLines = [], assignedContact = null) {
  const kunde = String(lead['Nachname + Vorname'] ?? lead.namen ?? '').trim();
  const tel = String(lead.Telefon ?? lead.telefon ?? '').trim();
  const email = String(lead['E-Mail'] ?? lead.email ?? '').trim();
  const st = String(lead['Straße'] ?? lead.strasse ?? '').trim();
  const plz = String(lead.PLZ ?? lead.plz ?? '').trim();
  const ort = String(lead.Ort ?? lead.ort ?? '').trim();
  const land = String(lead.Land ?? lead.land ?? '').trim();
  const addrMid = [plz, ort].filter(Boolean).join(' ').trim();
  const core = st ? `${st}, ${addrMid}`.trim() : addrMid;
  const addressStr = [core, land].filter(Boolean).join(', ') || '';
  const notizen = String(lead.Notizen ?? lead.notizen ?? '').trim();
  const info = String(lead.Info ?? lead.info ?? '').trim();
  const detailsBlock = [info || null, notizen || null].filter(Boolean).join('\n\n') || '(keine Angaben)';
  const partner = String(partnerName || '').trim() || '—';
  const extras = Array.isArray(extraLines) ? extraLines.filter(Boolean) : [];
  const betreuer = String(lead['Betreut Durch'] ?? lead.betreuer ?? '').trim();
  const salesLines = [];
  if (assignedContact && (assignedContact.tel || assignedContact.email)) {
    salesLines.push(
      '---',
      'NOORTEC Vertrieb (Betreuung):',
      `Name: ${assignedContact.name || '—'}`,
      `Tel: ${assignedContact.tel || '—'}`,
      `E-Mail: ${assignedContact.email || '—'}`,
    );
  } else if (betreuer) {
    salesLines.push('---', `Betreut durch: ${betreuer}`);
  }
  return [
    `👤 Kunde: ${kunde || '—'}`,
    `📞 Tel: ${tel || '—'}`,
    `✉️ E-Mail: ${email || '—'}`,
    `📍 Adresse: ${addressStr || '—'}`,
    '---',
    '📝 Anfrage-Details & Notizen:',
    detailsBlock,
    '',
    ...extras,
    ...salesLines,
    '---',
    `NOORTEC Kalender / Ansprechpartner: ${partner}`,
  ].join('\n');
}

/**
 * Deep-Links / ICS für Termine (Google, Outlook, Apple).
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {string} opts.customerAddress
 * @param {string} opts.partnerName
 * @param {object} opts.lead — für ausführliche DESCRIPTION
 * @param {'vor_ort'|'online'} [opts.terminTyp]
 * @param {{ name: string, tel: string, email: string } | null} [opts.assignedContact]
 */
function buildEventTexts({
  customerName, customerAddress, partnerName, lead, terminTyp = 'vor_ort', assignedContact = null,
}) {
  const title = `NOORTEC — ${customerName || 'Kunde'}`;
  const online = String(terminTyp || '').toLowerCase() === 'online';
  const location = online
    ? 'Google Meet (Online-Termin)'
    : String(customerAddress || '').trim();
  const meetUrl = String(lead['Meet-Link'] ?? lead.meet_link ?? '').trim();
  const extra = online && meetUrl ? [`Google Meet: ${meetUrl}`] : [];
  const description = buildLeadCalendarDescription(lead, partnerName, extra, assignedContact);
  return { title, location, description };
}

/** Google Calendar compose (wie bisherige Web-UI). `URLSearchParams` kodiert `details` inkl. Zeilenumbrüche sicher. */
function buildGoogleCalendarUrl({
  title, location, description, start, end, attendeeEmail, withGoogleMeet,
}) {
  const fmt = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: title,
    details: description,
    location,
    dates: `${fmt(start)}/${fmt(end)}`,
  });
  const guest = String(attendeeEmail || '').trim();
  if (guest) params.append('add', guest);
  let qs = params.toString();
  if (withGoogleMeet) qs += '&conferenceDataVersion=1';
  return `https://calendar.google.com/calendar/render?${qs}`;
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
    'PRODID:-//NOORTEC Vertriebs-Dashboard//DE',
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
 * @param {{ terminTyp?: string, assignedContact?: { name: string, tel: string, email: string } | null }} [opts]
 */
function generateCalendarLink(lead, partnerName, start, end, opts = {}) {
  const terminTypRaw = opts.terminTyp != null ? opts.terminTyp : (lead.Termintyp ?? lead.termin_typ ?? 'vor_ort');
  const terminTyp = String(terminTypRaw || '').toLowerCase() === 'online' ? 'online' : 'vor_ort';
  const customerName = lead['Nachname + Vorname'] || lead.namen || lead['E-Mail'] || '';
  const customerAddress = [lead['Straße'] || lead.strasse, lead['PLZ'] || lead.plz, lead['Ort'] || lead.ort].filter(Boolean).join(', ');
  const assignedContact = opts.assignedContact !== undefined ? opts.assignedContact : null;
  const { title, location, description } = buildEventTexts({
    customerName,
    customerAddress,
    partnerName,
    lead,
    terminTyp,
    assignedContact,
  });
  const attendeeEmail = lead['E-Mail'] || lead.email || '';
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}@pv-lead-manager`;
  return {
    title,
    location,
    description,
    googleUrl: buildGoogleCalendarUrl({
      title,
      location,
      description,
      start,
      end,
      attendeeEmail,
      withGoogleMeet: terminTyp === 'online',
    }),
    outlookUrl: buildOutlookCalendarUrl({ title, location, description, start, end }),
    icsContent: buildAppleIcsContent({ title, location, description, start, end, uid }),
    icsFilename: `NOORTEC-Termin-${String(customerName).replace(/\s+/g, '_').slice(0, 40) || 'Lead'}.ics`,
  };
}

module.exports = {
  generateCalendarLink,
  buildLeadCalendarDescription,
  buildGoogleCalendarUrl,
  buildOutlookCalendarUrl,
  buildAppleIcsContent,
};
