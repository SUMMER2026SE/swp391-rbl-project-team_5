'use strict';

const { jsonrepair } = require('jsonrepair');

// ============================================================
// llmClient.js
// ------------------------------------------------------------
// Lớp gọi LLM dùng chung cho mọi module AI (chatbot, gợi ý,
// kế hoạch tham quan...).
//
// - Hỗ trợ 2 provider: Gemini (Google) và OpenAI.
// - Tự động fallback: nếu provider chính lỗi (hết quota, rate
//   limit, timeout...) thì thử provider phụ.
// - Có thể ép trả JSON (responseFormat: 'json') để các service
//   khác parse trực tiếp.
//
// ENV cần có (.env):
//   GEMINI_API_KEY=...
//   OPENAI_API_KEY=...
//   AI_PRIMARY_PROVIDER=gemini   // hoặc 'openai' (mặc định: gemini)
//   GEMINI_MODEL=gemini-2.0-flash      (tuỳ chọn, có default)
//   OPENAI_MODEL=gpt-4o-mini           (tuỳ chọn, có default)
// ============================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const PRIMARY_PROVIDER = (process.env.AI_PRIMARY_PROVIDER || 'gemini').toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const DEFAULT_LLM_TIMEOUT_MS = 20000;
const LLM_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AI_LLM_TIMEOUT_MS || process.env.LLM_TIMEOUT_MS,
  DEFAULT_LLM_TIMEOUT_MS,
);

const GEMINI_URL = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

function resolveTimeoutMs(value, fallback = DEFAULT_LLM_TIMEOUT_MS) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function fetchWithTimeout(url, fetchOptions = {}, timeoutMs = LLM_TIMEOUT_MS) {
  const timeout = resolveTimeoutMs(timeoutMs, LLM_TIMEOUT_MS);
  const timeoutError = () => new Error(`LLM request timed out after ${timeout}ms`);

  if (typeof AbortController === 'undefined') {
    let timer;
    try {
      return await Promise.race([
        fetch(url, fetchOptions),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(timeoutError()), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw timeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function providerHttpError(provider, status) {
  const error = new Error(`${provider} API lỗi (${status})`);
  error.status = status;
  return error;
}

function safeProviderErrorMessage(error) {
  const message = String(error?.message || 'unknown error')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]')
    .replace(/key=[A-Za-z0-9._-]+/g, 'key=[redacted]')
    .replace(/\s+/g, ' ')
    .trim();

  return message.slice(0, 240);
}

/**
 * Gọi Gemini API.
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ json?: boolean, temperature?: number, timeoutMs?: number }} options
 * @returns {Promise<string>} text trả về từ model
 */
async function callGemini(systemPrompt, userPrompt, options = {}) {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY chưa được cấu hình');

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: `${systemPrompt}\n\n---\n\n${userPrompt}` }],
      },
    ],
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      maxOutputTokens: options.maxOutputTokens ?? 2048,
      ...(options.json ? { responseMimeType: 'application/json' } : {}),
    },
  };

  const res = await fetchWithTimeout(GEMINI_URL(GEMINI_MODEL), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  }, options.timeoutMs);

  if (!res.ok) {
    await res.text().catch(() => '');
    throw providerHttpError('Gemini', res.status);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  if (!text) throw new Error('Gemini API trả về rỗng');
  return text;
}

/**
 * Gọi OpenAI API (chat completions).
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {{ json?: boolean, temperature?: number, timeoutMs?: number }} options
 * @returns {Promise<string>} text trả về từ model
 */
async function callOpenAI(systemPrompt, userPrompt, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY chưa được cấu hình');

  const body = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: options.temperature ?? 0.4,
    max_tokens: options.maxOutputTokens ?? 2048,
    ...(options.json ? { response_format: { type: 'json_object' } } : {}),
  };

  const res = await fetchWithTimeout(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(body),
  }, options.timeoutMs);

  if (!res.ok) {
    await res.text().catch(() => '');
    throw providerHttpError('OpenAI', res.status);
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) throw new Error('OpenAI API trả về rỗng');
  return text;
}

const PROVIDERS = {
  gemini: callGemini,
  openai: callOpenAI,
};

/**
 * Gọi LLM với cơ chế fallback giữa Gemini và OpenAI.
 *
 * @param {string} systemPrompt - Hướng dẫn vai trò/ngữ cảnh cho model.
 * @param {string} userPrompt - Nội dung câu hỏi/yêu cầu cụ thể.
 * @param {{ json?: boolean, temperature?: number, maxOutputTokens?: number, timeoutMs?: number }} [options]
 * @returns {Promise<{ text: string, provider: string }>}
 */
async function generateText(systemPrompt, userPrompt, options = {}) {
  const order =
    PRIMARY_PROVIDER === 'openai' ? ['openai', 'gemini'] : ['gemini', 'openai'];

  let lastError = null;

  for (const providerName of order) {
    const fn = PROVIDERS[providerName];
    try {
      const text = await fn(systemPrompt, userPrompt, options);
      return { text, provider: providerName };
    } catch (err) {
      lastError = err;
      console.error(
        `[llmClient] Provider "${providerName}" thất bại:`,
        safeProviderErrorMessage(err),
      );
      // thử provider tiếp theo
    }
  }

  throw new Error(
    `Tất cả LLM provider đều thất bại. Lỗi cuối: ${lastError?.message || 'unknown'}`
  );
}

/**
 * Gọi LLM và parse kết quả trả về dạng JSON.
 * Tự động loại bỏ markdown code fences (```json ... ```) nếu model
 * (đặc biệt OpenAI khi không hỗ trợ json_object) vẫn trả kèm.
 *
 * @param {string} systemPrompt
 * @param {string} userPrompt
 * @param {object} [options]
 * @returns {Promise<{ data: any, provider: string }>}
 */
async function generateJSON(systemPrompt, userPrompt, options = {}) {
  const { text, provider } = await generateText(systemPrompt, userPrompt, {
    ...options,
    json: true,
  });

  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    const repaired = jsonrepair(cleaned);
    const data = JSON.parse(repaired);
    return { data, provider };
  } catch (err) {
    throw new Error(
      `Không parse được JSON từ provider "${provider}": ${err.message}\nNội dung trả về: ${cleaned.slice(0, 500)}`,
      { cause: err },
    );
  }
}

module.exports = {
  generateText,
  generateJSON,
};
