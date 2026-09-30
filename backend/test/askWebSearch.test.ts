import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASK_WEB_FORMAT_RULES,
  askClockSystemRules,
  askWebCapabilityRules,
  askWebSearchBlockedReason,
  askWebSearchProvider,
  asksAboutJobFile,
  composeAskWebAnswer,
  filterWebHitsToAllowed,
  formatWebTrailer,
  geminiWebSearchModel,
  isAskWebSearchConfigured,
  filterLowValueWebCitations,
  isLowValueWebCitation,
  looksLikeExplicitWebSearchRequest,
  looksLikeLiveTopicalAsk,
  looksLikeOutsideKnowledgeAsk,
  looksLikePureWebCapabilityAsk,
  looksLikeWebCapabilityAsk,
  normalizeAskWebCitations,
  professionalWebCapabilityAnswer,
  parseDuckDuckGoHtml,
  parseWebTrailer,
  resolveAskSearchQuery,
  sanitizeAskWebQuery,
  searchAskWeb,
  shouldSearchAskWeb,
  shouldSupplementWithWebSearch,
  stripWebTrailer,
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

/** Fake key only. Never a real Tavily secret. */
const TAVILY_ON = {
  TAVILY_API_KEY: 'tvly-test-not-real',
  ASK_WEB_SEARCH_PROVIDER: undefined,
  ASK_WEB_SEARCH_API_KEY: undefined,
  BRAVE_SEARCH_API_KEY: undefined,
  SERPER_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  GOOGLE_API_KEY: undefined,
} as const;

const ASK_NOW = new Date('2026-09-30T15:00:00.000Z');

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

test('live topical asks (sports / weather / news) take the web_search path', async () => {
  // Exact production refusal prompt from Tiffany & Co. Chat screenshot
  assert.equal(looksLikeLiveTopicalAsk('what NFL Games are on today'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('what NFL Games are on today'), true);
  assert.equal(looksLikeLiveTopicalAsk('NFL games tonight'), true);
  assert.equal(looksLikeLiveTopicalAsk('what basketball games are on today'), true);
  assert.equal(looksLikeLiveTopicalAsk('sports scores today'), true);
  assert.equal(looksLikeLiveTopicalAsk("what's the weather today"), true);
  assert.equal(looksLikeLiveTopicalAsk('weather forecast in Austin'), true);
  assert.equal(looksLikeLiveTopicalAsk('latest news headlines'), true);
  assert.equal(looksLikeLiveTopicalAsk('breaking news about the storm'), true);
  assert.equal(looksLikeLiveTopicalAsk('where can I buy GAF Timberline shingles'), true);

  // Job-file schedule / evidence asks must NOT look like live sports topical
  assert.equal(looksLikeLiveTopicalAsk('what is the lockbox code'), false);
  assert.equal(looksLikeLiveTopicalAsk('what did the homeowner say about skylights'), false);
  assert.equal(looksLikeLiveTopicalAsk('when is this job scheduled to start'), false);

  await withEnv(TAVILY_ON, () => {
      assert.equal(
        shouldSupplementWithWebSearch('what NFL Games are on today', 'brief · Carrier approved deck.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch("what's the weather today", 'This job file does not have that.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('latest news headlines', 'brief · Permit: BP-1'),
        true,
      );
      // Capability-only still skips live fetch
      assert.equal(
        shouldSupplementWithWebSearch('can you search the web?', 'brief · Carrier approved deck.'),
        false,
      );
    },
  );
});

test('askWebCapabilityRules forbids claiming no live search when configured', async () => {
  await withEnv(TAVILY_ON, () => {
    const rules = askWebCapabilityRules();
    assert.match(rules, /You CAN search the public web/i);
    assert.match(rules, /job file comes first/i);
    assert.match(rules, /Never claim you lack a live web search tool/i);
    assert.match(rules, /cannot query prices/i);
    assert.match(rules, /CURRENT DATE AND TIME/i);
    assert.match(rules, /do not soft-refuse/i);
    assert.doesNotMatch(rules, /not configured/i);
    assert.match(ASK_WEB_FORMAT_RULES, /The job file wins/i);
    assert.match(ASK_WEB_FORMAT_RULES, /\*\*Web results\*\*/);
  });
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
  await withEnv(TAVILY_ON, () => {
      assert.equal(
        shouldSupplementWithWebSearch('what does IRC R905 require', 'This job file does not have that.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('who is this child in the photo', 'This job file does not have that.'),
        false,
      );
      // Pure capability — answer yes from rules; do not fetch google.com junk
      assert.equal(
        shouldSearchAskWeb('are you connected to the internet', 'This job file does not have that.'),
        false,
      );
      assert.equal(
        shouldSupplementWithWebSearch('can u search google', 'brief · Carrier approved deck.'),
        false,
      );
      assert.equal(
        shouldSupplementWithWebSearch('what can you search for', 'brief · Carrier approved deck.'),
        false,
      );
      // Topical web intents still search
      assert.equal(
        shouldSupplementWithWebSearch('search the web for tile prices', 'brief · Carrier approved deck.'),
        true,
      );
      assert.equal(
        shouldSupplementWithWebSearch('tile prices', 'brief · Carrier approved deck.'),
        true,
      );
    },
  );
});

test('TAVILY_API_KEY configures Ask web search; other provider keys do not', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: undefined,
      ASK_WEB_SEARCH_PROVIDER: undefined,
      BRAVE_SEARCH_API_KEY: 'brave-key',
      SERPER_API_KEY: 'serper-key',
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: 'gemini-test-key',
      GOOGLE_API_KEY: 'google-test-key',
    },
    () => {
      assert.equal(askWebSearchProvider(), null);
      assert.equal(isAskWebSearchConfigured(), false);
      assert.match(askWebCapabilityRules(), /not configured/i);
    },
  );
  await withEnv(TAVILY_ON, () => {
    assert.equal(askWebSearchProvider(), 'tavily');
    assert.equal(isAskWebSearchConfigured(), true);
    assert.match(askWebCapabilityRules(), /You CAN search the public web/i);
    assert.doesNotMatch(askWebCapabilityRules(), /not configured/i);
  });
});

test('ASK_WEB_SEARCH_PROVIDER=off disables even with TAVILY_API_KEY', async () => {
  await withEnv(
    {
      ASK_WEB_SEARCH_PROVIDER: 'off',
      TAVILY_API_KEY: 'tvly-test-not-real',
      GEMINI_API_KEY: 'gemini-test-key',
      BRAVE_SEARCH_API_KEY: 'brave-key',
      SERPER_API_KEY: undefined,
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

test('job-file questions are not auto-searched; explicit and public questions are', async () => {
  await withEnv(TAVILY_ON, () => {
    assert.equal(asksAboutJobFile('what did the homeowner say about the lockbox'), true);
    assert.equal(looksLikeExplicitWebSearchRequest('what did the homeowner say about the lockbox'), false);
    assert.equal(
      shouldSupplementWithWebSearch('what did the homeowner say about the lockbox', 'brief · Lockbox 4412'),
      false,
    );
    assert.equal(shouldSupplementWithWebSearch('how many clips are in the video', 'brief · two clips'), false);
    assert.equal(shouldSupplementWithWebSearch('search the transcript for the lockbox', 'brief · Lockbox 4412'), false);
    assert.equal(shouldSupplementWithWebSearch('search the web for the capital of France', 'brief · Lockbox 4412'), true);
    assert.equal(shouldSupplementWithWebSearch('what is the capital of France', 'brief · Carrier approved deck.'), true);
    assert.equal(shouldSupplementWithWebSearch('what NFL game is Thursday?', 'brief · Carrier approved deck.'), true);

    const jobFirst = composeAskWebAnswer({
      question: 'what is the lockbox',
      jobAnswer: 'brief · Gate / access: Lockbox 4412',
      webAnswer: 'A lockbox is a real estate key box.',
      hits: [{ title: 'Lockbox', url: 'https://example.com/lockbox', snippet: 'A lockbox holds keys.' }],
    });
    assert.match(jobFirst, /^brief · Gate \/ access: Lockbox 4412/);
    assert.match(jobFirst, /\*\*Web results\*\*/);
    assert.doesNotMatch(jobFirst.split('**Web results**')[0] ?? '', /real estate key box/);

    const publicAnswer = composeAskWebAnswer({
      question: 'what NFL game is Thursday?',
      jobAnswer: 'brief · Carrier approved the deck.',
      webAnswer: 'Packers at Lions on October 1, 2026.',
      hits: [{ title: 'NFL schedule', url: 'https://example.com/nfl', snippet: 'Thursday night game.' }],
    });
    assert.match(publicAnswer, /^Packers at Lions on October 1, 2026/);
    assert.match(publicAnswer, /\[NFL schedule\]\(https:\/\/example\.com\/nfl\)/);
  });
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
  await clearSearchEnv(async () => {
    let called = false;
    const hits = await searchAskWeb('IRC R905', {
      fetchFn: async () => {
        called = true;
        return new Response('should not run', { status: 500 });
      },
    });
    assert.equal(called, false);
    assert.deepEqual(hits, []);
  });

  await withEnv(TAVILY_ON, async () => {
    const warns: string[] = [];
    const orig = console.warn;
    console.warn = (...args: unknown[]) => {
      warns.push(args.map(String).join(' '));
    };
    try {
      const hits = await searchAskWeb('IRC R905 underlayment', {
        fetchFn: async () => {
          throw new Error('Authorization: Bearer tvly-test-not-real failed');
        },
      });
      assert.deepEqual(hits, []);
      const line = warns.find((row) => row.includes('ask_web_search_failed'));
      assert.ok(line, 'expected a search-failure log');
      assert.doesNotMatch(line!, /tvly-test-not-real/);
      assert.match(line!, /Bearer \[redacted\]/);
    } finally {
      console.warn = orig;
    }
  });
});

test('searchAskWeb calls Tavily with Bearer auth, caps results, and never logs the key', async () => {
  await withEnv(TAVILY_ON, async () => {
    const logs: string[] = [];
    const orig = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    };
    const urls: string[] = [];
    try {
      const hits = await searchAskWeb('Home Depot and Lowe\'s tile prices', {
        limit: 20,
        includeDomains: ['homedepot.com'],
        fetchFn: async (input, init) => {
          urls.push(String(input));
          assert.equal(String(input), 'https://api.tavily.com/search');
          assert.equal(init?.method, 'POST');
          const headers = (init?.headers ?? {}) as Record<string, string>;
          assert.equal(headers.Authorization, 'Bearer tvly-test-not-real');
          assert.equal('api_key' in headers, false);
          const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
          assert.equal(body.api_key, undefined);
          assert.equal(body.search_depth, 'basic');
          assert.equal(body.max_results, 5);
          assert.equal(body.include_answer, true);
          assert.deepEqual(body.include_domains, ['homedepot.com', 'lowes.com']);
          assert.ok(init?.signal instanceof AbortSignal);
          return new Response(
            JSON.stringify({
              answer: 'Ceramic tile runs about $2 to $8 a square foot.',
              results: Array.from({ length: 8 }, (_, i) => ({
                title: `Tile ${i + 1}`,
                url: `https://example.com/tile-${i + 1}`,
                content: `Snippet ${i + 1}`,
              })),
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      });
      assert.equal(hits.length, 5);
      assert.equal(hits[0]?.title, 'Tile 1');
      assert.equal(hits[0]?.snippet, 'Snippet 1');
      assert.deepEqual(urls, ['https://api.tavily.com/search']);
      const line = logs.find((row) => row.includes('"msg":"ask_web_search"'));
      assert.ok(line, 'expected an ask_web_search count log');
      assert.doesNotMatch(line!, /tvly-test-not-real/);
      assert.doesNotMatch(line!, /Authorization/);
      const parsed = JSON.parse(line!) as { searches?: unknown; results?: unknown };
      assert.equal(typeof parsed.searches, 'number');
      assert.ok((parsed.searches as number) >= 1);
      assert.equal(parsed.results, 5);
    } finally {
      console.log = orig;
    }
  });
});

test('relative days resolve in America/Chicago and the Tavily query includes that date', async () => {
  const clock = askClockSystemRules(ASK_NOW, 'America/Chicago');
  assert.match(clock, /Wednesday, September 30, 2026/);
  assert.match(clock, /10:00 AM CDT/);
  assert.match(clock, /America\/Chicago/);
  assert.match(clock, /Thursday/);
  assert.match(clock, /this Sunday/);

  assert.match(resolveAskSearchQuery('what NFL game is Thursday?', ASK_NOW, 'America/Chicago'), /Thursday, October 1, 2026/);
  assert.match(resolveAskSearchQuery('what is on this Sunday?', ASK_NOW, 'America/Chicago'), /Sunday, October 4, 2026/);
  assert.match(resolveAskSearchQuery('games tomorrow', ASK_NOW, 'America/Chicago'), /Thursday, October 1, 2026/);
  assert.match(resolveAskSearchQuery('next Wednesday night', ASK_NOW, 'America/Chicago'), /Wednesday, October 7, 2026/);
  assert.equal(
    resolveAskSearchQuery('what NFL game is Thursday?', ASK_NOW, 'America/Chicago').includes('Thursday, October 1, 2026'),
    true,
  );

  await withEnv(TAVILY_ON, async () => {
    let query = '';
    const hits = await searchAskWeb('what NFL game is Thursday?', {
      now: ASK_NOW,
      timeZone: 'America/Chicago',
      fetchFn: async (_input, init) => {
        query = String((JSON.parse(String(init?.body ?? '{}')) as { query?: string }).query ?? '');
        return new Response(
          JSON.stringify({
            answer: 'Packers at Lions on Thursday, October 1, 2026.',
            results: [
              {
                title: 'NFL schedule',
                url: 'https://example.com/nfl-thursday',
                content: 'Thursday, October 1, 2026: Packers at Lions.',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    });
    assert.match(query, /October 1, 2026/);
    assert.match(query, /what NFL game is Thursday/i);
    assert.equal(hits[0]?.url, 'https://example.com/nfl-thursday');
  });
});

test('searchAskWeb soft-fails on Tavily HTTP errors and does not call another provider', async () => {
  await withEnv(TAVILY_ON, async () => {
    const urls: string[] = [];
    const hits = await searchAskWeb('IRC R905', {
      fetchFn: async (input) => {
        urls.push(String(input));
        return new Response('nope tvly-test-not-real', { status: 403 });
      },
    });
    assert.deepEqual(hits, []);
    assert.deepEqual(urls, ['https://api.tavily.com/search']);
  });
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

test('sanitizeAskWebQuery still strips street addresses after fallback path', () => {
  const cleaned = sanitizeAskWebQuery(
    'search google for von mour near 2214 Cedar Ridge Dr Round Rock 78681',
  );
  assert.doesNotMatch(cleaned, /2214 Cedar Ridge/);
  assert.doesNotMatch(cleaned, /78681/);
  assert.match(cleaned, /von mour/i);
});


test('looksLikePureWebCapabilityAsk distinguishes capability-only from topical search', () => {
  assert.equal(looksLikePureWebCapabilityAsk('can you search the web?'), true);
  assert.equal(looksLikePureWebCapabilityAsk('can u search google'), true);
  assert.equal(looksLikePureWebCapabilityAsk('are you connected to the internet'), true);
  assert.equal(looksLikePureWebCapabilityAsk('what can you search for'), true);
  assert.equal(looksLikePureWebCapabilityAsk('search the web for tile prices'), false);
  assert.equal(looksLikePureWebCapabilityAsk('google tile prices'), false);
  assert.equal(looksLikePureWebCapabilityAsk('look up shingle prices online'), false);
});

test('parseWebTrailer and stripWebTrailer handle ASCII [[web:…]]', () => {
  const raw =
    'Would you like to search the web?[[web: Google|https://www.google.com/xhtml/search, Google Search|https://search.google/]]';
  const parsed = parseWebTrailer(raw);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.url, 'https://www.google.com/xhtml/search');
  const stripped = stripWebTrailer(raw);
  assert.equal(stripped, 'Would you like to search the web?');
  assert.doesNotMatch(stripped, /\[\[web:/i);
});

// Exact junk trailer from live user screenshot after “can you search google”
test('stripWebTrailer removes exact screenshot [web:…] google/wikihow junk', () => {
  const junk =
    '[web: Google|https://www.google.com/xhtml/search, Google Search - A new kind of help|https://search.google/, How to Search Google: Basic Advanced & AI Options|https://www.wikihow.com/Search-Google]';
  const raw = `Yes — I can search the public web when you need it.${junk}`;
  const parsed = parseWebTrailer(raw);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0]?.url, 'https://www.google.com/xhtml/search');
  assert.equal(parsed[1]?.url, 'https://search.google/');
  assert.equal(parsed[2]?.url, 'https://www.wikihow.com/Search-Google');
  const stripped = stripWebTrailer(raw);
  assert.equal(stripped, 'Yes — I can search the public web when you need it.');
  assert.doesNotMatch(stripped, /\[web:/i);
  assert.doesNotMatch(stripped, /google\.com|search\.google|wikihow/i);

  const normalized = normalizeAskWebCitations(raw, parsed, {
    question: 'can you search google',
  });
  assert.equal(normalized, 'Yes — I can search the public web when you need it.');
  assert.doesNotMatch(normalized, /web:/i);
});

test('isLowValueWebCitation flags google homepage and how-to-search junk', () => {
  assert.equal(
    isLowValueWebCitation({ title: 'Google', url: 'https://www.google.com/xhtml/search' }),
    true,
  );
  assert.equal(
    isLowValueWebCitation({ title: 'Google Search', url: 'https://search.google/' }),
    true,
  );
  assert.equal(
    isLowValueWebCitation({
      title: 'How to Search Google',
      url: 'https://www.wikihow.com/Search-Google',
    }),
    true,
  );
  assert.equal(
    isLowValueWebCitation({ title: 'IRC R905', url: 'https://codes.iccsafe.org/r905' }),
    false,
  );
  const filtered = filterLowValueWebCitations([
    { title: 'Google', url: 'https://www.google.com/', snippet: '' },
    { title: 'IRC R905', url: 'https://codes.iccsafe.org/r905', snippet: '' },
  ]);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.url, 'https://codes.iccsafe.org/r905');
});

test('normalizeAskWebCitations strips ASCII trailer and skips capability junk', () => {
  const junk = [
    {
      title: 'Google',
      url: 'https://www.google.com/xhtml/search',
      snippet: 'Search',
    },
    {
      title: 'Google Search',
      url: 'https://search.google/',
      snippet: 'Search',
    },
  ];
  const capability = normalizeAskWebCitations(
    'Yes, I can search the public web.[[web: Google|https://www.google.com/xhtml/search]]',
    junk,
    { question: 'can you search the web?' },
  );
  assert.equal(capability, 'Yes, I can search the public web.');
  assert.doesNotMatch(capability, /web:/i);
  assert.doesNotMatch(capability, /google\.com/i);

  const topical = normalizeAskWebCitations(
    'Tile runs about $2–$8/sq ft.\n\n⟦web: Tile prices|https://www.homedepot.com/tile, Google|https://www.google.com/⟧',
    [
      {
        title: 'Tile prices',
        url: 'https://www.homedepot.com/tile',
        snippet: 'Tile',
      },
      {
        title: 'Google',
        url: 'https://www.google.com/',
        snippet: '',
      },
    ],
    { question: 'search the web for tile prices' },
  );
  assert.match(topical, /⟦web: Tile prices\|https:\/\/www\.homedepot\.com\/tile⟧/);
  assert.doesNotMatch(topical, /google\.com/);
  assert.doesNotMatch(topical, /\[\[web:/);
});

test('askWebCapabilityRules and format rules forbid web trailers', async () => {
  await withEnv(TAVILY_ON, () => {
    const rules = askWebCapabilityRules();
    assert.match(rules, /\*\*Web results\*\*/);
    assert.match(rules, /separate from job evidence/i);
    assert.match(ASK_WEB_FORMAT_RULES, /Do not write ⟦web:/);
    assert.match(ASK_WEB_FORMAT_RULES, /\[\[web:/);
    assert.match(ASK_WEB_FORMAT_RULES, /quotation marks are only for an exact transcript/i);
  });
});

test('professionalWebCapabilityAnswer is a short yes without citations', async () => {
  await withEnv(TAVILY_ON, () => {
      const yes = professionalWebCapabilityAnswer('can you search google?');
      assert.match(yes, /^Yes/i);
      assert.doesNotMatch(yes, /web:/i);
      assert.doesNotMatch(yes, /google\.com/i);
      assert.doesNotMatch(yes, /\*/);
      assert.ok(yes.split(/[.!?]/).filter((s) => s.trim()).length <= 4);

      const what = professionalWebCapabilityAnswer('what can you search for');
      assert.match(what, /codes|products|prices/i);
      assert.doesNotMatch(what, /\[\[web:/i);
    },
  );

  await withEnv(
    {
      ASK_WEB_SEARCH_API_KEY: undefined,
      ASK_WEB_SEARCH_PROVIDER: 'off',
      BRAVE_SEARCH_API_KEY: undefined,
      SERPER_API_KEY: undefined,
      TAVILY_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      GOOGLE_API_KEY: undefined,
    },
    () => {
      const offline = professionalWebCapabilityAnswer('can you search the web?');
      assert.match(offline, /not configured|job file/i);
      assert.doesNotMatch(offline, /web:/i);
    },
  );
});
