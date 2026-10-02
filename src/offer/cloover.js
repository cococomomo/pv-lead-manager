'use strict';

/**
 * Cloover-Projekt nur für die Testinstanz (APP_BASE_PATH=/test).
 * Production ruft die Partner-API nicht auf.
 *
 * Der Plan legt den Testschlüssel in die Server-Umgebung, nennt aber keinen
 * Variablennamen. Gelesen wird ausschließlich CLOOVER_API_KEY.
 * Zahlungsart und Laufzeit stehen im Plan ohne konkrete Werte. Die Test-Doku,
 * auf die der Plan verweist, zeigt FINANCING mit 5 bis 15 Jahren und für den
 * Preisrechner durationYears 10. Andere Werte werden nicht erfunden.
 */

const catalog = require('./catalog');
const { getBasePath } = require('../base-path');

const API_BASE = 'https://dev.cloover.com/api/partners/v1';
const USER_EMAIL = 'vertrieb@noortec.at';
const API_KEY_ENV = 'CLOOVER_API_KEY';
const PAYMENT_OPTIONS = ['FINANCING'];
const FINANCING_DURATION = { minYears: 5, maxYears: 15 };
const QUOTE_DURATION_YEARS = 10;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const FINANCE_SENTENCE_LEAD = 'Die Finanzierung Ihres Angebots können Sie hier direkt abschließen: ';

function isClooverTestInstance() {
  return getBasePath() === '/test';
}

function readApiKey(explicit) {
  if (explicit != null) return String(explicit).trim();
  return String(process.env[API_KEY_ENV] || '').trim();
}

function netFromGross(gross) {
  const incl = catalog.roundInvoiceCents(gross);
  if (!Number.isFinite(incl)) return NaN;
  return catalog.roundInvoiceCents(incl / (1 + catalog.MWST_RATE));
}

function clooverFinanceSentence(url) {
  const u = String(url || '').trim();
  if (!u) return '';
  return `${FINANCE_SENTENCE_LEAD}${u}`;
}

/** Satz mit der echten Checkout-URL vor die Grußformel. Ohne URL bleibt der Text. */
function ensureFinanceSentence(body, url) {
  const sentence = clooverFinanceSentence(url);
  const raw = String(body || '');
  if (!sentence) return raw;
  const kept = raw.split('\n').filter((row) => {
    if (row.includes(sentence)) return false;
    if (/cloover\.com/i.test(row)) return false;
    if (row.includes(FINANCE_SENTENCE_LEAD)) return false;
    return true;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const idx = kept.search(/Mit freundlichen Gr[uü]ßen/i);
  if (idx >= 0) {
    const head = kept.slice(0, idx).replace(/\s+$/g, '');
    const tail = kept.slice(idx).replace(/^\s+/, '');
    return `${head}\n\n${sentence}\n\n${tail}`;
  }
  return kept ? `${kept}\n\n${sentence}` : sentence;
}

function splitStreetAndNumber(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ').replace(/,\s*$/, '');
  if (!s) {
    return { ok: false, message: 'Die Hausnummer lässt sich nicht von der Straße trennen. Cloover-Projekt wird nicht angelegt.' };
  }
  const m = s.match(/^(.*\S)\s+(\d+\s*[A-Za-z]?(?:\s*[/\-]\s*\d+\s*[A-Za-z]?)?)$/);
  if (!m) {
    return { ok: false, message: 'Die Hausnummer lässt sich nicht von der Straße trennen. Cloover-Projekt wird nicht angelegt.' };
  }
  const street = m[1].trim();
  const streetNumber = m[2].replace(/\s+/g, '');
  if (!street || !streetNumber) {
    return { ok: false, message: 'Die Hausnummer lässt sich nicht von der Straße trennen. Cloover-Projekt wird nicht angelegt.' };
  }
  return { ok: true, street, streetNumber };
}

function countryFromZip(zip) {
  const z = String(zip || '').trim();
  if (/^\d{4}$/.test(z)) return 'AT';
  if (/^\d{5}$/.test(z)) return 'DE';
  return '';
}

function wallboxKw(entry) {
  const label = String((entry && (entry.label || entry.name)) || '');
  const m = label.match(/(\d+(?:[.,]\d+)?)\s*kW/i);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 11;
}

function isWallboxItem(entry) {
  if (!entry) return false;
  const key = String(entry.key || '').toLowerCase();
  const label = String(entry.label || entry.name || '');
  return key === 'wallbox' || /wallbox/i.test(label);
}

/**
 * Nur Modus Fix steckt im Angebots-Brutto (optionale Zeilen liegen daneben).
 * Eine fixe Wallbox wird eigene WALLBOX. Solar und Speicher, die als ein Preis
 * gelten, werden eine assetGroup. Optionale Wallbox bleibt draußen.
 */
function buildFinancedAssets(offer) {
  const preis = offer && offer.preis;
  const totalIncl = preis ? catalog.roundInvoiceCents(preis.brutto) : NaN;
  if (!Number.isFinite(totalIncl) || totalIncl <= 0) {
    return { ok: false, message: 'Cloover: der Bruttopreis fehlt.' };
  }
  const inkludiert = Array.isArray(preis.inkludiert) ? preis.inkludiert : [];
  let wallboxIncl = 0;
  let wallboxKwSum = 0;
  for (const entry of inkludiert) {
    if (!isWallboxItem(entry)) continue;
    const price = catalog.roundInvoiceCents(entry.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const qty = Math.max(1, Math.round(Number(entry.qty) || 1));
    wallboxIncl += price;
    wallboxKwSum += wallboxKw(entry) * qty;
  }
  wallboxIncl = catalog.roundInvoiceCents(wallboxIncl);
  if (wallboxIncl > totalIncl) wallboxIncl = totalIncl;
  const restIncl = catalog.roundInvoiceCents(totalIncl - wallboxIncl);

  const cfg = (offer && offer.config) || {};
  const kind = (offer.meta && offer.meta.offerKind) || '';
  const kwp = Number(cfg.kwpCalculated) || 0;
  const kwh = Number(cfg.speicher) || 0;
  const hasSolar = (kind === 'pv' || kind === 'combo') && kwp > 0;
  const hasBattery = kwh > 0;

  const assets = [];
  const assetGroups = [];

  function pushPriced(target, extra) {
    const incl = catalog.roundInvoiceCents(extra.priceInclVat);
    const excl = netFromGross(incl);
    if (!Number.isFinite(incl) || incl <= 0 || !Number.isFinite(excl) || excl <= 0) return false;
    target.push(Object.assign({}, extra, { priceInclVat: incl, priceExclVat: excl }));
    return true;
  }

  if (restIncl > 0 && hasSolar && hasBattery) {
    pushPriced(assetGroups, {
      types: ['SOLAR', 'BATTERY'],
      priceInclVat: restIncl,
      capacities: { SOLAR: kwp, BATTERY: kwh },
    });
  } else if (restIncl > 0 && hasSolar) {
    pushPriced(assets, { type: 'SOLAR', priceInclVat: restIncl, capacity: kwp });
  } else if (restIncl > 0 && hasBattery) {
    pushPriced(assets, { type: 'BATTERY', priceInclVat: restIncl, capacity: kwh });
  }

  if (wallboxIncl > 0 && wallboxKwSum > 0) {
    pushPriced(assets, { type: 'WALLBOX', priceInclVat: wallboxIncl, capacity: wallboxKwSum });
  }

  if (!assets.length && !assetGroups.length) {
    return {
      ok: false,
      message: 'Cloover: nur fixe PV-, Speicher- oder Wallbox-Positionen werden finanziert. In diesem Angebot ist keine davon.',
    };
  }

  return {
    ok: true,
    brutto: totalIncl,
    bruttoCents: Math.round(totalIncl * 100),
    assets,
    assetGroups,
  };
}

function prepareClooverProject({ offer, customer, pdfBuffer, filename, angebotsnummer }) {
  const c = customer || {};
  const phone = String(c.phone || '').trim();
  if (phone.length < 3) {
    return { ok: false, message: 'Telefon fehlt. Cloover-Projekt wird nicht angelegt.' };
  }
  const firstName = String(c.vorname || '').trim();
  const lastName = String(c.nachname || '').trim();
  const email = String(c.email || '').trim();
  if (!firstName || !lastName || !email) {
    return { ok: false, message: 'Vorname, Nachname oder E-Mail fehlt. Cloover-Projekt wird nicht angelegt.' };
  }
  const split = splitStreetAndNumber(c.street);
  if (!split.ok) return split;
  const country = countryFromZip(c.zip);
  if (!country) {
    return { ok: false, message: 'Land fehlt: die PLZ muss österreichisch (4 Stellen) oder deutsch (5 Stellen) sein. Cloover-Projekt wird nicht angelegt.' };
  }
  const city = String(c.city || '').trim();
  const postalCode = String(c.zip || '').trim();
  if (!city || !postalCode) {
    return { ok: false, message: 'PLZ oder Ort fehlt. Cloover-Projekt wird nicht angelegt.' };
  }

  const financed = buildFinancedAssets(offer);
  if (!financed.ok) return financed;

  const pdf = Buffer.isBuffer(pdfBuffer) ? pdfBuffer : Buffer.from(pdfBuffer || '');
  if (!pdf.length) {
    return { ok: false, message: 'Cloover: das Angebots-PDF fehlt.' };
  }
  if (pdf.length > MAX_PDF_BYTES) {
    return { ok: false, message: 'Cloover: das PDF ist größer als 20 MB.' };
  }

  const number = String(angebotsnummer || '').trim();
  if (!number) {
    return { ok: false, message: 'Cloover: die Angebotsnummer fehlt.' };
  }

  const body = {
    customer: {
      firstName,
      lastName,
      email,
      phone,
      type: 'INDIVIDUAL',
    },
    installationAddress: {
      street: split.street,
      streetNumber: split.streetNumber,
      postalCode,
      city,
      country,
    },
    paymentOptions: PAYMENT_OPTIONS.slice(),
    financingDuration: { minYears: FINANCING_DURATION.minYears, maxYears: FINANCING_DURATION.maxYears },
    delivery: 'EMAIL',
    referenceNumber: number.slice(0, 100),
    offerDocuments: [{
      fileName: String(filename || 'angebot.pdf').slice(0, 200),
      contentBase64: pdf.toString('base64'),
    }],
  };
  if (financed.assets.length) body.assets = financed.assets;
  if (financed.assetGroups.length) body.assetGroups = financed.assetGroups;

  const idempotencyKey = `offer:${number}:brutto:${financed.bruttoCents}`.slice(0, 200);
  return {
    ok: true,
    body,
    idempotencyKey,
    bruttoCents: financed.bruttoCents,
    brutto: financed.brutto,
  };
}

function messageFromResponse(status, json) {
  const apiMsg = json && json.error && json.error.message ? String(json.error.message).trim() : '';
  if (status === 400) {
    return apiMsg
      ? `Cloover hat ein Feld abgelehnt: ${apiMsg}`
      : 'Cloover hat ein Feld abgelehnt.';
  }
  if (status === 401 || status === 403) return 'Cloover: Schlüssel oder Einladung.';
  if (status === 422) {
    return apiMsg
      ? `Cloover: für diese Anlage ist keine Rate hinterlegt. (${apiMsg})`
      : 'Cloover: für diese Anlage ist keine Rate hinterlegt.';
  }
  if (status === 409) return 'Cloover: dieses Angebot ist schon angelegt, der gespeicherte Link fehlt.';
  if (!status) return 'Cloover ist nicht erreichbar.';
  return apiMsg
    ? `Cloover hat mit Status ${status} geantwortet: ${apiMsg}`
    : `Cloover hat mit Status ${status} geantwortet.`;
}

async function clooverRequest(path, { method, body, idempotencyKey, apiKey, fetchImpl }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Cloover-User-Email': USER_EMAIL,
    Accept: 'application/json',
  };
  if (body) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetchImpl(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch (_) {
    return { ok: false, status: 0, json: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Legt das Projekt an oder nutzt den gespeicherten Link derselben Angebotsnummer
 * und desselben Bruttos. Ein anderer Brutto ist ein neues Projekt.
 */
async function runClooverCreate(input, deps) {
  const enabled = deps && deps.enabled != null ? !!deps.enabled : isClooverTestInstance();
  if (!enabled) return { active: false };

  const prepared = prepareClooverProject(input);
  if (!prepared.ok) return { active: true, ok: false, message: prepared.message };

  const loadStored = deps && deps.loadStored;
  const stored = typeof loadStored === 'function'
    ? loadStored(String(input.angebotsnummer || '').trim(), prepared.bruttoCents)
    : null;
  if (stored && stored.checkoutUrl) {
    const url = String(stored.checkoutUrl);
    return {
      active: true,
      ok: true,
      reused: true,
      resend: false,
      url,
      projectId: stored.projectId || '',
      sentence: clooverFinanceSentence(url),
    };
  }

  const latest = deps && typeof deps.loadLatest === 'function'
    ? deps.loadLatest(String(input.angebotsnummer || '').trim())
    : null;
  const resend = !!(latest && Number(latest.bruttoCents) !== prepared.bruttoCents);

  const apiKey = readApiKey(deps && Object.prototype.hasOwnProperty.call(deps, 'apiKey') ? deps.apiKey : undefined);
  if (!apiKey) {
    return {
      active: true,
      ok: false,
      message: 'Cloover-Testschlüssel fehlt in der Server-Umgebung (CLOOVER_API_KEY).',
    };
  }

  const fetchImpl = (deps && deps.fetchImpl) || fetch;
  const res = await clooverRequest('/projects', {
    method: 'POST',
    body: prepared.body,
    idempotencyKey: prepared.idempotencyKey,
    apiKey,
    fetchImpl,
  });
  const url = res.json && res.json.checkoutLink && res.json.checkoutLink.url
    ? String(res.json.checkoutLink.url).trim()
    : '';
  const projectId = res.json && res.json.projectId ? String(res.json.projectId) : '';
  if (res.ok && url && projectId) {
    if (deps && typeof deps.saveStored === 'function') {
      deps.saveStored({
        angebotsnummer: String(input.angebotsnummer || '').trim(),
        bruttoCents: prepared.bruttoCents,
        projectId,
        checkoutUrl: url,
      });
    }
    return {
      active: true,
      ok: true,
      reused: false,
      resend,
      url,
      projectId,
      sentence: clooverFinanceSentence(url),
      message: resend ? 'Cloover schickt die Finanzierungs-Mail noch einmal.' : '',
    };
  }
  return { active: true, ok: false, message: messageFromResponse(res.status, res.json) };
}

function quoteBodyFromOffer(offer) {
  const financed = buildFinancedAssets(offer);
  if (!financed.ok) return null;
  // Der Preisrechner kennt keine assetGroups. Solar und Speicher bleiben ein Preis
  // und werden dafür nicht auf zwei Positionen verteilt. Ohne passende Anfrage keine Rate.
  if (financed.assetGroups.length) return null;
  return {
    durationYears: QUOTE_DURATION_YEARS,
    assets: financed.assets,
  };
}

async function runClooverQuote(offer, deps) {
  const enabled = deps && deps.enabled != null ? !!deps.enabled : isClooverTestInstance();
  if (!enabled) return { active: false, monthlyPayment: null };
  const body = quoteBodyFromOffer(offer);
  if (!body) return { active: true, monthlyPayment: null };
  const apiKey = readApiKey(deps && Object.prototype.hasOwnProperty.call(deps, 'apiKey') ? deps.apiKey : undefined);
  if (!apiKey) return { active: true, monthlyPayment: null };
  const fetchImpl = (deps && deps.fetchImpl) || fetch;
  const res = await clooverRequest('/price-calculator', {
    method: 'POST',
    body,
    apiKey,
    fetchImpl,
  });
  const monthly = res.json && Number(res.json.monthlyPayment);
  if (!res.ok || !Number.isFinite(monthly)) return { active: true, monthlyPayment: null };
  return {
    active: true,
    monthlyPayment: monthly,
    rateType: res.json.rateType === 'exact' ? 'exact' : (res.json.rateType === 'from' ? 'from' : ''),
  };
}

function describeProjectStatus(project) {
  const p = project || {};
  const apps = Array.isArray(p.applicants) ? p.applicants : [];
  if (apps.length && apps.every((a) => a && a.contractSigned)) return 'Vertrag unterschrieben';
  if (p.checkoutStep === 'contract_signature') return 'Unterschrift ausstehend';
  const stages = {
    offer: 'Angebot',
    checkout: 'Checkout',
    approval: 'Prüfung',
    project_plan: 'Projektplan',
    installation: 'Installation',
    closed: 'Abgeschlossen',
  };
  return stages[p.stage] || '';
}

async function runClooverStatus(projectId, deps) {
  const enabled = deps && deps.enabled != null ? !!deps.enabled : isClooverTestInstance();
  if (!enabled) return { active: false };
  const id = String(projectId || '').trim();
  if (!id) return { active: true, ok: false, message: '' };
  const apiKey = readApiKey(deps && Object.prototype.hasOwnProperty.call(deps, 'apiKey') ? deps.apiKey : undefined);
  if (!apiKey) {
    return { active: true, ok: false, message: 'Cloover-Testschlüssel fehlt in der Server-Umgebung (CLOOVER_API_KEY).' };
  }
  const fetchImpl = (deps && deps.fetchImpl) || fetch;
  const res = await clooverRequest(`/projects/${encodeURIComponent(id)}`, {
    method: 'GET',
    apiKey,
    fetchImpl,
  });
  if (!res.ok || !res.json) {
    return { active: true, ok: false, message: messageFromResponse(res.status, res.json) };
  }
  const text = describeProjectStatus(res.json);
  return {
    active: true,
    ok: true,
    stage: res.json.stage || '',
    checkoutStep: res.json.checkoutStep || '',
    text,
    project: res.json,
  };
}

module.exports = {
  API_BASE,
  USER_EMAIL,
  API_KEY_ENV,
  PAYMENT_OPTIONS,
  FINANCING_DURATION,
  QUOTE_DURATION_YEARS,
  FINANCE_SENTENCE_LEAD,
  isClooverTestInstance,
  netFromGross,
  clooverFinanceSentence,
  ensureFinanceSentence,
  splitStreetAndNumber,
  countryFromZip,
  buildFinancedAssets,
  prepareClooverProject,
  runClooverCreate,
  runClooverQuote,
  runClooverStatus,
  describeProjectStatus,
  messageFromResponse,
};
