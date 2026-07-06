'use strict';

const { chatCompletionJson, parseJsonFromLlm } = require('./ai-offer');

const PHONE = '+43 676 707 55 25';
const UNTERLAGEN = ['Vollmacht (unterschrieben, anbei)', 'Meldezettel', 'Ausweiskopie', 'aktuelle Stromrechnung'];

/** "Nachname Vorname | Nummer" für die Ordnerstruktur. */
function buildSummaryTitle(customer, angebotsnummer) {
  const parts = String(customer.name || '').trim().split(/\s+/);
  let nachname = '';
  let vorname = '';
  if (parts.length >= 2) {
    vorname = parts.slice(0, -1).join(' ');
    nachname = parts[parts.length - 1];
  } else {
    nachname = parts[0] || 'Kunde';
  }
  const name = [nachname, vorname].filter(Boolean).join(' ');
  return `${name} | ${angebotsnummer || ''}`.trim();
}

function safeFileBase(customer, angebotsnummer) {
  const t = buildSummaryTitle(customer, angebotsnummer)
    .replace(/\|/g, '_')
    .replace(/[^\w\säöüÄÖÜß-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return t || `Angebot_${angebotsnummer || ''}`;
}

function firstName(customer) {
  const parts = String(customer.name || '').trim().split(/\s+/);
  return parts.length >= 2 ? parts.slice(0, -1).join(' ') : (parts[0] || '');
}

/** Standard-E-Mail-Text (Template). Sachlich, freundlich, Ziel: Vor-Ort-Termin. */
function buildEmailText({ customer, offer, contactType, extraText }) {
  const cfg = offer.config;
  const vorname = firstName(customer);
  const anrede = vorname ? `Guten Tag ${vorname},` : (customer.name ? `Guten Tag ${customer.name},` : 'Guten Tag,');
  const opener = contactType === 'telefonisch'
    ? 'vielen Dank für das Gespräch. Wie telefonisch besprochen, sende ich Ihnen anbei Ihr persönliches Angebot für Ihre Photovoltaikanlage.'
    : 'vielen Dank für Ihr Interesse. Anbei erhalten Sie Ihr persönliches Angebot für Ihre Photovoltaikanlage.';

  const speicherTeil = cfg.speicher ? ` inkl. ${cfg.speicherLabel} Stromspeicher` : '';
  const zusammenfassung = `Kurz zusammengefasst: ${cfg.kwpLabel} mit ${cfg.moduleCount} Modulen${speicherTeil}, ${cfg.brandLabel}, Dach ${cfg.dach} – Gesamtpreis ${offer.preis.bruttoFmt} brutto. Die Details finden Sie im angehängten PDF.`;

  // Firmen-Infos: keine Anzahlung, verlässlicher Partner
  const firmenInfo = 'Gut zu wissen: Bei uns gibt es keine Anzahlung – Sie zahlen erst nach abgeschlossener Installation und Inbetriebnahme. Als Ihr verlässlicher Partner begleiten wir Sie von der Planung bis zur Förderung und stehen Ihnen für alle Fragen persönlich zur Seite.';

  // Klares Ziel: Vor-Ort-Termin
  const termin = `Am besten besprechen wir Ihr Projekt bei einem unverbindlichen Vor-Ort-Termin. So sehen wir uns Ihr Dach gemeinsam an und stimmen alle Details genau auf Sie ab. Wann würde es Ihnen passen? Rufen Sie mich gerne direkt an unter ${PHONE} oder antworten Sie einfach auf diese E-Mail.`;

  const unterlagen = UNTERLAGEN.map((u) => `- ${u}`).join('\n');
  const v = offer.meta.vertrieb || {};
  const sig = [v.name, 'Noortec GmbH', v.phone || PHONE, v.email].filter(Boolean).join('\n');

  const blocks = [anrede, opener, zusammenfassung, firmenInfo, termin];
  if (extraText && String(extraText).trim()) blocks.push(String(extraText).trim());
  blocks.push(`Für die weitere Abwicklung benötigen wir später noch folgende Unterlagen:\n${unterlagen}`);
  blocks.push(`Mit sonnigen Grüßen\n${sig}`);

  const subject = `Ihr persönliches PV-Angebot von Noortec | Angebot ${offer.meta.angebotsnummer || ''}`.trim();
  return { subject, body: blocks.join('\n\n') };
}

const EMAIL_SYSTEM_PROMPT = `Du schreibst freundliche, fachlich fundierte deutsche Vertriebs-E-Mails für NOORTEC (Photovoltaik, Wien).
Stil: persönlich und sachlich, KEINE Floskeln, kein Marketing-Blabla, keine Übertreibungen. Ausgabe NUR als JSON: {"subject": "...", "body": "..."}.
Klares Hauptziel jeder E-Mail: einen unverbindlichen VOR-ORT-TERMIN vereinbaren und den Kunden interessiert halten.
Pflichtinhalte:
- Kurzer Bezug auf das beigefügte PV-Angebot (1 Satz Konfiguration + Gesamtpreis brutto).
- Wichtige Firmen-Infos einbauen: KEINE Anzahlung (Zahlung erst nach Fertigstellung/Inbetriebnahme); NOORTEC als verlässlicher Partner, der für alle Rückfragen persönlich zur Verfügung steht.
- Konkrete Einladung zu einem unverbindlichen Vor-Ort-Termin mit Frage nach einem passenden Termin; Telefonnummer +43 676 707 55 25 nennen.
- Hinweis auf später benötigte Unterlagen: Vollmacht (anbei), Meldezettel, Ausweiskopie, Stromrechnung.
- Grußformel "Mit sonnigen Grüßen" mit Name des Vertriebsmitarbeiters und "Noortec GmbH".
- Bei contactType=telefonisch den Einstieg "wie telefonisch besprochen" verwenden, sonst NICHT.
- Anrede nur mit Vornamen ("Guten Tag <Vorname>,") wenn ein Name bekannt ist.
- Keine Preisverhandlung, keine internen Garantieverlängerungen erwähnen.
- Halte die E-Mail kompakt (max. ~180 Wörter).`;

/** KI-generierter E-Mail-Text; fällt bei Fehler auf das Template zurück. */
async function buildEmailTextAI(params) {
  const { customer, offer, contactType, extraText } = params;
  const cfg = offer.config;
  const v = offer.meta.vertrieb || {};
  const userContent = JSON.stringify({
    contactType: contactType || 'schriftlich',
    kunde: customer.name,
    vorname: firstName(customer),
    konfiguration: `${cfg.kwpLabel} (${cfg.moduleCount} Module), Speicher ${cfg.speicherLabel}, ${cfg.brandLabel}, Dach ${cfg.dach}`,
    gesamtpreis_brutto: offer.preis.bruttoFmt,
    vertrieb_name: v.name || '',
    vertrieb_telefon: v.phone || PHONE,
    vertrieb_email: v.email || '',
    zusatztext_vom_vertrieb: extraText || '',
  });
  try {
    const out = await chatCompletionJson(EMAIL_SYSTEM_PROMPT, userContent);
    const j = parseJsonFromLlm(out);
    const subject = String(j.subject || '').trim();
    const body = String(j.body || '').trim();
    if (subject && body) return { subject, body, source: 'ai' };
  } catch (err) {
    console.error('[NOORTEC] E-Mail-Text KI fehlgeschlagen, nutze Template:', err.message);
  }
  return { ...buildEmailText(params), source: 'template' };
}

function encodeHeaderWord(str) {
  const s = String(str || '');
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

function chunk76(b64) {
  return b64.replace(/(.{76})/g, '$1\r\n');
}

/**
 * Baut eine .eml-Datei (RFC822, multipart/mixed) mit PDF-Anhang.
 * X-Unsent: 1 → Desktop-Outlook öffnet die Datei als neuen, unversendeten Entwurf.
 */
function buildEml({ to, from, subject, body, attachments = [] }) {
  const boundary = `----noortec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const lines = [];
  lines.push(`Date: ${new Date().toUTCString()}`);
  if (from) lines.push(`From: ${from}`);
  if (to) lines.push(`To: ${to}`);
  lines.push(`Subject: ${encodeHeaderWord(subject)}`);
  lines.push('X-Unsent: 1');
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(chunk76(Buffer.from(String(body || ''), 'utf8').toString('base64')));
  for (const att of attachments) {
    const ct = att.contentType || 'application/octet-stream';
    const data = Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content);
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${ct}; name="${att.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${att.filename}"`);
    lines.push('');
    lines.push(chunk76(data.toString('base64')));
  }
  lines.push(`--${boundary}--`);
  lines.push('');
  return lines.join('\r\n');
}

module.exports = {
  buildSummaryTitle,
  safeFileBase,
  buildEmailText,
  buildEmailTextAI,
  buildEml,
  PHONE,
};
