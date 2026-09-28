import test from 'node:test';
import assert from 'node:assert/strict';
import {
  askReasoningConfig,
  askReasoningTimeoutMs,
  completeAskText,
  geminiAskModel,
} from '../src/lib/askModel.js';
import {
  buildLookupUserPrompt,
  executeAskLookup,
  groundedLookupProse,
  lookupPeopleFromContexts,
  planAskLookup,
  redactClipTranscriptForAsk,
  type AskLookupCatalog,
  type AskLookupClip,
} from '../src/shared/askLookup.js';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import { parseFollowupTrailer, parseMomentSource, parseQuoteTrailer } from '../src/shared/askMoments.js';

const ORG = 'org-a';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const OTHER_JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_ORG = 'org-b';
const EL = '111832c2-d6f9-4412-86ce-1fccc439eb40';
const OFFICE = '00608802-140e-4897-9f02-1d5d0db88ecf';
const TABLE = 'd088682f-b5c8-400f-ae51-fcbeed97258a';

function clip(partial: Partial<AskLookupClip> & Pick<AskLookupClip, 'proofId' | 'title'>): AskLookupClip {
  return {
    jobId: JOB,
    orgId: ORG,
    ...partial,
  };
}

function catalog(partial: Partial<AskLookupCatalog> = {}): AskLookupCatalog {
  return {
    orgId: ORG,
    jobId: JOB,
    access: 'org',
    clips: [],
    history: [],
    people: [],
    ...partial,
  };
}

const office = clip({
  proofId: OFFICE,
  title: 'Sep 17 office recording',
  workDate: '2026-09-17',
  summary: 'A seated man in a small office.',
  speakers: ['Seated man'],
  recordedByUserIds: [EL],
  segments: [
    { start: 4.2, end: 6, text: 'The tarp came off the north slope.' },
    { start: 12, end: 14, text: 'The lockbox code is 4412.' },
  ],
  privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
  words: [
    { start: 4.2, end: 4.5, text: 'The' },
    { start: 4.5, end: 4.8, text: 'tarp' },
  ],
});

const childClip = clip({
  proofId: 'child-clip',
  title: 'Nursery pass',
  segments: [{ start: 20, end: 22, text: 'The toddler said hello there.' }],
  childPrivacyRedactions: {
    ranges: [{ startSec: 18, endSec: 25, reason: 'child present', confidence: 0.9, source: 'vision', category: 'child_privacy' }],
  },
});

test('every transcript tool redacts privacy and child ranges', () => {
  const file = catalog({ clips: [office, childClip], people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [OFFICE] }] });
  const rendered = redactClipTranscriptForAsk(office);
  assert.match(rendered, /\[privacy redacted\]/);
  assert.doesNotMatch(rendered, /4412/);
  assert.match(rendered, /tarp came off/);

  const childText = redactClipTranscriptForAsk(childClip);
  assert.match(childText, /child present \[privacy redacted\]/);
  assert.doesNotMatch(childText, /toddler said hello/);

  for (const name of ['search_transcripts', 'get_clip', 'list_person_activity'] as const) {
    const result =
      name === 'search_transcripts'
        ? executeAskLookup(name, { query: 'lockbox 4412 toddler hello' }, file)
        : name === 'get_clip'
          ? executeAskLookup(name, { proofId: OFFICE }, file)
          : executeAskLookup(name, { name: 'El Presidente' }, file);
    const data = result.data as {
      hits?: Array<{ excerpt?: string }>;
      transcript?: string | null;
      findings?: string | null;
      clips?: Array<{ excerpt?: string | null; summary?: string | null }>;
    };
    const spoken = [
      ...(data.hits ?? []).map((hit) => hit.excerpt ?? ''),
      data.transcript ?? '',
      data.findings ?? '',
      ...(data.clips ?? []).flatMap((row) => [row.excerpt ?? '', row.summary ?? '']),
    ].join('\n');
    assert.doesNotMatch(spoken, /4412/, name);
    assert.doesNotMatch(spoken, /toddler said hello/, name);
  }

  const childGet = executeAskLookup('get_clip', { proofId: 'child-clip' }, file);
  assert.doesNotMatch(JSON.stringify(childGet), /toddler said hello/);
  assert.match(JSON.stringify(childGet), /child present \[privacy redacted\]/);

  const safe = executeAskLookup('search_transcripts', { query: 'tarp' }, file);
  const hit = ((safe.data as { hits: Array<{ atSeconds: number; cite: string; excerpt: string; speaker: string }> }).hits)[0];
  assert.ok(hit);
  assert.equal(hit.atSeconds, 4.2);
  assert.equal(parseMomentSource(hit.cite)?.atSeconds, 4.2);
  assert.match(hit.excerpt, /tarp came off/);
  assert.equal(hit.speaker, 'Seated man');
  assert.doesNotMatch(hit.excerpt, /4412/);
});

test('job scope stays on the open job and org-wide Ask can see the org', () => {
  const other = clip({
    proofId: TABLE,
    jobId: OTHER_JOB,
    title: 'Kitchen faucet',
    segments: [{ start: 1, end: 2, text: 'The kitchen faucet is loose.' }],
  });
  const foreign = clip({
    proofId: 'foreign',
    orgId: OTHER_ORG,
    jobId: 'foreign-job',
    title: 'Other org secret',
    segments: [{ start: 1, end: 2, text: 'Secret other org phrase.' }],
  });
  const scoped = catalog({ clips: [office, other, foreign] });
  const jobHits = executeAskLookup('search_transcripts', { query: 'faucet' }, scoped);
  assert.equal(((jobHits.data as { hits: unknown[] }).hits).length, 0);
  const widened = executeAskLookup('search_transcripts', { query: 'faucet', jobId: OTHER_JOB }, scoped);
  assert.equal(widened.ok, false);
  assert.match(widened.summary, /open job/);

  const orgWide = catalog({ jobId: null, clips: [office, other, foreign] });
  const both = executeAskLookup('search_transcripts', { query: 'faucet' }, orgWide);
  assert.equal(((both.data as { hits: Array<{ jobId: string }> }).hits)[0]?.jobId, OTHER_JOB);
  const leaked = executeAskLookup('search_transcripts', { query: 'Secret other org' }, orgWide);
  assert.equal(((leaked.data as { hits: unknown[] }).hits).length, 0);

  const viewer = catalog({ access: 'viewer', clips: [office, other] });
  const viewerHits = executeAskLookup('search_transcripts', { query: 'faucet' }, viewer);
  assert.equal(((viewerHits.data as { hits: unknown[] }).hits).length, 0);
  const viewerOffice = executeAskLookup('search_transcripts', { query: 'tarp' }, viewer);
  assert.equal(((viewerOffice.data as { hits: unknown[] }).hits).length, 1);
});

test('list_person_activity does not treat unattributed history as that person', () => {
  const file = catalog({
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true }],
    history: [
      { id: 'shared', jobId: JOB, orgId: ORG, summary: 'Job-level memory with no actor.', actorId: null },
      { id: 'blank', jobId: JOB, orgId: ORG, summary: 'Blank actor event.', actorId: '' },
      { id: 'el', jobId: JOB, orgId: ORG, summary: 'El opened the job.', actorId: EL },
      { id: 'other', jobId: JOB, orgId: ORG, summary: 'Jane uploaded a clip.', actorId: 'jane' },
    ],
  });
  const result = executeAskLookup('list_person_activity', { name: 'El Presidente' }, file);
  const actions = (result.data as { actions: Array<{ summary: string }> }).actions;
  assert.deepEqual(
    actions.map((action) => action.summary),
    ['El opened the job.'],
  );
});

test('lookup people keep an off-job record and its other jobs', () => {
  const people = lookupPeopleFromContexts([
    {
      userId: 'jane',
      name: 'Jane Alvarez',
      onThisJob: false,
      otherJobTitles: ['Kitchen faucet'],
    },
    {
      userId: EL,
      name: 'El Presidente',
      items: [{ kind: 'video', proofId: OFFICE, captured: true }],
    },
  ]);
  assert.equal(people[0]?.onThisJob, false);
  assert.deepEqual(people[0]?.otherJobTitles, ['Kitchen faucet']);
  const activity = executeAskLookup('list_person_activity', { name: 'Jane Alvarez' }, catalog({ people }));
  assert.match(activity.summary, /isn't on this job/);
  assert.match(activity.summary, /Kitchen faucet/);
  assert.deepEqual((activity.data as { clips: unknown[] }).clips, []);
  assert.equal(people[1]?.onThisJob, true);
  assert.deepEqual(people[1]?.recordedProofIds, [OFFICE]);
});

test('a person who is not on the job gets no clips from it', () => {
  const file = catalog({
    clips: [office],
    people: [
      {
        userId: 'jane',
        name: 'Jane Alvarez',
        onThisJob: false,
        otherJobTitles: ['Kitchen faucet'],
        recordedProofIds: [OFFICE],
      },
    ],
  });
  const result = executeAskLookup('list_person_activity', { name: 'Jane Alvarez' }, file);
  assert.match(result.summary, /isn't on this job/);
  assert.match(result.summary, /Kitchen faucet/);
  assert.deepEqual((result.data as { clips: unknown[] }).clips, []);
  assert.doesNotMatch(JSON.stringify(result), /tarp/);
});

test('lookup prompt is an index, not the transcript', () => {
  const file = catalog({ clips: [office] });
  const prompt = buildLookupUserPrompt({
    question: 'what had @El Presidente done in this file',
    catalog: file,
  });
  assert.match(prompt, /Sep 17 office recording/);
  assert.ok(prompt.includes(OFFICE));
  assert.doesNotMatch(prompt, /tarp came off/);
  assert.doesNotMatch(prompt, /4412/);
});

test('a tool loop cites the moment, quotes the speaker, and suggests follow-ups', async () => {
  const file = catalog({
    clips: [office, clip({ proofId: TABLE, title: 'Sep 21 tabletop close-up', summary: 'A whitewashed tabletop.', segments: [{ start: 8, end: 9, text: 'But I know they have their ways.' }] })],
    history: [{ id: 'mem', jobId: JOB, orgId: ORG, summary: 'opened job #12 — Project Tiffany & Co.', actorId: EL, at: '2026-09-17T16:37:28.774Z' }],
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [OFFICE, TABLE] }],
  });
  let steps = 0;
  const result = await answerFromAskLookup({
    question: 'what had El Presidente done in this file',
    catalog: file,
    step: async ({ trace }) => {
      steps += 1;
      if (!trace.length) {
        return { model: 'claude-test', text: '', calls: [{ name: 'list_person_activity', input: { name: 'El Presidente' } }, { name: 'read_job_history', input: {} }] };
      }
      if (!trace.some((row) => row.tool === 'search_transcripts')) {
        return { model: 'claude-test', text: '', calls: [{ name: 'search_transcripts', input: { query: 'tarp' } }] };
      }
      const cite = `video/${JOB}/${OFFICE}/sep-17-office-recording@4.2`;
      return {
        model: 'claude-test',
        text: `El Presidente recorded the office clip. The seated man said the tarp came off.\n\n⟦sources: ${cite}⟧\n⟦quotes: ${cite}|Seated man|invented quote that must be replaced⟧\n⟦followups: What color is the dumpster? ;; What did El Presidente say in Sep 21 tabletop close-up?⟧`,
        calls: [],
      };
    },
  });
  assert.ok(steps >= 2);
  assert.equal(result.model, 'claude-test');
  assert.ok(result.trace.some((step) => step.tool === 'list_person_activity'));
  assert.ok(result.trace.some((step) => step.tool === 'search_transcripts'));
  assert.match(result.answer, /@4\.2/);
  const quotes = parseQuoteTrailer(result.answer);
  assert.match(quotes[0]?.text ?? '', /tarp came off/);
  assert.equal(quotes[0]?.speaker, 'Seated man');
  assert.doesNotMatch(result.answer, /invented quote/);
  assert.doesNotMatch(result.answer, /dumpster/i);
  const follows = parseFollowupTrailer(result.answer);
  assert.ok(follows.length >= 2 && follows.length <= 3);
  assert.ok(follows.some((item) => /tabletop/i.test(item)));
});

test('a failed model keeps transcript hits and clip speech in the fallback', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const file = catalog({ clips: [office] });
    const result = await answerFromAskLookup({
      question: 'what was said about the tarp',
      catalog: file,
      step: async () => null,
    });
    assert.equal(result.model, null);
    assert.match(result.answer, /tarp came off/);
    assert.doesNotMatch(result.answer, /This job file does not have that/);
    assert.match(result.answer, new RegExp(`video/${JOB}/${OFFICE}/`));
    const prose = groundedLookupProse('what was said about the tarp', [
      {
        tool: 'get_clip',
        input: { proofId: OFFICE },
        result: executeAskLookup('get_clip', { proofId: OFFICE }, file),
      },
    ]);
    assert.match(prose, /tarp came off/);
    assert.doesNotMatch(prose, /This job file does not have that/);
  } finally {
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
  }
});

test('a failed model falls back to tool results and does not invent', async () => {
  const prevAnthropic = process.env.ANTHROPIC_API_KEY;
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    const file = catalog({
      clips: [office],
      people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [OFFICE] }],
      history: [{ id: 'mem', jobId: JOB, orgId: ORG, summary: 'opened job #12 — Project Tiffany & Co.', actorId: EL }],
    });
    const result = await answerFromAskLookup({
      question: 'what had El Presidente done in this file',
      catalog: file,
      step: async () => null,
    });
    assert.equal(result.model, null);
    assert.match(result.answer, /office/i);
    assert.match(result.answer, /recorded|on this file|does not have/i);
    assert.match(result.answer, new RegExp(`video/${JOB}/${OFFICE}/`));
    assert.doesNotMatch(result.answer, /4412/);
    assert.doesNotMatch(result.answer, /purple dumpster/i);
    assert.ok(result.trace.length >= 2);
    const planned = planAskLookup('what had El Presidente done in this file', file);
    assert.ok(planned.some((step) => step.name === 'list_person_activity'));
    assert.ok(planned.some((step) => step.name === 'read_job_history'));
  } finally {
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevAnthropic;
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGemini;
    if (prevGoogle === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogle;
  }
});

test('reasoning mode uses the analysis model, thinking budget, and Gemini after Anthropic fails', async () => {
  const prev = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    ASK_ANALYSIS_MODEL: process.env.ASK_ANALYSIS_MODEL,
    ASK_ANALYSIS_THINKING_LEVEL: process.env.ASK_ANALYSIS_THINKING_LEVEL,
    ASK_REASONING_TIMEOUT_MS: process.env.ASK_REASONING_TIMEOUT_MS,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL,
  };
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ASK_ANALYSIS_MODEL;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic';
  process.env.GEMINI_API_KEY = 'test-gemini';
  process.env.ASK_ANALYSIS_THINKING_LEVEL = 'high';
  process.env.ASK_REASONING_TIMEOUT_MS = '12000';
  process.env.ANTHROPIC_MODEL = 'claude-opus-test';
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
  const originalFetch = globalThis.fetch;
  try {
    const config = askReasoningConfig();
    assert.equal(config.geminiModel, 'gemini-2.5-pro');
    assert.equal(geminiAskModel('reasoning'), 'gemini-2.5-pro');
    assert.equal(config.thinkingLevel, 'high');
    assert.equal(config.thinkingBudget, 8000);
    assert.equal(config.timeoutMs, 12000);
    assert.equal(askReasoningTimeoutMs(), 12000);
    assert.match(config.anthropicModel, /claude-opus-test|claude/);

    globalThis.fetch = (async (_input: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      assert.equal(body.generationConfig?.thinkingConfig?.thinkingBudget, 8192);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Grounded Gemini fallback.' }] } }],
          modelVersion: 'gemini-2.5-pro',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;

    const result = await completeAskText({
      system: 'sys',
      user: 'question',
      anthropicApiKey: 'not-a-real-key',
      mode: 'reasoning',
      fetchFn: globalThis.fetch,
    });
    assert.equal(result?.text, 'Grounded Gemini fallback.');
    assert.equal(result?.model, 'gemini-2.5-pro');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
