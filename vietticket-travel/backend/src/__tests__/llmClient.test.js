const ORIGINAL_ENV = process.env;
const ORIGINAL_FETCH = global.fetch;

describe('llmClient', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      AI_PRIMARY_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-key',
      OPENAI_API_KEY: 'openai-key',
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetModules();
    process.env = ORIGINAL_ENV;
    global.fetch = ORIGINAL_FETCH;
  });

  test('aborts a slow primary provider and falls back to the next provider', async () => {
    jest.useFakeTimers();
    const fetchCalls = [];
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    global.fetch = jest.fn((url, options = {}) => {
      fetchCalls.push({ url: String(url), options });

      if (String(url).includes('generativelanguage.googleapis.com')) {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'fallback ok' } }] }),
      });
    });

    const { generateText } = require('../services/llmClient');
    const responsePromise = generateText('system prompt', 'user prompt', { timeoutMs: 25 });

    await jest.advanceTimersByTimeAsync(25);

    await expect(responsePromise).resolves.toEqual({ text: 'fallback ok', provider: 'openai' });
    expect(fetchCalls).toHaveLength(2);
    expect(fetchCalls[0].options.signal.aborted).toBe(true);
    expect(consoleError.mock.calls.flat().join(' ')).toContain('timed out after 25ms');
  });

  test('sends Gemini policy through the native system instruction field', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }] } }],
      }),
    });

    const { generateText } = require('../services/llmClient');
    await expect(generateText('trusted policy', 'customer input')).resolves.toEqual({
      text: 'ok',
      provider: 'gemini',
    });

    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.systemInstruction.parts[0].text).toBe('trusted policy');
    expect(body.contents[0].parts[0].text).toBe('customer input');
    expect(body.contents[0].parts[0].text).not.toContain('trusted policy');
  });
});
