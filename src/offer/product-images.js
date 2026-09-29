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
  if (/modul|aiko|das-|neostar|photovoltaik/.test(n) && !/unterkonstruktion|montage/.test(n)) {
    return firstExisting('modulDas', 'pvModule');
  }
  if (/wechselrichter|gen24|symo|inverter|hybrid|sigenstor ec|sun2000/.test(n)) {
    if (b === 'fronius' || /fronius|gen24|symo/.test(n)) return firstExisting('froniusInverter', 'froniusGen24');
    if (b === 'huawei' || /huawei|sun2000/.test(n)) return firstExisting('huaweiInverter');
    return firstExisting('sigenInverter', 'sigenHybrid', 'froniusInverter');
  }
  if (/reserva|batter|speicher|sigenstor bat|akku/.test(n)) {
    if (b === 'fronius' || /fronius|reserva/.test(n)) return firstExisting('froniusReserva', 'sigenBattery');
    return firstExisting('sigenBattery', 'sigenStack', 'froniusReserva');
  }
  if (/smart.?meter|zähler|zaehler/.test(n)) return firstExisting('froniusSmartmeter');
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
  if (/fronius|gen24|reserva|symo|smart.?meter/.test(n)) return 'Fronius';
  if (/sigen|sigenergy|gateway|umschalt/.test(n)) return 'Sigenergy';
  if (/huawei|sun2000/.test(n)) return 'Huawei';
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
  if (/modul/.test(n)) return 'Modul';
  if (/wechselrichter|inverter|gen24|hybrid/.test(n)) return 'Wechselrichter';
  if (/speicher|reserva|batter|bat /.test(n) || /energiespeicher/.test(s)) return 'Stromspeicher';
  if (/unterkonstruktion|gestell/.test(n)) return 'Gestellkonstruktion';
  if (/installation|netzanschluss|erdung|einreichung|befund|inbetrieb|verdraht|leistung/.test(n) || /leistungen/.test(s)) {
    return 'Serviceleistung';
  }
  return 'Andere';
}

/** PV-Komponenten vor Speicher/Klima für Seitenfluss wie Vorlage. */
function splitComponentGroups(cards) {
  const pv = [];
  const storage = [];
  const other = [];
  for (const c of cards) {
    if (/energiespeicher|stromspeicher|smart.?meter/i.test(c.section) || c.kind === 'Stromspeicher' || /smart.?meter/i.test(c.name)) {
      storage.push(c);
    } else if (/klima/i.test(c.section)) {
      other.push(c);
    } else {
      pv.push(c);
    }
  }
  return { pv, storage, other };
}

module.exports = {
  DIR,
  FILES,
  abs,
  firstExisting,
  guessImageForItem,
  buildComponentCards,
  splitComponentGroups,
  classifyKind,
};
