'use strict';

/**
 * Versand speichert das Angebot, lässt den Lead-Status aber stehen,
 * bis die Ja-Frage markLeadAngebotGesendetById ausführt.
 * Eigene SQLite-Datei, kein data/leads.db.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `pvl-offer-sent-status-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* ignore */ }
}
process.env.SQLITE_LEADS_DB = dbFile;

const { getDb } = require('../src/database');
const persist = require('../src/offer/persist');
const { appendLead } = require('../src/sheets');
const { leadIdHeaderValue } = require('../src/offer/routes');

function leadById(id) {
  return getDb().prepare('SELECT * FROM leads WHERE id = ?').get(id);
}

function sourceOf(html, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(html);
  assert.ok(m, 'Funktion fehlt: ' + name);
  const rest = html.slice(m.index + m[0].length);
  const next = rest.search(/\n(?:async\s+)?function\s+/);
  return html.slice(m.index, m.index + m[0].length + (next === -1 ? rest.length : next));
}

async function saveSent(extra) {
  return persist.saveOfferVersion(Object.assign({
    customerEmail: 'status.frage@example.com',
    filenameBase: 'Frage_Status_2026-2001-V1',
    angebotsnummer: '2026-2001',
    customerVersion: 1,
    status: 'sent',
    updateLeadStatus: false,
    sentAt: '2026-10-01T12:00:00.000Z',
    customer: {
      vorname: 'Status',
      nachname: 'Frage',
      street: 'Testweg 1',
      zip: '1010',
      city: 'Wien',
      email: 'status.frage@example.com',
      phone: '0043111222',
    },
    latitude: 48.2,
    longitude: 16.3,
  }, extra || {}), 'test');
}

async function main() {
  const existing = await appendLead({
    name: 'Frage Status',
    email: 'status.frage@example.com',
    phone: '0043111222',
    street: 'Testweg 1',
    zip: '1010',
    city: 'Wien',
    source: 'Test',
    latitude: 48.2,
    longitude: 16.3,
  });
  assert.strictEqual(leadById(existing.id).status, 'Neu');

  const saved = await saveSent({ leadId: existing.id });
  assert.strictEqual(saved.status, 'sent', 'Angebot ist gesendet');
  assert.strictEqual(Number(saved.leadId), existing.id);
  const afterSave = leadById(existing.id);
  assert.strictEqual(afterSave.status, 'Neu', 'gespeicherter Versand ändert den Status nicht');
  assert.strictEqual(String(afterSave.nachfass_bis || '').trim(), '', 'Nachfass bleibt leer bis Ja');

  const updated = persist.markLeadAngebotGesendetById(existing.id, '2026-10-01T12:00:00.000Z');
  assert.strictEqual(updated, true);
  const afterYes = leadById(existing.id);
  assert.strictEqual(afterYes.status, 'Angebot gesendet');
  assert.strictEqual(String(afterYes.nachfass_bis).slice(0, 10), '2026-10-15');

  const created = await saveSent({
    leadId: null,
    customerEmail: 'frisch.kunde@example.com',
    filenameBase: 'Kunde_Frisch_2026-2002-V1',
    angebotsnummer: '2026-2002',
    customer: {
      vorname: 'Frisch',
      nachname: 'Kunde',
      street: 'Neue Gasse 2',
      zip: '1020',
      city: 'Wien',
      email: 'frisch.kunde@example.com',
      phone: '0043999',
    },
  });
  assert.ok(created.leadId, 'neuer Kunde bekommt eine Lead-Id');
  assert.notStrictEqual(Number(created.leadId), existing.id);
  assert.strictEqual(leadIdHeaderValue(created), String(created.leadId));
  assert.strictEqual(leadById(created.leadId).status, 'Neu', 'neu angelegter Kunde bleibt Neu');
  assert.strictEqual(persist.markLeadAngebotGesendetById(created.leadId, '2026-10-01T12:00:00.000Z'), true);
  assert.strictEqual(leadById(created.leadId).status, 'Angebot gesendet');

  const lost = await appendLead({
    name: 'Verloren Lead',
    email: 'verloren.lead@example.com',
    zip: '1030',
    city: 'Wien',
    source: 'Test',
    latitude: 48.2,
    longitude: 16.37,
  });
  getDb().prepare(`UPDATE leads SET status = 'Lead verloren', nachfass_bis = '' WHERE id = ?`).run(lost.id);
  await saveSent({
    leadId: lost.id,
    customerEmail: 'verloren.lead@example.com',
    filenameBase: 'Lead_Verloren_2026-2003-V1',
    angebotsnummer: '2026-2003',
    customer: {
      vorname: 'Lead',
      nachname: 'Verloren',
      zip: '1030',
      city: 'Wien',
      email: 'verloren.lead@example.com',
    },
  });
  assert.strictEqual(leadById(lost.id).status, 'Lead verloren');
  assert.strictEqual(persist.markLeadAngebotGesendetById(lost.id, '2026-10-01T12:00:00.000Z'), false);
  assert.strictEqual(leadById(lost.id).status, 'Lead verloren');
  assert.strictEqual(String(leadById(lost.id).nachfass_bis || '').trim(), '');

  const archived = await appendLead({
    name: 'Archiv Lead',
    email: 'archiv.lead@example.com',
    zip: '1040',
    city: 'Wien',
    source: 'Test',
    latitude: 48.19,
    longitude: 16.36,
  });
  getDb().prepare(`
    UPDATE leads SET status = 'Neu', archived_at = '2026-09-01T00:00:00Z', nachfass_bis = '' WHERE id = ?
  `).run(archived.id);
  assert.strictEqual(persist.markLeadAngebotGesendetById(archived.id, '2026-10-01T12:00:00.000Z'), false);
  const archivedRow = leadById(archived.id);
  assert.strictEqual(archivedRow.status, 'Neu');
  assert.ok(String(archivedRow.archived_at || '').trim(), 'Archiv bleibt');

  const draft = await persist.saveOfferVersion({
    customerEmail: 'entwurf.status@example.com',
    filenameBase: 'Status_Entwurf_2026-2004-V1',
    angebotsnummer: '2026-2004',
    status: 'draft',
    updateLeadStatus: false,
    customer: {
      vorname: 'Entwurf',
      nachname: 'Status',
      email: 'entwurf.status@example.com',
      zip: '1050',
      city: 'Wien',
    },
    latitude: 48.18,
    longitude: 16.35,
  }, 'test');
  assert.strictEqual(draft.status, 'draft');
  assert.strictEqual(leadById(draft.leadId).status, 'Neu', 'Entwurf bleibt Neu');
  assert.strictEqual(leadIdHeaderValue(null), '');

  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/offer.html'), 'utf8');
  assert.ok(html.includes('Status dieses Leads auf „Angebot gesendet“ setzen?'));
  for (const name of ['downloadPdf', 'finishOfferOpenOutlook']) {
    assert.ok(sourceOf(html, name).includes('maybeAskOfferSentStatus'), name + ' fragt nach dem Versand');
  }
  for (const name of ['refreshPreview', 'saveOfferVersionManual', 'openOutlookDraft']) {
    assert.ok(!sourceOf(html, name).includes('maybeAskOfferSentStatus'), name + ' fragt nicht');
  }
  const textOnly = sourceOf(html, 'openOutlookDraft');
  assert.ok(!textOnly.includes('/api/offer/pdf'), 'aktueller Text lädt kein PDF');
  assert.ok(!textOnly.includes('outlook-draft'), 'aktueller Text vergibt keine neue Nummer');
  const finish = sourceOf(html, 'finishOfferOpenOutlook');
  assert.ok(finish.indexOf('openMailSlot') >= 0 && finish.indexOf('openMailSlot') < finish.indexOf('await'), 'Mailto-Fenster noch im Klick');
  assert.ok(finish.includes('payload.finalize = true'), 'Fertigstellen speichert den Versand');
  assert.ok(finish.includes('closeMailSlotSoon'), 'Fertigstellen schließt den leeren Tab');
  assert.ok(finish.includes('buildClientMailto'), 'Fertigstellen übergibt mailto');
  assert.ok(!/outlook\.office|outlook:|outlook\.live/i.test(finish), 'Fertigstellen erzwingt kein Outlook');
  assert.ok(finish.includes("toast('PDF geladen. E-Mail-Programm wurde blockiert – Pop-up erlauben.', 'error')"), 'Popup-Hinweis bleibt');
  const textMail = sourceOf(html, 'openOutlookDraft');
  assert.ok(textMail.includes('closeMailSlotSoon'), 'Text-Knopf schließt den leeren Tab');
  assert.ok(textMail.includes('buildClientMailto'), 'Text-Knopf übergibt mailto');
  assert.ok(!/outlook\.office|outlook:|outlook\.live/i.test(textMail), 'Text-Knopf erzwingt kein Outlook');
  assert.ok(textMail.includes("toast('E-Mail-Programm wurde blockiert. Pop-up für diese Seite erlauben.', 'error')"), 'Text-Popup-Hinweis bleibt');
  assert.ok(html.includes('>Diesen Text in der E-Mail öffnen</button>'));
  assert.ok(!sourceOf(html, 'downloadPdf').includes('closeMailSlotSoon'), 'PDF-Download öffnet kein Mailto');
  const closeSlot = sourceOf(html, 'closeMailSlotSoon');
  assert.ok(closeSlot.includes('setTimeout') && closeSlot.includes('slot.close()'), 'Tab schließt nach kurzer Wartezeit');

  const routes = fs.readFileSync(path.join(root, 'src/offer/routes.js'), 'utf8');
  const saveAt = routes.indexOf('savedVersion = await persist.saveOfferVersion');
  assert.ok(saveAt > 0);
  assert.ok(routes.slice(saveAt, saveAt + 900).includes('updateLeadStatus: false'));
  assert.ok(routes.includes("res.setHeader('X-Lead-Id', leadHeader)"));
  assert.ok(routes.includes("app.post('/api/offer/mark-angebot-gesendet'"));

  const layout = fs.readFileSync(path.join(root, 'src/offer/layout-routes.js'), 'utf8');
  const idsAt = layout.indexOf("app.get('/api/offer/sent-lead-ids'");
  assert.ok(idsAt > 0);
  assert.ok(!layout.slice(idsAt, idsAt + 500).includes('syncLeadStatusFromSentOffers'));

  console.log('ok test-offer-sent-status');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
