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
const { buildComponentCards } = require('../src/offer/product-images');
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

async function main() {
  await testTruncatedDraft();
  await testClarificationStillDrafts();
  testInverterRemoval();
  testOptimizerLabel();
  testPdfPages();
  console.log(`\n${passed} ok, ${failed} failed`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
