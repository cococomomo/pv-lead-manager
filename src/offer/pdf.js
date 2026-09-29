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
const { writeHouseDiagramTemp, resolveHouseDiagramSelection } = require('./house-diagram');

const ASSETS = path.join(__dirname, 'assets');
const ROOT = path.join(__dirname, '../..');
const LOGO = path.join(ASSETS, 'noortec-logo.png');
const VOLLMACHT_PDF = path.join(ASSETS, 'vollmacht.pdf');
const VOLLMACHT_IMG = path.join(ASSETS, 'vollmacht.png');
const FONT_DIR = path.join(ASSETS, 'fonts');
/** Liberation Sans (Arial-metrisch) — saubere A4-Darstellung ohne Helvetica-Stretch. */
const FONT_REG = path.join(FONT_DIR, 'LiberationSans-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'LiberationSans-Bold.ttf');
const FONT_ITALIC = path.join(FONT_DIR, 'LiberationSans-Italic.ttf');
const F = { regular: 'OfferSans', bold: 'OfferSans-Bold', italic: 'OfferSans-Italic' };

function registerOfferFonts(doc) {
  try {
    if (fs.existsSync(FONT_REG)) doc.registerFont(F.regular, FONT_REG);
    else F.regular = 'Helvetica';
    if (fs.existsSync(FONT_BOLD)) doc.registerFont(F.bold, FONT_BOLD);
    else F.bold = 'Helvetica-Bold';
    if (fs.existsSync(FONT_ITALIC)) doc.registerFont(F.italic, FONT_ITALIC);
    else F.italic = 'Helvetica-Oblique';
  } catch (_) {
    F.regular = 'Helvetica';
    F.bold = 'Helvetica-Bold';
    F.italic = 'Helvetica-Oblique';
  }
}

const SALES_PHOTOS_DIR = path.join(ROOT, 'data', 'sales-photos');
const SALES_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Filename stem matching PR #4 upload (`safePhotoStem`). */
function salesPhotoStem(username) {
  const raw = String(username || '').trim().toLowerCase();
  const stem = raw.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '');
  return stem || 'user';
}

function absMaybe(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (!s) return null;
  return path.isAbsolute(s) ? s : path.join(ROOT, s);
}

/**
 * Newest file in data/sales-photos for this username (by mtime).
 * Survives extension changes on replace (png→jpg) without stale path.
 */
function findNewestSalesPhotoAbs(username) {
  const u = String(username || '').trim();
  if (!u || !fs.existsSync(SALES_PHOTOS_DIR)) return null;
  const stems = new Set([u, u.toLowerCase(), salesPhotoStem(u)]);
  let best = null;
  let bestM = -1;
  let names;
  try { names = fs.readdirSync(SALES_PHOTOS_DIR); } catch (_) { return null; }
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!SALES_PHOTO_EXTS.includes(ext)) continue;
    const stem = path.basename(name, path.extname(name));
    const match = [...stems].some((s) => s.toLowerCase() === stem.toLowerCase());
    if (!match) continue;
    const abs = path.join(SALES_PHOTOS_DIR, name);
    let mtime = 0;
    try { mtime = fs.statSync(abs).mtimeMs; } catch (_) { continue; }
    if (mtime >= bestM) {
      bestM = mtime;
      best = abs;
    }
  }
  return best;
}

/** Optional DB photo_path (PR #4 column) — ignore if column/schema missing. */
function tryDbSalesPhotoAbs(username) {
  const u = String(username || '').trim();
  if (!u) return null;
  try {
    const { getDb } = require('../database');
    const row = getDb().prepare(
      'SELECT photo_path FROM users WHERE lower(username) = lower(?)',
    ).get(u);
    const rel = row && row.photo_path ? String(row.photo_path).trim() : '';
    if (!rel) return null;
    const abs = absMaybe(rel);
    return abs && fs.existsSync(abs) ? abs : null;
  } catch (_) {
    return null;
  }
}

/**
 * Resolve Vertriebler-Foto for this render (always from current disk state).
 * Order: existing photoPath → photoUrl map → DB photo_path → newest data/sales-photos/<user>.*
 * → baked-in salesPortrait only if nothing else exists.
 */
function resolveSalesPhotoPath(vertrieb) {
  const v = vertrieb || {};
  const tried = [];

  const push = (p) => {
    const abs = absMaybe(p);
    if (abs && !tried.includes(abs)) tried.push(abs);
  };

  if (v.photoPath) push(v.photoPath);

  let urlUser = null;
  if (v.photoUrl) {
    const u = String(v.photoUrl);
    const m = u.match(/\/api\/sales-photos\/([^/?#]+)/i);
    if (m) {
      urlUser = decodeURIComponent(m[1]);
      for (const ext of SALES_PHOTO_EXTS) {
        push(path.join(SALES_PHOTOS_DIR, `${urlUser}${ext}`));
        push(path.join(SALES_PHOTOS_DIR, `${salesPhotoStem(urlUser)}${ext}`));
      }
    } else if (u.startsWith('/') && !u.startsWith('//')) {
      push(path.join(ROOT, 'public', u.replace(/^\//, '')));
      push(path.join(ROOT, u.replace(/^\//, '')));
    }
  }

  for (const p of tried) {
    if (fs.existsSync(p)) return p;
  }

  const user = v.username || urlUser;
  const fromDb = tryDbSalesPhotoAbs(user);
  if (fromDb) return fromDb;

  const newest = findNewestSalesPhotoAbs(user);
  if (newest) return newest;

  return productAbs('salesPortrait');
}

/** Rel path + URL for offer.meta when a disk photo exists (upload code may be on another PR). */
function salesPhotoMetaForUsername(username, photoPath, photoUrl) {
  const abs = resolveSalesPhotoPath({
    username,
    photoPath: photoPath || null,
    photoUrl: photoUrl || null,
  });
  const portrait = productAbs('salesPortrait');
  if (!abs || (portrait && path.resolve(abs) === path.resolve(portrait))) {
    return { photoPath: photoPath || null, photoUrl: photoUrl || null };
  }
  const rel = path.relative(ROOT, abs).split(path.sep).join('/');
  const url = username
    ? `/api/sales-photos/${encodeURIComponent(String(username).trim())}`
    : (photoUrl || null);
  return { photoPath: rel, photoUrl: url };
}

/**
 * Fit product image into box (contain, centered).
 * Default: no backdrop plate — freigestellt on the page white (no grey/black bars).
 */
function drawFittedImage(doc, imgPath, x, y, boxW, boxH, bg = null) {
  if (!imgPath || !fs.existsSync(imgPath)) return false;
  try {
    if (bg) {
      doc.save().roundedRect(x, y, boxW, boxH, 4).fill(bg).restore();
    }
    const img = doc.openImage(imgPath);
    const scale = Math.min(boxW / Math.max(1, img.width), boxH / Math.max(1, img.height));
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
      registerOfferFonts(doc);
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

      // ── Abschluss (großzügig, i. d. R. 2 Seiten): Liste → Preis+Optionals+Unterschrift ──
      y = startContentPage();
      y = drawClosingSection(doc, y, offer, startContentPage);

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
  doc.font(F.regular).fontSize(9).fillColor(COLORS.white)
    .text('noortec.at', MARGIN, y + 8, { lineBreak: false });
  doc.font(F.regular).fontSize(9).fillColor(COLORS.white)
    .text(`${pageNum} / ${total}`, MARGIN, y + 8, { width: CONTENT_W, align: 'right', lineBreak: false });
}

function drawSalesBadge(doc, vertrieb, photoPath, x, y, opts = {}) {
  const v = vertrieb || {};
  const badgeW = opts.width || 210;
  const badgeH = opts.height || 52;
  doc.save().roundedRect(x, y, badgeW, badgeH, 10).fill('#ececec').restore();
  let textX = x + 12;
  // Re-resolve on every badge draw so a replaced file is never skipped for a stale path.
  const resolved = resolveSalesPhotoPath({
    ...v,
    photoPath: photoPath || v.photoPath,
  });
  if (resolved && fs.existsSync(resolved)) {
    try {
      const side = 32;
      const cx = x + 10 + side / 2;
      const cy = y + badgeH / 2;
      doc.save();
      doc.circle(cx, cy, side / 2).clip();
      // Buffer load — no PDFKit path-cache of a previous portrait at the same filename
      const img = doc.openImage(fs.readFileSync(resolved));
      // Cover-fit (kein Stauchen) in den Kreis
      const scale = Math.max(side / Math.max(1, img.width), side / Math.max(1, img.height));
      const dw = img.width * scale;
      const dh = img.height * scale;
      doc.image(img, cx - dw / 2, cy - dh / 2, { width: dw, height: dh });
      doc.restore();
      textX = x + 48;
    } catch (_) { /* ignore */ }
  }
  const tw = badgeW - (textX - x) - 8;
  doc.font(F.bold).fontSize(9.5).fillColor(COLORS.text)
    .text(v.name || 'Noortec Vertrieb', textX, y + 8, { width: tw, lineBreak: false });
  doc.font(F.regular).fontSize(7.5).fillColor(COLORS.muted)
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
  doc.font(F.regular).fontSize(8).fillColor(COLORS.softMuted)
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
  drawSalesBadge(doc, v, salesPhoto, badgeX, 32, { width: badgeW, height: 52 });

  // Title
  let y = 130;
  doc.font(F.bold).fontSize(28).fillColor(COLORS.text)
    .text('Ihr persönliches Angebot', MARGIN, y);
  y = doc.y + 10;
  doc.save().lineWidth(0.8).strokeColor(COLORS.rule)
    .moveTo(MARGIN, y).lineTo(MARGIN + 280, y).stroke().restore();
  y += 10;
  doc.font(F.regular).fontSize(10).fillColor(COLORS.muted)
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
  doc.font(F.regular).fontSize(12).fillColor(COLORS.dark)
    .text(`Angebotsnummer ${offer.meta.angebotsnummer || ''}`, MARGIN, 720);

  // Customer on gold (bottom right)
  const lines = [];
  if (customer.name) lines.push(customer.name);
  if (customer.street) lines.push(customer.street);
  const city = [customer.zip, customer.city].filter(Boolean).join(' ');
  if (city) lines.push(city);
  if (customer.email) lines.push(customer.email);
  if (customer.phone) lines.push(customer.phone);
  doc.font(F.regular).fontSize(11).fillColor(COLORS.white);
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
  doc.font(F.bold).fontSize(13).fillColor(COLORS.text)
    .text('Noortec: Energie, die für Sie arbeitet! – Ihr Komplettanbieter für nachhaltige Energielösungen seit 2011', cardX + 18, cardY + 18, {
      width: cardW - 36,
      align: 'left',
      lineGap: 2,
    });

  let y = 240;
  try {
    if (fs.existsSync(LOGO)) doc.image(LOGO, MARGIN, y, { height: 28 });
  } catch (_) { /* ignore */ }
  doc.font(F.bold).fontSize(16).fillColor(COLORS.text)
    .text('Ihr Partner für Photovoltaikanlagen in Wien, Niederösterreich und Burgenland.', MARGIN + 130, y, {
      width: CONTENT_W - 130,
    });
  y = Math.max(doc.y, y + 40) + 16;

  for (const p of ABOUT_PARAS) {
    doc.font(F.regular).fontSize(10).fillColor(COLORS.dark)
      .text(p, MARGIN, y, { width: CONTENT_W, align: 'justify', lineGap: 2 });
    y = doc.y + 12;
  }
}

function drawLetterPage(doc, y, texts) {
  doc.font(F.bold).fontSize(26).fillColor(COLORS.text).text('Ihr Angebot', MARGIN, y);
  y = doc.y + 18;
  doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
    .text(texts.greeting || 'Guten Tag,', MARGIN, y);
  y = doc.y + 12;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text(texts.intro || DEFAULT_INTRO, MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 14;
  doc.font(F.bold).fontSize(11).fillColor(COLORS.text)
    .text('Unser Angebot beinhaltet:', MARGIN, y);
  y = doc.y + 10;
  const bullets = Array.isArray(texts.bullets) && texts.bullets.length ? texts.bullets : DEFAULT_BULLETS;
  for (const b of bullets) {
    doc.font(F.bold).fontSize(12).fillColor(COLORS.yellow).text('+', MARGIN, y);
    doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
      .text(b, MARGIN + 16, y + 1, { width: CONTENT_W - 16, lineGap: 1 });
    y = doc.y + 6;
  }
  y += 10;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Wir sind überzeugt, dass unsere Photovoltaiklösungen Ihnen helfen werden, unabhängig von schwankenden Strompreisen zu werden und gleichzeitig einen Beitrag zum Umweltschutz zu leisten.', MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 12;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Bitte überprüfen Sie die Details des Angebots und zögern Sie nicht, mich bei Fragen oder für weitere Informationen zu kontaktieren.', MARGIN, y, { width: CONTENT_W, lineGap: 3 });
  y = doc.y + 12;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Wir freuen uns darauf, Sie auf dem Weg zu einer nachhaltigeren Energieversorgung zu begleiten.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

function drawGlancePage(doc, y, offer, eco) {
  const pad = 18;
  const maxW = CONTENT_W - pad * 2;
  // Systemdiagramm braucht mehr Höhe als die alte Haus-Skizze
  const maxH = 300;
  const cardH = 52 + 56 + maxH + 14 + (eco.hasStorage ? 70 : 40) + 16;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, cardH, 10).fill(COLORS.cardBg).restore();
  let yy = y + pad;
  doc.font(F.bold).fontSize(20).fillColor(COLORS.text)
    .text('Auf einen Blick', MARGIN + pad, yy);
  yy = doc.y + 6;
  doc.font(F.regular).fontSize(10).fillColor(COLORS.text)
    .text('Ihr Angebot auf einen Blick:  Mit Ihrer Photovoltaikanlage produzieren Sie CO2-neutral Strom. Mit Ihrem Stromspeicher erreichen Sie eine höhere Unabhängigkeit. Graue Komponenten sind nicht Bestandteil dieses Angebots.', MARGIN + pad, yy, {
      width: CONTENT_W - pad * 2,
      lineGap: 1.5,
    });
  yy = doc.y + 10;

  doc.save().roundedRect(MARGIN + pad, yy, maxW, maxH, 6).fill('#ffffff').restore();
  let housePath = null;
  let houseTmp = null;
  try {
    houseTmp = writeHouseDiagramTemp(offer);
    housePath = houseTmp || productAbs('houseSystemDiagram') || productAbs('houseOverview');
    if (housePath && fs.existsSync(housePath)) {
      const img = doc.openImage(housePath);
      let dw = maxW;
      let dh = dw * (img.height / Math.max(1, img.width));
      if (dh > maxH) {
        dh = maxH;
        dw = dh * (img.width / Math.max(1, img.height));
      }
      doc.image(img, MARGIN + pad + (maxW - dw) / 2, yy + (maxH - dh) / 2, { width: dw, height: dh });
    }
  } catch (_) { /* ignore */ }
  finally {
    if (houseTmp) {
      try { fs.unlinkSync(houseTmp); } catch (__) { /* ignore */ }
    }
  }
  yy += maxH + 12;

  const sel = resolveHouseDiagramSelection(offer);
  const rows = [];
  if (sel.flags.pv) rows.push(['Photovoltaikanlage', eco.labels.peak]);
  if (sel.flags.battery) rows.push(['Stromspeicher', eco.labels.speicher]);
  if (!rows.length) {
    rows.push(['Ihr Energiesystem', 'individuell zusammengestellt']);
  }
  rows.forEach(([label, val], i) => {
    if (i > 0) {
      doc.save().lineWidth(0.6).strokeColor('#d8d8d8')
        .moveTo(MARGIN + pad, yy).lineTo(PAGE.width - MARGIN - pad, yy).stroke().restore();
      yy += 6;
    }
    doc.font(F.regular).fontSize(11).fillColor(COLORS.text).text(label, MARGIN + pad, yy);
    doc.font(F.bold).fontSize(11).fillColor(COLORS.text)
      .text(val, MARGIN + pad, yy, { width: CONTENT_W - pad * 2, align: 'right' });
    yy += 22;
  });

  return yy + 8;
}

function drawPvIntroPage(doc, y, offer, eco, lp, isPrimary = true) {
  const title = isPrimary || !lp || !lp.subtitle
    ? 'Ihre Photovoltaikanlage'
    : `Ihre Photovoltaikanlage · ${lp.subtitle}`;
  doc.font(F.bold).fontSize(26).fillColor(COLORS.text).text(title, MARGIN, y);
  y = doc.y + 8;
  doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
    .text('Hier sehen Sie die Details zur Photovoltaikanlage, die wir für Sie geplant haben.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;
  doc.font(F.bold).fontSize(11).fillColor(COLORS.softMuted)
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
    doc.font(F.regular).fontSize(11).fillColor(COLORS.muted)
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
  doc.font(F.bold).fontSize(12).fillColor(COLORS.text).text(title, MARGIN, y);
  const valW = 140;
  doc.font(F.bold).fontSize(18).fillColor(COLORS.text)
    .text(value, MARGIN, y, { width: CONTENT_W, align: 'right' });
  y = doc.y + 2;
  doc.font(F.regular).fontSize(9).fillColor(COLORS.muted)
    .text(desc, MARGIN, y, { width: CONTENT_W - valW - 10 });
  return doc.y + 12;
}

function drawComponentCardPages(doc, cards, startContentPage, heading) {
  if (!cards.length) return 0;
  let y = startContentPage();
  doc.font(F.bold).fontSize(13).fillColor(COLORS.softMuted)
    .text(heading, MARGIN, y, { characterSpacing: 0.6 });
  y = doc.y + 12;

  let index = 0;
  for (const card of cards) {
    index += 1;
    const blockH = estimateCardHeight(doc, card);
    // Pack ~4–5 Bildkarten / Seite (Vorlage-Feedback: deutlich mehr als 2)
    if (y + blockH > CONTENT_BOTTOM) {
      y = startContentPage();
      doc.font(F.bold).fontSize(13).fillColor(COLORS.softMuted)
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
  doc.font(F.regular).fontSize(8.5);
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
  doc.font(F.bold).fontSize(9.5).fillColor(COLORS.text)
    .text(String(index), MARGIN, y + 4, { width: numR * 2, align: 'center', lineBreak: false });

  const right = [card.brandLabel, card.qty].filter(Boolean).join('  ·  ');
  const rightW = right ? Math.min(200, doc.widthOfString(right) + 4) : 0;
  doc.font(F.bold).fontSize(11).fillColor(COLORS.text)
    .text(card.name || '', MARGIN + numR * 2 + 8, y + 3, {
      width: CONTENT_W - numR * 2 - 16 - rightW,
      lineBreak: false,
      ellipsis: true,
    });
  if (right) {
    doc.font(F.regular).fontSize(8.5).fillColor(COLORS.muted)
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
  doc.font(F.regular).fontSize(8.5).fillColor(COLORS.dark)
    .text(desc, MARGIN, y, { width: textW, lineGap: 1.2, height: 58, ellipsis: true });
  const textBottom = doc.y;
  if (hasImg) {
    // Freigestellt auf Seitenweiß – kein graues/schwarzes Bildplättchen
    drawFittedImage(doc, card.image, PAGE.width - MARGIN - imgBoxW, y, imgBoxW, imgBoxH, null);
    return Math.max(textBottom, y + imgBoxH) + 2;
  }
  return Math.max(textBottom, titleY + 54) + 2;
}

function drawStorageSection(doc, y, cards, eco, startContentPage) {
  doc.font(F.bold).fontSize(24).fillColor(COLORS.text).text('Ihr Energiespeicher', MARGIN, y);
  y = doc.y + 6;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Hier sehen Sie die Details zum Energiespeicher, den wir für Sie geplant haben.', MARGIN, y);
  y = doc.y + 12;
  doc.font(F.bold).fontSize(11).fillColor(COLORS.softMuted)
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
  doc.font(F.bold).fontSize(14).fillColor(COLORS.softMuted)
    .text('MONATLICHE ENERGIEPRODUKTION', MARGIN, y, { characterSpacing: 0.5 });
  y = doc.y + 10;
  doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
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
  doc.font(F.regular).fontSize(8).fillColor(COLORS.muted)
    .text('Die in dieser Simulation berechneten Ertragswerte basieren auf dem spezifischen Standort, der Neigung und der Ausrichtung der PV-Module. Sie stellen eine näherungsweise Schätzung dar und können im Individualfall abweichen. Die Ergebnisse sind nicht als verbindliche Zusage für die tatsächliche Leistung der Anlage zu verstehen.', MARGIN, y, { width: CONTENT_W, lineGap: 1 });
  return doc.y;
}

function drawMonthlyBars(doc, x, y, w, h, monthly) {
  const max = Math.max(...monthly.map((m) => m.kwh), 1);
  const gap = 6;
  const barW = (w - gap * (monthly.length - 1)) / monthly.length;
  // grid
  doc.font(F.regular).fontSize(7).fillColor(COLORS.softMuted);
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
      doc.font(F.regular).fontSize(7).fillColor(COLORS.muted)
        .text(m.month, bx - 4, y + h + 4, { width: barW + 8, align: 'center' });
    }
  });
}

function drawHaushaltPage(doc, y, eco) {
  doc.font(F.bold).fontSize(26).fillColor(COLORS.text).text('Ihr Haushalt', MARGIN, y);
  y = doc.y + 8;
  doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
    .text('Hier sehen Sie, wie sich Ihr Haushalt in Zukunft im Hinblick auf Energieverbrauch & Energieerzeugung verhalten kann.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 18;

  doc.font(F.bold).fontSize(12).fillColor(COLORS.softMuted)
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
    doc.font(F.regular).fontSize(11).fillColor(COLORS.text).text(label, MARGIN, y);
    doc.font(F.bold).fontSize(11).fillColor(COLORS.text)
      .text(val, MARGIN, y, { width: CONTENT_W, align: 'right' });
    y += 24;
  });
  doc.save().lineWidth(0.6).strokeColor(COLORS.rule)
    .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
  y += 18;

  doc.font(F.bold).fontSize(12).fillColor(COLORS.softMuted)
    .text('IHR ENERGIEHAUSHALT', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 10;
  doc.font(F.regular).fontSize(10).fillColor(COLORS.text)
    .text(eco.flowText, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
  y = doc.y + 12;

  // Sankey-Rahmen: Höhe ≈ Breite / φ² (Querformat im goldenen Schnitt)
  const PHI = 1.6180339887;
  const flowH = Math.round(CONTENT_W / (PHI * PHI)); // ≈ 0.382 · CONTENT_W
  doc.save().roundedRect(MARGIN, y, CONTENT_W, flowH, 10)
    .lineWidth(0.7).strokeColor('#e0e0e0').fillAndStroke('#fcfcfc', '#e0e0e0').restore();
  // Innenrand ≈ H/φ³ → ruhiger Weißraum um die Flüsse
  const inset = Math.max(10, Math.round(flowH / (PHI * PHI * PHI)));
  drawEnergyFlowDiagram(doc, MARGIN + inset, y + inset, CONTENT_W - inset * 2, flowH - inset * 2, eco);
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
  doc.font(F.regular).fontSize(8).fillColor(COLORS.muted)
    .text('Die in dieser Simulation berechneten Ertragswerte basieren auf dem spezifischen Standort, der Neigung und der Ausrichtung der PV-Module. Sie stellen eine näherungsweise Schätzung dar und können im Individualfall abweichen.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

/**
 * Energiefluss-Sankey — proportionale Banddicken + goldener Schnitt:
 * – Dicke = kWh · gemeinsame Skala (keine künstliche Mindestdicke)
 * – 2 pt Luft zwischen gestapelten Bändern → klar lesbare Proportionen
 * – PV- und Verbrauch-Säule je für sich vertikal zentriert (ausgeglichener Weißraum)
 * – Mittelspalte bei span/φ; Knoten verbinden alle anliegenden Flüsse
 */
function drawEnergyFlowDiagram(doc, x, y, w, h, eco) {
  const PHI = 1.6180339887;
  const pv = Math.max(1, Math.round(eco.annualYield || 1));
  const feed = Math.max(0, Math.round(eco.feedInKwh || 0));
  const toStore = Math.max(0, Math.round(eco.toStorage || 0));
  const toHome = Math.max(0, Math.round(eco.directToHome || 0));
  const fromStore = Math.max(0, Math.round(eco.fromStorage || 0));
  const fromGrid = Math.max(0, Math.round(eco.gridRemain || 0));
  const household = Math.max(1, Math.round(eco.household || toHome + fromStore + fromGrid));
  const hasStorage = !!(eco.hasStorage && (toStore > 0 || fromStore > 0));

  const ORANGE = '#e6b81e';
  const ORANGE_FLOW = '#f0c96a';
  const STORE_FLOW = '#efe0a8';
  const STORE_NODE = '#e4d08a';
  const GRAY = '#4a4a4a';
  const GRAY_FLOW = '#d0d0d0';
  const GRAY_FLOW_DARK = '#9a9a9a';

  const leftLabelW = 84;
  const rightLabelW = 74;
  const nodeW = 11;
  const gap = 2; // Luft zwischen Bändern — Dicken bleiben proportional
  const padY = Math.max(6, h * (PHI - 1) * 0.08);
  const usableH = Math.max(40, h - padY * 2);

  const pvParts = [feed, toHome, toStore].filter((v) => v > 0);
  const consParts = [toHome, fromGrid, fromStore].filter((v) => v > 0);
  const pvGaps = Math.max(0, pvParts.length - 1) * gap;
  const consGaps = Math.max(0, consParts.length - 1) * gap;
  const pvKwh = Math.max(1, feed + toHome + toStore);
  const consKwh = Math.max(1, toHome + fromGrid + fromStore);
  // Skala so, dass die größere Säule (inkl. Gaps) die nutzbare Höhe füllt
  const scale = (usableH - Math.max(pvGaps, consGaps)) / Math.max(pvKwh, consKwh);
  const thick = (v) => (v > 0 ? Math.max(0.6, v * scale) : 0);

  const tFeed = thick(feed);
  const tHome = thick(toHome);
  const tStore = thick(toStore);
  const tFromGrid = thick(fromGrid);
  const tFromStore = thick(fromStore);

  const pvH = tFeed + tHome + tStore + pvGaps;
  const verbrauchH = tHome + tFromGrid + tFromStore + consGaps;

  // Spalten: Mittelknoten bei span/φ² ≈ 38,2 % → kurzer Zulauf, langer eleganter Fächer zum Verbrauch
  const chartLeft = x + leftLabelW;
  const chartRight = x + w - rightLabelW - nodeW;
  const span = Math.max(40, chartRight - chartLeft);
  const pvX = chartLeft;
  const midX = chartLeft + span / (PHI * PHI);
  const endX = chartRight;

  const frameTop = y + padY;
  // Beide Säulen unabhängig zentriert → ruhige φ-Balance, kurvige Lesepfade
  const pvTop = frameTop + Math.max(0, (usableH - pvH) / 2);
  const verbrauchTop = frameTop + Math.max(0, (usableH - verbrauchH) / 2);

  // PV oben→unten: Einspeisung · Direkt · Speicher
  let pvY = pvTop;
  const feedY0 = pvY; pvY += tFeed + (tFeed > 0 && (tHome > 0 || tStore > 0) ? gap : 0);
  const homeY0 = pvY; pvY += tHome + (tHome > 0 && tStore > 0 ? gap : 0);
  const storeY0 = pvY;

  // Verbrauch oben→unten: Direkt · Netzbezug · Speicher
  let cY = verbrauchTop;
  const cHomeY0 = cY; cY += tHome + (tHome > 0 && (tFromGrid > 0 || tFromStore > 0) ? gap : 0);
  const cGridY0 = cY; cY += tFromGrid + (tFromGrid > 0 && tFromStore > 0 ? gap : 0);
  const cStoreY0 = cY;

  // Netz-Knoten spannt Einspeisung + Bezug; Austritt unten am Knoten
  const netzInY0 = feedY0;
  const netzBodyH = Math.max(tFeed, tFromGrid, 1);
  const netzTop = feedY0;
  const netzOutY0 = netzTop + Math.max(0, netzBodyH - tFromGrid);

  // Speicher-Knoten spannt Ladung + Entladung
  const speicherInY0 = storeY0;
  const speicherBodyH = hasStorage ? Math.max(tStore, tFromStore, 1) : 0;
  const speicherTop = hasStorage ? storeY0 : frameTop;
  const speicherOutY0 = speicherTop + Math.max(0, speicherBodyH - tFromStore);

  /** Flussband: Dicke links/rechts = kWh-Proportion; Kontrollpunkte bei 1/φ */
  function band(x0, y0, t0, x1, y1, t1, color, opacity) {
    if (t0 <= 0 && t1 <= 0) return;
    const a = Math.max(0.6, t0);
    const b = Math.max(0.6, t1);
    const dx = x1 - x0;
    const c1x = x0 + dx / PHI;
    const c2x = x1 - dx * (1 - 1 / PHI);
    doc.save();
    doc.fillColor(color).fillOpacity(opacity == null ? 0.92 : opacity);
    doc.moveTo(x0, y0)
      .bezierCurveTo(c1x, y0, c2x, y1, x1, y1)
      .lineTo(x1, y1 + b)
      .bezierCurveTo(c2x, y1 + b, c1x, y0 + a, x0, y0 + a)
      .closePath()
      .fill();
    doc.fillOpacity(1).restore();
  }

  // Große Flächen zuerst, Kreuzungen danach — Lesereihenfolge PV → Netz/Speicher → Haus
  if (feed > 0) band(pvX + nodeW, feedY0, tFeed, midX, netzInY0, tFeed, GRAY_FLOW, 0.85);
  if (toHome > 0) band(pvX + nodeW, homeY0, tHome, endX, cHomeY0, tHome, ORANGE_FLOW, 0.94);
  if (hasStorage && toStore > 0) {
    band(pvX + nodeW, storeY0, tStore, midX, speicherInY0, tStore, STORE_FLOW, 0.9);
  }
  if (fromGrid > 0) {
    band(midX + nodeW, netzOutY0, tFromGrid, endX, cGridY0, tFromGrid, GRAY_FLOW_DARK, 0.88);
  }
  if (hasStorage && fromStore > 0) {
    band(midX + nodeW, speicherOutY0, tFromStore, endX, cStoreY0, tFromStore, STORE_FLOW, 0.9);
  }

  // Knoten (über den Bändern)
  doc.save().roundedRect(pvX, pvTop, nodeW, Math.max(1, pvH), 2.5).fill(ORANGE).restore();
  if (feed > 0 || fromGrid > 0) {
    doc.save().roundedRect(midX, netzTop, nodeW, Math.max(1, netzBodyH), 2.5).fill(GRAY).restore();
  }
  if (hasStorage && speicherBodyH > 0) {
    doc.save().roundedRect(midX, speicherTop, nodeW, Math.max(1, speicherBodyH), 2.5).fill(STORE_NODE).restore();
  }
  doc.save().roundedRect(endX, verbrauchTop, nodeW, Math.max(1, verbrauchH), 2.5).fill(GRAY).restore();

  const kwh = (n) => `${formatNum(Math.round(n))} kWh`;
  const labelBeside = (title, value, lx, cy, maxW) => {
    const top = cy - 11;
    doc.font(F.bold).fontSize(9).fillColor(COLORS.text)
      .text(title, lx, top, { width: maxW, lineBreak: false });
    doc.font(F.regular).fontSize(8).fillColor(COLORS.muted)
      .text(value, lx, top + 12, { width: maxW, lineBreak: false });
  };

  labelBeside('Photovoltaik', kwh(pv), x, pvTop + pvH / 2, leftLabelW - 8);

  if (feed > 0 || fromGrid > 0) {
    const nx = midX + nodeW + 7;
    // Label über dem Knoten, nicht auf dem Band — φ-Abstand zum Fluss
    const netzLabelY = Math.max(frameTop - 2, netzTop - 28);
    doc.font(F.bold).fontSize(9).fillColor(COLORS.text)
      .text('Netz', nx, netzLabelY, { width: 100, lineBreak: false });
    doc.font(F.regular).fontSize(7.5).fillColor(COLORS.muted)
      .text(`Einsp. ${formatNum(feed)}`, nx, netzLabelY + 11, { width: 100, lineBreak: false })
      .text(`Bezug ${formatNum(fromGrid)}`, nx, netzLabelY + 21, { width: 100, lineBreak: false });
  }

  if (hasStorage && speicherBodyH > 0) {
    const sx = midX + nodeW + 7;
    const sy = speicherTop + speicherBodyH / 2;
    labelBeside('Speicher', kwh(toStore), sx, sy, 100);
  }

  labelBeside('Verbrauch', kwh(household), endX + nodeW + 6, verbrauchTop + verbrauchH / 2, rightLabelW - 4);
}

function drawWirtschaftPage(doc, y, eco) {
  doc.font(F.bold).fontSize(24).fillColor(COLORS.text).text('Ihre Wirtschaftlichkeit', MARGIN, y);
  y = doc.y + 6;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Hier sehen Sie die Wirtschaftlichkeit Ihrer geplanten Komponenten über den Betrachtungszeitraum.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;
  doc.font(F.bold).fontSize(11).fillColor(COLORS.softMuted)
    .text('AMORTISATION', MARGIN, y, { characterSpacing: 0.4 });
  y = doc.y + 12;

  const chartH = 280;
  doc.save().roundedRect(MARGIN, y, CONTENT_W, chartH, 8).fill(COLORS.cardBg).restore();
  drawAmortBars(doc, MARGIN + 36, y + 16, CONTENT_W - 52, chartH - 44, eco.yearly);
  y += chartH + 20;

  y = drawKeyValueRow(doc, y,
    'Gesamte Einsparungen',
    `Auf eine Sicht von ${eco.years} Jahren sparen Sie ${eco.labels.totalSavings}.`,
    eco.labels.totalSavings);
  y += 8;
  const beSub = eco.paybackYears != null
    ? `Die Amortisation wird nach ${eco.paybackYears} Jahren${eco.paybackYearLabel ? ` im Jahr ${eco.paybackYearLabel}` : ''} erwartet`
    : 'Amortisation außerhalb des Betrachtungszeitraums';
  y = drawKeyValueRow(doc, y, 'Break-Even', beSub, eco.labels.payback);
  y += 12;
  doc.font(F.regular).fontSize(7.5).fillColor(COLORS.muted)
    .text('Die Berechnungsergebnisse dienen der Orientierung und können im Einzelfall abweichen. Einflussfaktoren wie Wetterbedingungen, Strompreisänderungen, Degradation der PV-Module und individuelles Verbrauchsverhalten können zu Abweichungen führen.', MARGIN, y, { width: CONTENT_W });
  return doc.y;
}

function pickYearIndices(yearly) {
  if (!yearly.length) return [];
  const n = yearly.length;
  const targets = [0];
  if (n > 1) targets.push(Math.min(4, n - 1));
  if (n > 5) targets.push(Math.min(9, n - 1));
  if (n > 10) targets.push(Math.min(14, n - 1));
  targets.push(n - 1);
  return [...new Set(targets)].sort((a, b) => a - b);
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
  // Jahresbeschriftung an der Achse (ohne Extra-€-Tabelle)
  doc.font(F.regular).fontSize(7).fillColor(COLORS.muted);
  const labelIdx = pickYearIndices(yearly);
  labelIdx.forEach((i) => {
    const bx = x + i * (barW + gap);
    const label = String(yearly[i].calendarYear);
    const tw = doc.widthOfString(label);
    doc.text(label, bx + barW / 2 - tw / 2, y + h + 4, { lineBreak: false });
  });
}

/**
 * Abschluss-Block im Chesky-/Airbnb-Sinn:
 * – ruhige Hierarchie, großzügige Zeilen, keine schreienden Titel
 * – Seite 1: Bestandteile (atmen)
 * – Seite 2: Fortsetzung der Liste falls nötig + Preis + Optionals + Unterschrift unten
 */
function drawClosingSection(doc, y, offer, startContentPage) {
  const optionals = offer.optionaleKomponenten || [];
  const decisionH = estimateDecisionBlockHeight(optionals);

  const list = drawBestandteileList(doc, y, offer, startContentPage, {
    // Seite 1 füllt sich großzügig; Rest + Preis + Unterschrift auf Seite 2
    firstPageSoftLimit: CONTENT_TOP + (CONTENT_BOTTOM - CONTENT_TOP) * 0.88,
  });
  y = list.y;

  // Signaturzone am Fuß — Entscheidungsinhalt muss darüber enden
  const sigZone = 52;
  if (list.pageIndex === 0) {
    // Kurze Liste: eigene ruhige Entscheidungsseite
    y = startContentPage();
  } else if (y + decisionH > CONTENT_BOTTOM - sigZone) {
    y = startContentPage();
  } else {
    y += 24;
  }

  y = drawPriceBlock(doc, y, offer.preis);
  y += 22;
  y = drawAcceptBody(doc, y, optionals);
  drawSignaturePinned(doc);
  return CONTENT_BOTTOM;
}

function drawColumnHeaders(doc, y) {
  doc.font(F.bold).fontSize(8).fillColor(COLORS.softMuted)
    .text('NAME', MARGIN, y)
    .text('TYP', MARGIN + CONTENT_W * 0.56, y)
    .text('ANZAHL', MARGIN, y, { width: CONTENT_W, align: 'right' });
  return y + 14;
}

/**
 * Großzügige Komponentenliste.
 * firstPageSoftLimit: weicher Umbruch auf Seite 1 (Platz für Entscheidungsseite).
 * decisionReserve: auf Folgeseiten Platz für Preis+Signatur freihalten.
 */
function drawBestandteileList(doc, y, offer, startContentPage, opts = {}) {
  const firstPageSoftLimit = Number(opts.firstPageSoftLimit) || 0;
  let pageIndex = 0;

  const pageLimit = () => {
    if (pageIndex === 0 && firstPageSoftLimit > 0) return firstPageSoftLimit;
    return CONTENT_BOTTOM;
  };

  doc.font(F.bold).fontSize(16).fillColor(COLORS.text)
    .text('Bestandteile Ihres Angebots', MARGIN, y);
  y = doc.y + 8;
  doc.font(F.regular).fontSize(11).fillColor(COLORS.muted)
    .text('Alles, was in Ihrem Angebot enthalten ist — Komponenten und Leistungen.', MARGIN, y, {
      width: CONTENT_W,
      lineGap: 2,
    });
  y = doc.y + 22;

  const sections = orderedOverviewSections(offer);
  let openSectionTitle = null;

  const breakPage = (redrawSection) => {
    y = startContentPage();
    pageIndex += 1;
    if (redrawSection && openSectionTitle) {
      doc.font(F.bold).fontSize(12).fillColor(COLORS.text).text(openSectionTitle, MARGIN, y);
      y = doc.y + 10;
      y = drawColumnHeaders(doc, y);
    }
  };

  /** @returns {boolean} true wenn umbrochen wurde */
  const ensureRowSpace = (need, redrawSection = true) => {
    if (y + need <= pageLimit()) return false;
    breakPage(redrawSection);
    return true;
  };

  for (const section of sections) {
    openSectionTitle = section.title || '';
    const items = section.items || [];
    // Abschnitt nur beginnen, wenn Titel + erste Zeile (ggf. mehrzeilig) Platz haben
    let firstNeed = 40;
    if (items[0]) {
      const fh = doc.font(F.regular).fontSize(11)
        .heightOfString(items[0].name || '', { width: CONTENT_W * 0.52 });
      firstNeed = Math.max(26, fh + 14) + 10;
    }
    const brokeBeforeSection = ensureRowSpace(52 + firstNeed, true);
    if (!brokeBeforeSection) {
      doc.font(F.bold).fontSize(12).fillColor(COLORS.text).text(openSectionTitle, MARGIN, y);
      y = doc.y + 10;
      y = drawColumnHeaders(doc, y);
    }

    for (const item of items) {
      const name = item.name || '';
      const kind = classifyKind(name, section.title);
      const nameH = doc.font(F.regular).fontSize(11).heightOfString(name, { width: CONTENT_W * 0.52 });
      const rowH = Math.max(26, nameH + 14);
      ensureRowSpace(rowH + 10, true);

      doc.save().lineWidth(0.5).strokeColor(COLORS.rule)
        .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
      y += 8;
      doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
        .text(name, MARGIN, y, { width: CONTENT_W * 0.52, lineGap: 1.5 });
      doc.font(F.regular).fontSize(10.5).fillColor(COLORS.muted)
        .text(kind, MARGIN + CONTENT_W * 0.56, y, { width: CONTENT_W * 0.22, lineBreak: false });
      doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
        .text(item.qty || '', MARGIN, y, { width: CONTENT_W, align: 'right', lineBreak: false });
      y += rowH;
    }
    y += 18;
    openSectionTitle = null;
  }
  return { y, pageIndex };
}

/** @deprecated – use drawClosingSection */
function drawBestandteilePage(doc, y, offer, startContentPage) {
  return drawBestandteileList(doc, y, offer, startContentPage, {}).y;
}

function drawPriceBlock(doc, y, preis) {
  const p = preis || {};
  const rows = [
    ['Gesamt (Netto)', p.nettoFmt || formatEUR(p.netto)],
    [`MwSt. (${((p.mwstRate || 0.2) * 100).toFixed(1).replace('.', ',')} % auf ${p.nettoFmt || formatEUR(p.netto)})`, p.mwstFmt || formatEUR(p.mwst)],
  ];
  rows.forEach(([label, val]) => {
    doc.font(F.regular).fontSize(11).fillColor(COLORS.text).text(label, MARGIN, y);
    doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
      .text(val || '—', MARGIN, y, { width: CONTENT_W, align: 'right' });
    y += 20;
    doc.save().lineWidth(0.55).strokeColor(COLORS.rule)
      .moveTo(MARGIN, y).lineTo(PAGE.width - MARGIN, y).stroke().restore();
    y += 10;
  });
  doc.font(F.bold).fontSize(14).fillColor(COLORS.text).text('Gesamtpreis (Brutto)', MARGIN, y);
  doc.font(F.bold).fontSize(14).fillColor(COLORS.text)
    .text(p.bruttoFmt || formatEUR(p.brutto), MARGIN, y, { width: CONTENT_W, align: 'right' });
  return y + 22;
}

/** @deprecated Alias – Prefer drawPriceBlock directly under the overview list. */
function drawPricePage(doc, y, preis) {
  return drawPriceBlock(doc, y, preis);
}

function estimateDecisionBlockHeight(optionals = []) {
  const opts = Array.isArray(optionals) ? optionals : [];
  // Nur fließender Inhalt (Unterschrift ist am Seitenfuß gepinnt, zählt nicht in die Flusshöhe)
  let h = 92; // price block
  h += 22;
  h += 16 + 14 + 14 + 16; // accept title + terms
  if (opts.length) h += 16 + 14 + opts.length * 24 + 8;
  else h += 8;
  h += 16; // kleiner Abstand vor Signaturzone
  return h;
}

function estimateAcceptHeight(optionals = []) {
  return estimateDecisionBlockHeight(optionals);
}

/** Akzeptieren-Inhalt ohne Signatur (Signatur wird separat am Seitenfuß verankert). */
function drawAcceptBody(doc, y, optionals = []) {
  doc.font(F.bold).fontSize(15).fillColor(COLORS.text).text('Angebot akzeptieren', MARGIN, y);
  y = doc.y + 12;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Zahlungskonditionen: 100 % nach Fertigstellung der Installation und Inbetriebnahme', MARGIN, y, {
      width: CONTENT_W,
    });
  y = doc.y + 6;
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.text)
    .text('Liefer- und Montagetermin: ca. 10–14 Wochen nach Bestellung', MARGIN, y, {
      width: CONTENT_W,
    });
  y = doc.y + 16;

  const opts = Array.isArray(optionals) ? optionals : [];
  if (opts.length) {
    doc.font(F.bold).fontSize(12).fillColor(COLORS.text).text('Optionale Komponenten', MARGIN, y);
    y = doc.y + 6;
    doc.font(F.regular).fontSize(10).fillColor(COLORS.muted)
      .text('Nicht im Gesamtpreis enthalten — auf Wunsch beauftragbar.', MARGIN, y);
    y = doc.y + 12;
    for (const opt of opts) {
      const rowY = y;
      doc.save().lineWidth(1.1).strokeColor(COLORS.yellow)
        .roundedRect(MARGIN, rowY + 2, 11, 11, 2).stroke().restore();
      doc.font(F.regular).fontSize(11).fillColor(COLORS.text)
        .text(opt.label || '', MARGIN + 20, rowY, { width: CONTENT_W - 130 });
      doc.font(F.bold).fontSize(11).fillColor(COLORS.text)
        .text(formatEUR(opt.price), MARGIN, rowY, { width: CONTENT_W, align: 'right' });
      y = Math.max(doc.y, rowY + 16) + 8;
    }
  }
  return y;
}

/** Unterschriftszeile fest knapp oberhalb der gelben Footer-Leiste. */
function drawSignaturePinned(doc) {
  const sigY = PAGE.height - FOOTER_H - 42;
  doc.save().lineWidth(0.9).strokeColor('#c8c8c8')
    .moveTo(MARGIN, sigY).lineTo(PAGE.width - MARGIN, sigY).stroke().restore();
  doc.font(F.regular).fontSize(10.5).fillColor(COLORS.muted)
    .text('Ort, Datum, Name, Unterschrift', MARGIN, sigY + 8);
}

/**
 * Akzeptieren-Seite (Legacy-API): Körper + gepinnte Unterschrift.
 */
function drawAcceptPage(doc, y, optionals = []) {
  y = drawAcceptBody(doc, y, optionals);
  drawSignaturePinned(doc);
  return CONTENT_BOTTOM;
}

function drawDatasheetsPage(doc, y, sheets) {
  doc.font(F.bold).fontSize(22).fillColor(COLORS.text).text('Datenblätter', MARGIN, y);
  y = doc.y + 8;
  doc.font(F.regular).fontSize(10).fillColor(COLORS.text)
    .text('Hier sehen Sie die Datenblätter aller Komponenten, die wir Ihnen im Rahmen Ihres Angebots anbieten.', MARGIN, y, { width: CONTENT_W });
  y = doc.y + 14;
  doc.font(F.bold).fontSize(7.5).fillColor(COLORS.softMuted)
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
    doc.font(F.bold).fontSize(10).fillColor(COLORS.text)
      .text(sheet.label || 'Komponente', MARGIN, y, { width: CONTENT_W * 0.58 });
    const nameBottom = doc.y;
    doc.font(F.regular).fontSize(9).fillColor(COLORS.muted)
      .text(kind, MARGIN + CONTENT_W * 0.62, rowTop, { width: CONTENT_W * 0.2, lineBreak: false });
    // Short link on the far right – avoids long URLs overlapping name/type
    const linkLabel = 'Oeffnen';
    const linkW = 52;
    const linkX = PAGE.width - MARGIN - linkW;
    doc.font(F.bold).fontSize(9).fillColor(COLORS.yellow)
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
  resolveSalesPhotoPath,
  salesPhotoMetaForUsername,
  findNewestSalesPhotoAbs,
};
