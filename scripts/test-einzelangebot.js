#!/usr/bin/env node
/**
 * Einzelangebot ohne Photovoltaikpaket und große PV-Anlage ohne Speicher.
 * Schreibt keine leads.db.
 * Run: node scripts/test-einzelangebot.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/offer/catalog');
const { normalizeOffer } = require('../src/offer/ai-offer');
const { selectDatasheetsForOffer } = require('../src/offer/datasheets');
const { pdfPageFlags } = require('../src/offer/pdf');
const { buildEmailText } = require('../src/offer/email');

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

function blockPrice(brand, kwh) {
  const hit = (catalog.STORAGE_EXTENSIONS[brand] || []).find((e) => Math.abs(e.kwh - kwh) < 0.05);
  return hit ? hit.price : null;
}

function testPartsCommand() {
  console.log('Sprachbefehl nur Positionen');
  const text = 'Sigenergy Speichererweiterung 10.0 und Montage 800 Euro.';
  const parsed = normalizeOffer({}, text);
  const req = parsed.requirements;
  assert(req.includePv === false, 'includePv false');
  assert(req.module_count === 0, 'moduleCount 0');
  assert(req.speicher == null, 'kein Anlagenspeicher');
  assert(Array.isArray(req.speicherZusatz) && req.speicherZusatz.length === 1, 'ein Speicherblock');
  assert(req.speicherZusatz[0].kwh === 10, 'Block 10.0');
  assert(blockPrice('sigenergy', 10) === 3600, 'Katalog 10.0 = 3600');
  assert(blockPrice('sigenergy', 6) === 2400, 'Katalog 6.0 = 2400');
  assert(blockPrice('fronius', 3.2) === 1320, 'Fronius +3,2 = 1320');
  const montage = (req.optionenList || []).find((o) => /montage/i.test(o.label || ''));
  assert(montage && montage.price === 800, 'Montage 800 €');
  assert(parsed.clarifications.some((c) => c.id === 'parts_only'), 'Chip Angebot nur für diese Positionen');
  assert(parsed.clarifications.some((c) => /doch mit anlage/i.test((c.answers || []).map((a) => a.label).join(' '))), 'Doch mit Anlage');
  assert(parsed.needsClarification === false, 'der Chip blockiert den Entwurf nicht');
  assert(req.brand !== 'huawei', 'kein Huawei');

  const nine = normalizeOffer({}, '9 kWh Sigenergy Speichererweiterung');
  assert(nine.requirements.includePv === false, '9 kWh Erweiterung ist kein Anlagenpaket');
  assert(nine.requirements.speicherZusatz[0] && nine.requirements.speicherZusatz[0].kwh === 10, '9 kWh wird Block 10.0');

  const open = normalizeOffer({}, 'Montage ohne Betrag');
  const openMontage = (open.requirements.optionenList || []).find((o) => /montage/i.test(o.label || ''));
  assert(openMontage && openMontage.price == null, 'Montage ohne Betrag bleibt leer');
  assert(open.clarifications.some((c) => c.id === 'montage_price'), 'Chip fragt den Montagebetrag');

  const plant = normalizeOffer({}, '22 Module und Speicher 10.0');
  assert(plant.requirements.includePv === true, '22 Module bleiben eine Anlage');
  assert(plant.requirements.module_count === 22, '22 Module');
  assert(plant.requirements.speicher === 10, 'Speicher 10 bleibt am Paket');
  const full = catalog.computeOffer({
    includePv: true,
    brand: plant.requirements.brand,
    moduleCount: plant.requirements.module_count,
    speicher: plant.requirements.speicher,
    dach: 'Ziegel',
  });
  assert(full.meta.offerKind === 'pv', 'normales Angebot ist PV');
  assert(full.quoteLines.some((l) => l.role === 'module' && l.active !== false), 'Anlage enthält Module');
  assert(full.config.moduleCount === 22, 'keine leere Anlage');
}

function testComputeParts() {
  console.log('Kalkulation ohne erfundene Module');
  const offer = catalog.computeOffer({
    includePv: false,
    brand: 'sigenergy',
    moduleCount: 0,
    speicher: null,
    speicherZusatz: [{ kwh: 10, mode: 'fix', brand: 'sigenergy' }],
    optionen: [{ label: 'Freie Leitung', price: 500, mode: 'fix' }],
  });
  assert(offer.config.moduleCount === 0, 'keine Module');
  assert(!offer.quoteLines.some((l) => l.role === 'module'), 'keine Modulzeile');
  assert(!offer.quoteLines.some((l) => l.role === 'inverter'), 'kein Wechselrichter');
  assert(offer.preis.speicherZusatzPreis === 3600, 'Block zum Katalogpreis');
  assert(offer.preis.brutto === 4100, 'Block plus freie Zeile');
  assert(offer.meta.offerKind === 'einzel', 'offerKind einzel');
  assert(!/5,84|5\.84|8,76|8\.76/.test(JSON.stringify(offer.config.speicherLabel || '')), 'keine alte Nutzkapazität');
  assert(offer.config.speicher === 9.04, 'nutzbar 9,04 kWh');

  const sheets = selectDatasheetsForOffer(offer, { includeMissing: true });
  assert(sheets.some((s) => s.kind === 'storage'), 'Datenblatt nur für den Speicher');
  assert(!sheets.some((s) => s.kind === 'inverter' || s.kind === 'module'), 'kein Modul- oder WR-Blatt');

  const mail = buildEmailText({
    customer: { vorname: 'Anna', nachname: 'Berger' },
    offer,
  });
  assert(!/schlüsselfertig/i.test(mail.subject + mail.body), 'keine schlüsselfertige kWp-Anlage');
  assert(!/Vollmacht/i.test(mail.body), 'keine Vollmacht');
  assert(!/Klimaanlagen an/i.test(mail.body), 'kein Klima-Hinweis wie bei PV');
  assert(!/Datenblatt|datenblaetter|datasheet/i.test(mail.body), 'Mail ohne Datenblatt');
  const withSheet = buildEmailText({
    customer: { vorname: 'Anna', nachname: 'Berger' },
    offer,
    extraText: 'Datenblätter:\n- Sigenergy SigenStor BAT: https://pvl.lifeco.at/datenblaetter/sigenstor.pdf',
  });
  assert(!/Datenblatt|datenblaetter|datasheet/i.test(withSheet.body), 'eingefügter Datenblatt-Abschnitt fällt weg');
  assert(/Mit freundlichen Gr/i.test(withSheet.body), 'Signatur bleibt');
  assert(pdfPageFlags({ hasLayout: true, consumptionEntered: true, serviceCount: 2, offerKind: 'einzel' }).yield === false, 'keine Ertragsseite');
  assert(pdfPageFlags({ hasLayout: false, consumptionEntered: false, serviceCount: 0 }).yield === true, 'PV-Ertragsseite bleibt der Standard');

  const piping = catalog.computeOffer({
    includePv: false,
    klima: { extraPipingMeters: 2, condensatePump: true },
  });
  assert(piping.config.moduleCount === 0, 'Leitung ohne erfundene Module');
  assert(piping.preis.klimaSumme === 320, '2 m Leitung und Pumpe');
  assert(piping.meta.offerKind === 'einzel', 'Zubehör ohne Paket ist einzel');

  const klima = catalog.computeOffer({
    includePv: false,
    klima: { enabled: true, packageId: 'lg-std2-single-25' },
  });
  assert(klima.meta.offerKind === 'klima', 'Klimapaket bleibt Klima');
}

function testNoStorage() {
  console.log('Große Anlage ohne Speicher');
  const forty = normalizeOffer({}, '40 Module ohne Speicher');
  assert(forty.requirements.includePv === true, '40 Module sind eine Anlage');
  assert(forty.requirements.module_count === 40, '40 Module');
  assert(forty.requirements.speicher === 0, 'speicher 0');
  assert(forty.requirements.brand === 'fronius_symo', 'ohne Marke wird Symo');
  assert(forty.requirements.brand !== 'huawei', 'kein Huawei');

  const offer = catalog.computeOffer({
    includePv: true,
    brand: forty.requirements.brand,
    moduleCount: 40,
    speicher: 0,
    dach: 'Ziegel',
    moduleType: 'das',
  });
  assert(offer.preis.basePrice === 15540, '14,8 kWp ohne Speicher, nicht 0 €');
  assert(offer.preis.extraModules === 6, 'sechs Zusatzmodule');
  assert(offer.preis.brutto === 16980, 'Paket plus 6 × 200 € netto');
  assert(offer.config.speicherBasis === 0, 'bleibt bei keinem Speicher');
  assert(offer.config.inverterKw === 17.5, 'Symo 17,5 kW');
  assert(!/huawei/i.test(offer.config.brand + offer.config.inverter), 'Wechselrichter nicht Huawei');
  assert(!offer.quoteLines.some((l) => l.role === 'storage'), 'keine Speicherzeile');
  assert(offer.meta.offerKind === 'pv', 'ohne Speicher bleibt PV');
  assert(offer.quoteLines.some((l) => l.id === 'svc:installation'), 'Leistungen bleiben');

  const kwp = normalizeOffer({}, '20 kWp ohne Speicher');
  assert(kwp.requirements.speicher === 0, '20 kWp speicher 0');
  assert(kwp.requirements.module_count === 44, '20 kWp sind 44 Module à 455 Wp');
  assert(kwp.requirements.brand === 'fronius_symo', '20 kWp ohne Marke ist Symo');
  const big = catalog.computeOffer({
    includePv: true,
    brand: 'fronius_symo',
    moduleCount: kwp.requirements.module_count,
    speicher: 0,
    dach: 'Ziegel',
  });
  assert(big.preis.basePrice === 17400, '17,8 kWp ohne Speicher');
  assert(big.preis.brutto === 18120, 'drei Zusatzmodule');
  assert(big.config.inverterKw === 20, 'Symo 20 kW');
  assert(big.config.speicherBasis === 0, 'springt nicht auf die erste Speicherstufe');

  const sigen = catalog.computeOffer({
    includePv: true,
    brand: 'sigenergy',
    moduleCount: 40,
    speicher: 0,
    dach: 'Ziegel',
  });
  assert(sigen.preis.brutto === 16980, 'Sigenergy ohne Speicher nutzt die PV-Liste');
  assert(sigen.config.speicherBasis === 0, 'Sigenergy-Speicher bleibt aus');
  assert(/TP2/i.test(sigen.config.inverter), 'Wechselrichter aus dem Sigenergy-Katalog');
  assert(sigen.config.inverterKw === 12, 'TP2 bis 12 kW');
  assert(!/huawei/i.test(sigen.config.inverter), 'Sigenergy-Pfad ohne Huawei');

  const named = normalizeOffer({}, 'Sigenergy ohne Speicher, 40 Module');
  assert(named.requirements.brand === 'sigenergy', 'genannte Marke bleibt');
  assert(named.requirements.speicher === 0, 'genannte Marke ohne Speicher');
}

function testFormHooks() {
  console.log('Formular hält 0 Module und Kein Speicher');
  const html = fs.readFileSync(path.join(__dirname, '../public/offer.html'), 'utf8');
  assert(html.includes('Kein Speicher'), 'Speicherauswahl hat Kein Speicher');
  assert(html.includes('id="pos-search"'), 'Position hinzufügen');
  assert(html.includes('id="positions-block"'), 'Positionsliste bleibt eigene Fläche');
  assert(/speicher === 0 \|\| cfg\.speicher === '0'/.test(html), 'speicher 0 wird geschrieben');
  assert(/optionen: readOptionRows\(\)/.test(html), 'Positionen bleiben bei Photovoltaik aus');
  const readStart = html.indexOf('function readForm');
  const readFn = html.slice(readStart, html.indexOf('function writeForm'));
  assert(!/optionen: includePv \? readOptionRows\(\)/.test(readFn), 'Photovoltaik aus löscht die Zeilen nicht');
}

testPartsCommand();
testComputeParts();
testNoStorage();
testFormHooks();

console.log(`\n${passed} ok, ${failed} fehlgeschlagen`);
if (failed) process.exit(1);
