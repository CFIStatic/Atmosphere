import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askProviderLabel,
  completeAskText,
  isAskModelConfigured,
} from '../src/lib/askModel.js';
import { answerFromJobFile } from '../src/shared/jobFileAsk.js';

function restoreEnv(name: string, previous: string | undefined) {
  if (previous === undefined) delete process.env[name];
  else process.env[name] = previous;
}

test('askProviderLabel prefers Anthropic, then Gemini', () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    assert.equal(askProviderLabel(), 'unconfigured');
    assert.equal(isAskModelConfigured(), false);

    process.env.GEMINI_API_KEY = 'test-gemini';
    assert.equal(askProviderLabel(), 'google');
    assert.equal(isAskModelConfigured(), true);
    assert.equal(isAskModelConfigured(null), true);

    process.env.ANTHROPIC_API_KEY = 'test-anthropic';
    assert.equal(askProviderLabel(), 'anthropic');
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});

test('completeAskText uses Gemini when Anthropic is unset', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  try {
    const calls: Array<{ url: string; key: string | null }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, key: headers.get('x-goog-api-key') });
      assert.match(url, /gemini-3\.6-flash:generateContent/);
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        system_instruction?: { parts?: Array<{ text?: string }> };
        contents?: Array<{ parts?: Array<{ text?: string }> }>;
      };
      assert.match(body.system_instruction?.parts?.[0]?.text ?? '', /job file/i);
      assert.match(body.contents?.[0]?.parts?.[0]?.text ?? '', /what happens/i);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'North slope is stripped to decking.' }] } }],
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12 },
          modelVersion: 'gemini-3.6-flash',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await completeAskText({
      system: 'You answer questions about one job file.',
      user: 'Question: what happens in the video',
      anthropicApiKey: null,
      fetchFn,
    });
    assert.ok(result);
    assert.equal(result.model, 'gemini-3.6-flash');
    assert.match(result.text, /North slope/);
    assert.equal(result.usage?.inputTokens, 40);
    assert.equal(result.usage?.outputTokens, 12);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.key, 'live-gemini');
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});

test('completeAskText retries a retired Gemini model id', async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevModel = process.env.VERIFICATION_PRIMARY_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  process.env.VERIFICATION_PRIMARY_MODEL = 'gemini-2.5-flash';
  try {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('gemini-2.5-flash')) {
        return new Response(
          'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash.',
          { status: 404 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Retried on the current model.' }] } }],
          modelVersion: 'gemini-3.6-flash',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    const result = await completeAskText({
      system: 'sys',
      user: 'what happens',
      anthropicApiKey: null,
      fetchFn,
    });
    assert.equal(result?.text, 'Retried on the current model.');
    assert.equal(result?.model, 'gemini-3.6-flash');
    assert.equal(urls.length, 2);
  } finally {
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('VERIFICATION_PRIMARY_MODEL', prevModel);
  }
});

test('answerFromJobFile uses Gemini when only a Google key is wired', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: 'Permit BP-2026-8841 is on the brief.' }],
              },
            },
          ],
          modelVersion: 'gemini-3.6-flash',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )) as typeof fetch;

    const result = await answerFromJobFile({
      question: 'what is the permit number',
      file: {
        facts: { Permit: 'BP-2026-8841' },
        clips: [{ workDate: '2026-08-05', summary: 'North slope stripped to decking.' }],
      },
      apiKey: null,
    });
    assert.equal(result.model, 'gemini-3.6-flash');
    assert.match(result.answer, /BP-2026-8841/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});
