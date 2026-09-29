'use strict';

/**
 * Angebots-PDF im Stil der Useini-Vorlage (Reonic/NOORTEC).
 * Seite: Cover → Über uns → Brief → Auf einen Blick → PV+Belegung →
 * Komponenten → Speicher → Ertrag → Haushalt → Wirtschaftlichkeit →
 * Bestandteile → Preis → Akzeptieren → Datenblätter (+ Vollmacht).
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PdfLibDoc } = require('pdf-lib');
const { formatEUR, formatNum } = require('./catalog');
const { drawLayoutPreview } = require('./layout-preview');
const { selectDatasheetsForOffer } = require('./datasheets');
const { computeEconomics } = require('./economics');
const {
  abs: productAbs,
  firstExisting,
  buildComponentCards,
  splitComponentGroups,
  orderedOverviewSections,
  classifyKind,
} = require('./product-images');

const ASSETS = path.join(__dirname, 'assets');
const ROOT = path.join(__dirname, '../..');
const LOGO = path.join(ASSETS, 'noortec-logo.png');
const VOLLMACHT_PDF = path.join(ASSETS, 'vollmacht.pdf');
const VOLLMACHT_IMG = path.join(ASSETS, 'vollmacht.png');

/** Resolve Vertriebler-Foto: photoPath (fs) → photoUrl local map → fallback product asset. */
function resolveSalesPhotoPath(vertrieb) {
  const v = vertrieb || {};
  const candidates = [];
  if (v.photoPath) {
    const p = String(v.photoPath);
    candidates.push(path.isAbsolute(p) ? p : path.join(ROOT, p));
  }
  // Sibling UI serves /api/sales-photos/<user>; map to data/sales-photos on disk.
  if (v.photoUrl) {
    const u = String(v.photoUrl);
    const m = u.match(/\/api\/sales-photos\/([^/?#]+)/i);
    if (m) {
      const user = decodeURIComponent(m[1]);
      for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
        candidates.push(path.join(ROOT, 'data', 'sales-photos', `${user}${ext}`));
      }
    } else if (u.startsWith('/') && !u.startsWith('//')) {
      candidates.push(path.join(ROOT, 'public', u.replace(/^\//, '')));
      candidates.push(path.join(ROOT, u.replace(/^\//, '')));
    }
  }
  if (v.username) {
    for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
      candidates.push(path.join(ROOT, 'data', 'sales-photos', `${v.username}${ext}`));
    }
  }
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return productAbs('salesPortrait');
}

/** Fit image into box without letterbox bars (contain, centered on light fill). */
function drawFittedImage(doc, imgPath, x, y, boxW, boxH, bg = '#ffffff') {
  if (!imgPath || !fs.existsSync(imgPath)) return false;
  try {
    if (bg) {
      doc.save().roundedRect(x, y, boxW, boxH, 4).fill(bg).restore();
    }
    const img = doc.openImage(imgPath);
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    doc.image(img, x + (boxW - dw) / 2, y + (boxH - dh) / 2, { width: dw, height: dh });
    return true;
  } catch (_) {
    return false;
  }
}

/** Farben der Useini-Vorlage */
const COLORS = {
  text: '#2b2b2b',
  muted: '#8a8a8a',
  softMuted: '#a3a3a3',
  rule: '#e6e6e6',
  yellow: '#e6b81e',
  yellowSoft: '#f2db8e',
  yellowPale: '#f7efd0',
  footer: '#e6b81e',
  white: '#ffffff',
  cardBg: '#f5f5f5',
  dark: '#3a3a3a',
};

const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 48;
const CONTENT_W = PAGE.width - MARGIN * 2;
const CONTENT_TOP = 78;
const CONTENT_BOTTOM = 760;
const FOOTER_H = 28;

const DEFAULT_BULLETS = [
  'Hochleistungsfähige Glas-Glas PV-Module mit 30 Jahren Leistungsgarantie.',
  'Hocheffiziente Wechselrichter und Speicherlösungen.',
  'Robuste ALU-Unterkonstruktion.',
  'Komplette Installation und Inbetriebnahme durch unser Fachpersonal.',
  'Alle notwendigen Genehmigungen und Formalitäten.',
  'Ein modernes Überwachungssystem.',
  'Persönliche Einschulung und App-Installation für einfaches Monitoring.',
];

const DEFAULT_INTRO = 'vielen Dank für Ihr Interesse an unseren Lösungen im Bereich der Photovoltaik. Wir freuen uns, Ihnen ein individuelles Angebot für eine Photovoltaikanlage unterbreiten zu dürfen, das speziell auf Ihre Bedürfnisse zugeschnitten ist.';

const ABOUT_PARAS = [
  'Seit unserer Gründung im Jahr 2011 hat sich Noortec als führender Anbieter von Photovoltaiksystemen etabliert. Wir bieten alles aus einer Hand – von der ersten Beratung über die Planung und Installation bis hin zur Wartung und Unterstützung bei allen behördlichen Abwicklungen. Unsere Mission ist es, nachhaltige und effiziente Energiequellen zugänglich zu machen und dabei höchste Qualitätsstandards zu wahren.',
  'Mit mehreren tausend erfolgreich realisierten Anlagen haben wir umfangreiche Erfahrung und Fachwissen aufgebaut, das es uns ermöglicht, individuell auf die Bedürfnisse unserer Kunden einzugehen. Unser Angebot umfasst hochmoderne Solarpanels, intelligente Speicherlösungen und Netztrennboxen, alles ausgerichtet auf optimale Leistung und maximale Energieunabhängigkeit.',
  'Unser engagiertes Team aus Fachleuten übernimmt sämtliche Planungs- und Installationsprozesse sowie die notwendigen behördlichen Abwicklungen, sodass Sie sich um nichts kümmern müssen. Wir stehen Ihnen mit einem vollumfänglichen Service zur Seite und sorgen dafür, dass Ihre Anlage auch langfristig effizient und störungsfrei läuft.',
  'Vertrauen Sie auf Noortec für Ihre Energiezukunft – nachhaltig, zuverlässig und kompetent.',
];

function addPdfLinkNewWindow(doc, x, y, w, h, url) {
  try {
    const action = doc.ref({ S: 'URI', URI: new String(url), NewWindow: true });
    action.end();
    doc.annotate(x, y, w, h, { Subtype: 'Link', A: action, Border: [0, 0, 0] });
  } catch (_) {
    try { doc.link(x, y, w, h, url); } catch (__) { /* ignore */ }
  }
}

function fmtDateLong(datum) {
  if (!datum) return new Date().toLocaleDateString('de-AT', { day: 'numeric', month: 'long', year: 'numeric' });
  // already localized string ok
  return String(datum);
}

function generateOfferPdf(offer, customer, texts = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: MARGIN, bufferPages: true, autoFirstPage: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const eco = computeEconomics(offer, {
        ...(opts.economics || {}),
        ...(opts.ertrag || {}),
        ...(texts.economics || {}),
        jahresverbrauch: opts.jahresverbrauch || texts.jahresverbrauch,
      });
      const cards = buildComponentCards(offer);
      const groups = splitComponentGroups(cards);
      const dateLabel = fmtDateLong(offer.meta && offer.meta.datum);
      const cfg = offer.config || {};
      const vertrieb = (offer.meta && offer.meta.vertrieb) || {};
      const salesPhoto = resolveSalesPhotoPath(vertrieb);

      let y = 0;

      const startContentPage = () => {
        doc.addPage();
        y = drawContentHeader(doc, dateLabel, vertrieb, salesPhoto);
        return y;
      };

      // ── 1 Cover ──
      drawCoverPage(doc, offer, customer, salesPhoto);

      // ── 2 Über uns ──
      doc.addPage();
      drawAboutPage(doc);

      // ── 3 Brief ──
      y = startContentPage();
      y = drawLetterPage(doc, y, texts);

      // ── 4 Auf einen Blick ──
      y = startContentPage();
      y = drawGlancePage(doc, y, offer, eco);

      // ── 5 PV + Belegungsplan (aktiv) + weitere Varianten ──
      const layoutPages = collectLayoutPages(opts);
      if (cfg.includePv !== false && Number(cfg.moduleCount) > 0) {
        if (!layoutPages.length) {
          y = startContentPage();
          y = drawPvIntroPage(doc, y, offer, eco, null);
        } else {
          layoutPages.forEach((lp, idx) => {
            y = startContentPage();
            y = drawPvIntroPage(doc, y, offer, eco, lp, idx === 0);
          });
        }
      }

      // ── 6 VERBAUTE KOMPONENTEN (PV) ──
      y = drawComponentCardPages(doc, groups.pv, startContentPage, 'VERBAUTE KOMPONENTEN');

      // ── 7 Speicher ──
      if (groups.storage.length) {
        y = startContentPage();
        y = drawStorageSection(doc, y, groups.storage, eco, startContentPage);
      }

      if (groups.extras && groups.extras.length) {
        y = drawComponentCardPages(doc, groups.extras, startContentPage, 'WEITERE KOMPONENTEN');
      }

      // ── 8 Ertrag ──
      y = startContentPage();
      y = drawErtragPage(doc, y, eco);

      // ── 9 Haushalt ──
      y = startContentPage();
      y = drawHaushaltPage(doc, y, eco);

      // ── 10 Wirtschaftlichkeit ──
      y = startContentPage();
      y = drawWirtschaftPage(doc, y, eco);

      // ── 11 Gesamtübersicht: PV → Speicher → weitere → Leistungen → Preis → Unterschrift ──
      y = startContentPage();
      y = drawBestandteilePage(doc, y, offer, startContentPage);
      y += 14;
      if (y > CONTENT_BOTTOM - 140) y = startContentPage();
      y = drawPriceBlock(doc, y, offer.preis);
      y += 32;
      if (y > CONTENT_BOTTOM - 56) y = startContentPage();
      doc.save().lineWidth(0.8).strokeColor('#c8c8c8')
        .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
      y += 8;
      doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
        .text('Ort, Datum, Name, Unterschrift', MARGIN, y);

      // Optionals AFTER total price + signature
      if (offer.optionaleKomponenten && offer.optionaleKomponenten.length) {
        y = startContentPage();
        doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.text).text('Optionale Komponenten', MARGIN, y);
        y = doc.y + 12;
        doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
          .text('Nicht im Gesamtpreis enthalten – auf Wunsch beauftragbar.', MARGIN, y);
        y = doc.y + 14;
        for (const opt of offer.optionaleKomponenten) {
          if (y > CONTENT_BOTTOM - 36) y = startContentPage();
          const rowY = y;
          doc.save().lineWidth(1).strokeColor(COLORS.yellow)
            .roundedRect(MARGIN, rowY + 2, 11, 11, 2).stroke().restore();
          doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
            .text(opt.label, MARGIN + 20, rowY, { width: CONTENT_W - 130 });
          doc.font('Helvetica-Bold').fontSize(10.5).fillColor(COLORS.text)
            .text(formatEUR(opt.price), MARGIN, rowY, { width: CONTENT_W, align: 'right' });
          y = Math.max(doc.y, rowY + 18) + 8;
        }
      }

      // ── Angebot akzeptieren (nach Optionals) ──
      y = startContentPage();
      y = drawAcceptPage(doc, y);

      // ── Datenblätter ──
      const sheets = selectDatasheetsForOffer(offer, {
        baseUrl: opts.baseUrl || process.env.APP_BASE_URL || 'https://pvl.lifeco.at',
      });
      if (sheets.length) {
        y = startContentPage();
        y = drawDatasheetsPage(doc, y, sheets);
      }

      // Footer auf allen Seiten außer Cover (Seite 0) und About hat eigenen Footer
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i += 1) {
        doc.switchToPage(i);
        doc.page.margins.bottom = 0;
        const pageIndex = i - range.start;
        if (pageIndex === 0) continue; // cover
        drawYellowFooter(doc, pageIndex + 1, range.count);
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawYellowFooter(doc, pageNum, total) {
  const y = PAGE.height - FOOTER_H;
  doc.save().rect(0, y, PAGE.width, FOOTER_H).fill(COLORS.footer).restore();
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.white)
    .text('noortec.at', MARGIN, y + 8, { lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.white)
    .text(`${pageNum} / ${total}`, MARGIN, y + 8, { width: CONTENT_W, align: 'right', lineBreak: false });
}

function drawSalesBadge(doc, vertrieb, photoPath, x, y, opts = {}) {
  const v = vertrieb || {};
  const badgeW = opts.width || 210;
  const badgeH = opts.height || 52;
  doc.save().roundedRect(x, y, badgeW, badgeH, 10).fill('#ececec').restore();
  let textX = x + 12;
  if (photoPath && fs.existsSync(photoPath)) {
    try {
      doc.save();
      doc.circle(x + 26, y + badgeH / 2, 16).clip();
      doc.image(photoPath, x + 10, y + badgeH / 2 - 16, { width: 32, height: 32 });
      doc.restore();
      textX = x + 48;
    } catch (_) { /* ignore */ }
  }
  const tw = badgeW - (textX - x) - 8;
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text)
    .text(v.name || 'Noortec Vertrieb', textX, y + 8, { width: tw, lineBreak: false });
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text(v.email || '', textX, y + 22, { width: tw, lineBreak: false })
    .text(v.phone || '', textX, y + 34, { width: tw, lineBreak: false });
  return badgeH;
}

function drawContentHeader(doc, dateLabel, vertrieb, salesPhoto) {
  try {
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, 28, { height: 26 });
  } catch (_) { /* ignore */ }
  const badgeW = 200;
  const badgeX = PAGE.width - MARGIN - badgeW;
  drawSalesBadge(doc, vertrieb, salesPhoto, badgeX, 22, { width: badgeW, height: 48 });
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.softMuted)
    .text(dateLabel || '', MARGIN, 56, { width: CONTENT_W - badgeW - 12, align: 'left' });
  return 88;
}

function drawCoverPage(doc, offer, customer, salesPhoto) {
  // Logo + sales badge
  try {
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, 36, { height: 34 });
  } catch (_) { /* ignore */ }

  const v = (offer.meta && offer.meta.vertrieb) || {};
  const badgeW = 210;
  const badgeX = PAGE.width - MARGIN - badgeW;
  drawSalesBadge(doc, v, salesPhoto || productAbs('salesPortrait'), badgeX, 32, { width: badgeW, height: 52 });

  // Title
  let y = 130;
  doc.font('Helvetica-Bold').fontSize(28).fillColor(COLORS.text)
    .text('Ihr persönliches Angebot', MARGIN, y);
  y = doc.y + 10;
  doc.save().lineWidth(0.8).strokeColor(COLORS.rule)
    .moveTo(MARGIN, y).lineTo(MARGIN + 280, y).stroke().restore();
  y += 10;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
    .text('von Noortec GmbH | Rudolf Köpplgasse 2/7 | 1220 Wien', MARGIN, y);

  // Yellow waves (bottom third)
  const waveTop = 470;
  doc.save();
  doc.moveTo(0, waveTop + 80)
    .bezierCurveTo(120, waveTop - 40, 280, waveTop + 140, 420, waveTop + 20)
    .bezierCurveTo(500, waveTop - 40, 560, waveTop + 60, PAGE.width, waveTop + 10)
    .lineTo(PAGE.width, PAGE.height)
    .lineTo(0, PAGE.height)
    .closePath()
    .fill(COLORS.yellowSoft);
  doc.moveTo(0, waveTop + 160)
    .bezierCurveTo(150, waveTop + 40, 300, waveTop + 220, 480, waveTop + 100)
    .bezierCurveTo(540, waveTop + 60, 580, waveTop + 140, PAGE.width, waveTop + 120)
    .lineTo(PAGE.width, PAGE.height)
    .lineTo(0, PAGE.height)
    .closePath()
    .fill(COLORS.yellow);
  doc.restore();

  // Circular hero
  const circle = firstExisting('coverHero', 'coverHeroRaw', 'heroHome');
  const cx = PAGE.width / 2;
  const cy = 380;
  const r = 118;
  if (circle) {
    try {
      doc.save();
      doc.circle(cx, cy, r + 6).fill(COLORS.white);
      doc.circle(cx, cy, r).clip();
      const img = doc.openImage(circle);
      const scale = Math.max((r * 2) / img.width, (r * 2) / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      doc.image(img, cx - dw / 2, cy - dh / 2, { width: dw, height: dh });
      doc.restore();
      doc.save().circle(cx, cy, r + 4).lineWidth(6).strokeColor(COLORS.white).stroke().restore();
    } catch (_) { /* ignore */ }
  }

  // Angebotsnummer auf der hellen Welle (Vorlage)
  doc.font('Helvetica').fontSize(12).fillColor(COLORS.dark)
    .text(`Angebotsnummer ${offer.meta.angebotsnummer || ''}`, MARGIN, 720);

  // Customer on gold (bottom right)
  const lines = [];
  if (customer.name) lines.push(customer.name);
  if (customer.street) lines.push(customer.street);
  const city = [customer.zip, customer.city].filter(Boolean).join(' ');
  if (city) lines.push(city);
  if (customer.email) lines.push(customer.email);
  if (customer.phone) lines.push(customer.phone);
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.white);
  let cyText = 700;
  lines.forEach((t) => {
    doc.text(t, MARGIN, cyText, { width: CONTENT_W, align: 'right' });
    cyText = doc.y + 2;
  });
}

function drawAboutPage(doc) {
  // pale yellow top band with white slogan card
  doc.save().rect(0, 0, PAGE.width, 210).fill(COLORS.yellowPale).restore();
  const cardW = CONTENT_W;
  const cardH = 72;
  const cardX = MARGIN;
  const cardY = 70;
  doc.save().roundedRect(cardX, cardY, cardW, cardH, 4).fill(COLORS.white).restore();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.text)
    .text('Noortec: Energie, die für Sie arbeitet! – Ihr Komplettanbieter für nachhaltige Energielösungen seit 2011', cardX + 18, cardY + 18, {
      width: cardW - 36,
      align: 'left',
      lineGap: 2,
    });

  let y = 240;
  try {
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, y, { height: 28 });
  } catch (_) { /* ignore */ }
  doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.text)
    .text('Ihr Partner für Photovoltaikanlagen in Wien, Niederösterreich und Burgenland.', MARGIN + 130, y, {
      width: CONTENT_W - 130,
    });
  y = Math.max(doc.y, y + 40) + 16;

  for (const p of ABOUT_PARAS) {
    doc.font('Helvetica').fontSize(10).fillColor(COLORS.dark)
      .text(p, MARGIN, y, { width: CONTENT_W, align: 'justify', lineGap: 2 });
    y = doc.y + 12;
  }
}

function drawLetterPage(doc, y, texts) {
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.text).text('Ihr Angebot', MARGIN, y);
  y = doc.y + 18;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text(texts.greeting || 'Guten Tag,', MARGIN, y);
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text(texts.intro || DEFAULT_INTRO, MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text)
    .text('Unser Angebot beinhaltet:', MARGIN, y);
  y = doc.y + 10;
  const bullets = Array.isArray(texts.bullets) && texts.bullets.length ? texts.bullets : DEFAULT_BULLETS;
  for (const b of bullets) {
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.yellow).text('+', MARGIN, y);
    doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
      .text(b, MARGIN + 16, y + 1, { width: CONTENT_W - 16, lineGap: 1 });
    y = doc.y + 6;
  }
  y += 10;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Wir sind überzeugt, dass unsere Photovoltaiklösungen Ihnen helfen werden, unabhängig von schwankenden Strompreisen zu werden und gleichzeitig einen Beitrag zum Umweltschutz zu leisten.', MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Bitte überprüfen Sie die Details des Angebots und zögern Sie nicht, mich bei Fragen oder für weitere Informationen zu kontaktieren.', MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Wir freuen uns darauf, Sie auf dem Weg zu einer nachhaltigeren Energieversorgung zu begleiten.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

function drawGlancePage(doc, y, offer, eco) {
  doc.save().roundedRect(MARGIN, y, CONTENT_W, 460, 10).fill(COLORS.cardBg).restore();
  const pad = 20;
  let yy = y + pad;
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.text)
    .text('Auf einen Blick', MARGIN + pad, yy);
  yy = doc.y + 8;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Ihr Angebot auf einen Blick:  Mit Ihrer Photovoltaikanlage produzieren Sie CO2-neutral Strom. Mit Ihrem Stromspeicher erreichen Sie eine höhere Unabhängigkeit.', MARGIN + pad, yy, {
      width: CONTENT_W - pad * 2,
      lineGap: 2,
    });
  yy = doc.y + 12;
  const house = productAbs('houseOverview');
  const maxW = CONTENT_W - pad * 2;
  const maxH = 230;
  if (house) {
    try {
      const img = doc.openImage(house);
      let dw = maxW;
      let dh = dw * (img.height / Math.max(1, img.width));
      if (dh > maxH) {
        dh = maxH;
        dw = dh * (img.width / Math.max(1, img.height));
      }
      // heller Bildrahmen – kein schwarzer Kasten
      doc.save().roundedRect(MARGIN + pad, yy, maxW, maxH, 6).fill('#ffffff').restore();
      doc.image(img, MARGIN + pad + (maxW - dw) / 2, yy + (maxH - dh) / 2, { width: dw, height: dh });
    } catch (_) { /* ignore */ }
  }
  yy += maxH + 14;
  const rows = [['Photovoltaikanlage', eco.labels.peak]];
  if (eco.hasStorage) rows.push(['Stromspeicher', eco.labels.speicher]);
  rows.forEach(([label, val], i) => {
    if (i > 0) {
      doc.save().lineWidth(0.6).strokeColor('#d8d8d8')
        .moveTo(MARGIN + pad, yy).lineTo(PAGE.width - MARGIN - pad, yy).stroke().restore();
      yy += 8;
    }
    doc.font('Helvetica').fontSize(12).fillColor(COLORS.text).text(label, MARGIN + pad, yy);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text)
      .text(val, MARGIN + pad, yy, { width: CONTENT_W - pad * 2, align: 'right' });
    yy += 26;
  });

  const boxY = Math.max(yy + 12, y + 480);
  doc.save().roundedRect(MARGIN, boxY, CONTENT_W, 72, 10).fill(COLORS.cardBg).restore();
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text)
    .text('Sie finden Ihr Angebot auch Online.', MARGIN + 22, boxY + 18);
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text('Scannen Sie dazu einfach den nebenstehenden QR-Code.', MARGIN + 22, boxY + 38, { width: CONTENT_W - 120 });
  const qr = productAbs('qrPlaceholder');
  if (qr) {
    try { doc.image(qr, PAGE.width - MARGIN - 64, boxY + 8, { width: 56, height: 56 }); } catch (_) { /* ignore */ }
  }
  return boxY + 80;
}

function drawPvIntroPage(doc, y, offer, eco, lp, isPrimary = true) {
  const title = isPrimary || !lp || !lp.subtitle
    ? 'Ihre Photovoltaikanlage'
    : `Ihre Photovoltaikanlage · ${lp.subtitle}`;
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.text).text(title, MARGIN, y);
  y = doc.y + 8;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text('Hier sehen Sie die Details zur Photovoltaikanlage, die wir für Sie geplant haben.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.softMuted)
    .text(lp && lp.subtitle ? `IHRE DACHBELEGUNG · ${String(lp.subtitle).toUpperCase()}` : 'IHRE DACHBELEGUNG', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 10;

  const imgH = 360;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, imgH, 6).fill('#c9d4c0').restore();
  let drawn = false;
  if (lp && lp.layoutSnapshotPath && fs.existsSync(lp.layoutSnapshotPath)) {
    try {
      // Cover: fill the frame cleanly (no black bars), slight inset for rounded look
      const pad = 2;
      doc.save();
      doc.roundedRect(MARGIN + pad, y + pad, CONTENT_W - pad * 2, imgH - pad * 2, 5).clip();
      const img = doc.openImage(lp.layoutSnapshotPath);
      const scale = Math.max((CONTENT_W - pad * 2) / img.width, (imgH - pad * 2) / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      doc.image(img, MARGIN + pad + (CONTENT_W - pad * 2 - dw) / 2, y + pad + (imgH - pad * 2 - dh) / 2, {
        width: dw,
        height: dh,
      });
      doc.restore();
      drawn = true;
    } catch (_) { /* ignore */ }
  }
  if (!drawn && lp && lp.layoutPlan) {
    const out = drawLayoutPreview(doc, lp.layoutPlan, {
      x: MARGIN + 6, y: y + 6, width: CONTENT_W - 12, height: imgH - 12,
    });
    drawn = !!out.drawn;
  }
  if (!drawn) {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.muted)
      .text('Belegungsplan wird ergänzt, sobald die Dachplanung vorliegt.', MARGIN + 24, y + imgH / 2 - 8, {
        width: CONTENT_W - 48,
        align: 'center',
      });
  }
  y += imgH + 18;

  // Anlagengröße / Module rows
  y = drawKeyValueRow(doc, y,
    'Anlagengröße',
    'Die Anlagengröße in Kilowattpeak bezeichnet die Leistung Ihrer Anlage unter Standardbedingungen.',
    eco.labels.kwp);
  y += 8;
  const mods = Number((offer.config && offer.config.moduleCount) || 0);
  y = drawKeyValueRow(doc, y,
    'Module',
    `Wir installieren für Sie ${mods} Module wie oben gezeigt auf Ihrem Dach, vorausgesetzt es ist technisch machbar.`,
    `${mods} ×`);
  return y;
}

function drawKeyValueRow(doc, y, title, desc, value) {
  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text(title, MARGIN, y);
  const valW = 140;
  doc.font('Helvetica-Bold').fontSize(18).fillColor(COLORS.text)
    .text(value, MARGIN, y, { width: CONTENT_W, align: 'right' });
  y = doc.y + 2;
  doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
    .text(desc, MARGIN, y, { width: CONTENT_W - valW - 10 });
  return doc.y + 12;
}

function drawComponentCardPages(doc, cards, startContentPage, heading) {
  if (!cards.length) return 0;
  let y = startContentPage();
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.softMuted)
    .text(heading, MARGIN, y, { characterSpacing: 0.6 });
  y = doc.y + 12;

  let index = 0;
  for (const card of cards) {
    index += 1;
    const blockH = estimateCardHeight(doc, card);
    // Pack ~4–5 Bildkarten / Seite (Vorlage-Feedback: deutlich mehr als 2)
    if (y + blockH > CONTENT_BOTTOM) {
      y = startContentPage();
      doc.font('Helvetica-Bold').fontSize(13).fillColor(COLORS.softMuted)
        .text(heading, MARGIN, y, { characterSpacing: 0.6 });
      y = doc.y + 12;
    }
    y = drawComponentCard(doc, y, index, card);
    y += 10;
  }
  return y;
}

function estimateCardHeight(doc, card) {
  const hasImg = !!(card.image && fs.existsSync(card.image));
  const textW = CONTENT_W - (hasImg ? 118 : 0);
  const desc = truncateDesc(card.desc, 220);
  doc.font('Helvetica').fontSize(8.5);
  const descH = doc.heightOfString(desc || ' ', { width: textW, lineGap: 1 });
  return Math.max(hasImg ? 96 : 62, 30 + Math.min(descH, 58) + 12);
}

function truncateDesc(text, maxLen) {
  const raw = text == null ? '' : String(text).trim();
  const s = raw || 'Hochwertige Komponente – fachgerecht installiert.';
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1).trim()}…`;
}

function drawComponentCard(doc, y, index, card) {
  const numR = 9;
  const titleY = y;
  doc.save().circle(MARGIN + numR, y + numR, numR).lineWidth(1.1).strokeColor(COLORS.text).stroke().restore();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(COLORS.text)
    .text(String(index), MARGIN, y + 4, { width: numR * 2, align: 'center', lineBreak: false });

  const right = [card.brandLabel, card.qty].filter(Boolean).join('  ·  ');
  const rightW = right ? Math.min(200, doc.widthOfString(right) + 4) : 0;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text)
    .text(card.name || '', MARGIN + numR * 2 + 8, y + 3, {
      width: CONTENT_W - numR * 2 - 16 - rightW,
      lineBreak: false,
      ellipsis: true,
    });
  if (right) {
    doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.muted)
      .text(right, MARGIN, y + 5, { width: CONTENT_W, align: 'right', lineBreak: false });
  }
  y += 22;
  doc.save().lineWidth(0.6).strokeColor(COLORS.rule)
    .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
  y += 8;

  const hasImg = !!(card.image && fs.existsSync(card.image));
  const imgBoxW = hasImg ? 100 : 0;
  const imgBoxH = hasImg ? 78 : 0;
  const textW = CONTENT_W - (hasImg ? imgBoxW + 14 : 0);
  const desc = truncateDesc(card.desc, 240);
  doc.font('Helvetica').fontSize(8.5).fillColor(COLORS.dark)
    .text(desc, MARGIN, y, { width: textW, lineGap: 1.2, height: 58, ellipsis: true });
  const textBottom = doc.y;
  if (hasImg) {
    drawFittedImage(doc, card.image, PAGE.width - MARGIN - imgBoxW, y, imgBoxW, imgBoxH, '#f7f7f7');
    return Math.max(textBottom, y + imgBoxH) + 2;
  }
  return Math.max(textBottom, titleY + 54) + 2;
}

function drawStorageSection(doc, y, cards, eco, startContentPage) {
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.text).text('Ihr Energiespeicher', MARGIN, y);
  y = doc.y + 6;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Hier sehen Sie die Details zum Energiespeicher, den wir für Sie geplant haben.', MARGIN, y);
  y = doc.y + 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.softMuted)
    .text('VERBAUTE KOMPONENTEN', MARGIN, y, { characterSpacing: 0.5 });
  y = doc.y + 10;

  let index = 0;
  for (const card of cards) {
    index += 1;
    const blockH = estimateCardHeight(doc, card);
    if (y + blockH > CONTENT_BOTTOM - 80) {
      y = startContentPage();
    }
    y = drawComponentCard(doc, y, index, card);
    y += 8;
  }
  y += 6;
  if (y > CONTENT_BOTTOM - 70) y = startContentPage();
  y = drawKeyValueRow(doc, y,
    'Speichergröße',
    'Die Speichergröße in Kilowattstunden (kWh) beschreibt die maximale Menge Strom, die Ihr Speicher aufnehmen und abgeben kann.',
    eco.labels.speicher);
  return y;
}

function drawErtragPage(doc, y, eco) {
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.softMuted)
    .text('MONATLICHE ENERGIEPRODUKTION', MARGIN, y, { characterSpacing: 0.5 });
  y = doc.y + 10;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text('Hier sehen Sie die Stromproduktion Ihrer zukünftigen Photovoltaikanlage über ein Jahr hinweg.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 16;

  const chartH = 260;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, chartH, 8).fill(COLORS.cardBg).restore();
  drawMonthlyBars(doc, MARGIN + 36, y + 20, CONTENT_W - 56, chartH - 50, eco.monthly);
  y += chartH + 18;

  y = drawKeyValueRow(doc, y,
    'Stromertrag im Jahr',
    'In einem durchschnittlichen Jahr ist für Ihre Photovoltaikanlage von ungefähr diesem Ertrag auszugehen.',
    eco.labels.annualYield);
  y += 16;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
    .text('Die in dieser Simulation berechneten Ertragswerte basieren auf dem spezifischen Standort, der Neigung und der Ausrichtung der PV-Module. Sie stellen eine näherungsweise Schätzung dar und können im Individualfall abweichen. Die Ergebnisse sind nicht als verbindliche Zusage für die tatsächliche Leistung der Anlage zu verstehen.', MARGIN, y, { width: CONTENT_W, lineGap: 1 });
  return doc.y;
}

function drawMonthlyBars(doc, x, y, w, h, monthly) {
  const max = Math.max(...monthly.map((m) => m.kwh), 1);
  const gap = 6;
  const barW = (w - gap * (monthly.length - 1)) / monthly.length;
  // grid
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.softMuted);
  for (let i = 0; i <= 4; i += 1) {
    const gy = y + h - (h * i) / 4;
    doc.save().lineWidth(0.4).strokeColor('#ddd')
      .moveTo(x, gy).lineTo(x + w, gy).stroke().restore();
    const label = Math.round((max * i) / 4);
    doc.text(`${formatNum(label)}`, x - 34, gy - 4, { width: 30, align: 'right' });
  }
  monthly.forEach((m, i) => {
    const bh = Math.max(2, (m.kwh / max) * h);
    const bx = x + i * (barW + gap);
    doc.save().roundedRect(bx, y + h - bh, barW, bh, 2).fill(COLORS.yellow).restore();
    if (i % 2 === 0) {
      doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted)
        .text(m.month, bx - 4, y + h + 4, { width: barW + 8, align: 'center' });
    }
  });
}

function drawHaushaltPage(doc, y, eco) {
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.text).text('Ihr Haushalt', MARGIN, y);
  y = doc.y + 8;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text('Hier sehen Sie, wie sich Ihr Haushalt in Zukunft im Hinblick auf Energieverbrauch & Energieerzeugung verhalten kann.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 18;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.softMuted)
    .text('IHRE ANGABEN', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 10;
  const inputs = [
    ['Stromverbrauch Haushalt', eco.labels.household],
    ['Strompreis', eco.labels.gridPriceCt],
    ['Strompreissteigerung', eco.labels.inflation],
  ];
  inputs.forEach(([label, val]) => {
    doc.save().lineWidth(0.6).strokeColor(COLORS.rule)
      .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
    y += 10;
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.text).text(label, MARGIN, y);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.text)
      .text(val, MARGIN, y, { width: CONTENT_W, align: 'right' });
    y += 24;
  });
  doc.save().lineWidth(0.6).strokeColor(COLORS.rule)
    .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
  y += 18;

  doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.softMuted)
    .text('IHR ENERGIEHAUSHALT', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 10;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text(eco.flowText, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 12;

  const flowH = 168;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, flowH, 8).fill(COLORS.cardBg).restore();
  const flowImg = firstExisting('energyFlow', 'chartFlow');
  let flowDrawn = false;
  if (flowImg) {
    flowDrawn = drawFittedImage(doc, flowImg, MARGIN + 10, y + 8, CONTENT_W - 20, flowH - 16, null);
  }
  if (!flowDrawn) {
    drawEnergyFlowDiagram(doc, MARGIN + 16, y + 14, CONTENT_W - 32, flowH - 28, eco);
  }
  y += flowH + 14;

  y = drawKeyValueRow(doc, y,
    'Ihre Autarkie im Haushalt',
    'Die Autarkiequote zeigt, wie viel des benötigten Stroms für Ihren Haushalt selbst erzeugt wird.',
    eco.labels.autarky);
  y += 6;
  y = drawKeyValueRow(doc, y,
    'Ihr Eigenverbrauch',
    'Die Eigenverbrauchsquote gibt an, wie viel des erzeugten Solarstroms selbst genutzt und nicht in das öffentliche Stromnetz eingespeist wird.',
    eco.labels.selfRate);
  y += 10;
  doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
    .text('Die in dieser Simulation berechneten Ertragswerte basieren auf dem spezifischen Standort, der Neigung und der Ausrichtung der PV-Module. Sie stellen eine näherungsweise Schätzung dar und können im Individualfall abweichen.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

/** Vector Sankey-ähnliches Energieflussdiagramm (Fallback ohne Asset). */
function drawEnergyFlowDiagram(doc, x, y, w, h, eco) {
  const pv = Math.max(1, eco.annualYield || 1);
  const toHome = Math.max(0, eco.directToHome || eco.selfConsumed || 0);
  const toStore = Math.max(0, eco.toStorage || 0);
  const feed = Math.max(0, eco.feedInKwh || 0);
  const fromStore = Math.max(0, eco.fromStorage || 0);
  const fromGrid = Math.max(0, eco.gridRemain || 0);
  const totalOut = Math.max(1, toHome + toStore + feed);

  const nodeW = 14;
  const pvX = x + 8;
  const midX = x + w * 0.45;
  const endX = x + w - 22;
  const pvTop = y + 8;
  const pvH = h - 28;

  function band(x0, y0, x1, y1, thickness, color) {
    const t = Math.max(3, thickness);
    doc.save();
    doc.fillColor(color).fillOpacity(0.55);
    doc.moveTo(x0, y0 - t / 2)
      .bezierCurveTo((x0 + x1) / 2, y0 - t / 2, (x0 + x1) / 2, y1 - t / 2, x1, y1 - t / 2)
      .lineTo(x1, y1 + t / 2)
      .bezierCurveTo((x0 + x1) / 2, y1 + t / 2, (x0 + x1) / 2, y0 + t / 2, x0, y0 + t / 2)
      .closePath()
      .fill();
    doc.restore();
  }

  let cursor = pvTop;
  const hFeed = (feed / totalOut) * pvH;
  const hHome = (toHome / totalOut) * pvH;
  const hStore = (toStore / totalOut) * pvH;

  band(pvX + nodeW, cursor + hFeed / 2, midX, y + 28, hFeed * 0.85, '#c8b06a');
  cursor += hFeed;
  band(pvX + nodeW, cursor + hHome / 2, endX, y + 70, hHome * 0.85, COLORS.yellowSoft);
  cursor += hHome;
  band(pvX + nodeW, cursor + hStore / 2, midX, y + h - 50, Math.max(8, hStore * 0.85), COLORS.yellowPale);
  if (fromGrid > 0) {
    band(midX + nodeW, y + 36, endX, y + h * 0.55, 18, '#9a9a9a');
  }
  if (fromStore > 0) {
    band(midX + nodeW, y + h - 50, endX, y + h - 40, 16, COLORS.yellowSoft);
  }

  doc.save().roundedRect(pvX, pvTop, nodeW, pvH, 3).fill(COLORS.yellow).restore();
  doc.save().roundedRect(midX, y + 16, nodeW, 48, 3).fill('#4a4a4a').restore();
  if (eco.hasStorage) {
    doc.save().roundedRect(midX, y + h - 70, nodeW, 52, 3).fill(COLORS.yellowSoft).restore();
  }
  doc.save().roundedRect(endX, y + 24, nodeW, h - 48, 3).fill('#4a4a4a').restore();

  doc.font('Helvetica').fontSize(8).fillColor(COLORS.dark)
    .text('Photovoltaik', pvX - 2, y + h - 14, { width: 70 })
    .text('Netz', midX - 8, y + 4, { width: 40 })
    .text(eco.hasStorage ? 'Speicher' : '', midX - 10, y + h - 16, { width: 50 })
    .text('Verbrauch', endX - 30, y + 8, { width: 60 });
}

function drawWirtschaftPage(doc, y, eco) {
  doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.text).text('Ihre Wirtschaftlichkeit', MARGIN, y);
  y = doc.y + 6;
  doc.font('Helvetica').fontSize(10.5).fillColor(COLORS.text)
    .text('Hier sehen Sie die Wirtschaftlichkeit Ihrer geplanten Komponenten über den Betrachtungszeitraum.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 12;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(COLORS.softMuted)
    .text('AMORTISATION', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 10;

  const chartH = 200;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, chartH, 8).fill(COLORS.cardBg).restore();
  drawAmortBars(doc, MARGIN + 36, y + 12, CONTENT_W - 52, chartH - 36, eco.yearly);
  y += chartH + 12;

  // Mehrjahres-Kennzahlen (nicht nur erstes/letztes Jahr)
  y = drawYearlySnapshotTable(doc, y, eco);
  y += 10;

  y = drawKeyValueRow(doc, y,
    'Gesamte Einsparungen',
    `Auf eine Sicht von ${eco.years} Jahren sparen Sie ${eco.labels.totalSavings}.`,
    eco.labels.totalSavings);
  y += 4;
  const beSub = eco.paybackYears != null
    ? `Die Amortisation wird nach ${eco.paybackYears} Jahren${eco.paybackYearLabel ? ` im Jahr ${eco.paybackYearLabel}` : ''} erwartet`
    : 'Amortisation außerhalb des Betrachtungszeitraums';
  y = drawKeyValueRow(doc, y, 'Break-Even', beSub, eco.labels.payback);
  y += 4;
  y = drawKeyValueRow(doc, y,
    'Einsparung Jahr 1',
    'Geschätzte Ersparnis im ersten Betriebsjahr (Eigenverbrauch + Einspeisung).',
    `${formatNum(Math.round(eco.savingsYear1))} €`);
  y += 8;
  doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted)
    .text('Die Berechnungsergebnisse dienen der Orientierung und können im Einzelfall abweichen. Einflussfaktoren wie Wetterbedingungen, Strompreisänderungen, Degradation der PV-Module und individuelles Verbrauchsverhalten können zu Abweichungen führen.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

function pickYearIndices(yearly) {
  if (!yearly.length) return [];
  const n = yearly.length;
  const targets = [0];
  if (n > 1) targets.push(Math.min(4, n - 1)); // Jahr 5
  if (n > 5) targets.push(Math.min(9, n - 1)); // Jahr 10
  if (n > 10) targets.push(Math.min(14, n - 1)); // Jahr 15
  targets.push(n - 1);
  // unique sorted
  return [...new Set(targets)].sort((a, b) => a - b);
}

function drawYearlySnapshotTable(doc, y, eco) {
  const yearly = eco.yearly || [];
  const idxs = pickYearIndices(yearly);
  if (!idxs.length) return y;

  doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.softMuted)
    .text('ENTWICKLUNG ÜBER DIE JAHRE', MARGIN, y, { characterSpacing: 0.3 });
  y = doc.y + 8;

  const cols = idxs.length;
  const colW = CONTENT_W / cols;
  idxs.forEach((i, ci) => {
    const r = yearly[i];
    const cx = MARGIN + ci * colW;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
      .text(String(r.calendarYear), cx, y, { width: colW - 6 });
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.muted)
      .text(`Jahr ${r.year}`, cx, y + 12, { width: colW - 6 });
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.text)
      .text(`${formatNum(Math.round(r.cumulative))} €`, cx, y + 26, { width: colW - 6 });
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.softMuted)
      .text(`+${formatNum(Math.round(r.savings))} € / Jahr`, cx, y + 40, { width: colW - 6 });
  });
  return y + 58;
}

function drawAmortBars(doc, x, y, w, h, yearly) {
  if (!yearly.length) return;
  const vals = yearly.map((r) => r.cumulative);
  const max = Math.max(...vals, 1);
  const min = Math.min(...vals, 0);
  const span = Math.max(max - min, 1);
  const zeroY = y + h * (max / span);
  const gap = 2;
  const barW = Math.max(2, (w - gap * (yearly.length - 1)) / yearly.length);
  doc.save().lineWidth(0.5).strokeColor('#ccc').moveTo(x, zeroY).lineTo(x + w, zeroY).stroke().restore();
  yearly.forEach((r, i) => {
    const bx = x + i * (barW + gap);
    const v = r.cumulative;
    if (v >= 0) {
      const bh = (v / span) * h;
      doc.save().rect(bx, zeroY - bh, barW, Math.max(1, bh)).fill(COLORS.yellow).restore();
    } else {
      const bh = (-v / span) * h;
      doc.save().rect(bx, zeroY, barW, Math.max(1, bh)).fill('#4a4a4a').restore();
    }
  });
  // Mehrjahres-Beschriftung (alle 5 Jahre + Start/Ende)
  doc.font('Helvetica').fontSize(7).fillColor(COLORS.muted);
  const labelIdx = pickYearIndices(yearly);
  labelIdx.forEach((i) => {
    const bx = x + i * (barW + gap);
    const label = String(yearly[i].calendarYear);
    const tw = doc.widthOfString(label);
    doc.text(label, bx + barW / 2 - tw / 2, y + h + 3, { lineBreak: false });
  });
}

function drawBestandteilePage(doc, y, offer, startContentPage) {
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.text)
    .text('Bestandteile Ihres Angebots', MARGIN, y);
  y = doc.y + 6;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text('Hier sehen Sie alle Komponenten & Dienstleistungen, die wir Ihnen im Rahmen Ihres Angebots anbieten.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;

  // Reihenfolge: PV → Energiespeicher → weitere → Leistungen
  const sections = orderedOverviewSections(offer);
  for (const section of sections) {
    if (y > CONTENT_BOTTOM - 80) {
      y = startContentPage();
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.text).text(section.title, MARGIN, y);
    y = doc.y + 8;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.softMuted)
      .text('NAME', MARGIN, y, { characterSpacing: 0.5 })
      .text('TYP', MARGIN + CONTENT_W * 0.58, y, { characterSpacing: 0.5 })
      .text('ANZAHL', MARGIN, y, { width: CONTENT_W, align: 'right', characterSpacing: 0.5 });
    y += 12;
    for (const item of section.items || []) {
      if (y > CONTENT_BOTTOM - 22) {
        y = startContentPage();
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.softMuted)
          .text('NAME', MARGIN, y).text('TYP', MARGIN + CONTENT_W * 0.58, y)
          .text('ANZAHL', MARGIN, y, { width: CONTENT_W, align: 'right' });
        y += 12;
      }
      doc.save().lineWidth(0.5).strokeColor(COLORS.rule)
        .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
      y += 5;
      const kind = classifyKind(item.name, section.title);
      const nameH = doc.font('Helvetica').fontSize(9).heightOfString(item.name || '', { width: CONTENT_W * 0.55 });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(item.name || '', MARGIN, y, { width: CONTENT_W * 0.55 });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(kind, MARGIN + CONTENT_W * 0.58, y, { width: CONTENT_W * 0.2, lineBreak: false });
      doc.font('Helvetica').fontSize(9).fillColor(COLORS.text)
        .text(item.qty || '', MARGIN, y, { width: CONTENT_W, align: 'right', lineBreak: false });
      y += Math.max(16, nameH + 6);
    }
    y += 10;
  }
  return y;
}

function drawPriceBlock(doc, y, preis) {
  const p = preis || {};
  const rows = [
    ['Gesamt (Netto)', p.nettoFmt || formatEUR(p.netto)],
    [`MwSt. (${((p.mwstRate || 0.2) * 100).toFixed(1).replace('.', ',')} % auf ${p.nettoFmt || formatEUR(p.netto)})`, p.mwstFmt || formatEUR(p.mwst)],
  ];
  rows.forEach(([label, val]) => {
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.text).text(label, MARGIN, y);
    doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
      .text(val || '—', MARGIN, y, { width: CONTENT_W, align: 'right' });
    y += 22;
    doc.save().lineWidth(0.6).strokeColor(COLORS.rule)
      .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
    y += 12;
  });
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text).text('Gesamtpreis (Brutto)', MARGIN, y);
  doc.font('Helvetica-Bold').fontSize(14).fillColor(COLORS.text)
    .text(p.bruttoFmt || formatEUR(p.brutto), MARGIN, y, { width: CONTENT_W, align: 'right' });
  return y + 28;
}

/** @deprecated Alias – Prefer drawPriceBlock directly under the overview list. */
function drawPricePage(doc, y, preis) {
  return drawPriceBlock(doc, y, preis);
}

function drawAcceptPage(doc, y) {
  doc.font('Helvetica-Bold').fontSize(26).fillColor(COLORS.text).text('Angebot akzeptieren', MARGIN, y);
  y = doc.y + 28;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text('Zahlungskonditionen : 100% nach Fertigstellung der Installation und Inbetriebnahme', MARGIN, y);
  y = doc.y + 12;
  doc.font('Helvetica').fontSize(11).fillColor(COLORS.text)
    .text('Liefer- und Montagetermin : ca. 10-14 Wochen nach Bestellung', MARGIN, y);
  y = doc.y + 80;
  doc.save().lineWidth(0.8).strokeColor('#c8c8c8')
    .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
  y += 8;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted)
    .text('Ort, Datum, Name, Unterschrift', MARGIN, y);
  return y + 40;
}

function drawDatasheetsPage(doc, y, sheets) {
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COLORS.text).text('Datenblätter', MARGIN, y);
  y = doc.y + 8;
  doc.font('Helvetica').fontSize(10).fillColor(COLORS.text)
    .text('Hier sehen Sie die Datenblätter aller Komponenten, die wir Ihnen im Rahmen Ihres Angebots anbieten.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(COLORS.softMuted)
    .text('KOMPONENTE', MARGIN, y, { characterSpacing: 0.4 })
    .text('TYP', MARGIN + CONTENT_W * 0.62, y, { characterSpacing: 0.4 })
    .text('LINK', MARGIN, y, { width: CONTENT_W, align: 'right', characterSpacing: 0.4 });
  y += 12;

  const kindMap = { module: 'Modul', inverter: 'Wechselrichter', storage: 'Stromspeicher' };
  for (const sheet of sheets) {
    if (y > CONTENT_BOTTOM - 48) {
      // caller may continue on same page; keep compact
      break;
    }
    doc.save().lineWidth(0.5).strokeColor(COLORS.rule)
      .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
    y += 8;
    const rowTop = y;
    const kind = kindMap[sheet.kind] || sheet.kind || 'Komponente';
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.text)
      .text(sheet.label || 'Komponente', MARGIN, y, { width: CONTENT_W * 0.58 });
    const nameBottom = doc.y;
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.muted)
      .text(kind, MARGIN + CONTENT_W * 0.62, rowTop, { width: CONTENT_W * 0.2, lineBreak: false });
    // Short link on the far right – avoids long URLs overlapping name/type
    const linkLabel = 'Oeffnen';
    const linkW = 52;
    const linkX = PAGE.width - MARGIN - linkW;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.yellow)
      .text(linkLabel, linkX, rowTop, { width: linkW, align: 'right', underline: true, lineBreak: false });
    addPdfLinkNewWindow(doc, linkX - 4, rowTop - 2, linkW + 8, 16, sheet.url);
    y = Math.max(nameBottom, rowTop + 14) + 10;
  }
  return y;
}

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
    push({
      title: 'Belegungsplan',
      subtitle: v.label || (v.index != null ? `Variante ${Number(v.index) + 1}` : ''),
      layoutSnapshotPath: v.layoutSnapshotPath,
      layoutPlan: v.layoutPlan,
      layoutPlanId: v.layoutPlanId,
    });
  }
  return pages;
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
