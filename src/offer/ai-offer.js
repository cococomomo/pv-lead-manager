'use strict';

require('../load-env');
const { getLlmConfig } = require('../app-settings');
const catalog = require('./catalog');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

const SYSTEM_PROMPT_OFFER = `Du bist der Angebots-Assistent von NOORTEC (Photovoltaik + Klimageräte LG STANDARD II, Wien/Österreich).
Aus einem freien Sprach-/Textbefehl des Vertriebs extrahierst du strukturierte Daten für ein Angebot.
Angebote können NUR PV, NUR Klima oder KOMBI (PV + Klima) sein.

Trenne strikt zwischen KUNDENDATEN und ANFORDERUNGEN.

Ausgabe: NUR valides JSON (kein Markdown), exakt dieses Schema (unbekannt = null):
{
  "customer": {
    "vorname": "Vorname oder null",
    "nachname": "Nachname oder null",
    "name": "Vorname Nachname (Fallback, wenn getrennt unklar)",
    "street": "Straße + Hausnummer",
    "zip": "PLZ",
    "city": "Ort",
    "email": "E-Mail",
    "phone": "Telefon (+43…)"
  },
  "requirements": {
    "includePv": true|false|null,
    "brand": "sigenergy | fronius | huawei | fronius_symo | null",
    "kwp": Zahl in kWp oder null,
    "module_count": Gesamtanzahl Module/Paneele als Zahl oder null,
    "speicher": Zahl in kWh oder 0 bei ohne Speicher oder null,
    "brutto_preis": Ziel-Gesamtpreis brutto in EUR oder null,
    "dach": "Ziegel | … | Flachdach | Flachdach Ost-West | Flachdach Südaufständerung | Freifläche Ost-West | Freifläche Süd | Trapezblech | Falzblech | null",
    "dachSegmente": [
      { "dach": "Falzblech | Flachdach Ost-West | Flachdach Südaufständerung | Freifläche Ost-West | Freifläche Süd | Ziegel | …", "modules": Zahl }
    ],
    "moduleType": "das | aiko | null",
    "inverter_kw": "Nennleistung Wechselrichter in kW (z. B. 8) oder null",
    "optionen": {
      "wallbox": true|false,
      "notstrom": true|false,
      "speichererweiterung": true|false,
      "optimierer": true|false,
      "ohmpilot": true|false,
      "ueberspannungsschutz": true|false,
      "lasttrennschalter": true|false,
      "fi_schalter": true|false,
      "zaehlerbrett": true|false,
      "waermepumpe_anschluss": true|false
    },
    "optionDetails": [
      {
        "key": "notstrom | wallbox | speichererweiterung | speicher_upgrade | optimierer | … | null",
        "label": "optionaler Anzeigename oder null",
        "mode": "optional | fix",
        "price": Zahl oder null,
        "hint": "Hinweistext der im Angebot bei dieser Komponente erscheinen soll",
        "upgradeFrom": "nur bei speicher_upgrade: Basis-kWh",
        "upgradeTo": "nur bei speicher_upgrade: Ziel-kWh"
      }
    ],
    "customOptions": [
      { "label": "Freie Position", "mode": "optional|fix", "price": Zahl oder null, "hint": "Hinweistext" }
    ],
    "offerNotes": ["Allgemeiner Hinweis fürs Angebot (ohne eigene Preisposition)"],
    "standardOptionen": true|false|null,
    "klima": {
      "wanted": true|false,
      "mode": "fix | optional | null",
      "packageId": "lg-std2-single-25 | lg-std2-single-35 | lg-std2-multi-41 | lg-std2-multi-63 | null",
      "outdoorKw": Zahl oder null,
      "indoor": [{ "kw": Zahl, "qty": Zahl }],
      "extraPipingMeters": Zahl oder null,
      "condensatePump": true|false|null,
      "notes": "kurz"
    },
    "notes": "kurze Zusammenfassung weiterer Wünsche"
  },
  "clarifications": [
    {
      "id": "kurze_id_oder_null",
      "question": "Konkrete Rückfrage an den Vertrieb",
      "answers": [
        { "label": "Kurzer Button-Text", "text": "Satz der ans Ende des Befehls angehängt wird" }
      ]
    }
  ],
  "contactType": "telefonisch | schriftlich | null"
}

Klimapakete (LG STANDARD II, Brutto-Installationspreis):
- lg-std2-single-25: 1× Außen 2,5 kW + 1× Innen 2,5 kW → 2400 €
- lg-std2-single-35: 1× Außen 3,5 kW + 1× Innen 3,5 kW → 2600 €
- lg-std2-multi-41: 1× Außen 4,1 kW + 2× Innen 2,5 kW → 4500 €
- lg-std2-multi-63: 1× Außen 6,3 kW + 2× Innen 2,5 kW + 1× Innen 3,5 kW → 7200 €
Zubehör: Kältemittelleitung inkl. 10 m je Innengerät, jeder weitere Meter 40 €; Kondensatwasserpumpe 240 €.

Regeln:
- Marke PV:
  • Hybrid mit Speicher: Default "sigenergy"; "Fronius"/"GEN24"/"Reserva" → "fronius".
  • Ohne Speicher: "Huawei"/"SUN2000" → "huawei"; "Fronius Symo" (ohne GEN24/Reserva) → "fronius_symo".
  • "ohne Speicher"/"kein Speicher"/"nur PV" → speicher=0 und Marke huawei (Default) bzw. fronius_symo wenn Symo genannt.
- Telefonnummern in +43… normalisieren.
- "AIKO" → moduleType "aiko", sonst "das".
- kwp/speicher als reine Zahlen. "9 kw speicher" = 9 kWh Speicher. Ohne Speicher: speicher=0.
  Sigenergy: NUR Module 6 kWh und 9 kWh, beliebig kombinierbar.
  Beispiele → speicher = Gesamtkapazität (eine Zahl):
  "6+9" / "9+6" → 15; "9+9" / "2×9" / "2x9" → 18; "6+6" / "2×6" → 12;
  "9+6+6" → 21; "18 kWh" → 18.
  Fronius Reserva: NUR Module à 3,2 kWh. Tower-Stufen: 6,4 (2 Mod.) / 9,5 (3) / 12,6 (4) / 15,8 (5).
  Bis zu 3 Speichertower kombinierbar. "Reserva 12,6" / "4 Module Fronius" → speicher 12.6;
  "6 Module Fronius" / "19 kWh Fronius" → speicher ≈ 19 (15,8 + 3,2).
  NICHT speichererweiterung setzen, wenn die genannte Größe die Haupt-Speicherkonfiguration ist.
  speichererweiterung nur bei expliziter optionaler Nachrüstung ("später +6 nachrüsten", "optional +3,2", "optional erweiterbar").
- "12 Paneele/Module" → module_count: 12.
- MEHRERE DACHFLÄCHEN / UNTERKONSTRUKTIONEN:
  Formulierungen wie "6 Module auf Falzblech und 14 Module auf Flachdach" →
  dachSegmente: [{ dach: "Falzblech", modules: 6 }, { dach: "Flachdach", modules: 14 }],
  module_count: 20 (Summe). Einzelnes Dach weiterhin in "dach".
  Falzblech und Trapezblech sind unterschiedliche Typen – Falzblech nicht zu Trapezblech umbiegen.
  Flachdach-/Freiflächen-Ausrichtung (eigene Dachsegmente / Unterkonstruktionen):
  - "Ost-West" / "Ost/West" / "Südost" / "Südostaufstellung" → dach "Flachdach Ost-West" (bzw. Freifläche Ost-West)
  - "Süd" / "Südaufstellung" / "Südaufständerung" → dach "Flachdach Südaufständerung" (bzw. Freifläche Süd)
  - Ohne Ausrichtung nur "Flachdach" → "Flachdach"
  Beispiel: "6 Module Falzblech, Flachdach 11 Module Südostaufstellung und 3 Module Südaufstellung" →
  dachSegmente: [
    { dach: "Falzblech", modules: 6 },
    { dach: "Flachdach Ost-West", modules: 11 },
    { dach: "Flachdach Südaufständerung", modules: 3 }
  ], module_count: 20.
  WICHTIG – KEINE DOPPELZÄHLUNG:
  Wenn eine Gesamtzahl genannt wird UND danach die Aufschlüsselung
  („14 Module auf dem Flachdach, wobei 11 Südost und 3 Süd“), dann NUR die Aufschlüsselung
  in dachSegmente schreiben (11 + 3), NICHT zusätzlich die 14.
  module_count = Summe aller Segmente.
  Unterkonstruktionen = genau 1 Stück pro Modul; Summe der Segment-Module MUSS module_count entsprechen.
- WECHSELRICHTER: "8 kW Wechselrichter" / "Wechselrichter 8 kW" → inverter_kw: 8 (niemals als module_count!).
  Speicher-kWh und Euro-Beträge niemals als Modulanzahl werten.
- OPTIMIERER (Leistungsoptimierer, 1 pro Modul, 60 € brutto/Stück – Server berechnet):
  Synonyme: "Optimierer", "Optimizer", "Leistungsoptimierer", "ein Optimierer pro Modul".
  → optionen.optimierer=true UND optionDetails key=optimierer, mode=fix (außer explizit "optional"),
  price=null (Server: 60 × Modulanzahl), hint z. B. "Ein Optimierer pro Modul für optimale Leistung."
  NICHT nur in offerNotes schreiben – immer als Preisposition.
- includePv: false wenn NUR Klima gewünscht; true bei PV oder Kombi; null wenn unklar.
- Klima-Erkennung: Formulierungen wie "zweimal 2,5 kW Innengerät und 4,1 kW Außengerät" → outdoorKw:4.1, indoor:[{kw:2.5,qty:2}], packageId lg-std2-multi-41.
- Wenn Klima erwähnt aber Paket nicht eindeutig zuordenbar → packageId null UND clarifications mit konkreten Rückfragen UND answers-Buttons (z. B. die 4 Klimapakete).
- Wenn Klima und PV gemischt ("PV mit 12 Modulen plus optional Klima…") → includePv true, klima.wanted true, klima.mode "optional" wenn "optional" gesagt, sonst "fix".
- optionen.* nur true wenn ausdrücklich erwähnt (außer Synonyme unten).
- NOTSTROM / GATEWAY / UMSCHALTBOX (alles → optionen.notstrom = true):
  Synonyme: "Notstrom", "Notstrombox", "Gateway", "SIG Energy Gateway", "Sigen Gateway", "SigenStor Gateway",
  "Umschaltbox", "Fronius Umschaltbox", "Fronius Backup", "Backup-Box", "Ersatzstrom", "Inselbetrieb".
  Wenn "optional"/"auf Wunsch" → optionDetails Eintrag key=notstrom, mode=optional.
  Wenn "fix"/"inkludiert"/"dabei" → mode=fix.
- Individuelle Hinweise: Wenn der Vertrieb begründet, wozu eine Komponente dient (z. B. Gateway für Warmwasser/Heizstab + Notstrom),
  schreibe das in optionDetails[].hint (vollständiger Satz fürs PDF). Beispiel:
  hint: "Dieses Gerät wird benötigt, um die Warmwassersteuerung über den Heizstab vorzunehmen, und ist für die Notstromschaltung verantwortlich."
- SPEICHER-UPGRADE (Preisdifferenz, nicht stapeln): Formulierungen wie "optional Upgrade auf 9 kWh", "statt 6er optional 9er",
  "Preisdifferenz 6 auf 9 Speicher" → optionDetails mit key="speicher_upgrade", mode="optional",
  upgradeFrom=6, upgradeTo=9 (Zahlen), hint erklären. Preis darf null sein (Server berechnet Differenz).
- SPEICHERERWEITERUNG (zusätzlicher optionaler/fix Block ZUSÄTZLICH zur Basis – nicht die Hauptgröße):
  Nur wenn klar getrennt von der Basis, z. B. "Basis 9 kWh, optional plus 6 kWh nachrüsten",
  "optional +3,2 kWh Fronius", "Fronius +3,2 nachrüsten" → optionen.speichererweiterung=true
  bzw. optionDetails key=speichererweiterung (bei Sigenergy +6 oder +9 im Label/kwh angeben).
  Sigenergy: +6 (3300) oder +9 (3960); Fronius: immer +3,2 (1320).
  WICHTIG: "6+9 kWh Speicher" / "15 kWh" / "Reserva 12,6" / "18 kWh" ist KEINE speichererweiterung – das ist speicher (Gesamt).
- Weitere freie Hinweise ohne Preisposition → offerNotes[].
- Unbekannte Extrawünsche als customOptions (mit hint) oder offerNotes – nichts erfinden, nur Übernehmen was gesagt wurde.
- clarifications: leeres Array [], wenn alles klar. Sonst 1–3 Objekte mit question + answers (2–6 Buttons).
  answers[].text = kurzer deutscher Nachtrag fürs Befehlsfeld (kein ganzes Angebot neu schreiben).
  answers[].label = max. ~28 Zeichen für den Button.
- contactType: telefonisch / schriftlich / null.
- Erfinde keine Kundendaten.`;

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
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const block = response.content.find((b) => b.type === 'text');
    return block ? block.text : '';
  }

  const base = (cfg.baseUrl || DEEPSEEK_BASE_URL).replace(/\/$/, '');
  const key = cfg.apiKey;
  const model = cfg.model || DEEPSEEK_MODEL;
  if (!key || !String(key).trim()) {
    throw new Error('Kein KI-API-Key gesetzt (Admin → KI-Einstellungen oder DEEPSEEK_API_KEY in .env)');
  }
  const body = {
    model,
    temperature: 0.1,
    max_tokens: 1800,
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

function normalizeKlimaReq(rawKlima, clarifications) {
  const k = rawKlima && typeof rawKlima === 'object' ? rawKlima : {};
  const str = (v) => (v == null ? '' : String(v).trim());
  const numOrNull = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  const indoorRaw = Array.isArray(k.indoor) ? k.indoor : [];
  const indoor = indoorRaw.map((i) => ({
    kw: numOrNull(i && i.kw),
    qty: Math.max(1, Math.round(numOrNull(i && i.qty) || 1)),
  })).filter((i) => i.kw != null && i.kw > 0);

  let packageId = str(k.packageId) || null;
  const outdoorKw = numOrNull(k.outdoorKw);
  if (!packageId && outdoorKw != null && indoor.length) {
    const matched = catalog.matchKlimaPackage({ outdoorKw, indoor });
    if (matched) packageId = matched.id;
  }
  if (packageId && !catalog.getKlimaPackage(packageId)) {
    packageId = null;
  }

  const wanted = k.wanted == null
    ? !!(packageId || outdoorKw || indoor.length || /klima/i.test(str(k.notes)))
    : bool(k.wanted);

  let mode = str(k.mode).toLowerCase();
  if (mode !== 'optional' && mode !== 'fix') mode = 'fix';

  if (wanted && !packageId) {
    clarifications.push({
      id: 'klima_package',
      question: 'Welches Klimapaket genau?',
      answers: [
        { label: 'Single 2,5 kW', text: 'Klimapaket LG Single-Split 2,5 kW (1× Außen 2,5 + 1× Innen 2,5)' },
        { label: 'Single 3,5 kW', text: 'Klimapaket LG Single-Split 3,5 kW (1× Außen 3,5 + 1× Innen 3,5)' },
        { label: 'Multi 4,1 kW', text: 'Klimapaket LG Multi-Split 4,1 kW (1× Außen 4,1 + 2× Innen 2,5)' },
        { label: 'Multi 6,3 kW', text: 'Klimapaket LG Multi-Split 6,3 kW (1× Außen 6,3 + 2× Innen 2,5 + 1× Innen 3,5)' },
      ],
    });
  }

  return {
    wanted,
    mode,
    packageId,
    outdoorKw,
    indoor,
    extraPipingMeters: numOrNull(k.extraPipingMeters),
    condensatePump: k.condensatePump == null ? null : bool(k.condensatePump),
    notes: str(k.notes),
  };
}

function detectNotstromFromText(text) {
  const t = String(text || '').toLowerCase();
  return /notstrom|umschaltbox|gateway|ersatzstrom|backup[\s-]?box|inselbetrieb|sigen\s*gateway|sig\s*energy\s*gateway|fronius\s*(backup|umschalt)/i.test(t);
}

/**
 * Liest Speicher-Gesamt-kWh aus Freitext (Sigenergy 6/9-Kombinationen).
 * Beispiele: "6+9 kWh", "9+9", "2×9 kWh Speicher", "18 kWh Speicher", "Speicher 15".
 * Ignoriert reine Upgrade-Formulierungen ("optional Upgrade 6 auf 9").
 */
function extractSpeicherKwhFromText(text) {
  const raw = String(text || '');
  const t = raw.toLowerCase().replace(/,/g, '.');
  if (!t.trim()) return null;

  // Upgrade-Sätze nicht als Gesamtspeicher werten
  if (/(?:upgrade|preisdifferenz|statt)\s*[^\n.]{0,40}?\d+(?:\.\d+)?\s*(?:kwh|kw)?[^\d\n]{0,20}?(?:auf|→|->|zu)\s*\d+/i.test(t)
    && !/\d+\s*\+\s*\d+/.test(t)
    && !/\d+\s*[x×]\s*\d+/.test(t)) {
    return null;
  }

  const num = (s) => {
    const n = Number(String(s).replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };

  // 2×9 / 2x 6 kWh
  const times = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(?:kwh|kw)?/);
  if (times) {
    const a = num(times[1]);
    const b = num(times[2]);
    if (a != null && b != null && a > 0 && b > 0) {
      const total = Math.round(a * b * 10) / 10;
      if (total >= 3 && total <= 120) return total;
    }
  }

  // 6+9 / 9+6+6 / 9 + 9 kWh (auch ohne "kWh" direkt hinter der Summe, wenn "Speicher" im Kontext)
  const plusChunk = t.match(
    /(\d+(?:\.\d+)?(?:\s*\+\s*\d+(?:\.\d+)?)+)\s*(?:kwh|kw)?/
  );
  if (plusChunk) {
    const around = t.slice(Math.max(0, plusChunk.index - 24), (plusChunk.index || 0) + plusChunk[0].length + 24);
    if (/speicher|kwh|bat|sigen|battery|akku/.test(around) || /kwh|kw/.test(plusChunk[0])) {
      const parts = plusChunk[1].split(/\s*\+\s*/).map(num).filter((n) => n != null && n > 0);
      if (parts.length >= 2) {
        const total = Math.round(parts.reduce((s, n) => s + n, 0) * 10) / 10;
        if (total >= 3 && total <= 120) return total;
      }
    }
  }

  // "6 und 9 kWh Speicher"
  const und = t.match(/(\d+(?:\.\d+)?)\s*und\s*(\d+(?:\.\d+)?)\s*(?:kwh|kw)?[^\n.]{0,20}speicher/);
  if (und) {
    const a = num(und[1]);
    const b = num(und[2]);
    if (a != null && b != null) return Math.round((a + b) * 10) / 10;
  }

  // "Speicher 18 kWh" / "18 kWh Speicher" / "mit 15 kWh" / "Reserva 12,6"
  const reserva = t.match(/reserva\s*(\d+(?:\.\d+)?)/)
    || t.match(/fronius[^\d]{0,20}(\d+(?:\.\d+)?)\s*kwh/);
  if (reserva) {
    const n = num(reserva[1]);
    if (n != null && n >= 3 && n <= 120) return n;
  }

  const plain = t.match(/speicher(?:\s*(?:größe|kapazität|mit))?\s*(?:von\s*)?(\d+(?:\.\d+)?)\s*(?:kwh|kw)?/)
    || t.match(/(\d+(?:\.\d+)?)\s*kwh\s*(?:speicher|bat|akku|sigen|reserva)/)
    || t.match(/(?:mit|plus)\s*(\d+(?:\.\d+)?)\s*kwh\s*speicher/);
  if (plain) {
    const n = num(plain[1]);
    if (n != null && n >= 3 && n <= 120) return n;
  }

  // "4 Module Fronius/Reserva" / "5 Batteriemodule"
  const modCount = t.match(/(\d+)\s*(?:batterie)?module?\s*(?:fronius|reserva|speicher)?/)
    || t.match(/fronius[^\n]{0,30}?(\d+)\s*(?:batterie)?module/);
  if (modCount && /fronius|reserva|batterie|speicher/.test(t)) {
    const m = num(modCount[1]);
    if (m != null && m >= 2 && m <= 15) {
      const map = { 2: 6.4, 3: 9.5, 4: 12.6, 5: 15.8 };
      if (map[m]) return map[m];
      return Math.round((15.8 + (m - 5) * 3.2) * 10) / 10;
    }
  }

  return null;
}

/** True, wenn speichererweiterung nur die Hauptgröße beschreibt (kein separates Nachrüst-Option). */
function isMainStorageComboText(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  if (/nachrüst|später\s+erweiter|optional\s+(?:noch\s+)?(?:\+|plus)|auf\s+wunsch\s+(?:\+|plus)/i.test(t)) {
    return false;
  }
  return /\d+\s*\+\s*\d+/.test(t)
    || /\d+\s*[x×]\s*\d+/.test(t)
    || /\d+(?:\.\d+)?\s*und\s*\d+(?:\.\d+)?\s*(?:kwh|kw)/.test(t)
    || /\d+(?:\.\d+)?\s*kwh\s*speicher|speicher\s*\d+(?:\.\d+)?/.test(t);
}

/** Orientierung aus Kontext (Südaufständerung / Ost-West). Südost → Ost-West. */
function detectDachOrientation(context) {
  const t = String(context || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
  if (/ost\s*-?\s*west|ostwest|\bo\s*\/\s*w\b|east\s*-?\s*west|suedost|southeast/.test(t)) {
    return 'ost-west';
  }
  if (/suedaufst|sued\s*aufst|aufstaender|suedausricht|ausrichtung\s*sued|(?:^|[^a-z])sued(?:[^a-z]|$)|sued\s*flach|\bsouth\b/.test(t)) {
    return 'sued';
  }
  return null;
}

function baseDachFromMatch(raw) {
  const s = String(raw || '').toLowerCase().replace(/ä/g, 'ae').replace(/ü/g, 'ue');
  if (/freiflaeche|freiland/.test(s)) return 'Freifläche';
  if (s.includes('falz')) return 'Falzblech';
  if (s.includes('flach')) return 'Flachdach';
  if (s.includes('trapez')) return 'Trapezblech';
  if (s.includes('welleternit')) return 'Welleternit';
  if (s.includes('eternit')) return 'Schindel-Eternit';
  if (s.includes('rhombus')) return 'Rhombus';
  if (s.includes('biberschwanz')) return 'Biberschwanz';
  if (s.includes('wiener') || s.includes('tasche')) return 'Wiener Tasche';
  if (s.includes('prefa')) return 'Prefa';
  if (s.includes('ziegel')) return 'Ziegel';
  return null;
}

function dachLabelWithOrientation(base, orient) {
  if (base === 'Flachdach') {
    if (orient === 'ost-west') return 'Flachdach Ost-West';
    if (orient === 'sued') return 'Flachdach Südaufständerung';
  }
  if (base === 'Freifläche') {
    if (orient === 'ost-west') return 'Freifläche Ost-West';
    if (orient === 'sued') return 'Freifläche Süd';
  }
  return base;
}

function pushDachMatch(raw, modules, base, orient) {
  if (!base || !Number.isFinite(modules) || modules <= 0) return;
  raw.push({
    dach: dachLabelWithOrientation(base, orient),
    modules,
  });
}

/**
 * Mehrere Dachflächen aus Freitext.
 * Erkennt sowohl „11 Module … Flachdach“ als auch „Flachdach 11 Module Südost…“.
 * Verhindert Doppelzählung bei Gesamt + Aufschlüsselung.
 */
function extractDachSegmenteFromText(sourceText) {
  const text = String(sourceText || '');
  if (!text.trim()) return [];
  const typeRe = '(freifl[aä]che|falzblech(?:dach)?|flachdach|trapezblech|welleternit|schindel[-\\s]?eternit|eternit|rhombus|biberschwanz|wiener\\s*tasche|prefa|ziegel)';
  const raw = [];

  // A) Zahl → … → Dachtyp  („6 Module auf Falzblech“, „3 Module Südaufstellung Flachdach“)
  const reNumFirst = new RegExp(
    `(\\d+)\\s*(?:module|paneele|stk\\.?)?([^\\d\\n]{0,55}?)(?:auf(?:\\s+dem|\\s+der|\\s+den)?|für)?\\s*(${typeRe})`,
    'gi'
  );
  let m;
  while ((m = reNumFirst.exec(text)) !== null) {
    const modules = Number(m[1]);
    const between = m[2] || '';
    const typeRaw = m[3];
    const base = baseDachFromMatch(typeRaw);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 40);
    const orient = detectDachOrientation(`${between} ${typeRaw} ${after}`);
    pushDachMatch(raw, modules, base, orient);
  }

  // B) Dachtyp → Zahl → … Orientierung  („Flachdach 11 Module Südostaufstellung“)
  const reTypeFirst = new RegExp(
    `(${typeRe})\\s+(\\d+)\\s*(?:module|paneele|stk\\.?)?([^\\d\\n]{0,45})`,
    'gi'
  );
  while ((m = reTypeFirst.exec(text)) !== null) {
    const base = baseDachFromMatch(m[1]);
    const modules = Number(m[2]);
    const after = m[3] || '';
    const orient = detectDachOrientation(`${m[1]} ${after}`);
    const already = raw.some((r) => r.modules === modules && baseDachFromMatch(r.dach) === base);
    if (already && !orient) continue;
    if (already && orient) {
      const idx = raw.findIndex((r) => r.modules === modules && baseDachFromMatch(r.dach) === base && r.dach === base);
      if (idx >= 0) {
        raw[idx] = { dach: dachLabelWithOrientation(base, orient), modules };
        continue;
      }
      if (raw.some((r) => r.modules === modules && r.dach === dachLabelWithOrientation(base, orient))) continue;
    }
    pushDachMatch(raw, modules, base, orient);
  }

  // C) „N Module … Süd-/Ost-West-Ausrichtung“ ohne Dachwort → Flachdach-Variante
  const reOrientOnly = /(\d+)\s*(?:module|paneele|stk\.?)([^\d\n]{0,55}?(?:s[üu]dost|ost\s*-?\s*west|s[üu]d)[^\d\n]{0,30}?(?:ausricht|aufstell|aufst(?:a|ä)end)?)/gi;
  while ((m = reOrientOnly.exec(text)) !== null) {
    const modules = Number(m[1]);
    const ctx = m[2] || '';
    if (new RegExp(typeRe, 'i').test(ctx)) continue;
    if (/wechselrichter|inverter|\bk\s*[wv]\b|speicher|euro|€/i.test(ctx)) continue;
    const orient = detectDachOrientation(ctx);
    if (!orient) continue;
    if (raw.some((r) => r.modules === modules)) continue;
    pushDachMatch(raw, modules, 'Flachdach', orient);
  }

  return catalog.reconcileDachSegmente(raw, null);
}

/** „8 kW Wechselrichter“ – nicht als Module zählen. */
function extractInverterKwFromText(sourceText) {
  const text = String(sourceText || '');
  const m = text.match(
    /(\d+(?:[.,]\d+)?)\s*k\s*[wv]\s*(?:peak\s*)?(?:hybrid[\s-]*)?(?:wechselrichter|inverter|wr)\b|\b(?:wechselrichter|inverter|wr)\s*(?:mit\s*)?(\d+(?:[.,]\d+)?)\s*k\s*[wv]/i
  );
  if (!m) return null;
  const raw = m[1] != null ? m[1] : m[2];
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : null;
}

function detectOptionModeFromText(text, key) {
  const t = String(text || '').toLowerCase();
  if (key === 'notstrom') {
    if (/optional[^\n.]{0,40}(gateway|umschalt|notstrom)|(gateway|umschalt|notstrom)[^\n.]{0,40}optional/i.test(t)) {
      return 'optional';
    }
    if (/fix[^\n.]{0,40}(gateway|umschalt|notstrom)|(gateway|umschalt|notstrom)[^\n.]{0,30}(fix|inklud|dabei|enthalten)/i.test(t)) {
      return 'fix';
    }
  }
  if (key === 'optimierer') {
    if (/optional[^\n.]{0,40}optimier|optimier[^\n.]{0,40}optional/i.test(t)) return 'optional';
    return 'fix';
  }
  if (/optional/.test(t)) return 'optional';
  return 'optional';
}

function buildOptionenList(req, brand, sourceText) {
  const str = (v) => (v == null ? '' : String(v).trim());
  const numOrNullLocal = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(',', '.').replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const opt = req.optionen && typeof req.optionen === 'object' ? req.optionen : {};
  const details = Array.isArray(req.optionDetails) ? req.optionDetails : [];
  const customs = Array.isArray(req.customOptions) ? req.customOptions : [];
  const byKey = {};

  const mark = (key, mode, hint, label, price, extra) => {
    if (!key && !label) return;
    const k = key || null;
    const id = k || `custom:${label}`;
    const prev = byKey[id] || {};
    byKey[id] = {
      key: k,
      label: str(label) || prev.label || null,
      mode: mode === 'fix' ? 'fix' : (mode === 'optional' ? 'optional' : (prev.mode || 'optional')),
      hint: str(hint) || prev.hint || null,
      price: price != null && Number.isFinite(Number(price)) ? Number(price) : (prev.price != null ? prev.price : null),
      upgradeFrom: (extra && extra.upgradeFrom != null) ? extra.upgradeFrom : (prev.upgradeFrom != null ? prev.upgradeFrom : null),
      upgradeTo: (extra && extra.upgradeTo != null) ? extra.upgradeTo : (prev.upgradeTo != null ? prev.upgradeTo : null),
    };
  };

  for (const [k, v] of Object.entries(opt)) {
    if (bool(v)) mark(k, detectOptionModeFromText(sourceText, k), null, null, null);
  }
  if (!bool(opt.notstrom) && detectNotstromFromText(sourceText)) {
    mark('notstrom', detectOptionModeFromText(sourceText, 'notstrom'), null, null, null);
  }
  if (!bool(opt.optimierer) && /optimier/i.test(String(sourceText || ''))) {
    mark('optimierer', /optional/i.test(sourceText) ? 'optional' : 'fix',
      'Ein Optimierer pro Modul für optimale Leistung.',
      'Optimierer (1 pro Modul)', null);
  }

  // Text-Fallback: "optional Upgrade 6 auf 9" / "statt 6er optional 9 kWh"
  const upgradeMatch = String(sourceText || '').match(
    /(?:upgrade|statt|aufpreis|preisdifferenz)[^\d]{0,40}?(\d+(?:[.,]\d+)?)\s*(?:kwh|kw)?[^\d]{0,25}?(?:auf|→|->|zu)\s*(\d+(?:[.,]\d+)?)\s*(?:kwh|kw)?/i
  ) || String(sourceText || '').match(
    /(\d+(?:[.,]\d+)?)\s*(?:kwh|kw)?[^\d]{0,15}?(?:auf|→|->|zu)\s*(\d+(?:[.,]\d+)?)\s*kwh[^\n.]{0,30}optional/i
  );
  if (upgradeMatch) {
    const from = numOrNullLocal(upgradeMatch[1]);
    const to = numOrNullLocal(upgradeMatch[2]);
    if (from != null && to != null && to > from) {
      mark('speicher_upgrade', 'optional',
        `Optional statt ${from} kWh: Upgrade auf ${to} kWh.`,
        `Upgrade Speicher ${from} -> ${to} kWh (Preisdifferenz)`,
        null,
        { upgradeFrom: from, upgradeTo: to });
    }
  }

  for (const d of details) {
    if (!d) continue;
    let key = str(d.key).toLowerCase() || null;
    if (key && /gateway|umschalt|notstrom|backup|ersatzstrom/.test(key)) key = 'notstrom';
    if (key && /speicher.?upgrade|upgrade.?speicher/.test(key)) key = 'speicher_upgrade';
    if (key && /optimier/.test(key)) key = 'optimierer';
    const labelHint = str(d.label).toLowerCase();
    if (!key && /gateway|umschalt|notstrom|backup|ersatzstrom/.test(labelHint)) key = 'notstrom';
    if (!key && /upgrade|preisdifferenz/.test(labelHint) && /speicher/.test(labelHint)) key = 'speicher_upgrade';
    if (!key && /optimier/.test(labelHint)) key = 'optimierer';
    const entryHint = d.hint || d.note || d.beschreibung;
    const from = numOrNullLocal(d.upgradeFrom != null ? d.upgradeFrom : d.fromKwh);
    const to = numOrNullLocal(d.upgradeTo != null ? d.upgradeTo : d.toKwh);
    const mode = key === 'optimierer' && !d.mode ? 'fix' : d.mode;
    mark(key, mode, entryHint, d.label, d.price, key === 'speicher_upgrade' ? { upgradeFrom: from, upgradeTo: to } : null);
  }

  for (const c of customs) {
    if (!c) continue;
    let key = null;
    const lab = str(c.label);
    if (/gateway|umschalt|notstrom|backup|ersatzstrom/i.test(lab)) key = 'notstrom';
    if (/upgrade|preisdifferenz/i.test(lab) && /speicher/i.test(lab)) key = 'speicher_upgrade';
    if (/optimier/i.test(lab)) key = 'optimierer';
    const mode = key === 'optimierer' && !c.mode ? 'fix' : c.mode;
    mark(key, mode, c.hint || c.note, lab, c.price);
  }

  const b = catalog.normalizeBrand(brand);
  const list = Object.values(byKey).map((o) => {
    let label = o.label;
    if (o.key === 'notstrom') {
      label = catalog.notstromLabelOption(b);
    } else if (o.key === 'speichererweiterung') {
      const se = catalog.resolveSpeicherErweiterungOption(b, o);
      label = se.label;
      if (o.price == null) o.price = se.price;
      o.kwh = se.kwh;
    } else if (o.key === 'speicher_upgrade' && o.upgradeFrom != null && o.upgradeTo != null) {
      label = (label || `Upgrade Speicher ${o.upgradeFrom} -> ${o.upgradeTo} kWh (Preisdifferenz)`)
        .replace(/\s*→\s*/g, ' -> ');
      // Preisdifferenz berechnet der Server – 0/null von der KI nicht durchreichen
      if (!(Number(o.price) > 0)) o.price = null;
    } else if (o.key === 'optimierer') {
      label = label || catalog.OPTIONS.optimierer.label;
      if (!(Number(o.price) > 0)) o.price = null;
      if (!o.hint) o.hint = 'Ein Optimierer pro Modul für optimale Leistung.';
    }
    return {
      key: o.key,
      label,
      mode: o.key === 'optimierer' && o.mode !== 'optional' ? 'fix' : (o.mode || 'optional'),
      hint: o.hint || null,
      price: o.price,
      upgradeFrom: o.upgradeFrom != null ? o.upgradeFrom : null,
      upgradeTo: o.upgradeTo != null ? o.upgradeTo : null,
    };
  });
  return list;
}

function normalizeOfferNotes(req) {
  const notes = [];
  if (Array.isArray(req.offerNotes)) {
    for (const n of req.offerNotes) {
      const t = String(n || '').trim();
      if (t) notes.push(t);
    }
  }
  if (req.offerNote) {
    const t = String(req.offerNote).trim();
    if (t) notes.push(t);
  }
  return [...new Set(notes)];
}

function heuristicAnswersForQuestion(question) {
  const q = String(question || '').toLowerCase();
  if (/klima|innengerät|außengerät|split/.test(q)) {
    return [
      { label: 'Single 2,5 kW', text: 'Klimapaket LG Single-Split 2,5 kW (1× Außen 2,5 + 1× Innen 2,5)' },
      { label: 'Single 3,5 kW', text: 'Klimapaket LG Single-Split 3,5 kW (1× Außen 3,5 + 1× Innen 3,5)' },
      { label: 'Multi 4,1 kW', text: 'Klimapaket LG Multi-Split 4,1 kW (1× Außen 4,1 + 2× Innen 2,5)' },
      { label: 'Multi 6,3 kW', text: 'Klimapaket LG Multi-Split 6,3 kW (1× Außen 6,3 + 2× Innen 2,5 + 1× Innen 3,5)' },
    ];
  }
  if (/modul|kwp|paneel|pv|anlage/.test(q)) {
    return [
      { label: '11 Module', text: '11 PV-Module' },
      { label: '16 Module', text: '16 PV-Module' },
      { label: '22 Module', text: '22 PV-Module' },
      { label: '27 Module', text: '27 PV-Module' },
      { label: '33 Module', text: '33 PV-Module' },
      { label: '10 kWp', text: 'ca. 10 kWp PV-Anlage' },
      { label: 'Nur Klima', text: 'kein PV, nur Klimaanlage' },
    ];
  }
  if (/gateway|umschalt|notstrom/.test(q)) {
    return [
      { label: 'Gateway optional', text: 'SIG Energy Gateway optional anbieten' },
      { label: 'Gateway fix', text: 'SIG Energy Gateway fix im Angebot' },
      { label: 'Ohne Gateway', text: 'kein Gateway / keine Umschaltbox' },
    ];
  }
  if (/speicher|upgrade|kwh|reserva/.test(q)) {
    return [
      { label: 'Sig 6+9', text: 'Speicher 15 kWh (6+9 Sigenergy)' },
      { label: 'Sig 2×9', text: 'Speicher 18 kWh (2×9 Sigenergy)' },
      { label: 'Fronius 9,5', text: 'Fronius Reserva 9,5 kWh' },
      { label: 'Fronius 12,6', text: 'Fronius Reserva 12,6 kWh' },
      { label: 'Fronius 15,8', text: 'Fronius Reserva 15,8 kWh' },
      { label: '+3,2 opt.', text: 'optional +3,2 kWh Speicherelement nachrüsten' },
      { label: 'Ohne Speicher', text: 'ohne Stromspeicher' },
    ];
  }
  if (/marke|sigenergy|fronius/.test(q)) {
    return [
      { label: 'Sigenergy', text: 'Marke Sigenergy' },
      { label: 'Fronius', text: 'Marke Fronius' },
    ];
  }
  if (/dach/.test(q)) {
    return [
      { label: 'Ziegel', text: 'Dach Ziegel' },
      { label: 'Flachdach O/W', text: 'Dach Flachdach Ost-West' },
      { label: 'Flachdach Süd', text: 'Dach Flachdach Südaufständerung' },
      { label: 'Freifläche Süd', text: 'Dach Freifläche Süd' },
      { label: 'Trapezblech', text: 'Dach Trapezblech' },
      { label: 'Prefa', text: 'Dach Prefa' },
    ];
  }
  if (/optional|fix|inklud|dabei|wunsch/.test(q)) {
    return [
      { label: 'Optional', text: 'als optionale Komponente' },
      { label: 'Fix im Preis', text: 'fix im Angebotspreis enthalten' },
      { label: 'Nicht anbieten', text: 'diese Position weglassen' },
    ];
  }
  // Generische Schnellantworten, damit nie „keine Buttons“ erscheint
  return [
    { label: 'Ja / bestätigen', text: 'Ja, wie besprochen bestätigen' },
    { label: 'Nein', text: 'Nein, das nicht' },
    { label: 'Optional', text: 'optional anbieten' },
    { label: 'Fix im Preis', text: 'fix im Angebotspreis' },
    { label: 'Später manuell', text: 'werde ich manuell im Formular setzen' },
  ];
}

function normalizeClarifications(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  const seen = new Set();
  const out = [];
  list.forEach((item, idx) => {
    if (item == null) return;
    if (typeof item === 'string') {
      const question = item.trim();
      if (!question || seen.has(question.toLowerCase())) return;
      seen.add(question.toLowerCase());
      out.push({
        id: `q${idx}`,
        question,
        answers: heuristicAnswersForQuestion(question),
      });
      return;
    }
    if (typeof item !== 'object') return;
    const question = String(item.question || item.q || item.text || '').trim();
    if (!question || seen.has(question.toLowerCase())) return;
    seen.add(question.toLowerCase());
    let answers = Array.isArray(item.answers) ? item.answers : [];
    answers = answers.map((a) => {
      if (typeof a === 'string') {
        const t = a.trim();
        return t ? { label: t.length > 28 ? `${t.slice(0, 26)}…` : t, text: t } : null;
      }
      if (!a || typeof a !== 'object') return null;
      const text = String(a.text || a.value || a.append || a.label || '').trim();
      const label = String(a.label || text).trim();
      if (!text) return null;
      return {
        label: label.length > 32 ? `${label.slice(0, 30)}…` : label,
        text,
      };
    }).filter(Boolean);
    if (!answers.length) answers = heuristicAnswersForQuestion(question);
    out.push({
      id: String(item.id || `q${idx}`),
      question,
      answers,
    });
  });
  return out;
}

function normalizeOffer(raw, sourceText = '') {
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

  const clarificationsRaw = Array.isArray(r.clarifications) ? r.clarifications.slice() : [];

  const klima = normalizeKlimaReq(req.klima, clarificationsRaw);
  const resolvedBrand = brand || 'sigenergy';
  const optionenList = buildOptionenList(req, resolvedBrand, sourceText);
  const offerNotes = normalizeOfferNotes(req);

  // Bool-Map für Rückwärtskompatibilität
  const optionenBool = {
    wallbox: bool(opt.wallbox),
    notstrom: bool(opt.notstrom) || optionenList.some((o) => o.key === 'notstrom'),
    speichererweiterung: bool(opt.speichererweiterung),
    optimierer: bool(opt.optimierer) || optionenList.some((o) => o.key === 'optimierer'),
    ohmpilot: bool(opt.ohmpilot),
    ueberspannungsschutz: bool(opt.ueberspannungsschutz),
    lasttrennschalter: bool(opt.lasttrennschalter),
    fi_schalter: bool(opt.fi_schalter),
    zaehlerbrett: bool(opt.zaehlerbrett),
    waermepumpe_anschluss: bool(opt.waermepumpe_anschluss),
  };
  for (const o of optionenList) {
    if (o.key && Object.prototype.hasOwnProperty.call(optionenBool, o.key)) {
      optionenBool[o.key] = true;
    }
  }

  let includePv = req.includePv;
  if (includePv == null) {
    const hasPvSignal = numOrNull(req.module_count) || numOrNull(req.kwp) || numOrNull(req.speicher)
      || extractSpeicherKwhFromText(sourceText) != null;
    if (klima.wanted && !hasPvSignal) includePv = false;
    else if (hasPvSignal) includePv = true;
    else includePv = !klima.wanted;
  } else {
    includePv = bool(includePv);
  }

  if (includePv && !numOrNull(req.module_count) && !numOrNull(req.kwp) && klima.wanted) {
    clarificationsRaw.push({
      id: 'pv_modules',
      question: 'Wie viele PV-Module (oder welche kWp) sollen im Kombi-Angebot enthalten sein?',
      answers: heuristicAnswersForQuestion('PV Module kWp'),
    });
  }

  const clarifications = normalizeClarifications(clarificationsRaw);

  let dachSegmente = [];
  if (Array.isArray(req.dachSegmente)) {
    dachSegmente = req.dachSegmente.map((s) => {
      if (!s || typeof s !== 'object') return null;
      const dach = str(s.dach) || str(s.type) || null;
      const modules = numOrNull(s.modules != null ? s.modules : s.module_count);
      if (!dach && modules == null) return null;
      return { dach: dach || 'Ziegel', modules: modules != null ? Math.round(modules) : null };
    }).filter(Boolean);
  }
  // Text-Extraktion hat Vorrang bei ≥2 Dachflächen ODER wenn Ausrichtung genannt wird
  // (KI liefert oft nur „Flachdach“ ohne Ost-West / Südaufständerung).
  const fromText = extractDachSegmenteFromText(sourceText);
  const textHasOrient = /suedost|ost\s*-?\s*west|suedaufst|suedaufstell|suedausricht|südost|südaufst|südausricht|ost\/west/i.test(sourceText);
  if (fromText.length >= 2 || (textHasOrient && fromText.length >= 1)) {
    dachSegmente = fromText;
  } else if (!dachSegmente.length && fromText.length) {
    dachSegmente = fromText;
  }
  const moduleHint = numOrNull(req.module_count);
  dachSegmente = catalog.reconcileDachSegmente(dachSegmente, moduleHint);
  let moduleCount = moduleHint;
  if (dachSegmente.length) {
    const sum = dachSegmente.reduce((a, s) => a + (Number(s.modules) || 0), 0);
    if (sum > 0) moduleCount = sum;
  }

  let inverterKw = numOrNull(req.inverter_kw != null ? req.inverter_kw : req.inverterKw);
  const fromInvText = extractInverterKwFromText(sourceText);
  if (fromInvText != null) inverterKw = fromInvText;

  // Speicher: Kombinationen aus Text (6+9, 2×9, …) haben Vorrang vor KI-Einzelwert
  let speicherKwh = numOrNull(req.speicher);
  const fromSpeicherText = extractSpeicherKwhFromText(sourceText);
  if (fromSpeicherText != null) speicherKwh = fromSpeicherText;

  // Haupt-Speichergröße nicht zusätzlich als speichererweiterung-Option führen
  let cleanedOptionenList = optionenList;
  if (speicherKwh != null && isMainStorageComboText(sourceText)) {
    const explicitNachruest = /nachrüst|später\s+erweiter|optional\s+(?:noch\s+)?(?:\+|plus\s+\d)/i.test(sourceText);
    if (!explicitNachruest) {
      cleanedOptionenList = optionenList.filter((o) => o.key !== 'speichererweiterung');
      optionenBool.speichererweiterung = false;
    }
  }

  let vorname = str(c.vorname) || str(c.firstName) || '';
  let nachname = str(c.nachname) || str(c.lastName) || '';
  let name = str(c.name);
  if ((!vorname || !nachname) && name) {
    // KI liefert oft „Vorname Nachname“ – nicht Lead-Konvention
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 1 && !nachname) nachname = parts[0];
    else if (parts.length >= 2) {
      if (!vorname) vorname = parts.slice(0, -1).join(' ');
      if (!nachname) nachname = parts[parts.length - 1];
    }
  }
  if (!name && (vorname || nachname)) name = [vorname, nachname].filter(Boolean).join(' ');

  return {
    customer: {
      vorname,
      nachname,
      name,
      street: str(c.street),
      zip: str(c.zip),
      city: str(c.city),
      email: str(c.email).toLowerCase(),
      phone: str(c.phone),
    },
    requirements: {
      includePv,
      brand: resolvedBrand,
      kwp: numOrNull(req.kwp),
      module_count: moduleCount,
      speicher: speicherKwh,
      brutto_preis: parseMoneyLike(req.brutto_preis),
      dach: str(req.dach) || (dachSegmente[0] && dachSegmente[0].dach) || null,
      dachSegmente,
      moduleType: str(req.moduleType).toLowerCase() === 'aiko' ? 'aiko' : 'das',
      inverter_kw: inverterKw,
      optionen: optionenBool,
      optionenList: cleanedOptionenList,
      offerNotes,
      standardOptionen: req.standardOptionen == null ? null : bool(req.standardOptionen),
      klima,
      notes: str(req.notes),
    },
    clarifications,
    needsClarification: clarifications.length > 0,
    contactType: ['telefonisch', 'schriftlich'].includes(str(r.contactType).toLowerCase())
      ? str(r.contactType).toLowerCase() : null,
  };
}

async function parseOfferCommand(commandText) {
  const text = String(commandText || '').trim();
  if (!text) throw new Error('Kein Text/Sprachbefehl übergeben');
  const out = await chatCompletionJson(SYSTEM_PROMPT_OFFER, text);
  const raw = parseJsonFromLlm(out);
  const normalized = normalizeOffer(raw, text);
  if (!normalized.requirements.brutto_preis) {
    normalized.requirements.brutto_preis = extractBruttoFromText(text);
  }
  return normalized;
}

module.exports = {
  parseOfferCommand,
  chatCompletionJson,
  parseJsonFromLlm,
  normalizeOffer,
  detectNotstromFromText,
  extractDachSegmenteFromText,
  extractInverterKwFromText,
  extractSpeicherKwhFromText,
};
