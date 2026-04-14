'use strict';

require('./load-env');

const { SYSTEM_PROMPT_LEAD_PARSING } = require('./services/prompts');
const { leadParseWithOpenAICompatible, parseJsonFromLlm, normalizeLeadFromLlm } = require('./services/ai');

async function extractAnthropic(userContent, emailData) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT_LEAD_PARSING,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) return null;

  const raw = parseJsonFromLlm(textBlock.text);
  const lead = normalizeLeadFromLlm(raw);
  if (lead) lead.date = lead.date || emailData.date?.slice(0, 10);
  return lead;
}

async function extractLead(emailData) {
  const userContent = `From: ${emailData.from}
Subject: ${emailData.subject}
Date: ${emailData.date}

${emailData.text || emailData.html}`;

  const provider = (process.env.LLM_PROVIDER || 'openai-compatible').toLowerCase();

  try {
    if (provider === 'openai-compatible' || provider === 'deepseek' || provider === 'openai') {
      return await leadParseWithOpenAICompatible(userContent, emailData);
    }
    return await extractAnthropic(userContent, emailData);
  } catch (err) {
    console.error('[NOORTEC] Lead-Extraktion:', err.message);
    return null;
  }
}

module.exports = { extractLead };
