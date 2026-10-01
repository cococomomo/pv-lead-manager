'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dbPath = path.join(os.tmpdir(), `pvl-lead-contact-${process.pid}.db`);
for (const ext of ['', '-wal', '-shm']) {
  try { fs.unlinkSync(dbPath + ext); } catch (_) { /* fresh */ }
}
process.env.SQLITE_LEADS_DB = dbPath;

const {
  updateLeadContactById,
  updateLeadField,
  updateLeadFieldById,
  updateLeadFieldsBulk,
  getLeadByEmail,
  getLeadById,
} = require('../src/sheets');
const { getDb } = require('../src/database');

function insertLead(db, row) {
  const info = db.prepare(`
    INSERT INTO leads (
      anfrage, namen, telefon, email, strasse, plz, ort, notizen, latitude, longitude, status
    ) VALUES (
      @anfrage, @namen, @telefon, @email, @strasse, @plz, @ort, @notizen, @latitude, @longitude, 'Neu'
    )
  `).run(row);
  return Number(info.lastInsertRowid);
}

(async () => {
  const db = getDb();
  const noEmailId = insertLead(db, {
    anfrage: 'T9001',
    namen: 'Foltin Michaela',
    telefon: '',
    email: '',
    strasse: '',
    plz: '',
    ort: '',
    notizen: 'alt',
    latitude: null,
    longitude: null,
  });
  const pinnedId = insertLead(db, {
    anfrage: 'T9002',
    namen: 'Pin Bleibt',
    telefon: '0043 650 1111111',
    email: 'pin@example.com',
    strasse: 'Pinstraße 1',
    plz: '1010',
    ort: 'Wien',
    notizen: 'pin-notiz',
    latitude: 48.2082,
    longitude: 16.3738,
  });
  const withPinNoEmailId = insertLead(db, {
    anfrage: 'T9003',
    namen: 'Hat Punkt',
    telefon: '111',
    email: '',
    strasse: 'Altstraße 2',
    plz: '1020',
    ort: 'Wien',
    notizen: '',
    latitude: 47.0707,
    longitude: 15.4395,
  });

  const pinnedBefore = db.prepare('SELECT * FROM leads WHERE id = ?').get(pinnedId);

  await updateLeadContactById(noEmailId, {
    'Nachname + Vorname': 'Foltin Michaela',
    Telefon: '0043 650 2828298',
    'E-Mail': '',
    Straße: 'Testgasse 4',
    PLZ: '1100',
    Ort: 'Wien',
  });
  const saved = db.prepare('SELECT * FROM leads WHERE id = ?').get(noEmailId);
  assert.strictEqual(saved.namen, 'Foltin Michaela');
  assert.strictEqual(saved.telefon, '0043 650 2828298');
  assert.strictEqual(String(saved.email || ''), '');
  assert.strictEqual(saved.strasse, 'Testgasse 4');
  assert.strictEqual(saved.plz, '1100');
  assert.strictEqual(saved.ort, 'Wien');
  assert.strictEqual(saved.latitude, null);
  assert.strictEqual(saved.longitude, null);
  assert.strictEqual(saved.notizen, 'alt');

  const pinnedAfterContact = db.prepare('SELECT * FROM leads WHERE id = ?').get(pinnedId);
  assert.deepStrictEqual(
    {
      namen: pinnedAfterContact.namen,
      telefon: pinnedAfterContact.telefon,
      email: pinnedAfterContact.email,
      strasse: pinnedAfterContact.strasse,
      plz: pinnedAfterContact.plz,
      ort: pinnedAfterContact.ort,
      notizen: pinnedAfterContact.notizen,
      latitude: pinnedAfterContact.latitude,
      longitude: pinnedAfterContact.longitude,
    },
    {
      namen: pinnedBefore.namen,
      telefon: pinnedBefore.telefon,
      email: pinnedBefore.email,
      strasse: pinnedBefore.strasse,
      plz: pinnedBefore.plz,
      ort: pinnedBefore.ort,
      notizen: pinnedBefore.notizen,
      latitude: pinnedBefore.latitude,
      longitude: pinnedBefore.longitude,
    },
  );

  await updateLeadFieldById(noEmailId, 'Notizen', 'ohne mail');
  assert.strictEqual(db.prepare('SELECT notizen FROM leads WHERE id = ?').get(noEmailId).notizen, 'ohne mail');
  assert.strictEqual(db.prepare('SELECT latitude FROM leads WHERE id = ?').get(pinnedId).latitude, 48.2082);

  await updateLeadContactById(noEmailId, {
    'Nachname + Vorname': 'Foltin Michaela',
    Telefon: '0043 650 2828298',
    'E-Mail': 'foltin@example.com',
    Straße: 'Testgasse 4',
    PLZ: '1100',
    Ort: 'Wien',
  });
  const withMail = await getLeadByEmail('foltin@example.com');
  assert.ok(withMail);
  assert.strictEqual(Number(withMail.pvlDbId), noEmailId);
  assert.strictEqual(withMail.latitude, null);
  assert.strictEqual(withMail.longitude, null);

  await updateLeadField('foltin@example.com', 'Notizen', 'mit mail');
  assert.strictEqual(db.prepare('SELECT notizen FROM leads WHERE id = ?').get(noEmailId).notizen, 'mit mail');
  assert.strictEqual(db.prepare('SELECT notizen FROM leads WHERE id = ?').get(pinnedId).notizen, 'pin-notiz');
  assert.strictEqual(db.prepare('SELECT latitude FROM leads WHERE id = ?').get(pinnedId).latitude, 48.2082);
  assert.strictEqual(db.prepare('SELECT longitude FROM leads WHERE id = ?').get(pinnedId).longitude, 16.3738);

  await updateLeadContactById(withPinNoEmailId, {
    Telefon: '222',
    Straße: 'Altstraße 2',
    PLZ: '1020',
    Ort: 'Wien',
  });
  const stillPinned = db.prepare('SELECT telefon, latitude, longitude FROM leads WHERE id = ?').get(withPinNoEmailId);
  assert.strictEqual(stillPinned.telefon, '222');
  assert.strictEqual(stillPinned.latitude, 47.0707);
  assert.strictEqual(stillPinned.longitude, 15.4395);

  await updateLeadFieldsBulk('pin@example.com', { Telefon: '0043 650 1111111', Notizen: 'pin-notiz' });
  const pinnedUntouched = await getLeadById(pinnedId);
  assert.strictEqual(pinnedUntouched.latitude, 48.2082);
  assert.strictEqual(pinnedUntouched.longitude, 16.3738);
  const otherUntouched = await getLeadById(noEmailId);
  assert.strictEqual(otherUntouched.latitude, null);
  assert.strictEqual(otherUntouched['E-Mail'], 'foltin@example.com');

  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('class="mc-open-name"'), 'Name in der Liste ohne Punkt ist klickbar');
  assert.ok(html.includes('skipMapFocus: true'), 'Seitenansicht ohne Kartenverschiebung');
  assert.ok(html.includes('openMissingCoordsLead'), 'Namensklick öffnet den Lead');
  assert.ok(html.includes('missing-lead-tel"><a href='), 'Telefon bleibt ein tel-Link');
  assert.ok(html.includes('btn-mini-tel" href='), 'Anrufen-Button bleibt');
  assert.ok(html.includes('mc-save'), 'Speichern bleibt');
  assert.ok(html.includes('mc-st-termin'), 'Termin bleibt');
  assert.ok(html.includes('mc-st-arch'), 'Archivieren bleibt');
  assert.ok(html.includes('color: #e11d48'), 'Rosa Detailzeile bleibt');
  assert.ok(html.includes('/api/lead-rows/\' + id + \'/contact\''), 'Speichern ohne E-Mail geht über die Id');
  assert.ok(html.includes('/api/leads/${encodeURIComponent(newEmail)}/field'), 'Danach gilt die E-Mail für weitere Felder');
  assert.ok(html.includes('/api/lead-rows/\' + id + \'/regeocode\''), 'Geocoding ohne E-Mail-Schlüssel geht über die Id');
  assert.ok(!html.includes('maybeOfferReonicTransfer'), 'Reonic-Nachfrage bleibt weg');

  console.log('ok lead contact by id');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
