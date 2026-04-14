'use strict';

const { getMailSender } = require('./mail-transport');

function looksLikeEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

function buildLeadAddressLine(lead) {
  const st = String(lead['Straße'] ?? lead.strasse ?? '').trim();
  const plz = String(lead.PLZ ?? lead.plz ?? '').trim();
  const ort = String(lead.Ort ?? lead.ort ?? '').trim();
  const land = String(lead.Land ?? lead.land ?? '').trim();
  const mid = [plz, ort].filter(Boolean).join(' ').trim();
  const core = st ? `${st}, ${mid}`.trim() : mid;
  return [core, land].filter(Boolean).join(', ').trim();
}

function formatTerminDe(terminRaw) {
  const raw = String(terminRaw || '').trim();
  if (!raw) return { dateStr: '—', timeStr: '—' };
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return { dateStr: raw, timeStr: '' };
  }
  const dateStr = d.toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return { dateStr, timeStr };
}

/**
 * @param {object} p
 * @param {string} [p.smtpUsername] — Session-User für persönliches SMTP
 */
async function sendAppointmentConfirmationEmail(p) {
  const to = String(p.to || '').trim();
  if (!to || !looksLikeEmail(to)) throw new Error('Ungültige Empfänger-E-Mail');
  const vorOrt = String(p.terminTyp || '').toLowerCase() !== 'online';
  const typWort = vorOrt ? 'Vor-Ort' : 'Online';
  const kundenname = String(p.customerName || '').trim() || 'Kundin oder Kunde';
  const ansprech = String(p.userName || '').trim() || 'Ihr Ansprechpartner';
  const tel = String(p.userTel || '').trim() || '—';
  const ue = String(p.userEmail || '').trim();
  const addrOrLink = vorOrt
    ? (String(p.addressLine || '').trim() || 'Adresse wie im System hinterlegt.')
    : (String(p.meetUrl || '').trim() || 'Den Google Meet-Link entnehmen Sie bitte der Kalendereinladung.');
  const smtpUser = String(p.smtpUsername || '').trim();

  const footer = String(p.footerLine || '').trim() || '— NOORTEC Vertriebs-Dashboard';
  const detailLines = [
    `Termin-Typ: ${typWort}`,
    `Datum: ${p.dateStr}`,
    `Uhrzeit: ${p.timeStr}`,
    `Ansprechpartner: ${ansprech}`,
    `Telefon Ansprechpartner: ${tel}`,
    ue ? `E-Mail Ansprechpartner: ${ue}` : null,
    '',
    `Guten Tag ${kundenname}, Ihr ${typWort}-Termin am ${p.dateStr} um ${p.timeStr} ist bestätigt. Ihr Ansprechpartner ${ansprech} ist unter ${tel} erreichbar. ${addrOrLink}`,
    '',
    footer,
  ].filter(Boolean).join('\n');

  const { transporter, from, replyTo } = await getMailSender(smtpUser ? { username: smtpUser } : {});
  const extraReply = looksLikeEmail(ue) ? ue : undefined;
  await transporter.sendMail({
    from,
    to,
    subject: `NOORTEC — Terminbestätigung (${typWort})`,
    text: detailLines,
    replyTo: replyTo || extraReply || undefined,
  });
}

module.exports = {
  sendAppointmentConfirmationEmail,
  buildLeadAddressLine,
  formatTerminDe,
  looksLikeEmail,
};
