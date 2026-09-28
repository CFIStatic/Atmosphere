import test from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicReasoningRequest,
  anthropicUsesBudgetTokens,
  askReasoningConfig,
  askReasoningTimeoutMs,
  completeAskText,
  geminiAskModel,
  scrubProviderDetail,
} from '../src/lib/askModel.js';
import {
  buildLookupUserPrompt,
  executeAskLookup,
  groundedLookupProse,
  lookupPeopleFromContexts,
  mergeJobAskPeople,
  planAskLookup,
  redactClipTranscriptForAsk,
  scrubStoredAskText,
  type AskLookupCatalog,
  type AskLookupClip,
} from '../src/shared/askLookup.js';
import { composeJobOverview } from '../src/shared/askPolish.js';
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

test('word groups and overlapping segments do not leak speech from a later redaction range', () => {
  const wordsOnly = clip({
    proofId: 'word-leak',
    title: 'Word timing',
    recordedByUserIds: [EL],
    words: [
      { start: 9.2, end: 9.6, text: 'The' },
      { start: 9.6, end: 10.0, text: 'gate' },
      { start: 10.2, end: 10.7, text: 'code' },
      { start: 10.7, end: 11.3, text: 'secretword' },
      { start: 11.4, end: 11.8, text: 'is' },
      { start: 11.9, end: 12.4, text: '4412' },
      { start: 16.0, end: 16.4, text: 'Clear' },
      { start: 16.4, end: 16.9, text: 'again' },
    ],
    privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
  });
  const rendered = redactClipTranscriptForAsk(wordsOnly);
  assert.match(rendered, /The gate code/);
  assert.match(rendered, /\[privacy redacted\]/);
  assert.match(rendered, /Clear again/);
  assert.doesNotMatch(rendered, /4412/);
  assert.doesNotMatch(rendered, /secretword/);
  assert.doesNotMatch(rendered, /\bis\b/);

  const childWords = clip({
    proofId: 'child-words',
    title: 'Child words',
    words: [
      { start: 17.2, end: 17.6, text: 'Then' },
      { start: 17.8, end: 18.4, text: 'toddler' },
      { start: 18.6, end: 19.1, text: 'said' },
      { start: 19.2, end: 19.8, text: 'hello' },
    ],
    childPrivacyRedactions: {
      ranges: [{ startSec: 18, endSec: 22, reason: 'child present', confidence: 0.9, source: 'vision', category: 'child_privacy' }],
    },
  });
  const childRendered = redactClipTranscriptForAsk(childWords);
  assert.match(childRendered, /Then/);
  assert.match(childRendered, /child present \[privacy redacted\]/);
  assert.doesNotMatch(childRendered, /toddler/);
  assert.doesNotMatch(childRendered, /hello/);

  const overlapping = clip({
    proofId: 'seg-overlap',
    title: 'Overlap',
    segments: [{ start: 10.2, end: 13, text: 'The lockbox code is 4412.' }],
    privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
  });
  const overlapRendered = redactClipTranscriptForAsk(overlapping);
  assert.doesNotMatch(overlapRendered, /4412/);
  assert.match(overlapRendered, /\[privacy redacted\]/);

  const file = catalog({
    clips: [wordsOnly, childWords],
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: ['word-leak', 'child-words'] }],
  });
  for (const name of ['search_transcripts', 'get_clip', 'list_person_activity'] as const) {
    const result =
      name === 'search_transcripts'
        ? executeAskLookup(name, { query: '4412 secretword toddler hello' }, file)
        : name === 'get_clip'
          ? executeAskLookup(name, { proofId: 'word-leak' }, file)
          : executeAskLookup(name, { name: 'El Presidente' }, file);
    const data = result.data as {
      hits?: Array<{ excerpt?: string }>;
      transcript?: string | null;
      clips?: Array<{ excerpt?: string | null; summary?: string | null }>;
    };
    const spoken = [
      ...(data.hits ?? []).map((hit) => hit.excerpt ?? ''),
      data.transcript ?? '',
      ...(data.clips ?? []).flatMap((row) => [row.excerpt ?? '', row.summary ?? '']),
    ].join('\n');
    assert.doesNotMatch(spoken, /4412/, name);
    assert.doesNotMatch(spoken, /secretword/, name);
    assert.doesNotMatch(spoken, /toddler/, name);
  }
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

test('list_person_activity cites the same line it quotes', () => {
  const file = catalog({
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [TABLE] }],
    clips: [
      clip({
        proofId: TABLE,
        title: 'Sep 21 table',
        speakers: ['El Presidente'],
        segments: [
          { start: 0, end: 3, text: "It's all on paper." },
          { start: 14.6, end: 16.5, text: "We've just got to go to QuickBooks online." },
        ],
      }),
    ],
  });
  const result = executeAskLookup('list_person_activity', { name: 'El Presidente' }, file);
  const row = (result.data as { clips: Array<{ excerpt: string; atSeconds: number; cite: string }> }).clips[0];
  assert.equal(row?.excerpt, "We've just got to go to QuickBooks online.");
  assert.equal(row?.atSeconds, 14.6);
  assert.equal(parseMomentSource(row?.cite ?? '')?.atSeconds, 14.6);
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

test('job context includes the redacted transcript and prior turns', () => {
  const file = catalog({
    clips: [office],
    jobTitle: 'Project Tiffany & Co.',
    jobAddress: '123 Michigan Ave, Chicago, IL',
    clientName: 'Tiffany & Co.',
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [OFFICE] }],
  });
  const prompt = buildLookupUserPrompt({
    question: 'what did he say there',
    resolved: 'What did El Presidente say on Sep 17?',
    catalog: file,
    history: [
      { role: 'user', text: 'What did El Presidente say on Sep 17?' },
      { role: 'assistant', text: 'The lockbox code is 4412. The tarp came off.' },
    ],
  });
  assert.match(prompt, /123 Michigan Ave/);
  assert.match(prompt, /Tiffany & Co\./);
  assert.match(prompt, /El Presidente/);
  assert.match(prompt, /tarp came off/);
  assert.match(prompt, /This follow-up refers to: What did El Presidente say on Sep 17\?/);
  assert.match(prompt, /Earlier turns/);
  assert.doesNotMatch(prompt, /4412/);
  assert.match(prompt, /\[privacy redacted\]/);
});

test('people on the job are available without an @mention', () => {
  const people = mergeJobAskPeople({
    mentioned: [
      {
        userId: '22222222-2222-4222-8222-222222222222',
        name: 'Off Site',
        onThisJob: false,
        otherJobTitles: ['Riverside roof'],
        recordedProofIds: [],
        taggedProofIds: [],
      },
    ],
    crew: [{ userId: EL, name: 'El Presidente' }],
    contacts: [{ name: 'Tiffany Buyer', proofIds: [OFFICE] }],
    clips: [office],
  });
  const onJob = people.filter((person) => person.onThisJob).map((person) => person.name);
  assert.ok(onJob.includes('El Presidente'));
  assert.ok(onJob.includes('Seated man'));
  assert.ok(onJob.includes('Tiffany Buyer'));
  assert.deepEqual(people.find((person) => person.name === 'El Presidente')?.recordedProofIds, [OFFICE]);
  const off = people.find((person) => person.name === 'Off Site');
  assert.equal(off?.onThisJob, false);
  assert.deepEqual(off?.recordedProofIds, []);
});

test('a clip summary and an untimed transcript do not keep a redacted secret', () => {
  const secret = clip({
    ...office,
    summary: 'Office check-in. The lockbox code is 4412.',
  });
  const file = catalog({
    clips: [secret],
    jobTitle: 'Project Tiffany & Co.',
    people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [OFFICE] }],
  });
  const prompt = buildLookupUserPrompt({ question: 'what was this job about', catalog: file });
  assert.doesNotMatch(prompt, /4412/);
  assert.match(prompt, /Office check-in/);
  const overview = composeJobOverview(file);
  assert.doesNotMatch(overview, /4412/);
  assert.match(overview, /Office check-in/);
  const loaded = executeAskLookup('get_clip', { proofId: OFFICE }, file);
  assert.doesNotMatch(JSON.stringify(loaded.data), /4412/);

  const untimed = clip({
    proofId: 'untimed-secret',
    title: 'Untimed private line',
    transcript: 'The gate code is 9088.',
    segments: [],
    words: [],
    privacyRedactions: { ranges: [{ startSec: 0, endSec: 8, reason: 'private', confidence: 0.9, source: 'vision' }] },
  });
  const scrubbed = scrubStoredAskText('He said The gate code is 9088. on camera.', [untimed]);
  assert.doesNotMatch(scrubbed, /9088/);
  assert.match(scrubbed, /\[privacy redacted\]/);
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
    assert.equal(config.geminiModel, 'gemini-3.1-pro-preview');
    assert.equal(geminiAskModel('reasoning'), 'gemini-3.1-pro-preview');
    assert.equal(config.thinkingLevel, 'high');
    assert.equal(config.thinkingBudget, 8000);
    assert.equal(config.timeoutMs, 12000);
    assert.equal(askReasoningTimeoutMs(), 12000);
    assert.match(config.anthropicModel, /claude-opus-test|claude/);

    globalThis.fetch = (async (input: unknown, init?: { body?: unknown }) => {
      const url = String(input);
      if (!url.includes('generativelanguage')) {
        return new Response(
          JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'rejected' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      const body = JSON.parse(String(init?.body ?? '{}'));
      assert.equal(body.generationConfig?.thinkingConfig?.thinkingLevel, 'high');
      assert.equal(body.generationConfig?.thinkingConfig?.thinkingBudget, undefined);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Grounded Gemini fallback.' }] } }],
          modelVersion: 'gemini-3.1-pro-preview',
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
    assert.equal(result?.model, 'gemini-3.1-pro-preview');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

function anthropicSse(events: Array<{ event: string; data: unknown }>): string {
  return events.map((item) => `event: ${item.event}\ndata: ${JSON.stringify(item.data)}\n\n`).join('');
}

function anthropicMessage(stop: string | null, contentEvents: Array<{ event: string; data: unknown }>): string {
  return anthropicSse([
    {
      event: 'message_start',
      data: {
        type: 'message_start',
        message: {
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-5',
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 12, output_tokens: 1 },
        },
      },
    },
    ...contentEvents,
    {
      event: 'message_delta',
      data: {
        type: 'message_delta',
        delta: { stop_reason: stop, stop_sequence: null },
        usage: { output_tokens: 30 },
      },
    },
    { event: 'message_stop', data: { type: 'message_stop' } },
  ]);
}

test('opus-5 lookup sends adaptive thinking and gemini retries without thinkingBudget', async () => {
  const prev = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ASK_ANALYSIS_MODEL: process.env.ASK_ANALYSIS_MODEL,
    ASK_ANALYSIS_THINKING_LEVEL: process.env.ASK_ANALYSIS_THINKING_LEVEL,
    ASK_REASONING_TIMEOUT_MS: process.env.ASK_REASONING_TIMEOUT_MS,
  };
  delete process.env.GOOGLE_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-shape-key';
  process.env.GEMINI_API_KEY = 'test-gemini';
  process.env.ANTHROPIC_MODEL = 'claude-opus-5';
  process.env.ASK_ANALYSIS_MODEL = 'gemini-retired-custom';
  process.env.ASK_ANALYSIS_THINKING_LEVEL = 'high';
  process.env.ASK_REASONING_TIMEOUT_MS = '20000';
  const opus = anthropicReasoningRequest('claude-opus-5');
  assert.equal(opus.thinking?.type, 'adaptive');
  assert.equal('budget_tokens' in (opus.thinking ?? {}), false);
  assert.equal(opus.output_config?.effort, 'high');
  assert.ok(opus.max_tokens >= 16_000);
  assert.equal(anthropicUsesBudgetTokens('claude-opus-4-5'), true);
  const legacy = anthropicReasoningRequest('claude-opus-4-5');
  assert.equal(legacy.thinking?.type, 'enabled');
  assert.equal(legacy.thinking && 'budget_tokens' in legacy.thinking ? legacy.thinking.budget_tokens : 0, 8000);
  assert.equal(anthropicUsesBudgetTokens('claude-opus-5'), false);
  assert.doesNotMatch(scrubProviderDetail('rejected sk-ant-api03-abcdefghijklmnop'), /sk-ant-/);
  const originalFetch = globalThis.fetch;
  const anthropicBodies: Array<Record<string, unknown>> = [];
  const geminiBodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  try {
    const fetchFn: typeof fetch = async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (url.includes('api.anthropic.com') || url.includes('/v1/messages')) {
        anthropicBodies.push(body);
        if (anthropicBodies.length === 1) {
          return new Response(
            anthropicMessage('tool_use', [
              {
                event: 'content_block_start',
                data: {
                  type: 'content_block_start',
                  index: 0,
                  content_block: { type: 'thinking', thinking: '', signature: '' },
                },
              },
              {
                event: 'content_block_delta',
                data: {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'thinking_delta', thinking: 'Check the Sep 21 clip.' },
                },
              },
              {
                event: 'content_block_delta',
                data: {
                  type: 'content_block_delta',
                  index: 0,
                  delta: { type: 'signature_delta', signature: 'sig_live_ask' },
                },
              },
              { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
              {
                event: 'content_block_start',
                data: {
                  type: 'content_block_start',
                  index: 1,
                  content_block: { type: 'tool_use', id: 'toolu_sep21', name: 'get_clip', input: {} },
                },
              },
              {
                event: 'content_block_delta',
                data: {
                  type: 'content_block_delta',
                  index: 1,
                  delta: { type: 'input_json_delta', partial_json: JSON.stringify({ proofId: TABLE }) },
                },
              },
              { event: 'content_block_stop', data: { type: 'content_block_stop', index: 1 } },
            ]),
            { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
          );
        }
        return new Response(
          anthropicMessage('end_turn', [
            {
              event: 'content_block_start',
              data: {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              },
            },
            {
              event: 'content_block_delta',
              data: {
                type: 'content_block_delta',
                index: 0,
                delta: { type: 'text_delta', text: 'On Sep 21 he said it is all on paper.' },
              },
            },
            { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
          ]),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      geminiBodies.push({ url, body });
      if (url.includes('gemini-retired-custom')) {
        return new Response(
          'This model models/gemini-retired-custom is no longer available. Please update your code to use models/gemini-3.1-pro-preview.',
          { status: 404 },
        );
      }
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'Gemini lookup answer.' }] } }],
          modelVersion: 'gemini-3.1-pro-preview',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };
    globalThis.fetch = fetchFn;
    const file = catalog({
      clips: [clip({ proofId: TABLE, title: 'Sep 21 table', workDate: '2026-09-21', segments: [{ start: 14.6, end: 16, text: 'QuickBooks online.' }] })],
      people: [{ userId: EL, name: 'El Presidente', onThisJob: true, recordedProofIds: [TABLE] }],
    });
    const result = await answerFromAskLookup({
      question: 'What did El Presidente say on Sep 21?',
      catalog: file,
      anthropicApiKey: 'sk-ant-test-shape-key',
      fetchFn,
    });
    assert.ok(anthropicBodies.length >= 2, `anthropic calls ${anthropicBodies.length}`);
    const first = anthropicBodies[0]!;
    assert.equal((first.thinking as { type?: string } | undefined)?.type, 'adaptive');
    assert.equal(JSON.stringify(first).includes('budget_tokens'), false);
    assert.equal((first.output_config as { effort?: string } | undefined)?.effort, 'high');
    assert.ok(Number(first.max_tokens) >= 16_000);
    const second = anthropicBodies[1]!;
    const messages = second.messages as Array<{ role: string; content: unknown }>;
    const assistant = messages.find((message) => message.role === 'assistant');
    const blocks = assistant?.content as Array<{ type?: string; thinking?: string; signature?: string }>;
    const thinking = blocks.find((block) => block.type === 'thinking');
    assert.equal(thinking?.thinking, 'Check the Sep 21 clip.');
    assert.equal(thinking?.signature, 'sig_live_ask');
    const toolTurn = messages.find((message) => message.role === 'user' && Array.isArray(message.content));
    const toolBlocks = toolTurn?.content as Array<{ type?: string; tool_use_id?: string }>;
    assert.equal(toolBlocks[0]?.type, 'tool_result');
    assert.equal(toolBlocks[0]?.tool_use_id, 'toolu_sep21');
    assert.match(result.answer, /all on paper/i);
    assert.equal(geminiBodies.length, 0);

    anthropicBodies.length = 0;
    geminiBodies.length = 0;
    const failingFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('anthropic') || url.includes('/v1/messages')) {
        return new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'thinking.type enabled is not supported' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return fetchFn(input, init);
    };
    globalThis.fetch = failingFetch;
    const failed = await answerFromAskLookup({
      question: 'What did El Presidente say on Sep 21?',
      catalog: file,
      anthropicApiKey: 'sk-ant-test-shape-key',
      fetchFn: failingFetch,
    });
    assert.ok(geminiBodies.length >= 2);
    assert.match(geminiBodies[0]!.url, /gemini-retired-custom/);
    assert.match(geminiBodies[1]!.url, /gemini-3\.1-pro-preview/);
    const retry = geminiBodies[1]!.body.generationConfig as { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } };
    assert.equal(retry.thinkingConfig?.thinkingLevel, 'high');
    assert.equal(retry.thinkingConfig?.thinkingBudget, undefined);
    assert.match(failed.answer, /Gemini lookup answer|QuickBooks/i);
    assert.doesNotMatch(JSON.stringify(geminiBodies), /sk-ant-/);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
