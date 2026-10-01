'use strict';

/**
 * Manuelle Kunden: PDF-Download legt einen suchbaren Lead an,
 * dieselbe E-Mail erzeugt keinen zweiten, verwaiste Angebote werden nachgezogen.
 * Eigene SQLite-Datei, kein data/leads.db.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbFile = path.join(os.tmpdir(), `pvl-manual-customers-${process.pid}.db`);
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbFile + suffix); } catch (_) { /* ignore */ }
}
process.env.SQLITE_LEADS_DB = dbFile;

const { getDb } = require('../src/database');
const persist = require('../src/offer/persist');
const { searchLeads, appendLead } = require('../src/sheets');
const { shouldPersistOfferVersion } = require('../src/offer/routes');

function countEmail(email) {
  const e = String(email).trim().toLowerCase();
  return getDb().prepare(`SELECT COUNT(*) AS c FROM leads WHERE lower(trim(email)) = ?`).get(e).c;
}

function leadByEmail(email) {
  const e = String(email).trim().toLowerCase();
  return getDb().prepare(`
    SELECT * FROM leads WHERE lower(trim(email)) = ? ORDER BY id DESC LIMIT 1
  `).get(e);
}

async function main() {
  assert.strictEqual(shouldPersistOfferVersion({}), false, 'PDF-Vorschau speichert nichts');
  assert.strictEqual(shouldPersistOfferVersion({ finalize: false }), false);
  assert.strictEqual(shouldPersistOfferVersion({ finalize: true }), true, 'PDF-Download speichert');
  assert.strictEqual(shouldPersistOfferVersion({ saveVersion: true, finalize: false }), true);

  const names = persist.parseNameFromFilenameBase('Putineanu_Marius_2026-0141-V2');
  assert.strictEqual(names.nachname, 'Putineanu');
  assert.strictEqual(names.vorname, 'Marius');

  // PDF-Download-Speicherpfad: finalize → status sent, Kunde im Lead.
  const saved = await persist.saveOfferVersion({
    customerEmail: 'suchbar.neu@example.com',
    filenameBase: 'Suchbar_Neu_2026-0999-V1',
    angebotsnummer: '2026-0999',
    customerVersion: 1,
    status: 'sent',
    emailSubject: 'Ihr PV-Angebot',
    customer: {
      vorname: 'Neu',
      nachname: 'Suchbar',
      street: 'Testgasse 1',
      zip: '1010',
      city: '',
      email: 'suchbar.neu@example.com',
      phone: '0043660000001',
    },
    latitude: 48.2082,
    longitude: 16.3738,
  }, 'test');

  assert.ok(saved && saved.leadId, 'PDF-Download setzt lead_id');
  assert.strictEqual(saved.customer.email, 'suchbar.neu@example.com');
  assert.ok(saved.customer.name.includes('Suchbar'), saved.customer.name);
  assert.ok(saved.customer.address.includes('Testgasse'), saved.customer.address);
  assert.strictEqual(saved.customer.phone, '0043660000001');
  const found = searchLeads('Suchbar');
  assert.ok(found.some((row) => String(row['E-Mail'] || '').toLowerCase() === 'suchbar.neu@example.com'), 'neuer Name ist suchbar');
  const sentLead = leadByEmail('suchbar.neu@example.com');
  assert.strictEqual(sentLead.status, 'Angebot gesendet');
  assert.strictEqual(sentLead.quelle, 'Angebot');
  assert.strictEqual(countEmail('suchbar.neu@example.com'), 1);

  await persist.saveOfferVersion({
    customerEmail: 'suchbar.neu@example.com',
    filenameBase: 'Suchbar_Neu_2026-0999-V2',
    angebotsnummer: '2026-0999',
    customerVersion: 2,
    status: 'sent',
    customer: {
      vorname: 'Andere',
      nachname: 'Person',
      street: 'Andere Gasse 9',
      zip: '1020',
      city: 'Wien',
      email: 'suchbar.neu@example.com',
      phone: '0043999',
    },
    latitude: 48.21,
    longitude: 16.37,
  }, 'test');

  assert.strictEqual(countEmail('suchbar.neu@example.com'), 1, 'gleiche E-Mail erzeugt keinen zweiten Lead');
  const still = leadByEmail('suchbar.neu@example.com');
  assert.strictEqual(still.telefon, '0043660000001', 'Telefon bleibt');
  assert.strictEqual(still.namen, 'Suchbar Neu', 'Name bleibt');
  assert.strictEqual(still.strasse, 'Testgasse 1', 'Straße bleibt');
  assert.strictEqual(String(still.ort || '').trim(), 'Wien', 'leerer Ort wird ergänzt');
  assert.strictEqual(still.plz, '1010', 'PLZ bleibt');

  const draft = await persist.saveOfferVersion({
    customerEmail: 'entwurf.bleibt@example.com',
    filenameBase: 'Bleibt_Entwurf_2026-1000-V1',
    angebotsnummer: '2026-1000',
    status: 'draft',
    customer: {
      vorname: 'Entwurf',
      nachname: 'Bleibt',
      email: 'entwurf.bleibt@example.com',
      zip: '1030',
      city: 'Wien',
    },
    latitude: 48.2,
    longitude: 16.39,
  }, 'test');
  assert.ok(draft.leadId);
  assert.strictEqual(leadByEmail('entwurf.bleibt@example.com').status, 'Neu', 'Entwurf bleibt Neu');
  assert.ok(searchLeads('Bleibt').length >= 1);

  await appendLead({
    name: 'Huber Anna',
    email: '',
    phone: '0043111',
    street: 'Altstraße 2',
    zip: '3400',
    city: 'Klosterneuburg',
    source: 'D&P',
    latitude: 48.3,
    longitude: 16.32,
  });
  const beforeHuber = getDb().prepare(`SELECT COUNT(*) AS c FROM leads WHERE namen = 'Huber Anna'`).get().c;
  const huberOffer = await persist.saveOfferVersion({
    customerEmail: '',
    filenameBase: 'Huber_Anna_2026-1001-V1',
    angebotsnummer: '2026-1001',
    status: 'draft',
    customer: {
      vorname: 'Anna',
      nachname: 'Huber',
      zip: '3400',
      city: 'Klosterneuburg',
      phone: '0043222',
      street: 'Neuergasse 1',
    },
    latitude: 48.3,
    longitude: 16.32,
  }, 'test');
  assert.strictEqual(getDb().prepare(`SELECT COUNT(*) AS c FROM leads WHERE lower(namen) LIKE '%huber%'`).get().c, beforeHuber);
  const huber = getDb().prepare(`SELECT * FROM leads WHERE namen = 'Huber Anna'`).get();
  assert.strictEqual(huberOffer.leadId, huber.id, 'Name plus PLZ trifft den bestehenden Lead');
  assert.strictEqual(huber.telefon, '0043111');
  assert.strictEqual(huber.strasse, 'Altstraße 2');
  assert.strictEqual(huber.quelle, 'D&P');

  // Nachzug: Putineanu nur in Angeboten, bekannte E-Mail, Name ohne E-Mail.
  const db = getDb();
  const existing = await appendLead({
    name: 'Novak Andreas',
    email: 'andreas.novak@univie.ac.at',
    phone: '00436608186857',
    street: '',
    zip: '3413',
    city: 'Oberkirchbach',
    source: 'D&P',
    latitude: 48.45,
    longitude: 16.1,
  });
  db.prepare(`UPDATE leads SET status = 'Angebot gesendet', strasse = '' WHERE id = ?`).run(existing.id);

  const layout = db.prepare(`
    INSERT INTO layout_plans (lead_id, customer_email, title, address_text, plan_json)
    VALUES (NULL, 'mputineanu@gmail.com', 'Belegungsplan V1 Marius Putineanu', 'An der Neurisse 9, 1220 Wien', '{}')
  `).run();
  const layoutId = Number(layout.lastInsertRowid);

  const insertOffer = db.prepare(`
    INSERT INTO offer_versions (
      lead_id, customer_email, angebotsnummer, filename_base, status, email_subject, email_body, layout_plan_id, sent_at
    ) VALUES (NULL, ?, ?, ?, 'sent', ?, 'Sehr geehrter Herr Test', ?, ?)
  `);
  insertOffer.run('mputineanu@gmail.com', '2026-0141', 'Putineanu_Marius_2026-0141-V1', 'Ihr PV-Angebot', layoutId, '2026-10-01T05:42:01.266Z');
  insertOffer.run('mputineanu@gmail.com', '2026-0141', 'Putineanu_Marius_2026-0141-V2', 'Ihr PV-Angebot', layoutId, '2026-10-01T05:51:31.104Z');
  insertOffer.run('andreas.novak@univie.ac.at', '2026-0052', 'Novak_Andreas_2026-0052-V1', 'Ihr PV-Angebot', null, '2026-07-23T14:27:44.307Z');
  insertOffer.run('', '2026-0072', 'Emminger_Susanne_2026-0072-V1', 'Ihr PV-Angebot', null, '2026-08-03T18:03:17.123Z');
  insertOffer.run('', '2026-0041', 'Kunde_2026-0041-V1', '', null, '2026-07-22T08:53:57.004Z');
  insertOffer.run('', '2026-0050', 'Kunde_2026-0050-V1', '', null, '2026-07-22T12:24:45.432Z');
  db.prepare(`
    INSERT INTO offer_versions (lead_id, customer_email, filename_base, status)
    VALUES (NULL, 'nur.entwurf@example.com', 'Entwurf_Nur_2026-1002-V1', 'draft')
  `).run();

  const report = await persist.backfillOrphanOfferCustomers();
  assert.strictEqual(report.linkedOffers, 7);
  assert.strictEqual(countEmail('mputineanu@gmail.com'), 1, 'Putineanu ein Lead');
  const put = leadByEmail('mputineanu@gmail.com');
  assert.ok(searchLeads('Putineanu').some((row) => Number(row.pvlDbId || row.id) === put.id));
  assert.strictEqual(put.status, 'Angebot gesendet');
  assert.strictEqual(put.quelle, 'Angebot');
  assert.ok(String(put.plz) === '1220', put.plz);
  assert.ok(String(put.strasse).includes('Neurisse'), put.strasse);
  const putOffers = db.prepare(`SELECT lead_id FROM offer_versions WHERE customer_email = 'mputineanu@gmail.com'`).all();
  assert.ok(putOffers.every((r) => Number(r.lead_id) === put.id));
  const putLayout = db.prepare(`SELECT lead_id FROM layout_plans WHERE id = ?`).get(layoutId);
  assert.strictEqual(Number(putLayout.lead_id), put.id);

  const novak = leadByEmail('andreas.novak@univie.ac.at');
  assert.strictEqual(novak.id, existing.id, 'bekannte E-Mail bleibt derselbe Lead');
  assert.strictEqual(novak.telefon, '00436608186857');
  assert.strictEqual(novak.quelle, 'D&P');
  assert.strictEqual(novak.status, 'Angebot gesendet');
  assert.strictEqual(String(novak.strasse || '').trim(), '', 'leere Straße ohne Adresse im Angebot bleibt leer');
  const novakOffer = db.prepare(`SELECT lead_id FROM offer_versions WHERE customer_email = 'andreas.novak@univie.ac.at'`).get();
  assert.strictEqual(Number(novakOffer.lead_id), novak.id);

  const emm = db.prepare(`SELECT * FROM leads WHERE lower(namen) LIKE '%emminger%'`).all();
  assert.strictEqual(emm.length, 1);
  assert.ok(searchLeads('Emminger').length === 1);
  assert.strictEqual(emm[0].status, 'Angebot gesendet');

  const kundeOffers = db.prepare(`SELECT lead_id FROM offer_versions WHERE filename_base LIKE 'Kunde_%'`).all();
  assert.strictEqual(kundeOffers.length, 2);
  assert.strictEqual(Number(kundeOffers[0].lead_id), Number(kundeOffers[1].lead_id), 'gleicher Dateiname-Name, ein Lead');

  const entwurf = leadByEmail('nur.entwurf@example.com');
  assert.strictEqual(entwurf.status, 'Neu');

  const again = await persist.backfillOrphanOfferCustomers();
  assert.strictEqual(again.linkedOffers, 0, 'zweiter Nachzug hängt nichts neu an');
  assert.strictEqual(countEmail('mputineanu@gmail.com'), 1);

  const stored = db.prepare(`SELECT customer_json FROM offer_versions WHERE filename_base = 'Putineanu_Marius_2026-0141-V1'`).get();
  const parsed = JSON.parse(stored.customer_json);
  assert.ok(parsed.name && parsed.name.includes('Putineanu'));
  assert.ok(parsed.address && parsed.address.includes('1220'));
  assert.ok('phone' in parsed && 'email' in parsed);

  console.log('ok test-manual-customers');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
