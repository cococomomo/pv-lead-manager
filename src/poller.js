'use strict';

/**
 * NOORTEC IMAP → Lead-DB, danach \Seen + Verschieben nach Archiv-Ordner.
 * Archiv-Pfad: Standard `<Leads-Mailbox>.Archiv_Importiert>` (Punkt) bzw. Slash, wenn die Mailbox so benannt ist.
 * Archiv-Default: `Leads/Archiv_Importiert`. Überschreiben: IMAP_ARCHIVE_MAILBOX.
 * Alt: Unterordner der Lead-Mailbox → IMAP_ARCHIVE_RELATIVE_TO_LEADS=1 und ggf. IMAP_ARCHIVE_SUBFOLDER.
 */

require('./load-env');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const { extractLead } = require('./extractor');
const { appendLead, leadEmailExistsInDatabase } = require('./sheets');
const { scheduleAppointment } = require('./calendar');

const imapConfig = {
  imap: {
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT, 10) || 993,
    user: process.env.IMAP_USER,
    password: process.env.IMAP_PASSWORD,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    authTimeout: 10000,
  },
};

/** Einmal pro Prozess: Postfach-Aufräumen (Mails zu bereits bekannten Leads). */
let initialCleanupRan = false;

/** Einmal pro Prozess: kurze Terminal-Bestätigung nach erster erfolgreicher Verschiebung. */
let firstArchiveSuccessNotified = false;

function leadsMailboxPath() {
  const full = process.env.IMAP_LEADS_MAILBOX;
  if (full && String(full).trim()) return String(full).trim();
  return `INBOX.${process.env.IMAP_FOLDER || 'Leads'}`;
}

/**
 * Manche Server deselektieren das Postfach nach move/search — vor jedem Zugriff wieder öffnen.
 * @param {*} connection — imap-simple Verbindung
 * @param {string} mailboxPath
 */
async function ensureMailboxSelected(connection, mailboxPath) {
  await connection.openBox(mailboxPath);
}

/**
 * node-imap: SEARCH/FETCH nur im gewählten Postfach — immer SELECT (openBox) abwarten,
 * danach optional einmal erneut bei „No mailbox is currently selected“.
 * @param {*} connection
 * @param {string} mailboxPath
 * @param {unknown[]} searchCriteria
 * @param {object} fetchOptions
 */
async function searchInMailbox(connection, mailboxPath, searchCriteria, fetchOptions) {
  await ensureMailboxSelected(connection, mailboxPath);
  try {
    return await connection.search(searchCriteria, fetchOptions);
  } catch (err) {
    const msg = err && err.message ? String(err.message) : String(err);
    if (/no mailbox is currently selected/i.test(msg)) {
      await ensureMailboxSelected(connection, mailboxPath);
      return await connection.search(searchCriteria, fetchOptions);
    }
    throw err;
  }
}

function archiveMailboxPath(leadsMb) {
  const explicit = process.env.IMAP_ARCHIVE_MAILBOX;
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  if (String(process.env.IMAP_ARCHIVE_RELATIVE_TO_LEADS || '').trim() === '1') {
    const sub = (process.env.IMAP_ARCHIVE_SUBFOLDER || 'Archiv_Importiert').trim();
    const delim = leadsMb.includes('/') ? '/' : '.';
    return `${leadsMb}${delim}${sub}`;
  }
  return 'Leads/Archiv_Importiert';
}

function noteFirstArchiveSuccess(archivePath) {
  if (firstArchiveSuccessNotified) return;
  firstArchiveSuccessNotified = true;
  console.log(
    `[NOORTEC] IMAP-Archiv: erste E-Mail(s) erfolgreich nach "${archivePath}" verschoben (Import unverändert).`,
  );
}

/**
 * @param {import('mailparser').ParsedMail} parsed
 * @returns {string[]}
 */
function collectEmailsFromParsed(parsed) {
  const out = new Set();
  const addStr = (s) => {
    if (!s || typeof s !== 'string') return;
    const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
    let m;
    const t = s;
    while ((m = re.exec(t)) !== null) out.add(m[0].toLowerCase());
  };
  const walkAddr = (field) => {
    if (!field) return;
    if (field.value && Array.isArray(field.value)) {
      for (const v of field.value) {
        if (v && v.address) out.add(String(v.address).toLowerCase());
      }
    }
  };
  walkAddr(parsed.from);
  walkAddr(parsed.replyTo);
  walkAddr(parsed.to);
  walkAddr(parsed.cc);
  addStr(parsed.subject || '');
  addStr(typeof parsed.text === 'string' ? parsed.text : '');
  const html = parsed.html;
  addStr(typeof html === 'string' ? html : html && typeof html.toString === 'function' ? html.toString() : '');
  return [...out];
}

/**
 * Prüft, ob der Archiv-Ordner existiert (ohne Import zu blockieren).
 * @returns {Promise<boolean>}
 */
async function verifyArchiveMailbox(connection, leadsMailbox, archivePath) {
  try {
    await ensureMailboxSelected(connection, archivePath);
    await ensureMailboxSelected(connection, leadsMailbox);
    return true;
  } catch (err) {
    console.warn(
      `[NOORTEC] IMAP-Archiv: Zielordner nicht gefunden oder nicht öffenbar (${archivePath}): ${err.message}. Importe laufen weiter; Verschieben wird übersprungen.`,
    );
    try {
      await ensureMailboxSelected(connection, leadsMailbox);
    } catch (e2) {
      console.warn(`[NOORTEC] IMAP-Archiv: Leads-Postfach konnte nicht erneut gewählt werden: ${e2.message}`);
    }
    return false;
  }
}

/**
 * @returns {Promise<boolean>} ob Verschieben geklappt hat
 */
async function markSeenAndMoveToArchive(connection, uid, archivePath, archiveEnabled) {
  if (!archiveEnabled || uid == null) return false;
  try {
    await connection.addFlags(uid, ['\\Seen']);
    await connection.moveMessage(uid, archivePath);
    noteFirstArchiveSuccess(archivePath);
    return true;
  } catch (err) {
    console.warn(`[NOORTEC] IMAP-Archiv: Verschieben (UID ${uid}) fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function runInitialInboxArchiveCleanup(connection, leadsMailbox, archivePath, archiveEnabled) {
  if (initialCleanupRan) return;
  initialCleanupRan = true;
  if (!archiveEnabled) return;

  await ensureMailboxSelected(connection, leadsMailbox);

  const rawMax = parseInt(process.env.IMAP_CLEANUP_MAX_MESSAGES, 10);
  const max = Math.min(Math.max(Number.isFinite(rawMax) ? rawMax : 200, 10), 500);

  let messages;
  try {
    messages = await searchInMailbox(connection, leadsMailbox, ['ALL'], { bodies: [''], markSeen: false });
  } catch (err) {
    console.warn(`[NOORTEC] IMAP-Cleanup: Suche fehlgeschlagen: ${err.message}`);
    return;
  }
  if (!messages || messages.length === 0) return;

  messages.sort((a, b) => (a.attributes?.uid || 0) - (b.attributes?.uid || 0));
  const slice = messages.length > max ? messages.slice(-max) : messages;
  console.log(`[NOORTEC] IMAP-Cleanup: prüfe ${slice.length} von ${messages.length} Nachricht(en) in "${leadsMailbox}" …`);

  const uidsToArchive = [];
  for (const message of slice) {
    try {
      const all = message.parts?.find((p) => p.which === '');
      if (!all || all.body == null) continue;
      const parsed = await simpleParser(all.body);
      const emails = collectEmailsFromParsed(parsed);
      if (emails.some((e) => leadEmailExistsInDatabase(e))) uidsToArchive.push(message.attributes.uid);
    } catch (err) {
      console.warn(`[NOORTEC] IMAP-Cleanup: Nachricht UID ${message.attributes?.uid}: ${err.message}`);
    }
  }

  let moved = 0;
  for (const uid of uidsToArchive) {
    const ok = await markSeenAndMoveToArchive(connection, uid, archivePath, archiveEnabled);
    if (ok) moved += 1;
  }
  if (moved > 0) {
    console.log(`[NOORTEC] IMAP-Cleanup: ${moved} bereits zugeordnete Lead-Mail(s) nach "${archivePath}" verschoben.`);
  }
}

/**
 * Ein IMAP-Durchlauf: ungelesene Leads-Mails importieren, Archivierung, optional Kalender.
 * @returns {Promise<{ importedCount: number }>}
 */
async function pollEmails() {
  let importedCount = 0;
  console.log(`[${new Date().toISOString()}] NOORTEC IMAP: Synchronisation…`);
  let connection;

  const leadsMailbox = leadsMailboxPath();
  const archivePath = archiveMailboxPath(leadsMailbox);

  try {
    connection = await imaps.connect(imapConfig);
    await ensureMailboxSelected(connection, leadsMailbox);

    const archiveOk = await verifyArchiveMailbox(connection, leadsMailbox, archivePath);
    await ensureMailboxSelected(connection, leadsMailbox);
    await runInitialInboxArchiveCleanup(connection, leadsMailbox, archivePath, archiveOk);
    await ensureMailboxSelected(connection, leadsMailbox);

    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
      bodies: ['HEADER', 'TEXT', ''],
      markSeen: false,
    };

    const messages = await searchInMailbox(connection, leadsMailbox, searchCriteria, fetchOptions);
    console.log(`Found ${messages.length} unread message(s).`);

    for (const message of messages) {
      try {
        const all = message.parts.find((p) => p.which === '');
        if (!all || all.body == null) {
          console.log('Message has no full body part, skipping.');
          continue;
        }
        const parsed = await simpleParser(all.body);

        const emailData = {
          from: parsed.from?.text || '',
          subject: parsed.subject || '',
          date: parsed.date?.toISOString() || new Date().toISOString(),
          text: parsed.text || '',
          html: parsed.html || '',
        };

        console.log(`Processing email: "${emailData.subject}" from ${emailData.from}`);

        const lead = await extractLead(emailData);
        if (!lead) {
          console.log('No lead data extracted, skipping.');
          continue;
        }

        const uid = message.attributes.uid;

        if (lead.email && leadEmailExistsInDatabase(lead.email)) {
          console.log(`Lead ${lead.email} already in database — NOORTEC: Mail wird archiviert.`);
          await markSeenAndMoveToArchive(connection, uid, archivePath, archiveOk);
          await ensureMailboxSelected(connection, leadsMailbox);
          continue;
        }

        await appendLead(lead);
        importedCount += 1;
        console.log(`Lead saved: ${lead.name} <${lead.email}>`);

        if (lead.email) {
          try {
            await scheduleAppointment(lead);
          } catch (calErr) {
            console.warn(`[NOORTEC] Kalender/E-Mail nach Import: ${calErr.message}`);
          }
        }

        await markSeenAndMoveToArchive(connection, uid, archivePath, archiveOk);
        await ensureMailboxSelected(connection, leadsMailbox);
      } catch (err) {
        console.error('[NOORTEC] Error processing message:', err.message);
        try {
          await ensureMailboxSelected(connection, leadsMailbox);
        } catch (e2) {
          console.warn('[NOORTEC] IMAP: Leads-Postfach nach Fehler nicht wieder wählbar:', e2.message);
        }
      }
    }
  } catch (err) {
    console.error('[NOORTEC] IMAP error:', err.message);
    throw err;
  } finally {
    if (connection) connection.end();
  }
  return { importedCount };
}

module.exports = { pollEmails };

/*
 * Hintergrund-Cron entfernt — IMAP-Import auslösen per:
 *   - Dashboard: POST /api/sync-leads
 *   - CLI: npm run poll  (scripts/pv-lead-poll.js)
 */
