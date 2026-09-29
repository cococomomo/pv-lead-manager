'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDoc } = require('pdf-lib');
const { formatEUR } = require('./catalog');
const { drawLayoutPreview } = require('./layout-preview');
const { selectDatasheetsForOffer } = require('./datasheets');
const { computeEconomics } = require('./economics');
const { buildComponentShowcases, firstExisting } = require('./product-images');

const ASSETS = path.join(__dirname, 'assets');
const LOGO = path.join(ASSETS, 'noortec-logo.png');
const VOLLMACHT_PDF = path.join(ASSETS, 'vollmacht.pdf');
const VOLLMACHT_IMG = path.join(ASSETS, 'vollmacht.png');

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
  soft: '#f7f5f1',
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
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

const DEFAULT_INTRO = 'vielen Dank für Ihr Interesse an unseren Lösungen im Bereich der Photovoltaik. Gerne unterbreiten wir Ihnen ein individuelles Angebot, das speziell auf Ihre Bedürfnisse zugeschnitten ist.';

function addPdfLinkNewWindow(doc, x, y, w, h, url) {
  try {
    const action = doc.ref({
      S: 'URI',
      URI: new String(url),
      NewWindow: true,
    });
    action.end();
    doc.annotate(x, y, w, h, { Subtype: 'Link', A: action, Border: [0, 0, 0] });
  } catch (_) {
    try { doc.link(x, y, w, h, url); } catch (__) { /* ignore */ }
  }
}

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

function deNumPdf(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n == null ? '' : n);
  return String(num).replace('.', ',');
}

/**
 * Erzeugt das Angebots-PDF (ohne Vollmacht). Promise<Buffer>.
 * @param {object} offer
 * @param {object} customer
 * @param {object} [texts]
 * @param {object} [opts]
 *   layoutSnapshotPath, layoutPlan,
 *   variantLayouts: [{ index, label, layoutPlanId, layoutSnapshotPath, layoutPlan }],
 *   economics / ertrag overrides,
 *   baseUrl
 */
function generateOfferPdf(offer, customer, texts = {}, opts = {}) {
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
        return y;
      };
      const ensure = (h, withColumnHeader = false) => {
        if (y + h > CONTENT_BOTTOM) return newPage(withColumnHeader);
        return y;
      };

      const economics = computeEconomics(offer, {
        ...(opts.economics || {}),
        ...(opts.ertrag || {}),
        ...(texts.economics || {}),
        jahresverbrauch: opts.jahresverbrauch || texts.jahresverbrauch,
      });

      // ═══ 1) Cover / Intro ═══
      y = drawPageHeader(doc, offer, { compact: false });
      y = drawCoverHero(doc, y, customer, offer);
      y += 14;
      y = drawInfoCards(doc, y, offer, customer);
      y += 16;

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
      y += 10;
      ensure(74);
      y = drawStatCards(doc, y, offer);

      // ═══ 2) Komponenten-Seiten (ein Thema pro Seite) ═══
      const showcases = buildComponentShowcases(offer);
      for (const page of showcases) {
        newPage();
        y = drawPageHeader(doc, offer, { compact: true });
        y = drawTopicPage(doc, y, page);
      }

      // ═══ 3) Belegungsplan(e) — aktiv + weitere Varianten mit eigenem Plan ═══
      const layoutPages = collectLayoutPages(opts);
      for (const lp of layoutPages) {
        newPage();
        y = drawPageHeader(doc, offer, { compact: true });
        y = drawBelegungsplanPage(doc, y, lp, ensure, newPage);
      }

      // ═══ 4) Alle Komponenten aufgelistet ═══
      newPage();
      y = drawPageHeader(doc, offer, { compact: true });
      y = drawSectionHeading(doc, y, 'Bestandteile Ihres Angebots');
      y += 6;
      for (const section of offer.sections || []) {
        const firstH = section.items && section.items[0]
          ? measureItemRowHeight(doc, section.items[0])
          : 24;
        const blockH = 22 + 6 + 20 + firstH + 4;
        ensure(blockH);
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.text).text(section.title, MARGIN, y);
        y = doc.y + 6;
        y = drawTableHeader(doc, y);
        for (const item of section.items) {
          y = drawItemRow(doc, y, item, newPage);
        }
        y += 8;
      }

      // ═══ 5) Ertragsberechnung ═══
      newPage();
      y = drawPageHeader(doc, offer, { compact: true });
      y = drawErtragPage(doc, y, economics, offer);

      // ═══ 6) Haushaltsenergie ═══
      newPage();
      y = drawPageHeader(doc, offer, { compact: true });
      y = drawHaushaltPage(doc, y, economics);

      // ═══ 7) Wirtschaftlichkeit ═══
      newPage();
      y = drawPageHeader(doc, offer, { compact: true });
      y = drawWirtschaftPage(doc, y, economics);

      // ═══ 8) Übersicht + Gesamtpreis ═══
      newPage();
      y = drawPageHeader(doc, offer, { compact: true });
      y = drawSectionHeading(doc, y, 'Übersicht & Gesamtpreis');
      y += 10;
      y = drawFinalOverview(doc, y, offer, ensure, newPage);
      y += 8;
      ensure(90);
      y = drawTotals(doc, y, offer.preis);

      if (offer.optionaleKomponenten && offer.optionaleKomponenten.length) {
        y += 16;
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
        y = doc.y + 12;
      }

      if (offer.offerNotes && offer.offerNotes.length) {
        ensure(50);
        y = drawSectionHeading(doc, y, 'Hinweise');
        y += 8;
        for (const note of offer.offerNotes) {
          ensure(28);
          doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
            .text(`• ${note}`, MARGIN, y, { width: CONTENT_W });
          y = doc.y + 6;
        }
        y += 8;
      }

      // ═══ 9) Angebot akzeptieren ═══
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
      y = doc.y + 18;

      // ═══ 10) Datenblätter ═══
      const sheetLinks = selectDatasheetsForOffer(offer, {
        baseUrl: opts.baseUrl || process.env.APP_BASE_URL || 'https://pvl.lifeco.at',
      });
      if (sheetLinks.length) {
        ensure(40 + sheetLinks.length * 16);
        y = drawSectionHeading(doc, y, 'Datenblätter');
        y += 8;
        doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
          .text('Technische Datenblätter der verbauten Komponenten (Klick öffnet das PDF):', MARGIN, y, {
            width: CONTENT_W,
          });
        y = doc.y + 8;
        for (const sheet of sheetLinks) {
          ensure(18);
          const lineY = y;
          doc.font('Helvetica').fontSize(10).fillColor(COLORS.text).text('•  ', MARGIN, y, { continued: true });
          doc.fillColor(COLORS.accent).text(sheet.label, {
            underline: true,
            width: CONTENT_W - 14,
          });
          const linkH = Math.max(12, doc.y - lineY);
          addPdfLinkNewWindow(doc, MARGIN, lineY - 1, CONTENT_W, linkH + 2, sheet.url);
          y = doc.y + 4;
        }
      }

      // Footer
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
          .text(COMPANY_FOOTER, MARGIN, 805, { width: CONTENT_W, align: 'center', lineBreak: false });
        doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
          .text(`${i - range.start + 1} / ${range.count}`, MARGIN, 818, {
            width: CONTENT_W, align: 'right', lineBreak: false,
          });
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/** Aktiver Plan + weitere Varianten-Pläne (ohne Duplikat der aktiven ID). */
function collectLayoutPages(opts) {
  const pages = [];
  const seen = new Set();
  const push = (entry) => {
    if (!entry) return;
    const hasSnap = !!(entry.layoutSnapshotPath && fs.existsSync(entry.layoutSnapshotPath));
    const plan = entry.layoutPlan;
    const hasPlan = !!(plan && (
      (Array.isArray(plan.modules) && plan.modules.length)
      || (Array.isArray(plan.roofs) && plan.roofs.length)
      || (Array.isArray(plan.roof) && plan.roof.length)
    ));
    if (!hasSnap && !hasPlan) return;
    const id = entry.layoutPlanId != null ? Number(entry.layoutPlanId) : null;
    if (id != null && seen.has(id)) return;
    if (id != null) seen.add(id);
    pages.push({
      title: entry.title || 'Belegungsplan',
      subtitle: entry.subtitle || '',
      layoutSnapshotPath: hasSnap ? entry.layoutSnapshotPath : null,
      layoutPlan: hasPlan ? plan : null,
      layoutPlanId: id,
    });
  };

  push({
    title: 'Belegungsplan',
    subtitle: opts.layoutVariantLabel || '',
    layoutSnapshotPath: opts.layoutSnapshotPath,
    layoutPlan: opts.layoutPlan,
    layoutPlanId: opts.layoutPlanId,
  });

  const extras = Array.isArray(opts.variantLayouts) ? opts.variantLayouts : [];
  for (const v of extras) {
    if (!v) continue;
    const id = v.layoutPlanId != null ? Number(v.layoutPlanId) : null;
    if (id != null && seen.has(id)) continue;
    push({
      title: 'Belegungsplan',
      subtitle: v.label || (v.index != null ? `Variante ${Number(v.index) + 1}` : ''),
      layoutSnapshotPath: v.layoutSnapshotPath,
      layoutPlan: v.layoutPlan,
      layoutPlanId: id,
    });
  }
  return pages;
}

function drawPageHeader(doc, offer, { compact }) {
  try {
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, compact ? 36 : 40, { height: compact ? 26 : 32 });
  } catch (_) { /* ignore */ }
  const v = (offer.meta && offer.meta.vertrieb) || {};
  const top = compact ? 38 : 42;
  doc.font('Helvetica-Bold').fontSize(compact ? 9 : 10).fillColor(COLORS.text)
    .text(v.name || '', MARGIN, top, { width: CONTENT_W, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted);
  doc.text([v.email, v.phone].filter(Boolean).join(' · '), MARGIN, top + 12, { width: CONTENT_W, align: 'right' });
  let y = compact ? 72 : 84;
  doc.save().lineWidth(compact ? 1.2 : 2).strokeColor(COLORS.accent)
    .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
  return y + (compact ? 14 : 18);
}

function drawCoverHero(doc, yStart, customer, offer) {
  const hero = firstExisting('heroPv', 'heroHome');
  const h = 168;
  doc.save().roundedRect(MARGIN, yStart, CONTENT_W, h, 8).fill(COLORS.soft).restore();
  if (hero) {
    try {
      doc.save();
      doc.roundedRect(MARGIN, yStart, CONTENT_W, h, 8).clip();
      const img = doc.openImage(hero);
      const scale = Math.max(CONTENT_W / img.width, h / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      doc.image(img, MARGIN + (CONTENT_W - dw) / 2, yStart + (h - dh) / 2, { width: dw, height: dh });
      doc.restore();
      // sanfter Verlauf unten für Textlesbarkeit
      doc.save().rect(MARGIN, yStart + h - 56, CONTENT_W, 56).fillOpacity(0.45).fill('#1e232e').restore();
    } catch (_) { /* ignore */ }
  }
  const titleY = yStart + h - 48;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(hero ? COLORS.white : COLORS.text)
    .text('Ihr persönliches Angebot', MARGIN + 16, titleY, { width: CONTENT_W - 32 });
  const sub = `Noortec GmbH · ${offer.meta.datum} · Angebotsnummer ${offer.meta.angebotsnummer || ''}`;
  doc.font('Helvetica').fontSize(9).fillColor(hero ? '#d7dbe2' : COLORS.muted)
    .text(sub, MARGIN + 16, titleY + 28, { width: CONTENT_W - 32 });
  return yStart + h + 8;
}

function drawTopicPage(doc, y, page) {
  y = drawSectionHeading(doc, y, page.title);
  y += 10;
  const imgH = 320;
  const imgBoxY = y;
  doc.save().roundedRect(MARGIN, imgBoxY, CONTENT_W, imgH, 8).fill(COLORS.soft).restore();
  if (page.image && fs.existsSync(page.image)) {
    try {
      const img = doc.openImage(page.image);
      const maxW = CONTENT_W - 48;
      const maxH = imgH - 36;
      let dw = maxW;
      let dh = dw * (img.height / Math.max(1, img.width));
      if (dh > maxH) {
        dh = maxH;
        dw = dh * (img.width / Math.max(1, img.height));
      }
      const ix = MARGIN + (CONTENT_W - dw) / 2;
      const iy = imgBoxY + (imgH - dh) / 2;
      doc.image(img, ix, iy, { width: dw, height: dh });
    } catch (_) { /* ignore */ }
  }
  y = imgBoxY + imgH + 18;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text(page.text || '', MARGIN, y, { width: CONTENT_W, lineGap: 3, align: 'left' });
  return doc.y + 8;
}

function drawBelegungsplanPage(doc, y, lp) {
  const heading = lp.subtitle ? `${lp.title} · ${lp.subtitle}` : lp.title;
  y = drawSectionHeading(doc, y, heading);
  y += 8;
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.muted)
    .text('Dachlinien dezent, Module schwarz mit hellem Rahmen – so sehen Sie die geplante Belegung auf einen Blick.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 10;
  const avail = Math.max(220, CONTENT_BOTTOM - y - 24);

  if (lp.layoutSnapshotPath) {
    try {
      const img = doc.openImage(lp.layoutSnapshotPath);
      const iw = Math.max(1, img.width);
      const ih = Math.max(1, img.height);
      let drawW = CONTENT_W;
      let drawH = drawW * (ih / iw);
      if (drawH > avail) {
        drawH = avail;
        drawW = drawH * (iw / ih);
      }
      const xOff = MARGIN + Math.max(0, (CONTENT_W - drawW) / 2);
      doc.image(img, xOff, y, { width: drawW, height: drawH });
      return y + drawH + 8;
    } catch (_) { /* fallback vector */ }
  }
  if (lp.layoutPlan) {
    const imgH = Math.min(480, avail);
    const out = drawLayoutPreview(doc, lp.layoutPlan, {
      x: MARGIN, y, width: CONTENT_W, height: imgH,
    });
    if (out.drawn) return y + out.height + 6;
  }
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
    .text('Für diese Variante liegt noch kein Belegungsplan vor.', MARGIN, y);
  return doc.y + 8;
}

function drawMetricGrid(doc, y, cells) {
  const cols = Math.min(3, cells.length);
  const gap = 10;
  const cardW = (CONTENT_W - gap * (cols - 1)) / cols;
  const cardH = 72;
  cells.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MARGIN + col * (cardW + gap);
    const cy = y + row * (cardH + gap);
    doc.save().roundedRect(x, cy, cardW, cardH, 6).fill(COLORS.darkBg).restore();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.darkLabel)
      .text(c.label, x + 12, cy + 12, { width: cardW - 24, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.white)
      .text(c.value, x + 12, cy + 30, { width: cardW - 24 });
    if (c.hint) {
      doc.font('Helvetica').fontSize(8).fillColor('#cfd3da')
        .text(c.hint, x + 12, cy + 52, { width: cardW - 24 });
    }
  });
  const rows = Math.ceil(cells.length / cols);
  return y + rows * (cardH + gap);
}

function drawErtragPage(doc, y, eco, offer) {
  y = drawSectionHeading(doc, y, 'Ertragsberechnung');
  y += 10;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('So viel Solarstrom erzeugt Ihre geplante Anlage voraussichtlich im Jahr – Grundlage für Eigenverbrauch und Einspeisung.', MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 16;
  y = drawMetricGrid(doc, y, [
    { label: 'JAHRESERTRAG', value: eco.labels.annualYield, hint: eco.labels.specificYield },
    { label: 'ANLAGENLEISTUNG', value: `${deNumPdf(Math.round(eco.kwp * 100) / 100)} kWp`, hint: `${(offer.config && offer.config.moduleCount) || '—'} Module` },
    { label: 'SPEICHER', value: eco.hasStorage ? `${deNumPdf(eco.speicherKwh)} kWh` : 'ohne', hint: eco.hasStorage ? 'mit Speicher' : 'Direktverbrauch' },
  ]);
  y += 8;
  const hero = firstExisting('heroPv', 'energyHome');
  if (hero) {
    const h = 200;
    doc.save().roundedRect(MARGIN, y, CONTENT_W, h, 8).fill(COLORS.soft).restore();
    try {
      const im = doc.openImage(hero);
      const scale = Math.max(CONTENT_W / im.width, h / im.height);
      const dw = im.width * scale;
      const dh = im.height * scale;
      doc.save();
      doc.roundedRect(MARGIN, y, CONTENT_W, h, 8).clip();
      doc.image(im, MARGIN + (CONTENT_W - dw) / 2, y + (h - dh) / 2, { width: dw, height: dh });
      doc.restore();
    } catch (_) { /* ignore */ }
    y += h + 14;
  }
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text(eco.source === 'override'
      ? 'Werte aus der hinterlegten Ertragsrechnung der Anlagenplanung.'
      : 'Schätzwerte für den Standort Österreich (Ostregion). Die tatsächlichen Erträge hängen von Ausrichtung, Verschattung und Wetterjahr ab.', MARGIN, y, { width: CONTENT_W });
  return doc.y + 8;
}

function drawHaushaltPage(doc, y, eco) {
  y = drawSectionHeading(doc, y, 'Haushaltsenergie');
  y += 10;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Ihr Haushalt, Ihr Solarstrom: So verteilt sich Erzeugung und Verbrauch über das Jahr – verständlich und auf einen Blick.', MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 16;

  // Einfaches Balken-Diagramm
  const barMaxW = CONTENT_W - 160;
  const rows = [
    { label: 'Jahresverbrauch', kwh: eco.household, color: '#6b7280' },
    { label: 'Eigenverbrauch', kwh: eco.selfConsumed, color: COLORS.accent },
    { label: 'Netzeinspeisung', kwh: eco.feedInKwh, color: '#3b82f6' },
    { label: 'Restbezug Netz', kwh: eco.gridRemain, color: '#94a3b8' },
  ];
  const maxK = Math.max(...rows.map((r) => r.kwh), 1);
  for (const r of rows) {
    doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text).text(r.label, MARGIN, y, { width: 130 });
    const bw = Math.max(4, (r.kwh / maxK) * barMaxW);
    doc.save().roundedRect(MARGIN + 140, y + 2, bw, 12, 3).fill(r.color).restore();
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text(`${deNumPdf(Math.round(r.kwh))} kWh`, MARGIN + 140 + bw + 8, y + 1);
    y += 26;
  }
  y += 10;
  y = drawMetricGrid(doc, y, [
    { label: 'AUTARKIEGRAD', value: eco.labels.autarky, hint: 'Anteil Eigenversorgung' },
    { label: 'EIGENVERBRAUCHSQUOTE', value: eco.labels.selfRate, hint: 'vom Jahresertrag' },
    { label: 'HAUSHALTSBEDARF', value: eco.labels.household, hint: 'pro Jahr' },
  ]);
  y += 6;
  const img = firstExisting('energyHome', 'heroHome');
  if (img) {
    const h = 180;
    doc.save().roundedRect(MARGIN, y, CONTENT_W, h, 8).fill(COLORS.soft).restore();
    try {
      const im = doc.openImage(img);
      const scale = Math.max(CONTENT_W / im.width, h / im.height);
      const dw = im.width * scale;
      const dh = im.height * scale;
      doc.save();
      doc.roundedRect(MARGIN, y, CONTENT_W, h, 8).clip();
      doc.image(im, MARGIN + (CONTENT_W - dw) / 2, y + (h - dh) / 2, { width: dw, height: dh });
      doc.restore();
    } catch (_) { /* ignore */ }
    y += h + 10;
  }
  return y;
}

function drawWirtschaftPage(doc, y, eco) {
  y = drawSectionHeading(doc, y, 'Wirtschaftlichkeit');
  y += 10;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Ihre Investition im Überblick: jährliche Ersparnis, Amortisation und Nutzen über den Betrachtungszeitraum.', MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 16;
  y = drawMetricGrid(doc, y, [
    { label: 'ERSCHPARNIS JAHR 1', value: eco.labels.savingsYear1, hint: `Strom ${eco.labels.gridPrice}` },
    { label: 'AMORTISATION', value: eco.labels.payback, hint: 'bei konstanten Preisen' },
    { label: 'INVESTITION', value: eco.labels.investment, hint: 'Brutto Angebotspreis' },
  ]);
  y += 8;
  y = drawMetricGrid(doc, y, [
    { label: `SUMME ${eco.years} JAHRE`, value: eco.labels.totalSavings, hint: 'kumulierte Ersparnis' },
    { label: 'NETTOVORTEIL', value: eco.labels.netGain, hint: 'Ersparnis abzgl. Investition' },
    { label: 'OHNE PV / JAHR', value: eco.labels.costWithout, hint: 'reiner Netzbezug' },
  ]);
  y += 14;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
    .text('Kumulative Ersparnis', MARGIN, y);
  y = doc.y + 8;

  // Mini sparkline / bars for years 5,10,15,20,25
  const checkpoints = [5, 10, 15, 20, 25].filter((n) => n <= eco.years);
  const gap = 12;
  const barW = (CONTENT_W - gap * (checkpoints.length - 1)) / Math.max(1, checkpoints.length);
  const maxC = Math.max(...checkpoints.map((n) => (eco.yearly[n - 1] || {}).cumulative || 0), 1);
  const chartH = 120;
  const baseY = y + chartH;
  checkpoints.forEach((n, i) => {
    const cum = (eco.yearly[n - 1] && eco.yearly[n - 1].cumulative) || 0;
    const bh = Math.max(4, (cum / maxC) * (chartH - 24));
    const x = MARGIN + i * (barW + gap);
    doc.save().roundedRect(x, baseY - bh, barW, bh, 4).fill(COLORS.accent).restore();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.text)
      .text(`${n} J.`, x, baseY + 4, { width: barW, align: 'center' });
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
      .text(formatEUR(cum), x, baseY + 16, { width: barW, align: 'center' });
  });
  y = baseY + 36;
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted)
    .text('Hinweis: Modellrechnung ohne Finanzierung, Inflation oder Steuer. Einspeisetarif und Strompreis können abweichen.', MARGIN, y, { width: CONTENT_W });
  return doc.y + 8;
}

function drawFinalOverview(doc, y, offer, ensure, newPage) {
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text('Zusammenfassung aller verbauten Komponenten und Leistungen dieses Angebots:', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 10;
  for (const section of offer.sections || []) {
    ensure(28);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.label).text(section.title, MARGIN, y);
    y = doc.y + 4;
    for (const item of section.items || []) {
      ensure(18);
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
        .text(`• ${item.name}`, MARGIN + 4, y, { width: CONTENT_W - 90, continued: false });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
        .text(item.qty || '', MARGIN, y, { width: CONTENT_W, align: 'right' });
      y = Math.max(doc.y, y + 14);
    }
    y += 6;
  }
  return y;
}

function buildConfigCardLines(offer) {
  const cfg = (offer && offer.config) || {};
  const lines = [];
  const klimaFix = (offer.klima && offer.klima.fix) || [];

  if (cfg.includePv !== false && Number(cfg.moduleCount) > 0) {
    const peakRaw = cfg.kwpCalculated != null ? cfg.kwpCalculated : cfg.kwp;
    const peakLbl = Number.isFinite(Number(peakRaw))
      ? `${deNumPdf(Math.round(Number(peakRaw) * 100) / 100)} kW Peak`
      : String(cfg.kwpLabel || '').replace(/\s*kWp/i, ' kW Peak');
    const mods = Number(cfg.moduleCount) || 0;
    let summary = `Anlage mit ${peakLbl}, ${mods} Module`;
    if (cfg.speicherLabel && cfg.speicherLabel !== '—') {
      const speicherShort = String(cfg.speicherLabel).replace(/\s*\([^)]*\)\s*$/, '').trim();
      summary += ` plus ${speicherShort} Speicher`;
    }
    summary += '.';
    lines.push([null, summary]);

    const moduleName = cfg.moduleModel || (cfg.moduleType === 'aiko' ? 'AIKO Neostar 2S' : 'DAS Solar');
    lines.push(['Module: ', moduleName]);
    if (cfg.inverter && cfg.inverter !== '—') {
      lines.push(['Wechselrichter: ', cfg.inverter]);
    }
    if (cfg.speicherLabel && cfg.speicherLabel !== '—') {
      let speicherProd = `Speicher ${cfg.speicherLabel}`;
      if (cfg.brand === 'fronius') speicherProd = `Fronius Reserva ${cfg.speicherLabel}`;
      else if (cfg.brand === 'sigenergy') speicherProd = `SigenStor BAT ${cfg.speicherLabel}`;
      lines.push(['Speicher: ', speicherProd]);
    }
    if (cfg.dach) {
      lines.push(['Unterkonstruktion: ', cfg.dach]);
    }
  }

  for (const k of klimaFix) {
    if (k.packageId) lines.push(['Klima: ', k.label]);
    else lines.push(['Klima-Zubehör: ', k.label]);
  }
  if (!lines.length) lines.push([null, '—']);
  return lines;
}

function drawInfoCards(doc, yStart, offer, customer) {
  const gap = 15;
  const cardW = (CONTENT_W - gap) / 2;
  const pad = 12;
  const leftX = MARGIN;
  const rightX = MARGIN + cardW + gap;

  const addrLines = fmtAddrLines(customer);
  let leftH = pad + 14;
  for (const l of addrLines) {
    doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.bold ? 10.5 : 9.5);
    leftH += doc.heightOfString(l.t, { width: cardW - pad * 2 }) + 2;
  }
  leftH += pad;

  const rightLines = buildConfigCardLines(offer);
  let rightH = pad + 14;
  for (const [k, val] of rightLines) {
    doc.font(k ? 'Helvetica' : 'Helvetica-Bold').fontSize(9.5);
    rightH += doc.heightOfString((k || '') + val, { width: cardW - pad * 2 }) + 2;
  }
  rightH += pad;

  const cardH = Math.max(leftH, rightH, 92);

  doc.save().roundedRect(leftX, yStart, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();
  doc.save().roundedRect(rightX, yStart, cardW, cardH, 6).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();

  let ly = yStart + pad;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.label)
    .text('ANGEBOT FÜR', leftX + pad, ly, { characterSpacing: 0.6 });
  ly = doc.y + 4;
  for (const l of addrLines) {
    doc.font(l.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(l.bold ? 10.5 : 9.5).fillColor(COLORS.text)
      .text(l.t, leftX + pad, ly, { width: cardW - pad * 2 });
    ly = doc.y + 2;
  }

  let ry = yStart + pad;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.label)
    .text('KONFIGURATION', rightX + pad, ry, { characterSpacing: 0.6 });
  ry = doc.y + 4;
  for (const [k, val] of rightLines) {
    if (!k) {
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text)
        .text(val, rightX + pad, ry, { width: cardW - pad * 2 });
    } else {
      doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
        .text(k, rightX + pad, ry, { width: cardW - pad * 2, continued: true });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text).text(val);
    }
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

function measureItemRowHeight(doc, item) {
  const qtyW = 80;
  const nameW = CONTENT_W - qtyW - 10;
  doc.font('Helvetica').fontSize(9.5);
  const nameH = doc.heightOfString(String(item.name || ''), { width: nameW });
  let descH = 0;
  if (item.desc) {
    doc.font('Helvetica').fontSize(7.8);
    descH = doc.heightOfString(String(item.desc), { width: nameW }) + 1;
  }
  return Math.max(nameH + descH, 14) + 9;
}

function drawItemRow(doc, y, item, newPage) {
  const qtyW = 80;
  const nameW = CONTENT_W - qtyW - 10;
  const rowH = measureItemRowHeight(doc, item);

  if (y + rowH > CONTENT_BOTTOM) {
    y = newPage(true);
  }

  doc.font('Helvetica').fontSize(9.5);
  const nameH = doc.heightOfString(String(item.name || ''), { width: nameW });

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
  const hint = String(opt.hint || '').trim();
  doc.font('Helvetica').fontSize(9.5);
  const labelW = CONTENT_W - 32 - 110;
  const labelH = doc.heightOfString(opt.label || '', { width: labelW });
  let hintH = 0;
  if (hint) {
    doc.font('Helvetica').fontSize(7.6);
    hintH = doc.heightOfString(hint, { width: labelW }) + 2;
  }
  const h = Math.max(26, 10 + labelH + hintH + 8);
  doc.save().roundedRect(MARGIN, y, CONTENT_W, h, 4).fillAndStroke(COLORS.cardBg, COLORS.cardBorder).restore();
  doc.save().lineWidth(1).strokeColor(COLORS.label)
    .roundedRect(MARGIN + 12, y + 8, 10, 10, 2).stroke().restore();
  doc.font('Helvetica').fontSize(9.5).fillColor(COLORS.text)
    .text(opt.label, MARGIN + 32, y + 7, { width: labelW });
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text)
    .text(formatEUR(opt.price), MARGIN, y + 7, { width: CONTENT_W - 14, align: 'right' });
  if (hint) {
    const hy = y + 7 + labelH + 1;
    doc.font('Helvetica-Oblique').fontSize(7.6).fillColor(COLORS.muted)
      .text(hint, MARGIN + 32, hy, { width: labelW });
  }
  return y + h + 6;
}

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

module.exports = {
  generateOfferPdf,
  appendVollmacht,
  DEFAULT_BULLETS,
  DEFAULT_INTRO,
  collectLayoutPages,
};
