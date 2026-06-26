'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDoc } = require('pdf-lib');
const { formatEUR } = require('./catalog');

const ASSETS = path.join(__dirname, 'assets');
const LOGO = path.join(ASSETS, 'noortec-logo.png');
const VOLLMACHT_PDF = path.join(ASSETS, 'vollmacht.pdf');
const VOLLMACHT_IMG = path.join(ASSETS, 'vollmacht.png');

// ── Design-Tokens ──────────────────────────────────────────────────────────
const COLORS = {
  text: '#1d1d1f',
  muted: '#8a8a8a',
  label: '#b5862f',
  accent: '#e7a13a',
  rule: '#e3e3e3',
  cardBg: '#fcf7ec',
  cardBorder: '#eee0c4',
  darkBg: '#1e232e',
  darkLabel: '#9aa1ad',
  white: '#ffffff',
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 50;
const CONTENT_W = PAGE.width - MARGIN * 2;
const CONTENT_TOP = 52;
const CONTENT_BOTTOM = 788;

const COMPANY_FOOTER = 'Noortec GmbH · Rudolf-Köppl-Gasse 2/7 · A-1220 Wien · FN 364201s · UID ATU66527948 · office@noortec.at';

const DEFAULT_BULLETS = [
  'Hochleistungsfähige Glas-Glas PV-Module mit 30 Jahren Leistungsgarantie',
  'Hocheffizienten Wechselrichter und Speicherlösung',
  'Robuste ALU-Unterkonstruktion',
  'Komplette Installation und Inbetriebnahme durch unser Fachpersonal',
  'Alle notwendigen Genehmigungen und Formalitäten',
  'Modernes Überwachungssystem inkl. persönlicher Einschulung und App',
];

const DEFAULT_INTRO = 'vielen Dank für Ihr Interesse an unseren Lösungen im Bereich der Photovoltaik. Gerne unterbreiten wir Ihnen ein individuelles Angebot, das speziell auf Ihre Bedürfnisse zugeschnitten ist. Unser Angebot beinhaltet:';

function fmtAddrLines(customer) {
  const lines = [];
  if (customer.name) lines.push({ t: customer.name, bold: true });
  if (customer.street) lines.push({ t: customer.street });
  const cityLine = [customer.zip, customer.city].filter(Boolean).join(' ');
  if (cityLine) lines.push({ t: cityLine });
  const contact = [customer.email, customer.phone].filter(Boolean).join(' · ');
  if (contact) lines.push({ t: contact });
  return lines;
}

/**
 * Erzeugt das Angebots-PDF (ohne Vollmacht). Liefert ein Promise<Buffer>.
 * @param {object} offer  Ergebnis von computeOffer()
 * @param {object} customer  { name,street,zip,city,email,phone }
 * @param {object} [texts]  { intro, bullets[], greeting }
 */
function generateOfferPdf(offer, customer, texts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      let y = CONTENT_TOP;

      const newPage = (withColumnHeader = false) => {
        doc.addPage();
        y = CONTENT_TOP + 8;
        if (withColumnHeader) y = drawTableHeader(doc, y);
      };
      const ensure = (h, withColumnHeader = false) => {
        if (y + h > CONTENT_BOTTOM) newPage(withColumnHeader);
      };

      // ── Kopf (nur Seite 1) ──
      try {
        if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, 44, { height: 34 });
      } catch (_) { /* ignore */ }
      const v = offer.meta.vertrieb || {};
      doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
        .text(v.name || '', MARGIN, 46, { width: CONTENT_W, align: 'right' });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted);
      doc.text(v.email || '', MARGIN, 60, { width: CONTENT_W, align: 'right' });
      doc.text(v.phone || '', MARGIN, 72, { width: CONTENT_W, align: 'right' });
      y = 92;
      doc.save().lineWidth(2).strokeColor(COLORS.accent)
        .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
      y += 22;

      // ── Titel ──
      doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.text)
        .text('Ihr persönliches Angebot', MARGIN, y);
      y = doc.y + 4;
      const sub = `von Noortec GmbH · Rudolf-Köppl-Gasse 2/7 · 1220 Wien   |   ${offer.meta.datum}   |   Angebotsnummer ${offer.meta.angebotsnummer || ''}`;
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted).text(sub, MARGIN, y);
      y = doc.y + 16;

      // ── Info-Karten ──
      y = drawInfoCards(doc, y, offer, customer);
      y += 18;

      // ── Anrede + Intro + Bullets ──
      doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
        .text(texts.greeting || 'Guten Tag,', MARGIN, y);
      y = doc.y + 8;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
        .text(texts.intro || DEFAULT_INTRO, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y = doc.y + 10;

      const bullets = Array.isArray(texts.bullets) && texts.bullets.length ? texts.bullets : DEFAULT_BULLETS;
      for (const b of bullets) {
        const bh = doc.font('Helvetica').fontSize(10).heightOfString(b, { width: CONTENT_W - 18 });
        ensure(bh + 4);
        doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.accent).text('+', MARGIN, y);
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
          .text(b, MARGIN + 16, y + 0.5, { width: CONTENT_W - 18, lineGap: 1 });
        y = doc.y + 5;
      }
      y += 8;

      // ── Stat-Karten ──
      ensure(74);
      y = drawStatCards(doc, y, offer);
      y += 22;

      // ── Bestandteile ──
      ensure(40);
      y = drawSectionHeading(doc, y, 'Bestandteile Ihres Angebots');
      y += 6;

      for (const section of offer.sections) {
        ensure(46, true);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.text).text(section.title, MARGIN, y);
        y = doc.y + 6;
        y = drawTableHeader(doc, y);
        for (const item of section.items) {
          y = drawItemRow(doc, y, item, ensure, newPage);
        }
        y += 8;
      }

      // ── Summen ──
      y += 4;
      ensure(80);
      y = drawTotals(doc, y, offer.preis);
      y += 18;

      // ── Optionale Komponenten ──
      if (offer.optionaleKomponenten && offer.optionaleKomponenten.length) {
        ensure(60);
        y = drawSectionHeading(doc, y, 'Optionale Komponenten');
        y += 8;
        for (const opt of offer.optionaleKomponenten) {
          ensure(30);
          y = drawOptionRow(doc, y, opt);
        }
        y += 4;
        doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
          .text('Optionale Komponenten sind nicht im Gesamtpreis enthalten und können auf Wunsch beauftragt werden.', MARGIN, y, { width: CONTENT_W });
        y = doc.y + 18;
      }

      // ── Angebot akzeptieren ──
      ensure(150);
      y = drawSectionHeading(doc, y, 'Angebot akzeptieren');
      y += 10;
      const accept = [
        ['Zahlungskonditionen: ', '100 % nach Fertigstellung der Installation und Inbetriebnahme'],
        ['Liefer- und Montagetermin: ', 'ca. 10–14 Wochen nach Bestellung'],
        ['Angebotsgültigkeit: ', '30 Tage ab Angebotsdatum'],
      ];
      for (const [k, val] of accept) {
        ensure(20);
        doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text).text(k, MARGIN, y, { continued: true });
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text(val);
        y = doc.y + 8;
      }
      y += 22;
      ensure(40);
      doc.save().lineWidth(0.8).strokeColor('#bdbdbd')
        .moveTo(MARGIN, y).lineTo(MARGIN + 300, y).stroke().restore();
      y += 4;
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted).text('Ort, Datum, Name, Unterschrift', MARGIN, y);
      y = doc.y + 14;
      doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
        .text('Dieses Angebot wurde automatisiert erstellt. Preise inkl. 20 % USt. Irrtümer und Änderungen vorbehalten.', MARGIN, y, { width: CONTENT_W });

      // ── Footer auf jeder Seite ──
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        // Unteren Rand neutralisieren, sonst löst ein Schreibvorgang unter der
        // Marge eine automatische (leere) Folgeseite aus.
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
          .text(COMPANY_FOOTER, MARGIN, 805, { width: CONTENT_W, align: 'center', lineBreak: false });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawInfoCards(doc, yStart, offer, customer) {
  const gap = 15;
  const cardW = (CONTENT_W - gap) / 2;
  const pad = 12;
  const leftX = MARGIN;
  const rightX = MARGIN + cardW + gap;

  const addrLines = fmtAddrLines(customer);
  // Höhe links messen
  let leftH = pad + 14; // label
  for (const l of addrLines) {
    doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.bold ? 10.5 : 9.5);
    leftH += doc.heightOfString(l.t, { width: cardW - pad * 2 }) + 2;
  }
  leftH += pad;

  const cfg = offer.config;
  const rightLines = [
    ['Anlage: ', `${cfg.kwpLabel} (${cfg.moduleCount} Module)`],
    ['Wechselrichter: ', cfg.inverter],
    ['Speicher: ', cfg.speicherLabel],
    ['Dach: ', cfg.dach],
  ];
  let rightH = pad + 14;
  for (const [k, val] of rightLines) {
    doc.font('Helvetica').fontSize(9.5);
    rightH += doc.heightOfString(k + val, { width: cardW - pad * 2 }) + 2;
  }
  rightH += pad;

  const cardH = Math.max(leftH, rightH, 92);

  // Hintergründe
  doc.save().roundedRect(leftX, yStart, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();
  doc.save().roundedRect(rightX, yStart, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();

  // Links
  let ly = yStart + pad;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.label)
    .text('ANGEBOT FÜR', leftX + pad, ly, { characterSpacing: 0.6 });
  ly = doc.y + 4;
  for (const l of addrLines) {
    doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.bold ? 10.5 : 9.5).fillColor(COLORS.text)
      .text(l.t, leftX + pad, ly, { width: cardW - pad * 2 });
    ly = doc.y + 2;
  }

  // Rechts
  let ry = yStart + pad;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.label)
    .text('KONFIGURATION', rightX + pad, ry, { characterSpacing: 0.6 });
  ry = doc.y + 4;
  for (const [k, val] of rightLines) {
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
      .text(k, rightX + pad, ry, { width: cardW - pad * 2, continued: true });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text(val);
    ry = doc.y + 2;
  }

  return yStart + cardH;
}

function drawStatCards(doc, yStart, offer) {
  const gap = 15;
  const cardW = (CONTENT_W - gap) / 2;
  const cardH = 62;
  const leftX = MARGIN;
  const rightX = MARGIN + cardW + gap;
  const pad = 14;

  const cards = [
    { label: 'PHOTOVOLTAIKANLAGE', big: offer.statCards.peak, unit: 'kW Peak' },
  ];
  if (offer.statCards.speicher) cards.push({ label: 'STROMSPEICHER', big: offer.statCards.speicher, unit: 'kWh' });

  cards.forEach((c, i) => {
    const x = i === 0 ? leftX : rightX;
    doc.save().roundedRect(x, yStart, cardW, cardH, 6).fill(COLORS.darkBg).restore();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.darkLabel)
      .text(c.label, x + pad, yStart + pad, { characterSpacing: 0.8 });
    const numY = yStart + pad + 14;
    doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.white).text(c.big, x + pad, numY, { continued: true });
    doc.font('Helvetica').fontSize(11).fillColor('#cfd3da').text(`  ${c.unit}`);
  });

  return yStart + cardH;
}

function drawSectionHeading(doc, y, title) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text).text(title, MARGIN, y);
  const ny = doc.y + 4;
  doc.save().lineWidth(1).strokeColor(COLORS.rule)
    .moveTo(MARGIN, ny).lineTo(PAGE.width - MARGIN, ny).stroke().restore();
  return ny;
}

function drawTableHeader(doc, y) {
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted)
    .text('KOMPONENTE', MARGIN, y, { characterSpacing: 0.6, continued: false });
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.muted)
    .text('ANZAHL', MARGIN, y, { width: CONTENT_W, align: 'right', characterSpacing: 0.6 });
  const ny = y + 12;
  doc.save().lineWidth(0.7).strokeColor(COLORS.rule)
    .moveTo(MARGIN, ny).lineTo(PAGE.width - MARGIN, ny).stroke().restore();
  return ny + 6;
}

function drawItemRow(doc, y, item, ensure, newPage) {
  const qtyW = 80;
  const nameW = CONTENT_W - qtyW - 10;
  doc.font('Helvetica').fontSize(9.5);
  const nameH = doc.heightOfString(item.name, { width: nameW });
  let descH = 0;
  if (item.desc) {
    doc.font('Helvetica').fontSize(7.8);
    descH = doc.heightOfString(item.desc, { width: nameW }) + 1;
  }
  const rowH = Math.max(nameH + descH, 14) + 9;

  if (y + rowH > CONTENT_BOTTOM) {
    newPage(true);
    y = doc.y;
  }

  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text).text(item.name, MARGIN, y, { width: nameW });
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
    .text(item.qty, MARGIN, y, { width: CONTENT_W, align: 'right' });
  let yy = y + nameH + 1;
  if (item.desc) {
    doc.font('Helvetica').fontSize(7.8).fillColor(COLORS.muted).text(item.desc, MARGIN, yy, { width: nameW });
    yy = doc.y;
  }
  const bottom = y + rowH;
  doc.save().lineWidth(0.5).strokeColor('#f0f0f0')
    .moveTo(MARGIN, bottom - 4).lineTo(PAGE.width - MARGIN, bottom - 4).stroke().restore();
  return bottom;
}

function drawTotals(doc, y, preis) {
  const rightEdge = PAGE.width - MARGIN;
  const labelX = MARGIN + CONTENT_W * 0.45;
  const valW = 140;
  const valX = rightEdge - valW;

  const row = (label, val, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 13 : 9.5).fillColor(COLORS.text);
    doc.text(label, labelX, y, { width: (valX - labelX) - 10, align: 'left' });
    doc.text(val, valX, y, { width: valW, align: 'right' });
    y = doc.y + (bold ? 4 : 6);
  };
  row('Gesamt (Netto)', preis.nettoFmt);
  row(`MwSt. (${(preis.mwstRate * 100).toFixed(1).replace('.', ',')} %)`, preis.mwstFmt);
  y += 2;
  doc.save().lineWidth(1).strokeColor('#cfcfcf').moveTo(labelX, y).lineTo(rightEdge, y).stroke().restore();
  y += 8;
  row('Gesamt (Brutto)', preis.bruttoFmt, true);
  return y;
}

function drawOptionRow(doc, y, opt) {
  const h = 26;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, h, 4).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();
  // Checkbox
  doc.save().lineWidth(1).strokeColor(COLORS.label)
    .roundedRect(MARGIN + 12, y + 8, 10, 10, 2).stroke().restore();
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
    .text(opt.label, MARGIN + 32, y + 8, { width: CONTENT_W - 32 - 110 });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text)
    .text(formatEUR(opt.price), MARGIN, y + 8, { width: CONTENT_W - 14, align: 'right' });
  return y + h + 6;
}

/** Hängt die Vollmacht ans Angebots-PDF an (echtes PDF bevorzugt, sonst Bild). */
async function appendVollmacht(offerPdfBuffer) {
  const merged = await PdfLibDoc.load(offerPdfBuffer);
  try {
    if (fs.existsSync(VOLLMACHT_PDF)) {
      const vm = await PdfLibDoc.load(fs.readFileSync(VOLLMACHT_PDF));
      const pages = await merged.copyPages(vm, vm.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } else if (fs.existsSync(VOLLMACHT_IMG)) {
      const imgBytes = fs.readFileSync(VOLLMACHT_IMG);
      let img;
      try { img = await merged.embedJpg(imgBytes); } catch { img = await merged.embedPng(imgBytes); }
      const page = merged.addPage([PAGE.width, PAGE.height]);
      const m = 36;
      const maxW = PAGE.width - m * 2;
      const maxH = PAGE.height - m * 2;
      const scale = Math.min(maxW / img.width, maxH / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, { x: (PAGE.width - w) / 2, y: PAGE.height - m - h, width: w, height: h });
    }
  } catch (err) {
    console.error('[NOORTEC] Vollmacht anhängen fehlgeschlagen:', err.message);
  }
  const out = await merged.save();
  return Buffer.from(out);
}

module.exports = { generateOfferPdf, appendVollmacht, DEFAULT_BULLETS, DEFAULT_INTRO };
