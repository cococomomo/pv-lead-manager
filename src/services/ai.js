'use strict';

require('../load-env');
const { SYSTEM_PROMPT_LEAD_PARSING } = require('./prompts');

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';
const DEEPSEEK_MODEL = 'deepseek-chat';

function parseJsonFromLlm(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(t);
}

/**
 * Mappt LLM-JSON (inkl. möglicher deutscher Schlüssel) auf das Objekt für `appendLead`.
 * @param {object} raw
 * @returns {object|null}
 */
function normalizeLeadFromLlm(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const pick = (...keys) => {
    for (const k of keys) {
      if (raw[k] != null && String(raw[k]).trim() !== '') return raw[k];
    }
    return null;
  };
  let name = pick('name', 'Name', 'namen', 'fullName');
  const vor = pick('Vorname', 'vorname', 'firstName');
  const nach = pick('Nachname', 'nachname', 'lastName');
  if (!name && (vor || nach)) {
    name = [vor, nach].filter(Boolean).join(' ').trim() || [nach, vor].filter(Boolean).join(' ').trim();
  }
  const phone = pick('phone', 'Telefon', 'telefon', 'tel');
  const email = pick('email', 'E-Mail', 'e_mail', 'mail');
  const street = pick('street', 'Straße', 'strasse', 'adresse');
  const zip = pick('zip', 'PLZ', 'plz', 'postleitzahl');
  const city = pick('city', 'Ort', 'ort', 'stadt');
  const country = pick('country', 'Land', 'land') || 'Österreich';
  const source = pick('source', 'Quelle', 'quelle');
  const date = pick('date', 'Anfragezeitpunkt', 'anfragezeitpunkt', 'datum');
  const info = pick('info', 'Info', 'details', 'bemerkung');

  return {
    name: name != null ? String(name).trim() : null,
    phone: phone != null ? String(phone).trim() : null,
    email: email != null ? String(email).trim().toLowerCase() : null,
    street: street != null ? String(street).trim() : null,
    zip: zip != null ? String(zip).trim() : null,
    city: city != null ? String(city).trim() : null,
    country: country != null ? String(country).trim() : null,
    source: source != null ? String(source).trim() : null,
    date: date != null ? String(date).trim() : null,
    info: info != null ? String(info).trim() : null,
  };
}

/**
 * OpenAI-kompatibler Chat-Completion (NOORTEC-Default: DeepSeek).
 * @param {string} userContent
 * @param {{ date?: string }} emailData
 */
async function leadParseWithOpenAICompatible(userContent, emailData) {
  const base = (process.env.OPENAI_BASE_URL || DEEPSEEK_BASE_URL).replace(/\/$/, '');
  const key = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  const model = process.env.LLM_MODEL || DEEPSEEK_MODEL;
  if (!key || !String(key).trim()) {
    throw new Error('DEEPSEEK_API_KEY (oder OPENAI_API_KEY) ist nicht gesetzt');
  }

  const body = {
    model,
    temperature: 0.2,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT_LEAD_PARSING },
      { role: 'user', content: userContent },
    ],
  };
  const allowJsonObject = String(process.env.LLM_JSON_OBJECT || '1').trim() !== '0';
  if (allowJsonObject && /deepseek/i.test(String(model))) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`LLM HTTP ${res.status}: ${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;

  const raw = parseJsonFromLlm(text);
  const lead = normalizeLeadFromLlm(raw);
  if (lead) lead.date = lead.date || (emailData.date && String(emailData.date).slice(0, 10)) || null;
  return lead;
}

module.exports = {
  parseJsonFromLlm,
  normalizeLeadFromLlm,
  leadParseWithOpenAICompatible,
  DEEPSEEK_BASE_URL,
  DEEPSEEK_MODEL,
};
