#!/usr/bin/env node
/**
 * KI-Entwurf bei abgeschnittenem JSON, Rückfragen blockieren die Mail nicht,
 * gestrichener Wechselrichter, Optimierer ohne Huawei, leere PDF-Seiten.
 * Run: node scripts/test-offer-lines.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const catalog = require('../src/offer/catalog');
const { selectDatasheetsForOffer } = require('../src/offer/datasheets');
const { buildComponentCards, guessImageForItem } = require('../src/offer/product-images');
const { parseOfferCommand, normalizeOffer } = require('../src/offer/ai-offer');
const { pdfPageFlags, activeLeistungen } = require('../src/offer/pdf');
const { computeEconomics } = require('../src/offer/economics');

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

const SAMPLE = [
  'Frau Anna Berger',
  'Hauptstraße 4',
  '1010 Wien',
  'anna.berger@example.com',
  '12 Module, 5,46 kWp, Speicher 6 kWh, 15000 € brutto',
].join('\n');

async function testTruncatedDraft() {
  console.log('abgeschnittenes JSON');
  let calls = 0;
  const parsed = await parseOfferCommand(SAMPLE, {
    complete: async () => {
      calls += 1;
      return { text: '{"customer":{"vorname":"Anna"', truncated: true };
    },
  });
  assert(calls === 2, 'bei Länge genau ein zweiter Versuch');
  assert(parsed.draftFromText === true, 'Entwurf aus dem Text');
  assert(parsed.requirements.module_count === 12, 'Modulzahl aus dem Text');
  assert(Math.abs(parsed.requirements.kwp - 5.46) < 0.001, 'kWp aus dem Text');
  assert(parsed.requirements.speicher === 6, 'Speicher aus dem Text');
  assert(parsed.requirements.brutto_preis === 15000, 'Brutto aus dem Text');
  assert(parsed.customer.vorname === 'Anna', 'Vorname aus dem Text');
  assert(parsed.customer.nachname === 'Berger', 'Nachname aus dem Text');
  assert(parsed.customer.email === 'anna.berger@example.com', 'E-Mail aus dem Text');
  assert(parsed.customer.zip === '1010', 'PLZ aus dem Text');
  assert(parsed.requirements.brand === 'sigenergy', 'Marke ohne Angabe ist Sigenergy');
  assert(parsed.requirements.dach === 'Ziegel', 'Dach ohne Angabe ist Ziegel');
}

async function testClarificationStillDrafts() {
  console.log('Rückfrage lässt den Entwurf stehen');
  const raw = {
    customer: { vorname: 'Anna', nachname: 'Berger', email: 'anna.berger@example.com' },
    requirements: {
      includePv: true,
      brand: null,
      kwp: null,
      module_count: null,
      speicher: 6,
      dach: null,
    },
    clarifications: [
      { id: 'brand', question: 'Welche Marke?', answers: [{ label: 'Sigenergy', text: 'Marke Sigenergy' }] },
      { id: 'dach', question: 'Welches Dach?', answers: [{ label: 'Ziegel', text: 'Dach Ziegel' }] },
    ],
  };
  const parsed = normalizeOffer(raw, 'Speicher 6 kWh, bitte ein Angebot.');
  assert(parsed.needsClarification === true, 'Rückfrage wegen fehlender Modulzahl');
  assert(parsed.clarifications.some((c) => c.id === 'pv_modules'), 'Chip nur zur Modulzahl');
  assert(!parsed.clarifications.some((c) => /marke|dach/i.test(c.id + c.question)), 'keine Chips für Marke oder Dach');
  assert(parsed.requirements.brand === 'sigenergy', 'Standard Sigenergy');
  assert(parsed.requirements.dach === 'Ziegel', 'Standard Ziegel');
  assert(parsed.requirements.speicher === 6, 'Speicher bleibt im Entwurf');

  const html = fs.readFileSync(path.join(__dirname, '../public/offer.html'), 'utf8');
  const start = html.indexOf('async function parseCommand');
  const end = html.indexOf('async function genEmailText');
  const fn = html.slice(start, end);
  assert(fn.includes('genEmailText()'), 'parseCommand ruft den E-Mail-Entwurf auf');
  assert(!/if\s*\(\s*!j\.needsClarification\s*\)[\s\S]{0,500}genEmailText\(/.test(fn), 'Rückfrage überspringt den E-Mail-Entwurf nicht');
  assert(!/needsClarification\)[\s\S]{0,180}toast\([^)]*'error'/.test(fn), 'Rückfrage-Toast ist kein Fehler');
  assert(/needsClarification\)[\s\S]{0,220}toast\([^)]*'hint'/.test(fn), 'Rückfrage-Toast ist ein Hinweis');
}

function testInverterRemoval() {
  console.log('Wechselrichter streichen');
  const base = {
    brand: 'sigenergy',
    moduleCount: 22,
    speicher: 6,
    dach: 'Ziegel',
    includePv: true,
  };
  const full = catalog.computeOffer(base);
  const inv = full.quoteLines.find((l) => l.role === 'inverter');
  assert(inv && inv.active, 'Wechselrichter ist standardmäßig an');
  const cut = catalog.computeOffer({ ...base, disabledLines: [inv.id] });
  const invOff = cut.quoteLines.find((l) => l.role === 'inverter');
  assert(invOff && invOff.active === false, 'Zeile bleibt in der Liste und ist aus');
  const sectionNames = cut.sections.flatMap((s) => (s.items || []).map((i) => i.name));
  assert(!sectionNames.includes(inv.name), 'PDF-Stückliste ohne Wechselrichter');
  const cards = buildComponentCards(cut);
  assert(!cards.some((c) => c.role === 'inverter'), 'PDF-Karten ohne Wechselrichter');
  const sheets = selectDatasheetsForOffer(cut, { includeMissing: true });
  assert(!sheets.some((s) => s.kind === 'inverter'), 'kein Wechselrichter-Datenblatt');
  assert(cut.config.linePresence.inverter === false, 'Zeilenstatus ohne Wechselrichter');
  assert(cut.config.kwpCalculated === full.config.kwpCalculated, 'Ertrag bleibt der Modulertrag');
  assert(cut.preis.packageBrutto === full.preis.packageBrutto, 'kein erfundener Positionsrabatt');
  assert(cut.preis.pdfBlocked === true, 'PDF blockiert bis zur Preisbestätigung');
  const uk = cut.quoteLines.filter((l) => l.role === 'unterkonstruktion');
  assert(uk.length && uk.every((l) => l.active), 'Unterkonstruktion bleibt an');
  const montage = cut.quoteLines.find((l) => l.id === 'svc:installation');
  assert(montage && montage.active, 'Montage bleibt eine normale Zeile');

  const confirmed = catalog.computeOffer({
    ...base,
    disabledLines: [inv.id],
    bruttoOverride: full.preis.packageBrutto,
    bruttoConfirm: { ids: [inv.id], amount: full.preis.packageBrutto },
  });
  assert(confirmed.preis.pdfBlocked === false, 'derselbe Betrag gibt das PDF frei');
  assert(confirmed.preis.brutto === full.preis.packageBrutto, 'bestätigter Preis ist der Paketpreis');
}

function testOptimizerLabel() {
  console.log('Optimierer ohne Huawei');
  assert(!/huawei/i.test(catalog.OPTIONS.optimierer.label), 'Kataloglabel ohne Huawei');
  assert(catalog.OPTIONS.optimierer.label === 'Optimierer (1 pro Modul)', 'Label Optimierer (1 pro Modul)');
  assert(catalog.OPTIONS.optimierer.price === 50, '50 € pro Modul');
  const offer = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 10,
    speicher: 6,
    dach: 'Ziegel',
    optionen: [{ key: 'optimierer', mode: 'fix', label: 'Optimierer Huawei (1 pro Modul)', price: null }],
  });
  const line = offer.quoteLines.find((l) => l.role === 'optimierer');
  assert(line && line.name === 'Optimierer (1 pro Modul)', 'Stückliste ohne Huawei');
  assert(!/huawei/i.test(JSON.stringify(offer.sections)), 'PDF-Abschnitte ohne Huawei-Optimierer');
  const opt = (offer.preis.inkludiert || []).find((i) => i.key === 'optimierer');
  assert(opt && opt.price === 500, '10 Module × 50 €');
}

function testPdfPages() {
  console.log('PDF-Seiten');
  const empty = pdfPageFlags({ hasLayout: false, consumptionEntered: false, serviceCount: 0 });
  assert(empty.layout === false, 'ohne Belegungsplan keine Layoutseite');
  assert(empty.household === false, 'ohne Verbrauch kein Haushaltsfluss');
  assert(empty.amortization === false, 'ohne Verbrauch keine Amortisation');
  assert(empty.yield === true, 'Ertragsseite bleibt');
  assert(empty.leistungen === false, 'ohne Leistungen keine Leistungsseite');
  const full = pdfPageFlags({ hasLayout: true, consumptionEntered: true, serviceCount: 2 });
  assert(full.layout && full.household && full.amortization && full.leistungen, 'volle Seiten wenn Daten da sind');
  assert(activeLeistungen([{ leistungKey: 'installation' }]).length === 1, 'nur aktive Leistung');
  assert(activeLeistungen([]).length === 0, 'keine Leistung, keine Seite');

  const eco = computeEconomics(
    { config: { kwp: 10, speicher: 6, linePresence: { storage: false } }, preis: { brutto: 15000 } },
    { balance: { available: true, consumptionEntered: false, annualYield: 9000, monthly: [], autarky: 0.5 } },
  );
  assert(eco.consumptionEntered === false, 'Verbrauch fehlt');
  assert(eco.yearly.length === 0, 'Amortisation wird nicht gerechnet');
  assert(eco.speicherKwh === 0, 'ohne Speicherzeile ist der Speicher für die Autarkie 0');
  assert(eco.annualYield === 9000, 'Jahresertrag bleibt');
}

function testStorageClimateSplit() {
  console.log('Speicher, Klima, Optimierer, Zeilentext');
  const neu6 = catalog.computeOffer({ brand: 'sigenergy', moduleCount: 11, speicher: 6, dach: 'Ziegel' });
  const alt6 = catalog.computeOffer({ brand: 'sigenergy_alt', moduleCount: 11, speicher: 6, dach: 'Ziegel' });
  const neu10 = catalog.computeOffer({ brand: 'sigenergy', moduleCount: 11, speicher: 10, dach: 'Ziegel' });
  const alt10 = catalog.computeOffer({ brand: 'sigenergy_alt', moduleCount: 11, speicher: 10, dach: 'Ziegel' });
  assert(neu6.preis.basePrice === 12500, 'Neu 5,01 / 6.0 = 12.500');
  assert(alt6.preis.basePrice === 13200, 'Alt 5,01 / 6.0 = 13.200');
  assert(neu10.preis.basePrice === 13500, 'Neu 5,01 / 10.0 = 13.500');
  assert(alt10.preis.basePrice === 14700, 'Alt 5,01 / 10.0 = 14.700');
  assert(neu10.config.speicher === 9.04, '10.0 weist 9,04 kWh aus');
  assert(neu10.config.speicherLabel.includes('9,04'), 'Label enthält 9,04');
  assert(neu10.statCards.speicher === '9,04', 'Kennzahl 9,04');
  assert(neu6.config.speicher === 6.02, '6.0 weist 6,02 kWh aus');
  assert(alt10.config.speicher === 9.04, 'Alt weist ebenfalls 9,04 kWh aus');

  const stacked = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 11,
    speicher: 6,
    speicherZusatz: [{ kwh: 10, price: 3600, label: '+10.0' }],
    dach: 'Ziegel',
  });
  const stackedAlt = catalog.computeOffer({
    brand: 'sigenergy_alt',
    moduleCount: 11,
    speicher: 6,
    speicherZusatz: [{ kwh: 10, price: 3600, label: '+10.0' }],
    dach: 'Ziegel',
  });
  assert(Math.abs(stacked.config.speicher - 15.06) < 0.001, '6,02 + 9,04 = 15,06');
  assert(stacked.config.speicherLabel.includes('15,06'), 'Label 15,06');
  assert(stacked.preis.basePrice === 12500, 'Basispreis bleibt das 6.0-Paket');
  assert(stacked.preis.brutto === 16100, 'Zusatzblock 3.600 kommt dazu');
  assert(Math.abs(stackedAlt.config.speicher - 15.06) < 0.001, 'Alt-Stapel ebenfalls 15,06');
  assert(stackedAlt.preis.basePrice === 13200, 'Alt-Basis bleibt 13.200');

  const ext = catalog.STORAGE_EXTENSIONS.sigenergy;
  const extAlt = catalog.STORAGE_EXTENSIONS.sigenergy_alt;
  assert(ext[0].price === 2400 && ext[1].price === 3600, 'Neu-Zusatz 2.400 und 3.600');
  assert(extAlt[0].price === 2400 && extAlt[1].price === 3600, 'Alt-Zusatz dieselben Preise');
  assert(catalog.brandOptionPrice('sigenergy', 'notstrom') === 1200, 'Gateway Neu 1.200');
  assert(catalog.brandOptionPrice('sigenergy_alt', 'notstrom') === 1200, 'Gateway Alt 1.200');
  assert(catalog.brandOptionPrice('sigenergy', 'wallbox') === 1500, 'Wallbox Neu 1.500');
  assert(catalog.brandOptionPrice('sigenergy_alt', 'wallbox') === 1500, 'Wallbox Alt 1.500');
  assert(!catalog.listKwpTiers('sigenergy_alt').includes(9.1), 'Alt ohne 9,10');
  assert(!catalog.listKwpTiers('sigenergy_alt').includes(11.83), 'Alt ohne 11,83');
  assert(!catalog.listKwpTiers('sigenergy').includes(8.19), 'Neu ohne 8,19');
  assert(!catalog.listStorageTiers('sigenergy', 5.01).some((t) => Math.abs(t - 12) < 0.05), 'Neu ohne 12-kWh-Spalte');
  assert(!catalog.listStorageTiers('sigenergy_alt', 5.01).some((t) => Math.abs(t - 12) < 0.05), 'Alt ohne 12-kWh-Spalte');

  const froniusSizes = [
    [11, 14400],
    [13, 15600],
    [16, 16320],
    [18, 17000],
    [22, 18660],
    [40, 23680],
  ];
  froniusSizes.forEach(([modules, price]) => {
    const offer = catalog.computeOffer({ brand: 'fronius', moduleCount: modules, speicher: 6.5, dach: 'Ziegel' });
    assert(offer.preis.basePrice === price, `Fronius ${modules} Module / 6,5 kWh = ${price}`);
    assert(offer.config.speicherLabel.includes('6,5'), `Fronius ${modules} Module zeigt 6,5`);
  });
  assert(catalog.FRONIUS_TOWER_KWH[2] === 6.5, 'zwei Reserva-Module sind 6,5 kWh');

  const opt = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 10,
    speicher: 6,
    dach: 'Ziegel',
    optionen: [{ key: 'optimierer', mode: 'fix', qty: 4, price: null }],
  });
  const pv = opt.quoteLines.filter((l) => l.section === 'Photovoltaikanlage');
  const modIdx = pv.findIndex((l) => l.role === 'module');
  const optIdx = pv.findIndex((l) => l.role === 'optimierer');
  const optLine = pv[optIdx];
  assert(optIdx === modIdx + 1, 'Optimierer steht direkt nach dem Modul');
  assert(optLine && optLine.qty === '4 Stück', 'Menge 4 Stück');
  const optPrice = (opt.preis.inkludiert || []).find((i) => i.key === 'optimierer');
  assert(optPrice && optPrice.price === 200, '4 × 50 €');
  const manualOpt = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 10,
    speicher: 6,
    dach: 'Ziegel',
    optionen: [{ key: 'optimierer', mode: 'fix', qty: 4, price: 300, priceManual: true }],
  });
  const manualPrice = (manualOpt.preis.inkludiert || []).find((i) => i.key === 'optimierer');
  assert(manualPrice && manualPrice.price === 300, 'manueller Optimiererpreis bleibt');

  const named = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 11,
    speicher: 6,
    dach: 'Ziegel',
    lineText: {
      'pv:module': { name: 'Sondermodul', desc: 'Eigene Beschreibung' },
      'svc:installation': { name: 'Montage vor Ort', desc: 'Geänderte Leistung' },
    },
  });
  const modLine = named.quoteLines.find((l) => l.id === 'pv:module');
  const svcLine = named.quoteLines.find((l) => l.id === 'svc:installation');
  assert(modLine && modLine.name === 'Sondermodul' && modLine.desc === 'Eigene Beschreibung', 'Zeilentext am Modul');
  assert(svcLine && svcLine.name === 'Montage vor Ort', 'Zeilentext an der Leistung');
  const sectionItem = named.sections.flatMap((s) => s.items || []).find((i) => i.id === 'pv:module');
  assert(sectionItem && sectionItem.name === 'Sondermodul', 'Abschnitt nutzt den geänderten Titel');
  const services = buildComponentCards(named).filter((c) => c.leistungKey);
  const leistung = activeLeistungen(services).find((i) => i.key === 'installation');
  assert(leistung && leistung.title === 'Montage vor Ort', 'Leistungsseite nutzt den geänderten Titel');
  assert(leistung && leistung.body === 'Geänderte Leistung', 'Leistungsseite nutzt die geänderte Beschreibung');

  const restored = catalog.computeOffer({
    brand: 'sigenergy',
    moduleCount: 11,
    speicher: 6,
    dach: 'Ziegel',
    lineText: { 'pv:module': { name: '   ', desc: '' } },
  });
  const restoredMod = restored.quoteLines.find((l) => l.id === 'pv:module');
  assert(restoredMod && restoredMod.name === 'DAS-DH108ND-455', 'leeres Feld holt den Katalogtext zurück');

  const sheetsNeu = selectDatasheetsForOffer(neu6, { includeMissing: true, baseUrl: 'https://pvl.lifeco.at' });
  const sheetsAlt = selectDatasheetsForOffer(alt6, { includeMissing: true, baseUrl: 'https://pvl.lifeco.at' });
  assert(sheetsNeu.every((s) => !String(s.url).includes('/open/')), 'Neu-Datenblatt ist ein direkter Download');
  assert(sheetsAlt.every((s) => !String(s.url).includes('/open/')), 'Alt-Datenblatt ist ein direkter Download');
  assert(sheetsNeu.some((s) => s.slug === 'sigen-hybrid-tp2.pdf'), 'Neu nutzt das TP2-Blatt');
  assert(!sheetsNeu.some((s) => s.slug === 'sigen-hybrid-wechselrichter.pdf'), 'Neu ohne TP1-Blatt');
  assert(sheetsAlt.some((s) => s.slug === 'sigen-hybrid-wechselrichter.pdf'), 'Alt nutzt das TP1-Blatt');

  const tigo = guessImageForItem('Optimierer (1 pro Modul)', 'sigenergy');
  assert(tigo && tigo.endsWith('tigo-optimierer.png'), 'Optimierer zeigt das Tigo-Foto');
  assert(tigo && !/modul-das|pv-module/.test(tigo), 'Optimierer ist kein PV-Modul');
  const fr = catalog.computeOffer({ brand: 'fronius', moduleCount: 11, speicher: 6.5, dach: 'Ziegel' });
  const reserva = buildComponentCards(fr).find((c) => c.role === 'storage');
  assert(reserva && reserva.image && reserva.image.endsWith('fronius-reserva.png'), 'Reserva-Foto am Speicher');
  assert(reserva && !/sigen/.test(reserva.image), 'kein Sigenergy-Batteriefoto');

  const two = catalog.priceKlimaCombination([{ kw: 2.5 }, { kw: 2.5 }], [{ kw: 2.5 }, { kw: 2.5 }]);
  assert(two.complete && two.packagePrice === 4800, 'zwei Single-Split 2,5 = 4.800');
  const gap = catalog.priceKlimaCombination([{ kw: 4.1 }], [{ kw: 2.5 }]);
  assert(!gap.complete && gap.packagePrice == null, 'unvollständige Kombination ohne Preis');
  const emptyKlima = catalog.computeOffer({
    includePv: false,
    klima: { enabled: true, outdoor: [{ kw: 4.1 }], indoor: [{ kw: 2.5 }] },
  });
  assert(emptyKlima.klima.priceSuggested == null, 'Feld bleibt leer');
  assert(emptyKlima.preis.klimaSumme === 0, 'kein erfundener Klimapreis');
  const manualKlima = catalog.computeOffer({
    includePv: false,
    klima: {
      enabled: true,
      outdoor: [{ kw: 2.5 }],
      indoor: [{ kw: 2.5 }],
      extraPipingMeters: 5,
      condensatePump: true,
      total: 3000,
      priceManual: true,
    },
  });
  assert(manualKlima.preis.brutto === 3000, 'manueller Klimapreis ist der Angebotspreis');
  assert(manualKlima.klima.priceSource === 'manual', 'Preisquelle manuell');
}

function testStorageBlockChoice() {
  console.log('Speicherblöcke Fix/Optional, nur Datenblattgrößen');
  const html = fs.readFileSync(path.join(__dirname, '../public/offer.html'), 'utf8');
  assert(html.includes('se-mode'), 'Formular hat Fix/Optional je Block');
  assert(html.includes('>Fix<') && html.includes('>Optional<'), 'Schalter bietet Fix und Optional');
  assert(!html.includes("className = 'se-kwh'"), 'kein freies kWh-Feld');
  assert(!html.includes("k.step = '0.1'"), 'keine Komma-Schritte an der Blockgröße');
  assert(!html.includes('Speicherblock (Fix im Preis)'), 'Hinzufügen ist nicht mehr nur Fix');

  const base = { brand: 'sigenergy', moduleCount: 11, speicher: 6, dach: 'Ziegel', optionen: [] };
  const fixedOnly = catalog.computeOffer({
    ...base,
    speicherZusatz: [{ kwh: 10, price: 3600, mode: 'fix' }],
  });
  assert(Math.abs(fixedOnly.config.speicher - 15.06) < 0.001, 'Fixblock 10.0 zählt 9,04 kWh ins Paket');
  assert(fixedOnly.preis.speicherZusatzPreis === 3600, 'Fixblock kostet 3.600');
  assert(fixedOnly.preis.brutto === 16100, 'Fixblock bleibt im Paketpreis');
  assert(fixedOnly.quoteLines.some((l) => l.role === 'storage' && /9,04/.test(l.desc)), 'Angebot zeigt 9,04 im Paket');
  assert(!fixedOnly.optionaleKomponenten.some((o) => o.key === 'speicherblock'), 'Fixblock ist keine optionale Zeile');

  const optionalOnly = catalog.computeOffer({
    ...base,
    speicher: 10,
    speicherZusatz: [{ kwh: 6, price: 2400, mode: 'optional' }],
  });
  assert(optionalOnly.config.speicher === 9.04, 'optionaler Block ändert die Paketkapazität nicht');
  assert(optionalOnly.preis.basePrice === 13500, 'Basis bleibt das 10.0-Paket');
  assert(optionalOnly.preis.speicherZusatzPreis === 0, 'optionaler Block nicht im Paketpreis');
  assert(optionalOnly.preis.brutto === 13500, 'Brutto ohne optionalen Block');
  const optLine = optionalOnly.optionaleKomponenten.find((o) => o.key === 'speicherblock');
  assert(optLine && optLine.price === 2400 && /6,02/.test(optLine.label), 'optionale Zeile 6.0 / 6,02 kWh / 2.400 €');
  assert(!optionalOnly.quoteLines.some((l) => l.role === 'storage' && /6,02/.test(l.desc || l.name || '')), 'optionaler 6.0-Block steht nicht in der Paket-Stückliste');

  const mixed = catalog.computeOffer({
    ...base,
    speicherZusatz: [
      { kwh: 10, price: 3600, mode: 'fix' },
      { kwh: 6, price: 2400, mode: 'optional' },
    ],
  });
  assert(Math.abs(mixed.config.speicher - 15.06) < 0.001, 'gemischt: nur der Fixblock zählt zur Kapazität');
  assert(mixed.preis.brutto === 16100, 'gemischt: nur 3.600 im Paket');
  assert(mixed.optionaleKomponenten.filter((o) => o.key === 'speicherblock').length === 1, 'genau eine optionale Speicherzeile');

  const weird = catalog.computeOffer({
    ...base,
    speicherZusatz: [
      { kwh: 6.5, price: 1000, mode: 'fix' },
      { kwh: 7.2, price: 1111, mode: 'optional' },
      { kwh: 5.84, price: 999, mode: 'optional' },
      { kwh: 8.76, price: 888, mode: 'fix' },
    ],
  });
  const blob = JSON.stringify({
    config: weird.config,
    quoteLines: weird.quoteLines,
    optionaleKomponenten: weird.optionaleKomponenten,
    preis: weird.preis,
  });
  assert(!/5[,.]84|8[,.]76|6[,.]5|7[,.]2/.test(blob), 'keine freie Größe 6,5 / 7,2 und nicht 5,84 / 8,76');
  assert(weird.preis.speicherZusatzPreis === 2400 + 3600, 'gesnappte Fixblöcke bleiben 2.400 und 3.600');
  const weirdOpt = weird.optionaleKomponenten.filter((o) => o.key === 'speicherblock');
  assert(weirdOpt.length === 2, 'gesnappte optionale Blöcke bleiben optionale Zeilen');
  assert(weirdOpt.every((o) => o.price === 2400 || o.price === 3600), 'keine erfundenen Blockpreise');
  assert(weirdOpt.some((o) => /6,02/.test(o.label) && o.price === 2400), '7,2 wird zum 6.0-Block für 2.400');
  assert(weird.quoteLines.filter((l) => l.role === 'storage').every((l) => /6,02|9,04/.test(l.desc)), 'Paketzeilen nur 6,02 oder 9,04');

  const alt = catalog.computeOffer({
    brand: 'sigenergy_alt',
    moduleCount: 11,
    speicher: 6,
    dach: 'Ziegel',
    optionen: [],
    speicherZusatz: [{ kwh: 10, mode: 'optional' }],
  });
  const altLine = alt.optionaleKomponenten.find((o) => o.key === 'speicherblock');
  assert(alt.config.speicher === 6.02, 'Alt-Paket bleibt 6,02');
  assert(alt.preis.brutto === 13200, 'Alt-Paketpreis ohne optionalen Block');
  assert(altLine && altLine.price === 3600 && /9,04/.test(altLine.label), 'Alt-Block 10.0 ebenfalls 9,04 kWh und 3.600 €');
}

async function main() {
  await testTruncatedDraft();
  await testClarificationStillDrafts();
  testInverterRemoval();
  testOptimizerLabel();
  testPdfPages();
  testStorageClimateSplit();
  testStorageBlockChoice();
  console.log(`\n${passed} ok, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
