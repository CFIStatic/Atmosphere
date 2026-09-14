import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEMINI_ASK_MAX_TOKENS,
  GEMINI_ASK_THINKING_LEVEL,
  askProviderLabel,
  completeAskText,
  geminiAskModel,
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

test('interactive Ask defaults to flash-lite without high thinking or 20k tokens', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevAsk = process.env.ASK_MODEL;
  const prevFast = process.env.ASK_FAST_MODEL;
  const prevPrimary = process.env.VERIFICATION_PRIMARY_MODEL;
  const prevGoogleFast = process.env.GOOGLE_MODEL_FAST;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ASK_MODEL;
  delete process.env.ASK_FAST_MODEL;
  delete process.env.VERIFICATION_PRIMARY_MODEL;
  delete process.env.GOOGLE_MODEL_FAST;
  process.env.GEMINI_API_KEY = 'live-gemini';
  try {
    assert.equal(geminiAskModel('interactive'), 'gemini-2.5-flash-lite');
    assert.equal(GEMINI_ASK_THINKING_LEVEL, 'minimal');
    assert.ok(GEMINI_ASK_MAX_TOKENS < 10_000);

    const calls: Array<{ url: string; key: string | null; body: any }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? '{}'));
      calls.push({ url, key: headers.get('x-goog-api-key'), body });
      assert.match(url, /gemini-2\.5-flash-lite:generateContent/);
      assert.equal(body.generationConfig?.maxOutputTokens, GEMINI_ASK_MAX_TOKENS);
      // Flash-lite: no thinkingConfig attached.
      assert.equal(body.generationConfig?.thinkingConfig, undefined);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'North slope is stripped to decking.' }] } }],
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12 },
          modelVersion: 'gemini-2.5-flash-lite',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await completeAskText({
      system: 'You answer questions about one job file.',
      user: 'Question: what happens in the video',
      anthropicApiKey: null,
      fetchFn,
      mode: 'interactive',
    });
    assert.ok(result);
    assert.equal(result.model, 'gemini-2.5-flash-lite');
    assert.match(result.text, /North slope/);
    assert.equal(result.usage?.inputTokens, 40);
    assert.equal(result.usage?.outputTokens, 12);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.key, 'live-gemini');
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
    restoreEnv('ASK_MODEL', prevAsk);
    restoreEnv('ASK_FAST_MODEL', prevFast);
    restoreEnv('VERIFICATION_PRIMARY_MODEL', prevPrimary);
    restoreEnv('GOOGLE_MODEL_FAST', prevGoogleFast);
  }
});

test('ASK_MODEL env overrides the interactive Ask model', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAsk = process.env.ASK_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  process.env.ASK_MODEL = 'gemini-2.5-flash';
  try {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      urls.push(String(input));
      const body = JSON.parse(String(init?.body ?? '{}'));
      // Non-lite 2.5 interactive: thinkingBudget 0
      assert.equal(body.generationConfig?.thinkingConfig?.thinkingBudget, 0);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Fast flash reply.' }] } }],
          modelVersion: 'gemini-2.5-flash',
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
    assert.equal(result?.text, 'Fast flash reply.');
    assert.match(urls[0] ?? '', /gemini-2\.5-flash:generateContent/);
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('ASK_MODEL', prevAsk);
  }
});

test('completeAskText streams Gemini SSE tokens via onToken', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  try {
    const tokens: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      assert.match(String(input), /streamGenerateContent\?alt=sse/);
      const sse =
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello "}]}}]}\n\n' +
        'data: {"candidates":[{"content":{"parts":[{"text":"world."}]}}],"usageMetadata":{"promptTokenCount":3,"candidatesTokenCount":2},"modelVersion":"gemini-2.5-flash-lite"}\n\n';
      return new Response(sse, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    };
    const result = await completeAskText({
      system: 'sys',
      user: 'hi',
      anthropicApiKey: null,
      fetchFn,
      onToken: (t) => tokens.push(t),
    });
    assert.deepEqual(tokens, ['Hello ', 'world.']);
    assert.equal(result?.text, 'Hello world.');
    assert.equal(result?.model, 'gemini-2.5-flash-lite');
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
  }
});

test('completeAskText retries a retired Gemini model id', async () => {
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevAsk = process.env.ASK_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  process.env.GEMINI_API_KEY = 'live-gemini';
  process.env.ASK_MODEL = 'gemini-2.5-flash-lite';
  try {
    const urls: string[] = [];
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('gemini-2.5-flash-lite')) {
        return new Response(
          'This model models/gemini-2.5-flash-lite is no longer available to new users. Please update your code to use models/gemini-2.5-flash.',
          { status: 404 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Retried on the current model.' }] } }],
          modelVersion: 'gemini-2.5-flash',
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
    assert.equal(result?.model, 'gemini-2.5-flash');
    assert.equal(urls.length, 2);
  } finally {
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('ASK_MODEL', prevAsk);
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
          modelVersion: 'gemini-2.5-flash-lite',
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
    // Brief field hit uses grounded fast path — no model wait.
    assert.equal(result.model, null);
    assert.match(result.answer, /BP-2026-8841/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
  }
});

test('analysis mode defaults to gemini-2.5-pro with high thinking headroom', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  const prevAsk = process.env.ASK_MODEL;
  const prevAnalysis = process.env.ASK_ANALYSIS_MODEL;
  const prevThink = process.env.ASK_ANALYSIS_THINKING_LEVEL;
  const prevPrimary = process.env.VERIFICATION_PRIMARY_MODEL;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ASK_MODEL;
  delete process.env.ASK_ANALYSIS_MODEL;
  delete process.env.ASK_ANALYSIS_THINKING_LEVEL;
  delete process.env.VERIFICATION_PRIMARY_MODEL;
  process.env.GEMINI_API_KEY = 'live-gemini';
  try {
    assert.equal(geminiAskModel('analysis'), 'gemini-2.5-pro');
    assert.equal(geminiAskModel('interactive'), 'gemini-2.5-flash-lite');

    const bodies: any[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      assert.match(String(input), /gemini-2\.5-pro:generateContent/);
      bodies.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Dense reconstruction.' }] } }],
          usageMetadata: { promptTokenCount: 80, candidatesTokenCount: 20 },
          modelVersion: 'gemini-2.5-pro',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const result = await completeAskText({
      system: 'Reconstruct the job film.',
      user: 'Produce dense timed evidence.',
      anthropicApiKey: null,
      fetchFn,
      mode: 'analysis',
    });
    assert.ok(result);
    assert.equal(result.model, 'gemini-2.5-pro');
    assert.equal(bodies[0]?.generationConfig?.thinkingConfig?.thinkingBudget, 8192);
    assert.ok((bodies[0]?.generationConfig?.maxOutputTokens ?? 0) >= 8192);
  } finally {
    restoreEnv('ANTHROPIC_API_KEY', prevAnthropic);
    restoreEnv('GEMINI_API_KEY', prevGemini);
    restoreEnv('GOOGLE_API_KEY', prevGoogle);
    restoreEnv('ASK_MODEL', prevAsk);
    restoreEnv('ASK_ANALYSIS_MODEL', prevAnalysis);
    restoreEnv('ASK_ANALYSIS_THINKING_LEVEL', prevThink);
    restoreEnv('VERIFICATION_PRIMARY_MODEL', prevPrimary);
  }
});
