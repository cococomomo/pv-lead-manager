'use strict';

/**
 * Produkt-/Symbolbilder für Angebots-PDF.
 * Pfade relativ zu src/offer/assets/products/
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'assets', 'products');

const FILES = {
  heroPv: 'hero-pv.jpg',
  heroHome: 'hero-home.jpg',
  energyHome: 'energy-home.jpg',
  pvModule: 'pv-module.png',
  montage: 'montage.jpg',
  wallbox: 'wallbox.jpg',
  klima: 'klima.jpg',
  sigenInverter: 'sigen-inverter.jpg',
  sigenHybrid: 'sigen-hybrid.jpg',
  sigenBattery: 'sigen-battery.png',
  sigenStack: 'sigen-stack.jpg',
  /** Sigenergy Gateway HomePro – korrekte Umschaltbox / Notstrom */
  sigenGateway: 'sigen-gateway.png',
  sigenGatewayMax: 'sigen-gateway-max.png',
  froniusInverter: 'fronius-gen24.jpg',
  huaweiInverter: 'huawei-inverter.png',
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

/**
 * @param {object} offer
 * @returns {Array<{ key: string, title: string, text: string, image: string|null }>}
 */
function buildComponentShowcases(offer) {
  const cfg = (offer && offer.config) || {};
  const brand = String(cfg.brand || '').toLowerCase();
  const pages = [];

  if (cfg.includePv !== false && Number(cfg.moduleCount) > 0) {
    pages.push({
      key: 'module',
      title: 'Photovoltaik-Module',
      text: `Hochwertige Glas-Glas-Module (${cfg.moduleModel || 'Premium-Modul'}) mit ${cfg.moduleWp || '—'} Wp. Langlebig, ertragsstark und mit langer Leistungsgarantie – die Basis Ihrer persönlichen Energiewende.`,
      image: firstExisting('pvModule', 'heroPv'),
    });

    let inverterImg = firstExisting('sigenInverter', 'sigenHybrid');
    let inverterTitle = 'Wechselrichter';
    let inverterText = `Ihr Wechselrichter (${cfg.inverter || 'Hybrid-Wechselrichter'}) wandelt den erzeugten Solarstrom zuverlässig in nutzbaren Haushaltsstrom um und steuert Speicher sowie Einspeisung intelligent.`;
    if (brand === 'fronius') {
      inverterImg = firstExisting('froniusInverter', 'sigenInverter');
      inverterTitle = 'Fronius Wechselrichter';
    } else if (brand === 'huawei') {
      inverterImg = firstExisting('huaweiInverter', 'sigenInverter');
      inverterTitle = 'Huawei Wechselrichter';
    } else if (brand === 'sigenergy') {
      inverterImg = firstExisting('sigenInverter', 'sigenHybrid', 'sigenStack');
      inverterTitle = 'Sigenergy Wechselrichter';
      inverterText = `Der SigenStor-Hybridwechselrichter (${cfg.inverter || 'SigenStor EC'}) ist das Herzstück Ihrer Anlage: kompakt, leistungsstark und optimal auf Speicher und Gateway abgestimmt.`;
    }
    pages.push({
      key: 'inverter',
      title: inverterTitle,
      text: inverterText,
      image: inverterImg,
    });

    if (cfg.speicher) {
      let batImg = firstExisting('sigenBattery', 'sigenStack');
      let batTitle = 'Stromspeicher';
      let batText = `Mit ${cfg.speicherLabel || `${cfg.speicher} kWh`} speichern Sie Ihren Solarstrom für Abend und Nacht – mehr Unabhängigkeit, weniger Netzbezug.`;
      if (brand === 'sigenergy') {
        batImg = firstExisting('sigenBattery', 'sigenStack');
        batTitle = 'Sigenergy Stromspeicher';
        batText = `SigenStor BAT (${cfg.speicherLabel || `${cfg.speicher} kWh`}) – modular erweiterbar, sicher und auf Ihren Eigenverbrauch abgestimmt.`;
      } else if (brand === 'fronius') {
        batTitle = 'Fronius Reserva Speicher';
        batImg = firstExisting('sigenBattery', 'sigenStack');
      }
      pages.push({
        key: 'storage',
        title: batTitle,
        text: batText,
        image: batImg,
      });
    }
  }

  // Zusätzliche inkludierte Komponenten mit Bild
  const sections = (offer && offer.sections) || [];
  const extra = sections.find((s) => /zusätzliche/i.test(s.title || ''));
  const items = (extra && extra.items) || [];
  const names = items.map((i) => String(i.name || '').toLowerCase()).join(' | ');

  if (/gateway|umschalt|notstrom|backup/i.test(names) || /sigenergy|sigen/.test(brand + names)) {
    if (/gateway|umschalt|notstrom|backup/i.test(names)) {
      pages.push({
        key: 'gateway',
        title: 'Umschaltbox / Notstrom',
        text: brand === 'sigenergy' || /sigen|sigenergy/i.test(names)
          ? 'Das Sigenergy Gateway (Umschaltbox) trennt bei Netzausfall sicher vom öffentlichen Netz und versorgt ausgewählte Stromkreise weiter – echte Backup-Fähigkeit für Ihr Zuhause.'
          : 'Die Umschaltbox ermöglicht Notstrombetrieb und schützt Ihre Anlage bei Netzstörungen.',
        image: brand === 'fronius'
          ? firstExisting('sigenGateway', 'sigenGatewayMax')
          : firstExisting('sigenGateway', 'sigenGatewayMax'),
      });
    }
  }

  if (/wallbox|ladestation|e-?mobil/i.test(names)) {
    pages.push({
      key: 'wallbox',
      title: 'Wallbox',
      text: 'Laden Sie Ihr Elektrofahrzeug bequem mit selbst erzeugtem Solarstrom – effizient, zukunftssicher und alltagstauglich.',
      image: firstExisting('wallbox'),
    });
  }

  if (cfg.includePv !== false && Number(cfg.moduleCount) > 0) {
    pages.push({
      key: 'montage',
      title: 'Unterkonstruktion & Montage',
      text: `Robuste Unterkonstruktion für ${cfg.dach || 'Ihr Dach'}, fachgerechte Installation und Inbetriebnahme durch unser Team – von der Planung bis zur Übergabe aus einer Hand.`,
      image: firstExisting('montage', 'heroHome'),
    });
  }

  const klima = (offer && offer.klima && offer.klima.fix) || [];
  if (klima.length) {
    pages.push({
      key: 'klima',
      title: 'Klimageräte',
      text: 'Effiziente Klimatisierung mit LG STANDARD II – abgestimmt auf Ihre Räume und kombiniert mit Ihrer PV-Anlage für niedrige Betriebskosten.',
      image: firstExisting('klima', 'energyHome'),
    });
  }

  return pages;
}

module.exports = {
  DIR,
  FILES,
  abs,
  firstExisting,
  buildComponentShowcases,
};
