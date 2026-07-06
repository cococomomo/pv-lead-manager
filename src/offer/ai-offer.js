'use strict';

require('../load-env');
const { getLlmConfig } = require('../app-settings');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT_OFFER = `Du bist der Angebots-Assistent von NOORTEC (Photovoltaik, Wien/Österreich).
Aus einem freien Sprach-/Textbefehl des Vertriebs extrahierst du strukturierte Daten für ein PV-Angebot.

Trenne strikt zwischen KUNDENDATEN und ANLAGEN-ANFORDERUNGEN.

Ausgabe: NUR valides JSON (kein Markdown), exakt dieses Schema (unbekannt = null):
{
  "customer": {
    "name": "Vorname Nachname",
    "street": "Straße + Hausnummer",
    "zip": "PLZ",
    "city": "Ort",
    "email": "E-Mail",
    "phone": "Telefon (+43…)"
  },
  "requirements": {
    "brand": "sigenergy | fronius | null",
    "kwp": Zahl in kWp oder null,
    "module_count": Anzahl Module als Zahl oder null,
    "speicher": Zahl in kWh oder null,
    "brutto_preis": Ziel-Gesamtpreis brutto in EUR oder null (z. B. "26000 brutto", "um 24.500 €"),
    "dach": "Ziegel | Welleternit | Eternit | Schindel-Eternit | Rhombus | Biberschwanz | Wiener Tasche | Prefa | Flachdach | Trapezblech | null",
    "moduleType": "das | aiko | null",
    "optionen": {
      "wallbox": true|false,
      "notstrom": true|false,
      "speichererweiterung": true|false,
      "ohmpilot": true|false,
      "ueberspannungsschutz": true|false,
      "lasttrennschalter": true|false,
      "fi_schalter": true|false,
      "zaehlerbrett": true|false,
      "waermepumpe_anschluss": true|false
    },
    "standardOptionen": true|false|null,
    "notes": "kurze Zusammenfassung weiterer Wünsche"
  },
  "contactType": "telefonisch | schriftlich | null"
}

Regeln:
- Marke: Wenn nichts genannt → "sigenergy". "Fronius" nur wenn ausdrücklich gewünscht.
- Telefonnummern in +43… normalisieren.
- "AIKO" → moduleType "aiko", sonst "das".
- kwp/speicher als reine Zahlen (z. B. "10 kWp Anlage mit 9 kWh Speicher" → kwp:10, speicher:9). "9 kw speicher" bedeutet 9 kWh Speicher.
- Sigenergy-Speicher können gestapelt werden: 9+6=15 kWh, 9+9=18 kWh, 9+6+6=21 kWh. Gib die gewünschte Gesamtkapazität in speicher an (z. B. 15, nicht 12).
- brutto_preis: wenn ein Zielpreis genannt wird ("26000 brutto", "um 24.500 €", "für 23000") → Zahl ohne Währung.
- module_count = genannte Modulanzahl (z. B. "22 Module" → 22), sonst null.
- "E-Ladestation", "Ladestation", "Wallbox" → optionen.wallbox = true.
- "Wärmepumpe" / "WP-Anschluss" / "Anschluss Wärmepumpe" → optionen.waermepumpe_anschluss = true (wir liefern nur den Anschluss, keine Wärmepumpe).
- "Zählerbrett" / "Zählerverteiler" / "Zählerplatz" → optionen.zaehlerbrett = true.
- "FI-Schalter" / "Fehlerstromschutzschalter" → optionen.fi_schalter = true.
- "Speichererweiterung" / "mehr Speicher zusätzlich" → optionen.speichererweiterung = true.
- optionen-Felder nur true, wenn ausdrücklich erwähnt; sonst false.
- contactType: "telefonisch" wenn Hinweis auf Telefonat/telefonisch besprochen, sonst "schriftlich" bei reiner Schriftanfrage, sonst null.
- Erfinde keine Daten.`;

function parseJsonFromLlm(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) t = t.slice(first, last + 1);
  return JSON.parse(t);
}

async function chatCompletionJson(systemPrompt, userContent) {
  const cfg = getLlmConfig();
  const provider = cfg.provider;

  if (provider === 'anthropic') {
    if (!cfg.apiKey) throw new Error('Kein KI-API-Key gesetzt (Admin → KI-Einstellungen oder ANTHROPIC_API_KEY in .env)');
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: cfg.apiKey });
    const model = cfg.model || 'claude-haiku-4-5-20251001';
    const response = await client.messages.create({
      model,
      max_tokens: 1500,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const block = response.content.find((b) => b.type === 'text');
    return block ? block.text : '';
  }

  // openai-compatible (DeepSeek Default)
  const base = (cfg.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');
  const key = cfg.apiKey;
  const model = cfg.model || DEEPSEEK_MODEL;
  if (!key || !String(key).trim()) {
    throw new Error('Kein KI-API-Key gesetzt (Admin → KI-Einstellungen oder DEEPSEEK_API_KEY in .env)');
  }
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 1500,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
  };
  const allowJsonObject = String(process.env.LLM_JSON_OBJECT || '1').trim() !== '0';
  if (allowJsonObject && /deepseek|gpt|openai/i.test(String(model))) {
    body.response_format = { type: 'json_object' };
  }
  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`LLM HTTP ${res.status}: ${msg}`);
  }
  return data.choices?.[0]?.message?.content || '';
}

function bool(v) { return v === true || v === 'true' || v === 1 || v === '1'; }

/** Brutto-Zielpreis aus Freitext (Fallback wenn KI kein brutto_preis liefert). */
function extractBruttoFromText(text) {
  const s = String(text || '');
  const patterns = [
    /(?:um|für|zu|preis|gesamt|kosten)\s*(?:von\s*)?(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\s*brutto/i,
    /(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)?\s*brutto/i,
    /brutto\s*(?:von|ca\.?|:)?\s*(\d+(?:[.,]\d{1,2})?)/i,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const n = Number(String(m[1]).replace(/\s/g, '').replace(/\./g, '').replace(',', '.'));
    if (Number.isFinite(n) && n >= 1000) return n;
  }
  return null;
}

function parseMoneyLike(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(/\./g, '').replace(',', '.').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n >= 1000 ? n : null;
}

function normalizeOffer(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const c = r.customer && typeof r.customer === 'object' ? r.customer : {};
  const req = r.requirements && typeof r.requirements === 'object' ? r.requirements : {};
  const opt = req.optionen && typeof req.optionen === 'object' ? req.optionen : {};
  const str = (v) => (v == null ? '' : String(v).trim());
  const numOrNull = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const brand = (() => {
    const s = str(req.brand).toLowerCase();
    if (s.includes('fronius')) return 'fronius';
    if (s.includes('sigen')) return 'sigenergy';
    return s || null;
  })();
  return {
    customer: {
      name: str(c.name),
      street: str(c.street),
      zip: str(c.zip),
      city: str(c.city),
      email: str(c.email).toLowerCase(),
      phone: str(c.phone),
    },
    requirements: {
      brand: brand || 'sigenergy',
      kwp: numOrNull(req.kwp),
      module_count: numOrNull(req.module_count),
      speicher: numOrNull(req.speicher),
      brutto_preis: parseMoneyLike(req.brutto_preis),
      dach: str(req.dach) || null,
      moduleType: str(req.moduleType).toLowerCase() === 'aiko' ? 'aiko' : 'das',
      optionen: {
        wallbox: bool(opt.wallbox),
        notstrom: bool(opt.notstrom),
        speichererweiterung: bool(opt.speichererweiterung),
        ohmpilot: bool(opt.ohmpilot),
        ueberspannungsschutz: bool(opt.ueberspannungsschutz),
        lasttrennschalter: bool(opt.lasttrennschalter),
        fi_schalter: bool(opt.fi_schalter),
        zaehlerbrett: bool(opt.zaehlerbrett),
        waermepumpe_anschluss: bool(opt.waermepumpe_anschluss),
      },
      standardOptionen: req.standardOptionen == null ? null : bool(req.standardOptionen),
      notes: str(req.notes),
    },
    contactType: ['telefonisch', 'schriftlich'].includes(str(r.contactType).toLowerCase())
      ? str(r.contactType).toLowerCase() : null,
  };
}

/** Freitext → strukturierte Angebotsdaten (Kundendaten + Anforderungen). */
async function parseOfferCommand(commandText) {
  const text = String(commandText || '').trim();
  if (!text) throw new Error('Kein Text/Sprachbefehl übergeben');
  const out = await chatCompletionJson(SYSTEM_PROMPT_OFFER, text);
  const raw = parseJsonFromLlm(out);
  const normalized = normalizeOffer(raw);
  if (!normalized.requirements.brutto_preis) {
    normalized.requirements.brutto_preis = extractBruttoFromText(text);
  }
  return normalized;
}

module.exports = {
  parseOfferCommand,
  chatCompletionJson,
  parseJsonFromLlm,
  extractBruttoFromText,
  SYSTEM_PROMPT_OFFER,
};
