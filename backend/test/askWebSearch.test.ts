import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askWebSearchBlockedReason,
  filterWebHitsToAllowed,
  formatWebTrailer,
  looksLikeOutsideKnowledgeAsk,
  normalizeAskWebCitations,
  parseWebTrailer,
  sanitizeAskWebQuery,
  searchAskWeb,
  shouldSupplementWithWebSearch,
} from '../src/shared/askWebSearch.js';

test('privacy blocks reverse-image, child, and private person identification', () => {
  assert.equal(askWebSearchBlockedReason('reverse image search this photo'), 'reverse_image_search');
  assert.equal(askWebSearchBlockedReason('who is this child in the video'), 'identify_child');
  assert.equal(
    askWebSearchBlockedReason('who is the person in the photo on the job'),
    'identify_private_person',
  );
  assert.equal(askWebSearchBlockedReason('what is IRC R905 for asphalt shingles'), null);
});

test('outside-knowledge detection covers codes and products', () => {
  assert.equal(looksLikeOutsideKnowledgeAsk('what does IRC R905 require for underlayment'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('GAF Timberline manufacturer install guide'), true);
  assert.equal(looksLikeOutsideKnowledgeAsk('what is the lockbox code'), false);
  assert.equal(looksLikeOutsideKnowledgeAsk('what did the homeowner say about skylights'), false);
});

test('shouldSupplementWithWebSearch respects grounded hits and privacy', () => {
  assert.equal(
    shouldSupplementWithWebSearch('what is the lockbox', 'brief · Gate / access: Lockbox 4412'),
    false,
  );
  // Without a configured key, always false.
  const prev = process.env.ASK_WEB_SEARCH_API_KEY;
  const prevBrave = process.env.BRAVE_SEARCH_API_KEY;
  const prevProv = process.env.ASK_WEB_SEARCH_PROVIDER;
  delete process.env.ASK_WEB_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.ASK_WEB_SEARCH_PROVIDER;
  try {
    assert.equal(
      shouldSupplementWithWebSearch('what does IRC R905 require', 'This job file does not have that.'),
      false,
    );
  } finally {
    if (prev === undefined) delete process.env.ASK_WEB_SEARCH_API_KEY;
    else process.env.ASK_WEB_SEARCH_API_KEY = prev;
    if (prevBrave === undefined) delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY = prevBrave;
    if (prevProv === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
    else process.env.ASK_WEB_SEARCH_PROVIDER = prevProv;
  }
});

test('shouldSupplementWithWebSearch when key is set for code questions', () => {
  const prev = process.env.ASK_WEB_SEARCH_API_KEY;
  const prevProv = process.env.ASK_WEB_SEARCH_PROVIDER;
  process.env.ASK_WEB_SEARCH_API_KEY = 'test-key';
  process.env.ASK_WEB_SEARCH_PROVIDER = 'brave';
  try {
    assert.equal(
      shouldSupplementWithWebSearch('what does IRC R905 require', 'This job file does not have that.'),
      true,
    );
    assert.equal(
      shouldSupplementWithWebSearch('who is this child in the photo', 'This job file does not have that.'),
      false,
    );
  } finally {
    if (prev === undefined) delete process.env.ASK_WEB_SEARCH_API_KEY;
    else process.env.ASK_WEB_SEARCH_API_KEY = prev;
    if (prevProv === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
    else process.env.ASK_WEB_SEARCH_PROVIDER = prevProv;
  }
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
  const prev = process.env.ASK_WEB_SEARCH_API_KEY;
  const prevProv = process.env.ASK_WEB_SEARCH_PROVIDER;
  delete process.env.ASK_WEB_SEARCH_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  process.env.ASK_WEB_SEARCH_PROVIDER = 'off';
  try {
    assert.deepEqual(await searchAskWeb('IRC R905'), []);
  } finally {
    if (prev === undefined) delete process.env.ASK_WEB_SEARCH_API_KEY;
    else process.env.ASK_WEB_SEARCH_API_KEY = prev;
    if (prevProv === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
    else process.env.ASK_WEB_SEARCH_PROVIDER = prevProv;
  }

  process.env.ASK_WEB_SEARCH_API_KEY = 'test-key';
  process.env.ASK_WEB_SEARCH_PROVIDER = 'brave';
  try {
    const hits = await searchAskWeb('IRC R905 underlayment', {
      fetchFn: async () => {
        throw new Error('network down');
      },
    });
    assert.deepEqual(hits, []);
  } finally {
    if (prev === undefined) delete process.env.ASK_WEB_SEARCH_API_KEY;
    else process.env.ASK_WEB_SEARCH_API_KEY = prev;
    if (prevProv === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
    else process.env.ASK_WEB_SEARCH_PROVIDER = prevProv;
  }
});

test('searchAskWeb parses Brave-shaped JSON', async () => {
  const prev = process.env.ASK_WEB_SEARCH_API_KEY;
  const prevProv = process.env.ASK_WEB_SEARCH_PROVIDER;
  process.env.ASK_WEB_SEARCH_API_KEY = 'test-key';
  process.env.ASK_WEB_SEARCH_PROVIDER = 'brave';
  try {
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
  } finally {
    if (prev === undefined) delete process.env.ASK_WEB_SEARCH_API_KEY;
    else process.env.ASK_WEB_SEARCH_API_KEY = prev;
    if (prevProv === undefined) delete process.env.ASK_WEB_SEARCH_PROVIDER;
    else process.env.ASK_WEB_SEARCH_PROVIDER = prevProv;
  }
});
