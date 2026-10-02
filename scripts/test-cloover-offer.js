#!/usr/bin/env node
/**
 * Cloover nur auf der Testinstanz, ohne zweiten Knopf.
 * Run: node scripts/test-cloover-offer.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDb = path.join(os.tmpdir(), `pvl-cloover-${process.pid}.db`);
process.env.SQLITE_LEADS_DB = tmpDb;
delete process.env.CLOOVER_API_KEY;
delete process.env.APP_BASE_PATH;

const catalog = require('../src/offer/catalog');
const cloover = require('../src/offer/cloover');
const { buildEmailText } = require('../src/offer/email');
const persist = require('../src/offer/persist');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  ok  ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

const CUSTOMER = {
  vorname: 'Anna',
  nachname: 'Berger',
  email: 'anna.berger@example.com',
  phone: '+436641112233',
  street: 'Hauptstraße 4',
  zip: '1010',
  city: 'Wien',
};

function pvOffer(optionen, extra) {
  return catalog.computeOffer(Object.assign({
    brand: 'sigenergy',
    moduleCount: 20,
    speicher: 6,
    dach: 'Ziegel',
    moduleType: 'das',
    optionen: optionen || [],
    angebotsnummer: '2026-0042',
  }, extra || {}));
}

function sumIncl(body) {
  const assets = (body.assets || []).reduce((s, a) => s + a.priceInclVat, 0);
  const groups = (body.assetGroups || []).reduce((s, a) => s + a.priceInclVat, 0);
  return catalog.roundInvoiceCents(assets + groups);
}

function noVatRate(value) {
  return !JSON.stringify(value).includes('vatRatePercent') && !JSON.stringify(value).includes('"subsidy"');
}

async function main() {
  console.log('Testinstanz');
  assert(cloover.isClooverTestInstance() === false, 'ohne APP_BASE_PATH ist Cloover aus');
  process.env.APP_BASE_PATH = '/';
  assert(cloover.isClooverTestInstance() === false, 'Production-Root ruft Cloover nicht');
  process.env.APP_BASE_PATH = '/live';
  assert(cloover.isClooverTestInstance() === false, 'anderer Pfad ist nicht die Testinstanz');
  process.env.APP_BASE_PATH = '/test';
  assert(cloover.isClooverTestInstance() === true, 'APP_BASE_PATH=/test schaltet Cloover ein');
  delete process.env.APP_BASE_PATH;

  console.log('Adresse');
  const split = cloover.splitStreetAndNumber('Hauptstraße 12a');
  assert(split.ok && split.street === 'Hauptstraße' && split.streetNumber === '12a', 'Hausnummer 12a');
  const slash = cloover.splitStreetAndNumber('Am Hof 12/3');
  assert(slash.ok && slash.streetNumber === '12/3', 'Hausnummer mit Stiege');
  assert(cloover.splitStreetAndNumber('Hauptstraße').ok === false, 'ohne Hausnummer kein Aufruf');
  assert(cloover.countryFromZip('1010') === 'AT', 'vierstellige PLZ ist AT');
  assert(cloover.countryFromZip('50667') === 'DE', 'fünfstellige PLZ ist DE');
  assert(cloover.countryFromZip('101') === '', 'kurze PLZ hat kein Land');

  console.log('Preise');
  const withOptional = pvOffer([
    { key: 'wallbox', mode: 'optional', price: 1500 },
    { key: 'notstrom', mode: 'fix' },
  ]);
  const financedOptional = cloover.buildFinancedAssets(withOptional);
  assert(financedOptional.ok, 'PV mit Speicher ist finanzierbar');
  assert(financedOptional.assetGroups.length === 1, 'Solar und Speicher sind eine Gruppe');
  assert(financedOptional.assetGroups[0].types.join(',') === 'SOLAR,BATTERY', 'Gruppe enthält SOLAR und BATTERY');
  assert(!financedOptional.assets.some((a) => a.type === 'WALLBOX'), 'optionale Wallbox bleibt draußen');
  assert(financedOptional.assetGroups[0].priceInclVat === catalog.roundInvoiceCents(withOptional.preis.brutto), 'Gruppenpreis ist der Angebots-Brutto');
  const excl = financedOptional.assetGroups[0].priceExclVat;
  const expectedNet = catalog.roundInvoiceCents(financedOptional.assetGroups[0].priceInclVat / 1.2);
  assert(excl === expectedNet, 'Netto ist Brutto/1,20 auf Cent wie die MwSt-Anzeige');
  assert(catalog.formatEUR(excl) === catalog.formatEUR(withOptional.preis.brutto / 1.2), 'Netto-Anzeige stimmt mit dem Angebot überein');
  assert(noVatRate(financedOptional), 'kein vatRatePercent und keine Förderung');

  const withFixWallbox = pvOffer([{ key: 'wallbox', mode: 'fix', price: 1500 }]);
  const financedFix = cloover.buildFinancedAssets(withFixWallbox);
  const wallbox = financedFix.assets.find((a) => a.type === 'WALLBOX');
  assert(wallbox && wallbox.priceInclVat === 1500 && wallbox.capacity === 11, 'fixe Wallbox 11 kW mit eigenem Preis');
  assert(sumIncl({ assets: financedFix.assets, assetGroups: financedFix.assetGroups }) === catalog.roundInvoiceCents(withFixWallbox.preis.brutto), 'Wallbox plus Gruppe ergeben den Brutto');

  const batteryOnly = catalog.computeOffer({
    includePv: false,
    brand: 'sigenergy',
    optionen: [],
    speicherZusatz: [{ kwh: 6, price: 3600, mode: 'fix' }],
  });
  const financedBattery = cloover.buildFinancedAssets(batteryOnly);
  assert(financedBattery.ok && financedBattery.assets.length === 1 && financedBattery.assets[0].type === 'BATTERY', 'reiner Speicherblock ist BATTERY');
  assert(!financedBattery.assetGroups.length, 'reiner Speicher ist keine Gruppe');

  const klima = catalog.computeOffer({
    includePv: false,
    klima: { enabled: true, packageId: 'lg-std2-single-25', mode: 'fix' },
  });
  const financedKlima = cloover.buildFinancedAssets(klima);
  assert(financedKlima.ok === false, 'Klimagerät ohne Wärmepumpe hat keinen Cloover-Typ');
  assert(!JSON.stringify(financedKlima).includes('HEAT_PUMP'), 'kein HEAT_PUMP fürs Klimagerät');

  console.log('Projekt anlegen');
  let calls = 0;
  const rows = [];
  const store = {
    loadStored: (num, cents) => rows.find((r) => r.angebotsnummer === num && r.bruttoCents === cents) || null,
    loadLatest: (num) => rows.filter((r) => r.angebotsnummer === num).slice(-1)[0] || null,
    saveStored: (row) => { rows.push(row); },
  };
  const fetchImpl = async (url, opts) => {
    calls += 1;
    const body = JSON.parse(opts.body);
    assert(url === 'https://dev.cloover.com/api/partners/v1/projects', 'Test-Basis dev.cloover.com');
    assert(opts.headers.Authorization === 'Bearer test-key', 'Bearer aus der übergebenen Umgebung');
    assert(opts.headers['Cloover-User-Email'] === 'vertrieb@noortec.at', 'Cloover-User-Email');
    assert(opts.headers['Idempotency-Key'].includes('2026-0042'), 'Idempotenz über die Angebotsnummer');
    assert(body.delivery === 'EMAIL', 'Cloover schickt die Mail selbst');
    assert(body.offerDocuments[0].contentBase64.length > 10, 'PDF liegt als Base64 bei');
    assert(body.paymentOptions.join(',') === 'FINANCING', 'Zahlungsart aus der Test-Doku');
    assert(body.financingDuration.minYears === 5 && body.financingDuration.maxYears === 15, 'Laufzeit aus der Test-Doku');
    assert(noVatRate(body), 'Projekt ohne vatRatePercent und ohne subsidy');
    assert(!JSON.stringify(body).includes('https://'), 'der Body erfindet keine Checkout-URL');
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({
        projectId: 'proj-1',
        checkoutLink: { url: 'https://dev.cloover.com/co/proj-1?t=real-token', expiresInSeconds: 60 },
        offerDocument: null,
      }),
    };
  };

  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
  const input = {
    offer: withFixWallbox,
    customer: CUSTOMER,
    pdfBuffer: pdf,
    filename: 'Berger_Anna_2026-0042-V1.pdf',
    angebotsnummer: '2026-0042',
  };

  const off = await cloover.runClooverCreate(input, {
    enabled: false,
    apiKey: 'test-key',
    fetchImpl: () => { throw new Error('Production darf Cloover nicht rufen'); },
    ...store,
  });
  assert(off.active === false && calls === 0, 'ausgeschaltete Instanz ruft nicht');

  const noPhone = await cloover.runClooverCreate(Object.assign({}, input, {
    customer: Object.assign({}, CUSTOMER, { phone: '' }),
  }), { enabled: true, apiKey: 'test-key', fetchImpl, ...store });
  assert(noPhone.ok === false && /Telefon fehlt/.test(noPhone.message) && calls === 0, 'fehlendes Telefon stoppt vor dem Aufruf');

  const noNumber = await cloover.runClooverCreate(Object.assign({}, input, {
    customer: Object.assign({}, CUSTOMER, { street: 'Hauptstraße' }),
  }), { enabled: true, apiKey: 'test-key', fetchImpl, ...store });
  assert(noNumber.ok === false && /Hausnummer/.test(noNumber.message) && calls === 0, 'Straße ohne Hausnummer stoppt vor dem Aufruf');

  const noKey = await cloover.runClooverCreate(input, { enabled: true, apiKey: '', fetchImpl, ...store });
  assert(noKey.ok === false && /CLOOVER_API_KEY/.test(noKey.message) && calls === 0, 'ohne Testschlüssel kein Aufruf');

  const created = await cloover.runClooverCreate(input, { enabled: true, apiKey: 'test-key', fetchImpl, ...store });
  assert(created.ok && created.url === 'https://dev.cloover.com/co/proj-1?t=real-token', 'Checkout-Link kommt aus der Antwort');
  assert(created.sentence.endsWith(created.url), 'der Satz enthält genau diese URL');
  assert(calls === 1 && rows.length === 1, 'ein Projekt wird gespeichert');

  const again = await cloover.runClooverCreate(input, { enabled: true, apiKey: 'test-key', fetchImpl, ...store });
  assert(again.reused === true && again.url === created.url && calls === 1, 'gleicher Brutto nutzt den gespeicherten Link');

  const changed = pvOffer([{ key: 'wallbox', mode: 'fix', price: 1500 }], { bruttoOverride: withFixWallbox.preis.brutto + 500 });
  const resent = await cloover.runClooverCreate(Object.assign({}, input, { offer: changed }), {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async (url, opts) => {
      calls += 1;
      const body = JSON.parse(opts.body);
      assert(!opts.headers['Idempotency-Key'].endsWith(String(catalog.roundInvoiceCents(withFixWallbox.preis.brutto) * 100)), 'neuer Brutto, neuer Schlüssel');
      assert(sumIncl(body) === catalog.roundInvoiceCents(changed.preis.brutto), 'neuer Bruttopreis geht an Cloover');
      return {
        ok: true,
        status: 201,
        text: async () => JSON.stringify({
          projectId: 'proj-2',
          checkoutLink: { url: 'https://dev.cloover.com/co/proj-2?t=second', expiresInSeconds: 60 },
        }),
      };
    },
    ...store,
  });
  assert(resent.ok && resent.resend === true && /noch einmal/.test(resent.message), 'geänderter Brutto legt neu an und sagt die zweite Mail an');

  const down = await cloover.runClooverCreate(input, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async () => { throw new Error('timeout'); },
    loadStored: () => null,
    loadLatest: () => null,
    saveStored: () => {},
  });
  assert(down.ok === false && down.message === 'Cloover ist nicht erreichbar.', 'keine Antwort blockiert den Versand nicht als Exception');

  console.log('Preisrechner');
  let quoteCalls = 0;
  const groupedQuote = await cloover.runClooverQuote(withFixWallbox, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async () => { quoteCalls += 1; throw new Error('Gruppe darf nicht an den Preisrechner'); },
  });
  assert(groupedQuote.monthlyPayment == null && quoteCalls === 0, 'Solar plus Speicher wird nicht aufgeteilt, deshalb keine Rate');
  const batteryQuote = await cloover.runClooverQuote(batteryOnly, {
    enabled: true,
    apiKey: 'test-key',
    fetchImpl: async (url, opts) => {
      quoteCalls += 1;
      const body = JSON.parse(opts.body);
      assert(url.endsWith('/price-calculator'), 'Preisrechner-Pfad');
      assert(body.assets[0].priceExclVat === cloover.netFromGross(body.assets[0].priceInclVat), 'Preisrechner bekommt das Netto');
      assert(!body.assetGroups && !body.assets[0].vatRatePercent, 'Preisrechner ohne Gruppe und ohne vatRatePercent');
      return { ok: true, status: 200, text: async () => JSON.stringify({ monthlyPayment: 89.5, rateType: 'from', currency: 'EUR' }) };
    },
  });
  assert(batteryQuote.monthlyPayment === 89.5 && batteryQuote.rateType === 'from', 'Rate nur aus der Antwort');
  const silent = await cloover.runClooverQuote(batteryOnly, { enabled: false, apiKey: 'test-key', fetchImpl: async () => { throw new Error('production'); } });
  assert(silent.active === false && silent.monthlyPayment == null, 'Production fragt die Rate nicht ab');

  console.log('E-Mail');
  const url = created.url;
  const mail = buildEmailText({
    customer: CUSTOMER,
    offer: withFixWallbox,
    finanzierungUrl: url,
  });
  const greet = mail.body.search(/Mit freundlichen Gr[uü]ßen/i);
  const at = mail.body.indexOf(url);
  assert(at >= 0 && greet > at, 'der Link steht vor der Grußformel');
  assert(mail.body.indexOf(cloover.FINANCE_SENTENCE_LEAD + url) >= 0, 'der Satz ist wörtlich der Server-Satz');
  const plain = buildEmailText({ customer: CUSTOMER, offer: withFixWallbox });
  assert(!/cloover\.com/i.test(plain.body), 'ohne URL erfindet die Vorlage keine Adresse');
  const existing = 'Sehr geehrte Frau Berger,\n\nbitte um Rückmeldung.\n\nMit freundlichen Grüßen\n\nAnna';
  const kept = cloover.ensureFinanceSentence(existing, url);
  assert(kept.includes('bitte um Rückmeldung'), 'vorhandener Text wird nicht neu geschrieben');
  assert(kept.indexOf(url) < kept.search(/Mit freundlichen Gr/i), 'fehlender Link wird vor der Grußformel ergänzt');
  const invented = cloover.ensureFinanceSentence(`Bitte hier: https://cloover.com/fake\n\nMit freundlichen Grüßen`, url);
  assert(!invented.includes('https://cloover.com/fake'), 'eine erfundene Adresse bleibt nicht stehen');
  assert(invented.includes(url), 'die echte Adresse ersetzt sie');

  console.log('Speicher');
  persist.saveClooverProject({
    angebotsnummer: '2026-0042',
    bruttoCents: 100,
    projectId: 'proj-db',
    checkoutUrl: url,
  });
  const loaded = persist.getClooverProject('2026-0042', 100);
  assert(loaded && loaded.projectId === 'proj-db' && loaded.checkoutUrl === url, 'projectId und Link liegen in der Datenbank');
  assert(persist.updateOfferVersionEmail(999999, 'Betreff', 'Text') === false, 'fehlende Version wird nicht erfunden');

  const html = fs.readFileSync(path.join(__dirname, '../public/offer.html'), 'utf8');
  assert(html.includes('Angebot fertigstellen'), 'der Fertigstellen-Knopf bleibt');
  assert(!html.includes('Cloover-Projekt anlegen'), 'kein eigener Cloover-Knopf');
  assert(html.includes('payload.createCloover = true'), 'Fertigstellen setzt das Projekt auf der Testinstanz');
  assert(html.includes('insertFinanceSentence'), 'der Mailto-Text bekommt den echten Satz');
  assert(html.includes('refreshClooverQuote'), 'die Rate erscheint nur aus der Antwort');

  console.log(`\n${passed} ok, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
}).finally(() => {
  try { fs.unlinkSync(tmpDb); } catch (_) {}
  try { fs.unlinkSync(`${tmpDb}-shm`); } catch (_) {}
  try { fs.unlinkSync(`${tmpDb}-wal`); } catch (_) {}
});
