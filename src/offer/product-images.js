'use strict';

/**
 * Produktbilder & Komponenten-Karten für Angebots-PDF (Useini-Vorlage).
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'assets', 'products');

const FILES = {
  coverHero: 'cover-hero-circle.png',
  coverHeroRaw: 'cover-hero.png',
  salesPortrait: 'sales-portrait.png',
  houseOverview: 'house-overview.png',
  houseSystemDiagram: 'house-system-diagram.png',
  qrPlaceholder: 'qr-placeholder.png',
  chartMonthly: 'chart-monthly-yield.png',
  chartFlow: 'chart-energy-flow.png',
  chartAmort: 'chart-amortisation.png',
  modulDas: 'modul-das-fullblack.png',
  pvModule: 'pv-module.png',
  froniusInverter: 'fronius-gen24-vorlage.png',
  froniusGen24: 'fronius-gen24.jpg',
  froniusReserva: 'fronius-reserva.png',
  froniusSmartmeter: 'fronius-smartmeter.png',
  froniusUmschalt: 'umschaltbox-fronius.png',
  sigenGateway: 'sigen-gateway.png',
  sigenGatewayMax: 'sigen-gateway-max.png',
  sigenInverter: 'sigen-inverter.jpg',
  sigenEcTp: 'sigen-ec-tp.jpg',
  sigenHybrid: 'sigen-hybrid.jpg',
  sigenBattery: 'sigen-battery.png',
  sigenStack: 'sigen-stack.jpg',
  huaweiInverter: 'huawei-inverter.png',
  wallbox: 'wallbox.jpg',
  montage: 'montage.jpg',
  ukFlach: 'unterkonstruktion-flach.png',
  ukZiegel: 'unterkonstruktion-ziegel.png',
  gak: 'gak-kasten.png',
  klima: 'klima.jpg',
  heroPv: 'hero-pv.jpg',
  heroHome: 'hero-home.jpg',
  energyHome: 'energy-home.jpg',
  energyFlow: 'energy-flow.png',
  energyFlowReference: 'energy-flow-reference.png',
  sigenSmartmeter: 'sigen-smartmeter.jpg',
};

function abs(key) {
  const file = FILES[key];
  if (!file) return null;
  const p = path.join(DIR, file);
  return fs.existsSync(p) ? p : null;
}

function firstExisting(...keys) {
  for (const k of keys) {
    const p = abs(k);
    if (p) return p;
  }
  return null;
}

function guessImageForItem(name, brand) {
  const n = String(name || '').toLowerCase();
  const b = String(brand || '').toLowerCase();
  // Service / Kleinmaterial: kein Produktfoto
  if (/installation|netzanschluss|erdung|einreichung|befund|inbetrieb|verdrahtung|kabelkanal|solarflex|mc buchse|mc stecker|kleinmaterial/.test(n)) {
    return null;
  }
  if ((/modul|aiko|das-|neostar|dh\d|fullblack/.test(n) || /^das-/.test(n))
    && !/unterkonstruktion|montage/.test(n)) {
    return firstExisting('modulDas', 'pvModule');
  }
  if (/wechselrichter|gen24|symo|inverter|hybrid|sigenstor ec|\btp\b|tp2|sun2000/.test(n)) {
    if (b === 'fronius' || /fronius|gen24|symo/.test(n)) return firstExisting('froniusInverter', 'froniusGen24');
    if (b === 'huawei' || /huawei|sun2000/.test(n)) return firstExisting('huaweiInverter');
    // Sigenergy SigenStor EC / Hybrid Three Phase TP (studio cutout)
    return firstExisting('sigenEcTp', 'sigenInverter', 'sigenHybrid', 'froniusInverter');
  }
  if (/reserva|batter|speicher|sigenstor bat|akku/.test(n)) {
    if (b === 'fronius' || /fronius|reserva/.test(n)) return firstExisting('froniusReserva', 'sigenBattery');
    return firstExisting('sigenBattery', 'sigenStack', 'froniusReserva');
  }
  if (/smart.?meter|zähler|zaehler|sigen.?sensor|energy.?meter|stromsensor/.test(n)) {
    if (/fronius/.test(n) || b === 'fronius') return firstExisting('froniusSmartmeter');
    if (/sigen|sigenergy/.test(n) || b === 'sigenergy') return firstExisting('sigenSmartmeter');
    // Generic „Smart Meter“: prefer offer brand
    if (b === 'huawei') return firstExisting('froniusSmartmeter', 'sigenSmartmeter');
    return firstExisting('sigenSmartmeter', 'froniusSmartmeter');
  }
  if (/gateway|umschalt|notstrom|backup|netztren/.test(n)) {
    if (b === 'fronius' || /fronius/.test(n)) return firstExisting('froniusUmschalt', 'sigenGateway');
    return firstExisting('sigenGateway', 'sigenGatewayMax', 'froniusUmschalt');
  }
  if (/wallbox|ladestation/.test(n)) return firstExisting('wallbox');
  if (/flachdach|ost-?west/.test(n)) return firstExisting('ukFlach', 'montage');
  if (/unterkonstruktion|ziegel|gestell|montageprofil/.test(n)) return firstExisting('ukZiegel', 'montage');
  if (/gak|generatoranschluss|überspannung/.test(n)) return firstExisting('gak');
  if (/klima|lg standard/.test(n)) return firstExisting('klima');
  return null;
}

/**
 * Flache Liste aller Angebotspositionen mit Bildern (Vorlage: VERBAUTE KOMPONENTEN).
 */
function buildComponentCards(offer) {
  const brand = (offer.config && offer.config.brand) || '';
  const cards = [];
  for (const section of offer.sections || []) {
    const sectionTitle = section.title || '';
    for (const item of section.items || []) {
      cards.push({
        name: item.name,
        qty: item.qty || '1 Stück',
        desc: item.desc || '',
        brandLabel: brandLabelFor(sectionTitle, brand, item.name),
        image: guessImageForItem(item.name, brand),
        section: sectionTitle,
        kind: classifyKind(item.name, sectionTitle),
      });
    }
  }
  return cards;
}

function brandLabelFor(sectionTitle, brand, name) {
  const n = String(name || '').toLowerCase();
  if (/installation|netzanschluss|erdung|einreichung|befund|inbetrieb|verdraht|kabelkanal|solarflex|kleinmaterial|mc buchse|mc stecker|leistung/.test(n)) {
    return '';
  }
  if (/modul|das-|aiko/.test(n)) return /aiko/.test(n) || brand === 'aiko' ? 'AIKO' : 'DAS Solar';
  if (/sigen|sigenergy/.test(n)) return 'Sigenergy';
  if (/fronius|gen24|reserva|symo/.test(n)) return 'Fronius';
  if (/huawei|sun2000/.test(n)) return 'Huawei';
  if (/smart.?meter|zähler|zaehler|stromsensor/.test(n)) {
    if (brand === 'fronius') return 'Fronius';
    if (brand === 'huawei') return 'Huawei';
    return 'Sigenergy';
  }
  if (/gateway|umschalt|notstrom/.test(n)) {
    if (brand === 'fronius') return 'Fronius';
    return 'Sigenergy';
  }
  if (/klima|lg/.test(n)) return 'LG';
  if (/wechselrichter|speicher|batter|wallbox/.test(n)) {
    if (brand === 'fronius') return 'Fronius';
    if (brand === 'huawei') return 'Huawei';
    if (brand === 'sigenergy') return 'Sigenergy';
  }
  return '';
}

function classifyKind(name, section) {
  const n = String(name || '').toLowerCase();
  const s = String(section || '').toLowerCase();
  // Services first – „… Module“ in Installationszeilen nicht als Modul werten
  if (/leistungen/.test(s) || /^(installation|netzanschluss|erdung|einreichung|e-?befund|erstinbetrieb|verdrahtung)/.test(n)
    || /netzanschluss|erdung|einreichung|befund|inbetriebnahme|verdrahtung verteiler/.test(n)) {
    return 'Serviceleistung';
  }
  if (/wechselrichter|inverter|gen24|hybrid|sigenstor ec|sun2000/.test(n)) return 'Wechselrichter';
  if (/smart.?meter|zähler|zaehler|stromsensor/.test(n)) return 'Smart Meter';
  if (/speicher|reserva|batter|\bbat\b|sigenstor bat/.test(n) || (/energiespeicher/.test(s) && !/smart.?meter/.test(n))) {
    return 'Stromspeicher';
  }
  if (/unterkonstruktion|gestell/.test(n)) return 'Gestellkonstruktion';
  if (/modul|das-|aiko|neostar|dh\d|fullblack|photovoltaikmodul/.test(n)) return 'Modul';
  if (/gak|generatoranschluss|kabelkanal|solarflex|mc |kleinmaterial/.test(n)) return 'Zubehör';
  if (/gateway|umschalt|notstrom|wallbox|klima/.test(n) || /zusätzliche|klima/.test(s)) return 'Zusatz';
  return 'Andere';
}

/**
 * Gruppen für Komponenten-Seiten + Gesamtübersicht.
 * Übersicht-Reihenfolge: PV → Energiespeicher → weitere → Leistungen.
 */
function splitComponentGroups(cards) {
  const pv = [];
  const storage = [];
  const extras = [];
  const services = [];
  for (const c of cards) {
    const section = String(c.section || '');
    if (c.kind === 'Serviceleistung' || /leistungen/i.test(section)) {
      services.push(c);
    } else if (
      /energiespeicher/i.test(section)
      || c.kind === 'Stromspeicher'
      || c.kind === 'Smart Meter'
      || /smart.?meter/i.test(c.name)
    ) {
      storage.push(c);
    } else if (/photovoltaik/i.test(section) || ['Modul', 'Wechselrichter', 'Gestellkonstruktion', 'Zubehör'].includes(c.kind)) {
      pv.push(c);
    } else {
      extras.push(c);
    }
  }
  return { pv, storage, other: extras, extras, services };
}

/** Sortierte Abschnitte für die Gesamtübersichtstabelle. */
function orderedOverviewSections(offer) {
  const sections = Array.isArray(offer && offer.sections) ? offer.sections.slice() : [];
  const rank = (title) => {
    const t = String(title || '').toLowerCase();
    if (/photovoltaik/.test(t)) return 1;
    if (/energiespeicher|stromspeicher/.test(t)) return 2;
    if (/zusätzliche|klima/.test(t)) return 3;
    if (/leistung/.test(t)) return 4;
    return 5;
  };
  return sections.sort((a, b) => rank(a.title) - rank(b.title));
}

module.exports = {
  DIR,
  FILES,
  abs,
  firstExisting,
  guessImageForItem,
  buildComponentCards,
  splitComponentGroups,
  orderedOverviewSections,
  classifyKind,
  brandLabelFor,
};
