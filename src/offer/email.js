'use strict';

const { chatCompletionJson, parseJsonFromLlm } = require('./ai-offer');
const { resolveCustomerNames } = require('./names');

const PHONE = '+43 676 707 55 25';
const DEFAULT_EMAIL = 'vertrieb@noortec.at';
const OFFER_VALIDITY_DAYS = 30;

/** Häufige Vornamen (AT/DE) für Anrede-Erkennung. */
const MALE_FIRST = new Set([
  'alexander', 'andreas', 'anton', 'benjamin', 'bernd', 'christian', 'christoph', 'claus', 'cosimo',
  'daniel', 'david', 'dominik', 'erich', 'ernst', 'felix', 'florian', 'franz', 'friedrich', 'georg',
  'gerald', 'gerhard', 'gunter', 'günter', 'hans', 'heinrich', 'helmut', 'herbert', 'hermann',
  'jakob', 'jan', 'johann', 'johannes', 'jonas', 'joseph', 'josef', 'julian', 'karl', 'klaus',
  'leo', 'leon', 'leopold', 'lukas', 'manuel', 'marc', 'marco', 'markus', 'martin', 'mathias',
  'matthias', 'max', 'maximilian', 'michael', 'moritz', 'nico', 'niklas', 'oliver', 'otto',
  'patrick', 'paul', 'peter', 'philipp', 'rafael', 'ralf', 'richard', 'robert', 'roland',
  'roman', 'rudolf', 'samuel', 'sebastian', 'simon', 'stefan', 'stephan', 'thomas', 'tobias',
  'victor', 'viktor', 'walter', 'werner', 'wilhelm', 'wolfgang',
]);

const FEMALE_FIRST = new Set([
  'alexandra', 'angela', 'anna', 'anne', 'annette', 'barbara', 'beate', 'birgit',
  'brigitte', 'carla', 'caroline', 'christina', 'christine', 'clara', 'claudia', 'cornelia',
  'daniela', 'diana', 'doris', 'edith', 'elena', 'elisabeth', 'ella', 'emma', 'erika', 'eva',
  'franziska', 'gabriele', 'gerda', 'gisela', 'hanna', 'hannah', 'heidi', 'heike', 'helga',
  'inga', 'ingrid', 'irene', 'iris', 'isabella', 'jana', 'jennifer', 'jessica', 'johanna',
  'julia', 'karin', 'karoline', 'katharina', 'katrin', 'klara', 'laura', 'lena', 'lisa',
  'magdalena', 'manuela', 'margarete', 'maria', 'marie', 'marina', 'marion', 'martina',
  'melanie', 'monika', 'nadine', 'natalie', 'nina', 'petra', 'renate', 'rita', 'sabine',
  'sandra', 'sara', 'sarah', 'silvia', 'simone', 'sofia', 'sophia', 'stephanie', 'susanne',
  'tanja', 'theresa', 'ulrike', 'ursula', 'verena', 'veronika', 'victoria',
]);

/** Unsichere/epizöne Vornamen – immer nachfragen. */
const AMBIGUOUS_FIRST = new Set([
  'alex', 'andrea', 'charlie', 'kim', 'luca', 'luka', 'michele', 'nicola', 'nikita', 'robin',
  'sasha', 'sascha', 'toni', 'tony',
]);

/** Dateiname-sicher: Umlaute behalten, Leerzeichen → _, Sonderzeichen weg. */
function sanitizeNamePart(s) {
  return String(s || '')
    .trim()
    .replace(/[^\w\säöüÄÖÜß-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Angebotsdateiname: Nachname_Vorname_2026-0001-V1
 * @param {object} customer
 * @param {string} angebotsnummer z. B. 2026-0001
 * @param {number} [customerVersion=1] Kunden-Version/Variante (V1, V2, …)
 */
function buildOfferFilenameBase(customer, angebotsnummer, customerVersion = 1) {
  const { nachname, vorname } = resolveCustomerNames(customer);
  const nn = sanitizeNamePart(nachname) || 'Kunde';
  const vn = sanitizeNamePart(vorname);
  const num = String(angebotsnummer || '').trim() || String(new Date().getFullYear());
  const ver = Math.max(1, Math.round(Number(customerVersion)) || 1);
  const namePart = vn ? `${nn}_${vn}` : nn;
  return `${namePart}_${num}-V${ver}`;
}

function buildSummaryTitle(customer, angebotsnummer, customerVersion) {
  const base = buildOfferFilenameBase(customer, angebotsnummer, customerVersion);
  return base.replace(/_/g, ' ');
}

function safeFileBase(customer, angebotsnummer, customerVersion) {
  return buildOfferFilenameBase(customer, angebotsnummer, customerVersion)
    || `Angebot_${angebotsnummer || ''}`;
}

function firstName(customer) {
  return resolveCustomerNames(customer).vorname;
}

function lastName(customer) {
  return resolveCustomerNames(customer).nachname;
}

/**
 * Geschlecht aus Vornamen ableiten.
 * @returns {'herr'|'frau'|'unknown'}
 */
function inferGenderFromFirstName(vorname) {
  const raw = String(vorname || '').trim();
  if (!raw) return 'unknown';
  const first = raw.split(/[-\s]+/)[0].toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (!first) return 'unknown';
  if (AMBIGUOUS_FIRST.has(first)) return 'unknown';
  if (MALE_FIRST.has(first)) return 'herr';
  if (FEMALE_FIRST.has(first)) return 'frau';
  // leichte Heuristik (mit Vorsicht) – bei Unsicherheit unknown
  if (/(?:ine|ette|ella|ella|issa|yna|ina)$/i.test(first) && first.length > 3) return 'frau';
  if (/(?:bert|hard|mund|rich|fried|helm|walt)$/i.test(first)) return 'herr';
  return 'unknown';
}

/**
 * @param {object} customer
 * @param {'herr'|'frau'|null|undefined} override
 * @returns {{ gender: 'herr'|'frau'|'unknown', greeting: string, needsClarification: boolean, clarifications: object[] }}
 */
function resolveSalutation(customer, override) {
  const ln = lastName(customer);
  const vn = firstName(customer);
  let gender = 'unknown';
  const ov = String(override || '').toLowerCase().trim();
  if (ov === 'herr' || ov === 'frau') gender = ov;
  else gender = inferGenderFromFirstName(vn);

  const clarifications = [];
  if (gender === 'unknown') {
    clarifications.push({
      id: 'anrede_geschlecht',
      question: vn
        ? `Anrede für „${vn}${ln ? ` ${ln}` : ''}“ – Herr oder Frau?`
        : (ln ? `Anrede für „${ln}“ – Herr oder Frau?` : 'Anrede – Herr oder Frau?'),
      answers: [
        { label: 'Herr', text: 'Anrede: Herr' },
        { label: 'Frau', text: 'Anrede: Frau' },
      ],
    });
  }

  let greeting = 'Guten Tag,';
  if (gender === 'herr' && ln) greeting = `Sehr geehrter Herr ${ln},`;
  else if (gender === 'frau' && ln) greeting = `Sehr geehrte Frau ${ln},`;
  else if (gender === 'herr') greeting = 'Sehr geehrter Herr,';
  else if (gender === 'frau') greeting = 'Sehr geehrte Frau,';
  else if (ln) greeting = `Guten Tag ${ln},`;
  else if (resolveCustomerNames(customer).displayName) {
    greeting = `Guten Tag ${resolveCustomerNames(customer).displayName},`;
  }

  return {
    gender,
    greeting,
    needsClarification: clarifications.length > 0,
    clarifications,
  };
}

/** Formale Anrede (Template-Fallback). */
function formalGreeting(customer, override) {
  return resolveSalutation(customer, override).greeting;
}

function validityDateLabel(offerDatum) {
  const raw = String(offerDatum || '').trim();
  let base = new Date();
  const m = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    base = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  } else {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) base = new Date(t);
  }
  if (!Number.isFinite(base.getTime())) base = new Date();
  const end = new Date(base.getTime());
  end.setDate(end.getDate() + OFFER_VALIDITY_DAYS);
  return end.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function deNum(s) {
  return String(s == null ? '' : s).replace(/(\d)\.(\d)/g, '$1,$2');
}

function formatEuroMail(bruttoFmt, bruttoNum) {
  if (Number.isFinite(Number(bruttoNum))) {
    const n = Math.round(Number(bruttoNum));
    return `€ ${n.toLocaleString('de-AT')},–`;
  }
  const s = String(bruttoFmt || '').replace(/\s*€\s*/g, '').trim();
  if (!s) return '';
  const cleaned = s.replace(/,00$/, '').replace(/,–$/, '');
  return `€ ${cleaned},–`;
}

function buildOverviewLine(offer) {
  const cfg = offer.config || {};
  const kind = (offer.meta && offer.meta.offerKind) || 'pv';
  const klimaFix = ((offer.klima && offer.klima.fix) || []).filter((k) => k && k.packageId);
  const klimaLbl = klimaFix.map((k) => k.label).filter(Boolean).join(', ');

  if (kind === 'klima') {
    return `${klimaLbl || 'Klimapaket LG STANDARD II'}, schlüsselfertig`;
  }

  const parts = [];
  if (cfg.kwpLabel) {
    parts.push(`${deNum(cfg.kwpLabel)}${cfg.moduleCount ? ` (${cfg.moduleCount} Module)` : ''}`);
  }
  if (cfg.speicher) {
    parts.push(`${deNum(cfg.speicherLabel)} ${cfg.brandLabel || 'Sigenergy'}-Speicher`);
  }
  let line = parts.filter(Boolean).join(' + ');
  if (!line) line = 'Photovoltaikanlage';
  if (kind === 'combo' && klimaLbl) line += ` + ${klimaLbl}`;
  return `${line}, schlüsselfertig`;
}

function buildSubject(offer) {
  const cfg = offer.config || {};
  const kind = (offer.meta && offer.meta.offerKind) || 'pv';
  const klimaFix = ((offer.klima && offer.klima.fix) || []).filter((k) => k && k.packageId);
  const klimaShort = klimaFix.length ? (klimaFix[0].label || 'Klima') : 'Klima';

  if (kind === 'klima') {
    return `Ihr Klima-Angebot: ${klimaShort}`;
  }
  const bits = [];
  if (cfg.kwpLabel) bits.push(deNum(cfg.kwpLabel));
  if (cfg.speicher) bits.push(`${deNum(cfg.speicherLabel || `${cfg.speicher} kWh`)} Speicher`);
  if (kind === 'combo') bits.push('Klima');
  const mid = bits.length ? bits.join(' + ') : 'Photovoltaik';
  const prefix = kind === 'combo' ? 'Ihr PV- & Klima-Angebot' : 'Ihr PV-Angebot';
  return `${prefix}: ${mid}`;
}

function offerProductLabel(kind) {
  if (kind === 'klima') return 'Ihre Klimaanlage';
  if (kind === 'combo') return 'Ihre Photovoltaikanlage und Klimaanlage';
  return 'Ihre Photovoltaikanlage';
}

function formatUnterkonstruktionBullet(offer) {
  const cfg = offer.config || {};
  const segs = Array.isArray(cfg.dachSegmente) ? cfg.dachSegmente.filter((s) => s && (s.label || s.dach)) : [];
  if (segs.length > 1) {
    const parts = segs.map((s) => {
      const n = Number(s.modules) || 0;
      const label = s.label || s.dach || 'Dach';
      return `${n} Module ${label}`;
    });
    return `- ALU-Unterkonstruktion: ${parts.join(', ')}.`;
  }
  return '- ALU-Unterkonstruktion.';
}

function hasFixOptimierer(offer) {
  const inkl = (offer.preis && Array.isArray(offer.preis.inkludiert)) ? offer.preis.inkludiert : [];
  if (inkl.some((it) => it && (it.key === 'optimierer' || /optimier/i.test(it.label || '')))) return true;
  const sections = Array.isArray(offer.sections) ? offer.sections : [];
  for (const sec of sections) {
    if (!sec || !/zusätzliche/i.test(sec.title || '')) continue;
    const items = Array.isArray(sec.items) ? sec.items : [];
    if (items.some((it) => it && /optimier/i.test(it.name || ''))) return true;
  }
  const opts = (offer.config && offer.config.optionen) || [];
  if (Array.isArray(opts)) {
    return opts.some((o) => {
      if (!o || o.mode !== 'fix') return false;
      const key = String(o.key || '').toLowerCase();
      const label = String(o.label || '').toLowerCase();
      return key === 'optimierer' || key === 'optimizer' || /optimier/.test(label);
    });
  }
  return false;
}

function buildModuleBullet(offer) {
  const cfg = offer.config || {};
  const model = String(cfg.moduleModel || '').trim();
  const wp = cfg.moduleWp != null ? Number(cfg.moduleWp) : null;
  const type = String(cfg.moduleType || '').toLowerCase();
  const isAiko = type === 'aiko' || /aiko/i.test(model);
  const wpPart = Number.isFinite(wp) && wp > 0 ? ` (${wp} Wp)` : '';
  if (isAiko) {
    return `- Hochleistungsmodule AIKO${wpPart || ' (490 Wp)'} – Branchenstandard für höchste Effizienz und Ästhetik – 30 Jahre Leistungsgarantie.`;
  }
  if (model) {
    return `- Hochleistungsmodule ${model}${wpPart} – Langlebigkeit und höchste Erträge – 30 Jahre Leistungsgarantie.`;
  }
  return '- Hochleistungsmodule – Langlebigkeit und höchste Erträge – 30 Jahre Leistungsgarantie.';
}

function buildIncludeBullets(offer) {
  const cfg = offer.config || {};
  const kind = (offer.meta && offer.meta.offerKind) || 'pv';
  const brand = cfg.brandLabel || 'Sigenergy';
  const bullets = [];

  if (kind !== 'klima') {
    bullets.push(buildModuleBullet(offer));
    bullets.push(`- Wechselrichter der Firma ${brand === 'Fronius' ? 'Fronius' : 'Fronius bzw. Sigenergy'} mit sehr hohem Wirkungsgrad.`);
    if (cfg.speicher) {
      bullets.push('- Lithium-Eisenphosphat-Speicher (LFP).');
    }
    if (hasFixOptimierer(offer)) {
      const n = Number(cfg.moduleCount) || 0;
      bullets.push(n > 0
        ? `- Optimierer (${n} Stück, 1 pro Modul).`
        : '- Optimierer (1 pro Modul).');
    }
    bullets.push(formatUnterkonstruktionBullet(offer));
    bullets.push('- Installation & Inbetriebnahme der Anlage.');
    bullets.push('- Genehmigungen, Behördenwege und Förderabwicklung.');
    bullets.push('- Überwachungssystem der Photovoltaikanlage.');
    bullets.push('- Einschulung und App-Installation.');
  }

  if (kind === 'klima' || kind === 'combo') {
    const klimaFix = ((offer.klima && offer.klima.fix) || []).filter((k) => k && k.packageId);
    const klimaLbl = klimaFix.map((k) => k.label).filter(Boolean).join(', ');
    bullets.push(klimaLbl
      ? `- Klimageräte LG STANDARD II (${klimaLbl}), schlüsselfertig installiert.`
      : '- Klimageräte LG STANDARD II, schlüsselfertig installiert.');
    bullets.push('- Montage, Inbetriebnahme und Einweisung.');
  }

  return bullets;
}

function buildDocumentList(kind) {
  if (kind === 'klima') {
    return [
      '- Ausweiskopie',
      '- Meldezettel',
      '- Angebot – unterschrieben',
    ];
  }
  return [
    '- Ausweiskopie',
    '- Meldezettel',
    '- Stromrechnung',
    '- Vollmacht (siehe Anhang) – ausgefüllt und unterschrieben',
    '- Angebot – unterschrieben',
    '- IBAN für die Einspeisevergütung der ÖMAG',
  ];
}

function formatEmailSignature(vertrieb) {
  const v = vertrieb || {};
  const name = String(v.name || 'Cosimo Lippe, BSc.').trim() || 'Cosimo Lippe, BSc.';
  const phone = String(v.phone || PHONE).trim() || PHONE;
  return [
    'Mit freundlichen Grüßen',
    '',
    name,
    'Planung | Beratung | Verkauf',
    phone,
    '',
    'Noortec GmbH',
  ].join('\n');
}

/** Ersetzt bzw. hängt die Signatur an – Telefonnummer ist immer enthalten. */
function applyEmailSignature(body, vertrieb) {
  const sig = formatEmailSignature(vertrieb);
  const t = String(body || '').replace(/\s+$/g, '');
  const idx = t.search(/Mit freundlichen Gr[uü]ßen/i);
  if (idx >= 0) {
    return `${t.slice(0, idx).replace(/\s+$/g, '')}\n\n${sig}`;
  }
  return `${t}\n\n${sig}`;
}

/**
 * Standard-E-Mail – an der Vertriebsvorlage orientiert.
 */
function buildEmailText({ customer, offer, extraText, salutationOverride }) {
  const v = offer.meta.vertrieb || {};
  const kind = (offer.meta && offer.meta.offerKind) || 'pv';
  const sal = resolveSalutation(customer, salutationOverride);
  const phone = v.phone || PHONE;
  const mail = v.email || DEFAULT_EMAIL;
  const bullets = buildIncludeBullets(offer);
  const docs = buildDocumentList(kind);
  const heading = kind === 'klima'
    ? 'Unser Klima-Angebot beinhaltet:'
    : (kind === 'combo'
      ? 'Unser Angebot beinhaltet:'
      : 'Unser Photovoltaik-Angebot beinhaltet:');

  const body = [
    sal.greeting,
    '',
    `wir schätzen Ihr Interesse an unseren Produkten und Dienstleistungen. Es freut mich, Ihnen Ihr Angebot für ${offerProductLabel(kind)} zusenden zu dürfen.`,
    '',
    heading,
    ...bullets,
    '',
    'Ich lade Sie herzlich ein, dieses Angebot zu überprüfen und freue mich auf Ihre rasche Bestätigung.',
    '',
    `Für alle Fragen stehe ich Ihnen gerne zur Verfügung – ich betreue Sie von der Planung bis zur Inbetriebnahme. Sie erreichen mich per E-Mail unter ${mail} oder telefonisch unter ${phone}.`,
    '',
    'Für die rasche und ordnungsgemäße Abwicklung bitte ich Sie um Zusendung von',
    ...docs,
    '',
  ];

  if (kind !== 'klima') {
    body.push('Sobald alle Genehmigungen vorliegen, meldet sich das Büro bezüglich Ihres Montagetermins.');
    body.push('');
  }

  // PV-only: Klima als zukünftiges Angebot erwähnen
  if (kind === 'pv') {
    body.push('Neben Photovoltaik bieten wir auch hochwertige Klimaanlagen an – sprechen Sie uns gerne an, wenn Sie Interesse haben oder künftig eine Klimatisierung planen.');
    body.push('');
  }

  if (extraText && String(extraText).trim()) {
    body.push(String(extraText).trim(), '');
  }

  return {
    subject: buildSubject(offer),
    body: applyEmailSignature(body.join('\n'), v),
    salutationGender: sal.gender,
    needsClarification: sal.needsClarification,
    clarifications: sal.clarifications,
  };
}

const EMAIL_SYSTEM_PROMPT = `Du schreibst deutsche Angebots-E-Mails für NOORTEC (Photovoltaik / Klima, Wien/Österreich).
Ausgabe NUR als JSON:
{"subject":"...","body":"...","salutationGender":"herr|frau|unknown","needsClarification":true|false,"clarifications":[{"id":"anrede_geschlecht","question":"...","answers":[{"label":"Herr","text":"Anrede: Herr"},{"label":"Frau","text":"Anrede: Frau"}]}]}

ORIENTIERE DICH STRIKT an dieser Vorlage (Ton, Aufbau, Formalität):

Sehr geehrter Herr Mustermann,

wir schätzen Ihr Interesse an unseren Produkten und Dienstleistungen. Es freut mich, Ihnen Ihr Angebot für Ihre Photovoltaikanlage zusenden zu dürfen.

Unser Photovoltaik-Angebot beinhaltet:
- Hochleistungsmodule AIKO (490 Wp) – Branchenstandard für höchste Effizienz und Ästhetik – 30 Jahre Leistungsgarantie.
  (Modulzeile an gewählten Modultyp anpassen: moduleModel / moduleType / moduleWp aus den Daten – AIKO gerne namentlich nennen.)
- Wechselrichter der Firma Fronius bzw. Sigenergy mit sehr hohem Wirkungsgrad.
- Lithium-Eisenphosphat-Speicher (LFP).
- ALU-Unterkonstruktion.
- Installation & Inbetriebnahme der Anlage.
- Genehmigungen, Behördenwege und Förderabwicklung.
- Überwachungssystem der Photovoltaikanlage.
- Einschulung und App-Installation.

Ich lade Sie herzlich ein, dieses Angebot zu überprüfen und freue mich auf Ihre rasche Bestätigung.

Für alle Fragen stehe ich Ihnen gerne zur Verfügung – ich betreue Sie von der Planung bis zur Inbetriebnahme. Sie erreichen mich per E-Mail unter vertrieb@noortec.at oder telefonisch unter +43 676 707 55 25.

Für die rasche und ordnungsgemäße Abwicklung bitte ich Sie um Zusendung von
- Ausweiskopie
- Meldezettel
- Stromrechnung
- Vollmacht (siehe Anhang) – ausgefüllt und unterschrieben
- Angebot – unterschrieben
- IBAN für die Einspeisevergütung der ÖMAG

Sobald alle Genehmigungen vorliegen, meldet sich das Büro bezüglich Ihres Montagetermins.

Bei reinen PV-Angeboten (offerKind=pv) zusätzlich einen kurzen Hinweis: Wir bieten auch Klimaanlagen an; Kunden können sich jederzeit bzw. zukünftig an uns wenden.

Mit freundlichen Grüßen

Cosimo Lippe, BSc.
Planung | Beratung | Verkauf
+43 676 707 55 25

Noortec GmbH

SIGNATUR (Pflicht):
- Nach „Mit freundlichen Grüßen“ immer: Name, „Planung | Beratung | Verkauf“, Telefonnummer (vertrieb_telefon), Leerzeile, „Noortec GmbH“.
- Die Telefonnummer in der Signatur NIEMALS weglassen.

ANREDE (Herr/Frau):
- Nutze salutationOverride wenn gesetzt ("herr" oder "frau").
- Sonst analysiere den Vornamen (vorname) auf Geschlecht – Nachname steht in "nachname".
- Sicher männlich → "Sehr geehrter Herr <Nachname>,"
- Sicher weiblich → "Sehr geehrte Frau <Nachname>,"
- UNSICHER oder mehrdeutig (z. B. Andrea, Alex, Luca, Kim) ODER Vorname fehlt:
  → needsClarification=true, clarifications mit Frage Herr/Frau,
  → body/subject trotzdem erzeugen mit vorläufiger Anrede "Guten Tag <Nachname>," ODER leer lassen ist NICHT erlaubt – verwende "Guten Tag," nur wenn gar kein Name.
  → salutationGender="unknown"

ANGEBOTSART (offerKind):
- pv: wie Vorlage (Photovoltaik). Speicher-Zeile nur wenn Speicher vorhanden.
- klima: Angebot für Klimaanlage. Aufzählung nur Klima (LG STANDARD II, Montage, Einweisung).
  VERBOTEN: Jede Formulierung zu "10-30 Jahre Herstellergarantie" / Herstellergarantie auf Klimageräte.
  Keine PV-Unterlagen (keine Vollmacht, keine Stromrechnung, keine ÖMAG-IBAN), kein Genehmigungs-/Montage-Satz der PV.
- combo: PV- und Klima-Inhalte kombinieren; Klima-Garantie-Satz weiterhin VERBOTEN.

UNTERKONSTRUKTION / OPTIMIERER:
- Bei mehreren Dachflächen: eine Zeile wie "- ALU-Unterkonstruktion: 6 Module Falzblech, 14 Module Flachdach."
- Wenn Optimierer inkludiert (hasOptimierer=true): Zeile "- Optimierer (N Stück, 1 pro Modul)."
- Genehmigungs-Bullet immer: "- Genehmigungen, Behördenwege und Förderabwicklung."

SPRACHBEFEHL / ROHTEXT:
- Der Sprachbefehl dient NUR der Fakt-Ableitung auf dem Server – NIEMALS wörtlich in die Mail zitieren oder paraphrasieren.
- Keine Garantie-Floskeln aus dem Rohbefehl übernehmen.
- Nur zusatztext_vom_vertrieb darf als freier Zusatz eingebaut werden.

FORMULIERUNG Ansprechpartner:
- NICHT: "Ein fester Ansprechpartner von der Planung bis zur Inbetriebnahme: ich persönlich"
- STATTDESSEN im Fragensatz: "… stehe ich Ihnen gerne zur Verfügung – ich betreue Sie von der Planung bis zur Inbetriebnahme."

STIL:
- Reiner Klartext (kein Markdown, keine HTML, keine Sternchen)
- Aufzählungen immer mit Bindestrich am Zeilenanfang: "- …"
- Persönlich, höflich, formell – wie die Vorlage
- vertrieb_name / vertrieb_email / vertrieb_telefon aus den Eingabedaten verwenden
- Signatur MUSS die Telefonnummer (vertrieb_telefon) enthalten
- zusatztext_vom_vertrieb sinnvoll einbauen
- Modulzeile MUSS moduleModel/moduleType widerspiegeln (AIKO namentlich, wenn gewählt)
- Bei offerKind=pv: kurzer Hinweis auf Klimaanlagen-Angebot für jetzt oder später
- Betreff kompakt mit Speichergröße, z. B. "Ihr PV-Angebot: 9,1 kWp + 6 kWh Speicher" bzw. Klima/Kombi`;

function stripMailMarkdown(text) {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1$2');
}

function sanitizeEmailBody(body, offerKind) {
  let t = stripMailMarkdown(body);
  // Klima: Herstellergarantie-Sätze zu Klimageräten entfernen
  if (offerKind === 'klima' || offerKind === 'combo') {
    t = t
      .replace(/^.*10\s*[-–—]\s*30\s*Jahre\s+Herstellergarantie.*$/gim, '')
      .replace(/^.*Herstellergarantie\s+auf\s+die\s+Klimageräte.*$/gim, '')
      .replace(/^.*Herstellergarantie\s+auf\s+Klimageräte.*$/gim, '');
  }
  // Alte Ansprechpartner-Floskel ersetzen, falls KI sie trotzdem liefert
  t = t
    .replace(
      /Ein fester Ansprechpartner von der Planung bis zur\s*\n?\s*Inbetriebnahme:\s*ich persönlich/gi,
      'ich betreue Sie von der Planung bis zur Inbetriebnahme'
    )
    .replace(
      /Ein fester Ansprechpartner von der Planung bis zur Inbetriebnahme:\s*ich persönlich/gi,
      'ich betreue Sie von der Planung bis zur Inbetriebnahme'
    );
  // Häufige Rohbefehl-/Garantie-Leaks entfernen
  t = t
    .replace(/^.*(?:sprachbefehl|diktat|voice\s*command).*$/gim, '')
    .replace(/^.*(?:module\s+auf\s+falzblech\s+und).*$/gim, '');
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

async function buildEmailTextAI(params) {
  const { customer, offer, extraText, salutationOverride } = params;
  const cfg = offer.config || {};
  const v = offer.meta.vertrieb || {};
  const klimaLabels = ((offer.klima && offer.klima.fix) || []).map((k) => k.label).filter(Boolean);
  const kind = (offer.meta && offer.meta.offerKind) || 'pv';
  const validUntil = validityDateLabel(offer.meta && offer.meta.datum);
  const sal = resolveSalutation(customer, salutationOverride);
  const names = resolveCustomerNames(customer);
  const ukBullet = formatUnterkonstruktionBullet(offer);
  const optimierer = hasFixOptimierer(offer);

  // Ohne Override und unsicher → Template + Rückfrage (kein riskanter KI-Raten-Pfad)
  if (sal.needsClarification && !salutationOverride) {
    const tpl = buildEmailText(params);
    return {
      ...tpl,
      source: 'template',
      needsClarification: true,
      clarifications: sal.clarifications,
      salutationGender: 'unknown',
    };
  }

  const userContent = JSON.stringify({
    offerKind: kind,
    kunde: names.displayName,
    nachname: names.nachname,
    vorname: names.vorname,
    salutationOverride: salutationOverride || null,
    suggestedGender: sal.gender,
    suggestedGreeting: sal.greeting,
    konfiguration: cfg.includePv === false
      ? (klimaLabels.join(', ') || 'Klimapaket')
      : `${cfg.kwpLabel} (${cfg.moduleCount} Module), Speicher ${cfg.speicherLabel}, ${cfg.brandLabel}, Dach ${cfg.dach}${klimaLabels.length ? `; Klima: ${klimaLabels.join(', ')}` : ''}`,
    kwpLabel: cfg.kwpLabel || null,
    moduleCount: cfg.moduleCount || null,
    moduleType: cfg.moduleType || null,
    moduleModel: cfg.moduleModel || null,
    moduleWp: cfg.moduleWp || null,
    moduleBullet: buildModuleBullet(offer),
    speicherLabel: cfg.speicher ? cfg.speicherLabel : null,
    hasSpeicher: !!cfg.speicher,
    brandLabel: cfg.brandLabel || null,
    dachSegmente: Array.isArray(cfg.dachSegmente)
      ? cfg.dachSegmente.map((s) => ({ dach: s.label || s.dach, modules: s.modules }))
      : [],
    unterkonstruktionBullet: ukBullet,
    hasOptimierer: optimierer,
    klima: klimaLabels,
    gesamtpreis_brutto: offer.preis.bruttoFmt,
    gesamtpreis_mail: formatEuroMail(offer.preis.bruttoFmt, offer.preis.brutto),
    gueltig_bis: validUntil,
    vertrieb_name: v.name || 'Cosimo Lippe, BSc.',
    vertrieb_telefon: v.phone || PHONE,
    vertrieb_email: v.email || DEFAULT_EMAIL,
    zusatztext_vom_vertrieb: extraText || '',
    beispiel_betreff: buildSubject(offer),
    beispiel_ueberblick: buildOverviewLine(offer),
    beispiel_bullets: buildIncludeBullets(offer),
  });

  try {
    const out = await chatCompletionJson(EMAIL_SYSTEM_PROMPT, userContent);
    const j = parseJsonFromLlm(out);
    let subject = String(j.subject || '').trim();
    let body = String(j.body || '').trim();
    if (!subject) subject = buildSubject(offer);
    if (body) {
      body = sanitizeEmailBody(body, kind)
        .replace(/\[DATUM\]/gi, validUntil)
        .replace(/<gueltig_bis>/gi, validUntil);
      body = applyEmailSignature(body, {
        name: v.name || 'Cosimo Lippe, BSc.',
        phone: v.phone || PHONE,
      });
      subject = stripMailMarkdown(subject);

      const aiGender = String(j.salutationGender || '').toLowerCase();
      let needsClarification = !!j.needsClarification && !salutationOverride;
      let clarifications = Array.isArray(j.clarifications) ? j.clarifications : [];
      if (needsClarification && !clarifications.length) {
        clarifications = sal.clarifications;
      }
      if (salutationOverride) {
        needsClarification = false;
        clarifications = [];
      }

      return {
        subject,
        body,
        source: 'ai',
        salutationGender: aiGender === 'herr' || aiGender === 'frau' ? aiGender : sal.gender,
        needsClarification,
        clarifications,
      };
    }
  } catch (err) {
    console.error('[NOORTEC] E-Mail-Text KI fehlgeschlagen, nutze Template:', err.message);
  }
  return { ...buildEmailText(params), source: 'template' };
}

function buildMailtoUrl({ to, subject, body }) {
  // RFC 6068: mailto query values must use percent-encoding (%20), not
  // application/x-www-form-urlencoded (+ for spaces). URLSearchParams uses +,
  // which Outlook desktop displays literally instead of as spaces.
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(String(subject))}`);
  if (body) parts.push(`body=${encodeURIComponent(String(body))}`);
  const qs = parts.length ? `?${parts.join('&')}` : '';
  return `mailto:${encodeURIComponent(String(to || '').trim())}${qs}`;
}

module.exports = {
  buildSummaryTitle,
  safeFileBase,
  buildOfferFilenameBase,
  buildEmailText,
  buildEmailTextAI,
  buildMailtoUrl,
  formalGreeting,
  resolveSalutation,
  inferGenderFromFirstName,
  validityDateLabel,
  OFFER_VALIDITY_DAYS,
  PHONE,
};
