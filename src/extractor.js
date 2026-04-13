'use strict';

require('./load-env');

const SYSTEM_PROMPT = `Du extrahierst aus E-Mail-Anfragen für Photovoltaikanlagen die relevanten Informationen für eine Lead-Tabelle.

Gib die Daten als JSON-Objekt zurück mit diesen Feldern (exakt diese Feldnamen):
- name: Nachname + Vorname (string oder null)
- phone: Telefonnummer immer im Format "0043 XXX XXXXXXX" (string oder null)
- email: E-Mail-Adresse (string oder null)
- street: Straße mit Hausnummer (string oder null)
- zip: Postleitzahl (string oder null)
- city: Ort (string oder null)
- country: immer "Österreich" (string)
- source: Quelle – erkenne automatisch: "D&P" für D&P Betriebsschmiede, "Photovoltaikanlage.at" für Leadmail/Nettbureau AS, "noortec.at" für Webformular noortec.at, neue Quellen erkennst du selbst (string oder null)
- date: Anfragezeitpunkt im Format JJJJ-MM-TT (string oder null)
- info: Objekttyp, relevante Details (Dachform, Speicher, Sonderanmerkungen), Installationszeitraum – kompakt in einem Freitext (string oder null)

Regeln:
- Telefonnummern immer im Format 0043 XXX XXXXXXX
- Datum immer im Format JJJJ-MM-TT
- Land immer "Österreich"
- Fehlende Felder bleiben null

Gib NUR das JSON-Objekt zurück, kein Markdown, keine Erklärung.`;

function parseJsonFromLlm(text) {
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(t);
}

async function extractAnthropic(userContent, emailData) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return null;

  const lead = parseJsonFromLlm(textBlock.text);
  lead.date = lead.date || emailData.date?.slice(0, 10);
  return lead;
}

async function extractOpenAICompatible(userContent, emailData) {
  const base = (process.env.OPENAI_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '');
  const key = process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
  const model = process.env.LLM_MODEL || 'deepseek-chat';
  if (!key) throw new Error('OPENAI_API_KEY (or DEEPSEEK_API_KEY) is not set');

  const res = await fetch(`${base}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    throw new Error(`LLM HTTP ${res.status}: ${msg}`);
  }

  const text = data.choices?.[0]?.message?.content;
  if (!text) return null;

  const lead = parseJsonFromLlm(text);
  lead.date = lead.date || emailData.date?.slice(0, 10);
  return lead;
}

async function extractLead(emailData) {
  const userContent = `From: ${emailData.from}
Subject: ${emailData.subject}
Date: ${emailData.date}

${emailData.text || emailData.html}`;

  const provider = (process.env.LLM_PROVIDER || 'anthropic').toLowerCase();

  try {
    if (provider === 'openai-compatible' || provider === 'deepseek' || provider === 'openai') {
      return await extractOpenAICompatible(userContent, emailData);
    }
    return await extractAnthropic(userContent, emailData);
  } catch (err) {
    console.error('Extraction error:', err.message);
    return null;
  }
}

module.exports = { extractLead };
