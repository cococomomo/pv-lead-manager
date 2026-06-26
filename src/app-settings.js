'use strict';

const fs = require('fs');
const path = require('path');
require('./load-env');
const { encryptSecret, decryptSecret } = require('./secret-crypto');

const DATA_DIR = path.join(__dirname, '../data');
const SETTINGS_FILE = path.join(DATA_DIR, 'app-settings.json');

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

function readRaw() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function writeRaw(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(obj, null, 2));
}

/**
 * Effektive LLM-Konfiguration: Admin-Einstellungen (DB/Datei) haben Vorrang,
 * sonst greifen die .env-Werte. Der API-Key wird hier entschlüsselt zurückgegeben.
 */
const KNOWN_PROVIDERS = ['openai-compatible', 'deepseek', 'openai', 'anthropic'];

function normalizeProvider(raw) {
  const p = String(raw || '').trim().toLowerCase();
  return KNOWN_PROVIDERS.includes(p) ? p : 'openai-compatible';
}

function getLlmConfig() {
  const s = readRaw();
  const provider = normalizeProvider(s.llmProvider || process.env.LLM_PROVIDER || 'openai-compatible');
  const model = String(
    s.llmModel
    || process.env.LLM_MODEL
    || (provider === 'anthropic' ? (process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001') : 'deepseek-chat'),
  ).trim();
  const baseUrl = String(s.llmBaseUrl || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  let apiKey = '';
  let source = 'none';
  if (s.llmApiKeyEnc) {
    apiKey = decryptSecret(String(s.llmApiKeyEnc));
    if (apiKey) source = 'admin';
  }
  if (!apiKey) {
    apiKey = provider === 'anthropic'
      ? String(process.env.ANTHROPIC_API_KEY || '').trim()
      : String(process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY || '').trim();
    if (apiKey) source = 'env';
  }
  return { provider, model, baseUrl, apiKey, source };
}

/** Ohne Geheimnis — für die Admin-Oberfläche. */
function getLlmPublic() {
  const cfg = getLlmConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    baseUrl: cfg.baseUrl,
    apiKeyConfigured: !!cfg.apiKey,
    source: cfg.source, // 'admin' | 'env' | 'none'
  };
}

/**
 * Speichert LLM-Einstellungen. Leeres apiKey-Feld = unverändert lassen;
 * apiKey === null = gespeicherten Key löschen (Fallback auf .env).
 */
function saveLlmSettings({ provider, model, baseUrl, apiKey }) {
  const s = readRaw();
  if (provider !== undefined) s.llmProvider = String(provider || '').trim().toLowerCase() || undefined;
  if (model !== undefined) s.llmModel = String(model || '').trim() || undefined;
  if (baseUrl !== undefined) s.llmBaseUrl = String(baseUrl || '').trim().replace(/\/$/, '') || undefined;
  if (apiKey === null) {
    delete s.llmApiKeyEnc;
  } else if (apiKey !== undefined && String(apiKey).trim() !== '') {
    s.llmApiKeyEnc = encryptSecret(String(apiKey).trim());
  }
  s.updatedAt = new Date().toISOString();
  writeRaw(s);
  return getLlmPublic();
}

module.exports = {
  getLlmConfig,
  getLlmPublic,
  saveLlmSettings,
  SETTINGS_FILE,
};
