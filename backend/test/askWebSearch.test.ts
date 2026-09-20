import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askWebCapabilityRules,
  askWebSearchBlockedReason,
  askWebSearchProvider,
  filterWebHitsToAllowed,
  formatWebTrailer,
  geminiWebSearchModel,
  isAskWebSearchConfigured,
  looksLikeOutsideKnowledgeAsk,
  looksLikeWebCapabilityAsk,
  normalizeAskWebCitations,
  parseDuckDuckGoHtml,
  parseGeminiAskWebHitsJson,
  parseWebTrailer,
  sanitizeAskWebQuery,
  searchAskWeb,
  shouldSearchAskWeb,
  shouldSupplementWithWebSearch,
  unwrapDuckDuckGoUrl,
} from '../src/shared/askWebSearch.js';

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const prev: Record<string, string | undefined> = {};
  const keys = Object.keys(vars);
  for (const key of keys) {
    prev[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key] as string;
  }
  return Promise.resolve()
    .then(() => fn())
    .finally(() => {
      for (const key of keys) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key]!;
      }
    });
}

async function clearSearchEnv(fn: () => void | Promise<void>) {
  return withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: undefined,
      ASK_WEB_SEARCH_PROVIDER: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    fn,
  );
}

test('privacy blocks reverse-image, child, and private person identification', () => {
  assert.equal(askWebSearchBlockedReason('reverse image search this photo'), 'reverse_image_search');
  assert.equal(askWebSearchBlockedReason('who is this child in the video'), 'identify_child');
  assert.equal(
    askWebSearchBlockedReason('who is the person in the photo on the job'),
    'identify_private_person',
  );
  assert.equal(askWebSearchBlockedReason('what is IRC R905 for asphalt shingles'), null);
});

test('outside-knowledge detection covers codes, products, and web capability', () => {
  assert.equal(looksLikeOutsideKnowledgeAsk('what does IRC R905 require for underlayment'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('GAF Timberline manufacturer install guide'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('what is the lockbox code'), false);
  assert.equal(looksLikeOutsideKnowledgeAsk('what did the homeowner say about skylights'), false);
  assert.equal(looksLikeWebCapabilityAsk('are you connected to the internet'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('are you connected to the internet'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('can you search the web'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('look this up online'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('do you have internet access'), true);
});

test('explicit web intents and price asks that previously missed detection', () => {
  // Exact failing production strings
  assert.equal(looksLikeWebCapabilityAsk('search the web for tile prices'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('search the web for tile prices'), true);
  assert.equal(looksLikeWebCapabilityAsk('can u search google'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('can u search google'), true);
  assert.equal(looksLikeWebCapabilityAsk('what can you search for'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('what can you search for'), true);

  // Broader explicit intents
  assert.equal(looksLikeWebCapabilityAsk('search google for IRC R905'), true);
  assert.equal(looksLikeWebCapabilityAsk('can ya search google'), true);
  assert.equal(looksLikeWebCapabilityAsk('google tile prices'), true);
  assert.equal(looksLikeWebCapabilityAsk('look up shingle prices online'), true);
  assert.equal(looksLikeWebCapabilityAsk('web search for underlayment'), true);
  assert.equal(looksLikeWebCapabilityAsk('find prices online'), true);

  // Price / product market as outside knowledge
  assert.equal(looksLikeOutsideKnowledgeAsk('tile prices'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('material cost for plywood'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('how much does tile cost'), true);
});

test('askWebCapabilityRules forbids claiming no live search when configured', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: 'test-key',
      ASK_WEB_SEARCH_PROVIDER: 'brave',
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    () => {
      const rules = askWebCapabilityRules();
      assert.match(rules, /results are fetched/i);
      assert.match(rules, /Never claim you lack a live web search tool/i);
      assert.match(rules, /cannot query prices/i);
      assert.doesNotMatch(rules, /not configured/i);
    },
  );
});

test('shouldSupplementWithWebSearch respects grounded hits and privacy', async () => {
  assert.equal(
    shouldSupplementWithWebSearch('what is the lockbox', 'brief · Gate / access: Lockbox 4412'),
    false,
  );
  await clearSearchEnv(() => {
    assert.equal(
      shouldSupplementWithWebSearch('what does IRC R905 require', 'This job file does not have that.'),
      false,
    );
    assert.equal(isAskWebSearchConfigured(), false);
  });
});

test('shouldSupplementWithWebSearch when key is set for code questions', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: 'test-key',
      ASK_WEB_SEARCH_PROVIDER: 'brave',
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    () => {
      assert.equal(
        shouldSupplementWithWebSearch('what does IRC R905 require', 'This job file does not have that.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('who is this child in the photo', 'This job file does not have that.'),
        false,
      );
      assert.equal(
        shouldSearchAskWeb('are you connected to the internet', 'This job file does not have that.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('search the web for tile prices', 'brief · Carrier approved deck.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('can u search google', 'brief · Carrier approved deck.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('what can you search for', 'brief · Carrier approved deck.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('tile prices', 'brief · Carrier approved deck.'),
        true,
      );
    },
  );
});

test('gemini auto-detect: GEMINI_API_KEY alone configures Ask web search', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: undefined,
      ASK_WEB_SEARCH_PROVIDER: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
    },
    () => {
      assert.equal(askWebSearchProvider(), 'gemini');
      assert.equal(isAskWebSearchConfigured(), true);
      assert.match(askWebCapabilityRules(), /CAN look up public web/i);
      assert.doesNotMatch(askWebCapabilityRules(), /not configured/i);
    },
  );
});

test('ASK_WEB_SEARCH_PROVIDER=off disables even with GEMINI_API_KEY', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'off',
      GEMINI_API_KEY: 'gemini-test-key',
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    () => {
      assert.equal(askWebSearchProvider(), null);
      assert.equal(isAskWebSearchConfigured(), false);
      assert.match(askWebCapabilityRules(), /not configured/i);
    },
  );
});

test('brave key preferred over gemini when both present', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: undefined,
      BRAVE_SEARCH_API_KEY: 'brave-key',
      GEMINI_API_KEY: 'gemini-test-key',
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    () => {
      assert.equal(askWebSearchProvider(), 'brave');
    },
  );
});

test('sanitizeAskWebQuery strips lockbox codes and street addresses', () => {
  const cleaned = sanitizeAskWebQuery(
    'IRC underlayment rules for 2214 Cedar Ridge Dr Round Rock 78681 lockbox code 4412',
  );
  assert.doesNotMatch(cleaned, /4412/);
  assert.doesNotMatch(cleaned, /2214 Cedar Ridge/);
  assert.doesNotMatch(cleaned, /78681/);
  assert.match(cleaned, /IRC underlayment/i);
});

test('web trailer round-trips and filters hallucinated URLs', () => {
  const hits = [
    {
      title: 'IRC R905',
      url: 'https://codes.iccsafe.org/r905',
      snippet: 'Asphalt shingles',
    },
    {
      title: 'GAF guide',
      url: 'https://www.gaf.com/install',
      snippet: 'Install',
    },
  ];
  const trailer = formatWebTrailer(hits);
  assert.match(trailer, /⟦web:/);
  const parsed = parseWebTrailer(`Answer here.\n\n${trailer}`);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.url, 'https://codes.iccsafe.org/r905');

  const filtered = filterWebHitsToAllowed(
    [
      ...parsed,
      { title: 'Fake', url: 'https://evil.example/fake', snippet: '' },
    ],
    hits,
  );
  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((h) => h.url !== 'https://evil.example/fake'));
});

test('normalizeAskWebCitations attaches validated trailer', () => {
  const hits = [
    {
      title: 'IRC R905',
      url: 'https://codes.iccsafe.org/r905',
      snippet: 'Asphalt shingles',
    },
  ];
  const withModel = normalizeAskWebCitations(
    'IRC R905 covers asphalt shingle underlayment.\n\n⟦web: IRC R905|https://codes.iccsafe.org/r905⟧',
    hits,
  );
  assert.match(withModel, /⟦web: IRC R905\|https:\/\/codes\.iccsafe\.org\/r905⟧/);
  assert.doesNotMatch(withModel.replace(/⟦web:[^⟧]+⟧/, ''), /⟦web:/);

  const missing = normalizeAskWebCitations(
    'Per code, asphalt shingles need proper underlayment under IRC R905.',
    hits,
  );
  assert.match(missing, /⟦web:/);
});

test('searchAskWeb soft-fails when unset and when fetch errors', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'off',
      ASK_WEB_SEARCH_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    async () => {
      assert.deepEqual(await searchAskWeb('IRC R905'), []);
    },
  );

  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: 'test-key',
      ASK_WEB_SEARCH_PROVIDER: 'brave',
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('IRC R905 underlayment', {
        fetchFn: async () => {
          throw new Error('network down');
        },
      });
      assert.deepEqual(hits, []);
    },
  );
});

test('searchAskWeb parses Brave-shaped JSON', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: 'test-key',
      ASK_WEB_SEARCH_PROVIDER: 'brave',
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('IRC R905', {
        fetchFn: async () =>
          new Response(
            JSON.stringify({
              web: {
                results: [
                  {
                    title: 'IRC R905',
                    url: 'https://codes.iccsafe.org/r905',
                    description: 'Roof covering',
                  },
                ],
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
      });
      assert.equal(hits.length, 1);
      assert.equal(hits[0]?.title, 'IRC R905');
      assert.equal(hits[0]?.url, 'https://codes.iccsafe.org/r905');
    },
  );
});

test('parseGeminiAskWebHitsJson reads hits object and array forms', () => {
  const fromObj = parseGeminiAskWebHitsJson(
    '{"hits":[{"title":"IRC R905","url":"https://codes.iccsafe.org/r905","snippet":"Roof"}]}',
  );
  assert.equal(fromObj.length, 1);
  assert.equal(fromObj[0]?.url, 'https://codes.iccsafe.org/r905');

  const fromArr = parseGeminiAskWebHitsJson(
    '[{"title":"GAF","url":"https://www.gaf.com/install","description":"Guide"}]',
  );
  assert.equal(fromArr.length, 1);
  assert.equal(fromArr[0]?.snippet, 'Guide');
});

test('searchAskWeb parses Gemini grounding metadata and JSON parts', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('IRC R905 underlayment', {
        fetchFn: async (_url, init) => {
          const body = JSON.parse(String((init as RequestInit)?.body ?? '{}')) as {
            tools?: unknown[];
          };
          assert.ok(body.tools?.some((t) => t && typeof t === 'object' && 'google_search' in (t as object)));
          return new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          hits: [
                            {
                              title: 'From JSON',
                              url: 'https://example.com/from-json',
                              snippet: 'JSON part',
                            },
                          ],
                        }),
                      },
                    ],
                  },
                  groundingMetadata: {
                    groundingChunks: [
                      {
                        web: {
                          uri: 'https://codes.iccsafe.org/r905',
                          title: 'IRC R905',
                        },
                      },
                      {
                        web: {
                          uri: 'https://example.com/from-json',
                          title: 'Dup',
                        },
                      },
                    ],
                  },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      });
      assert.ok(hits.length >= 1);
      assert.equal(hits[0]?.url, 'https://codes.iccsafe.org/r905');
      assert.equal(hits[0]?.title, 'IRC R905');
      // Deduped grounding + JSON share one URL
      assert.equal(hits.filter((h) => h.url === 'https://example.com/from-json').length, 1);
    },
  );
});

test('searchAskWeb soft-fails on Gemini HTTP errors', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('IRC R905', {
        fetchFn: async () => new Response('nope', { status: 403 }),
      });
      assert.deepEqual(hits, []);
    },
  );
});


test('geminiWebSearchModel prefers ASK_WEB_SEARCH_MODEL and ignores verification model', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_MODEL: undefined,
      VERIFICATION_PRIMARY_MODEL: 'gemini-2.5-pro',
    },
    () => {
      assert.equal(geminiWebSearchModel(), 'gemini-2.5-flash');
    },
  );
  await withEnv(
    {
      ASK_WEB_SEARCH_MODEL: 'gemini-2.0-flash',
      VERIFICATION_PRIMARY_MODEL: 'gemini-2.5-pro',
    },
    () => {
      assert.equal(geminiWebSearchModel(), 'gemini-2.0-flash');
    },
  );
});

test('unwrapDuckDuckGoUrl and parseDuckDuckGoHtml extract organic hits', () => {
  const wrapped =
    'https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.vonmaur.com%2Fstores%2Fbrookfield&rut=abc';
  assert.equal(unwrapDuckDuckGoUrl(wrapped), 'https://www.vonmaur.com/stores/brookfield');

  const html = `
    <div class="result">
      <a rel="nofollow" class="result__a" href="${wrapped}">Von Maur — Corners of Brookfield</a>
      <a class="result__snippet" href="#">Department store at The Corners of Brookfield.</a>
    </div>
    <div class="result">
      <a class="result__a" href="https://example.com/direct">Direct title</a>
      <a class="result__snippet" href="#">Direct snippet</a>
    </div>
    <div class="result">
      <a class="result__a" href="https://codes.iccsafe.org/r905"></a>
      <a class="result__snippet" href="#">Empty title uses hostname</a>
    </div>
  `;
  const hits = parseDuckDuckGoHtml(html, 5);
  assert.equal(hits.length, 3);
  assert.equal(hits[0]?.url, 'https://www.vonmaur.com/stores/brookfield');
  assert.match(hits[0]?.title ?? '', /Von Maur/i);
  assert.match(hits[0]?.snippet ?? '', /Department store/i);
  assert.equal(hits[1]?.url, 'https://example.com/direct');
  assert.equal(hits[2]?.title, 'codes.iccsafe.org');
});

const DDG_HTML_FIXTURE = `
<html><body>
  <a class="result__a" href="https://duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.vonmaur.com%2Flocations%2Fbrookfield&rut=x">Von Maur Corners of Brookfield</a>
  <a class="result__snippet" href="#">Store hours and directions.</a>
  <a class="result__a" href="https://www.thecornersofbrookfield.com/">The Corners of Brookfield</a>
  <a class="result__snippet" href="#">Shopping center directory.</a>
</body></html>
`;

test('searchAskWeb falls back to DuckDuckGo when Gemini throws', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
      ASK_WEB_SEARCH_MODEL: undefined,
      VERIFICATION_PRIMARY_MODEL: 'gemini-2.5-pro',
    },
    async () => {
      const urls: string[] = [];
      const hits = await searchAskWeb('search google for von mour corners of brookfield', {
        fetchFn: async (input, init) => {
          const url = String(input);
          urls.push(url);
          if (url.includes('generativelanguage.googleapis.com')) {
            assert.match(url, /gemini-2\.5-flash/);
            assert.doesNotMatch(url, /gemini-2\.5-pro/);
            return new Response('{"error":{"message":"model does not support google_search"}}', {
              status: 400,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('api.duckduckgo.com')) {
            return new Response(JSON.stringify({ AbstractURL: '', RelatedTopics: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            });
          }
          if (url.includes('duckduckgo.com')) {
            return new Response(DDG_HTML_FIXTURE, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return new Response('unexpected', { status: 500 });
        },
      });
      assert.ok(hits.length >= 1, `expected DDG hits, got ${hits.length}; urls=${urls.join(' | ')}`);
      assert.equal(hits[0]?.url, 'https://www.vonmaur.com/locations/brookfield');
      assert.match(hits[0]?.title ?? '', /Von Maur/i);
      assert.ok(urls.some((u) => u.includes('generativelanguage')));
      assert.ok(urls.some((u) => u.includes('duckduckgo')));
    },
  );
});

test('searchAskWeb falls back to DuckDuckGo when Gemini returns empty hits', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('search google for von mour corners of brookfield', {
        fetchFn: async (input) => {
          const url = String(input);
          if (url.includes('generativelanguage.googleapis.com')) {
            return new Response(
              JSON.stringify({
                candidates: [{ content: { parts: [{ text: '{"hits":[]}' }] }, groundingMetadata: {} }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          if (url.includes('api.duckduckgo.com')) {
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
          if (url.includes('duckduckgo.com')) {
            return new Response(DDG_HTML_FIXTURE, {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            });
          }
          return new Response('nope', { status: 404 });
        },
      });
      assert.ok(hits.length >= 1);
      assert.equal(hits[0]?.url, 'https://www.vonmaur.com/locations/brookfield');
    },
  );
});

test('sanitizeAskWebQuery still strips street addresses after fallback path', () => {
  const cleaned = sanitizeAskWebQuery(
    'search google for von mour near 2214 Cedar Ridge Dr Round Rock 78681',
  );
  assert.doesNotMatch(cleaned, /2214 Cedar Ridge/);
  assert.doesNotMatch(cleaned, /78681/);
  assert.match(cleaned, /von mour/i);
});

test('searchAskWeb Gemini empty-title grounding uses hostname fallback', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: undefined,
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      ASK_WEB_SEARCH_API_KEY: undefined,
    },
    async () => {
      const hits = await searchAskWeb('IRC R905', {
        fetchFn: async (input) => {
          const url = String(input);
          if (url.includes('generativelanguage.googleapis.com')) {
            return new Response(
              JSON.stringify({
                candidates: [
                  {
                    content: { parts: [{ text: '' }] },
                    groundingMetadata: {
                      groundingChunks: [{ web: { uri: 'https://codes.iccsafe.org/r905', title: '' } }],
                      groundingSupports: [
                        {
                          groundingChunkIndices: [0],
                          segment: { text: 'Asphalt shingle underlayment rules.' },
                        },
                      ],
                    },
                  },
                ],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            );
          }
          // Should not need DDG
          return new Response('nope', { status: 500 });
        },
      });
      assert.equal(hits.length, 1);
      assert.equal(hits[0]?.url, 'https://codes.iccsafe.org/r905');
      assert.equal(hits[0]?.title, 'codes.iccsafe.org');
      assert.match(hits[0]?.snippet ?? '', /Asphalt shingle/i);
    },
  );
});
