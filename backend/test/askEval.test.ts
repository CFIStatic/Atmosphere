/**
 * Eval-style checks for grounded Ask: questions and tasks, answer-first,
 * no junk tokens, the asker's timezone, citations, and redaction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import { planAskLookup, type AskLookupCatalog, type AskLookupClip } from '../src/shared/askLookup.js';
import { parseFollowupTrailer, parseQuoteTrailer, stripMomentTrailers } from '../src/shared/askMoments.js';

const ORG = '8b2cc105-1eec-4123-90db-fdcbc5565252';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';
const EL = '111832c2-d6f9-4412-86ce-1fccc439eb40';
const OTHER = '22222222-2222-4222-8222-222222222222';
const OFFICE = '00608802-140e-4897-9f02-1d5d0db88ecf';
const TABLE = 'd088682f-b5c8-400f-ae51-fcbeed97258a';
const WALK = 'c8d6e77f-6d86-4eee-8312-076038c15bac';

function clip(partial: Partial<AskLookupClip> & Pick<AskLookupClip, 'proofId' | 'title'>): AskLookupClip {
  return { jobId: JOB, orgId: ORG, recordedByUserIds: [EL], ...partial };
}

const tiffany: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Project Tiffany & Co.',
  timeZone: 'America/Chicago',
  people: [
    {
      userId: EL,
      name: 'El Presidente',
      onThisJob: true,
      recordedProofIds: [OFFICE, TABLE, WALK],
      taggedProofIds: [],
    },
    {
      userId: OTHER,
      name: 'Off Site',
      onThisJob: false,
      otherJobTitles: ['Riverside roof'],
      recordedProofIds: [],
      taggedProofIds: [],
    },
  ],
  history: [
    {
      id: '18346820-5594-43cf-9e8b-a13aed56ac95',
      jobId: JOB,
      orgId: ORG,
      summary: 'opened job #12 — Project Tiffany & Co.',
      at: '2026-09-17T16:37:28.774Z',
      actorId: EL,
    },
  ],
  clips: [
    clip({
      proofId: OFFICE,
      title: 'Sep 17 office recording',
      workDate: '2026-09-17',
      summary: 'A seated man in a small office, with a RESTORE 365 binder behind him.',
      speakers: ['Seated man'],
      segments: [
        { start: 4.2, end: 6, text: 'The tarp came off the north slope.' },
        { start: 12, end: 14, text: 'The lockbox code is 4412.' },
      ],
      privacyRedactions: { ranges: [{ startSec: 11, endSec: 15, reason: 'private', confidence: 0.9, source: 'vision' }] },
      words: [{ start: 4.2, end: 4.6, text: 'The' }],
    }),
    clip({
      proofId: TABLE,
      title: 'Sep 21 tabletop close-up',
      workDate: '2026-09-21',
      summary: 'A phone video of a whitewashed dining table.',
      segments: [{ start: 0, end: 3, text: "It's all on paper." }],
    }),
    clip({
      proofId: WALK,
      title: 'Sep 21 home walkthrough',
      workDate: '2026-09-21',
      summary: 'A sideways walkthrough into the dining area.',
      segments: [{ start: 0, end: 2, text: 'her entire life.' }],
      childPrivacyRedactions: {
        ranges: [{ startSec: 18, endSec: 22, reason: 'child present', confidence: 0.9, source: 'vision', category: 'child_privacy' }],
      },
    }),
  ],
};

function visible(answer: string): string {
  return stripMomentTrailers(answer)
    .replace(/⟦sources:[^⟧]*⟧/gi, '')
    .replace(/⟦\/?artifact⟧/g, '')
    .trim();
}

function firstSentence(answer: string): string {
  const prose = visible(answer).split('⟦')[0] ?? '';
  return (prose.split(/(?<=[.!?])\s/)[0] ?? prose).trim();
}

async function ask(question: string) {
  const prev = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    return await answerFromAskLookup({
      question,
      catalog: tiffany,
      step: async () => null,
    });
  } finally {
    if (prev.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.anthropic;
    if (prev.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev.gemini;
    if (prev.google === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prev.google;
  }
}

const prompts: Array<{ question: string; check: (answer: string) => void }> = [
  {
    question: 'what had @El Presidente done in this file',
    check: (answer) => {
      assert.match(firstSentence(answer), /El Presidente/i);
      assert.match(firstSentence(answer), /recorded/i);
      assert.match(answer, /11:37 AM CT/);
      assert.match(answer, new RegExp(`video/${JOB}/${OFFICE}/`));
    },
  },
  {
    question: 'what did El Presidente say about the tarp',
    check: (answer) => {
      assert.match(firstSentence(answer), /tarp came off/i);
      assert.match(answer, /@4\.2/);
      assert.doesNotMatch(visible(answer), /4412/);
    },
  },
  {
    question: 'what is the lockbox code',
    check: (answer) => {
      assert.match(firstSentence(answer), /does not include/i);
      assert.doesNotMatch(answer, /4412/);
      assert.doesNotMatch(answer, /toddler said hello/);
    },
  },
  {
    question: "what's the permit number",
    check: (answer) => {
      assert.match(firstSentence(answer), /permit/i);
      assert.match(firstSentence(answer), /does not include/i);
    },
  },
  {
    question: 'who opened this job',
    check: (answer) => {
      assert.match(answer, /opened/i);
      assert.match(answer, /11:37 AM CT/);
      assert.doesNotMatch(visible(answer), /16:37/);
      assert.doesNotMatch(visible(answer), /\bUTC\b/);
    },
  },
  {
    question: 'is Off Site on this job',
    check: (answer) => {
      assert.match(firstSentence(answer), /isn't on this job/i);
      assert.doesNotMatch(answer, /tarp came off/i);
    },
  },
  {
    question: 'write a summary for the homeowner',
    check: (answer) => {
      assert.match(firstSentence(answer), /clip/i);
      assert.match(answer, /⟦artifact⟧/);
      assert.match(answer, /Homeowner summary/);
      assert.match(answer, /RESTORE 365/);
      assert.doesNotMatch(visible(answer), /Sample the intervals/);
    },
  },
  {
    question: 'draft a scope note',
    check: (answer) => {
      assert.match(firstSentence(answer), /no written scope/i);
      assert.match(answer, /⟦artifact⟧/);
      assert.match(answer, /Scope note/);
    },
  },
  {
    question: 'compare the two visits',
    check: (answer) => {
      assert.match(firstSentence(answer), /Sep 17/);
      assert.match(answer, /\| Visit \|/);
      assert.match(answer, /whitewashed/i);
      assert.match(answer, /walkthrough/i);
      assert.match(answer, /⟦artifact⟧/);
    },
  },
  {
    question: 'list the open issues',
    check: (answer) => {
      assert.match(firstSentence(answer), /Nothing on this file is logged/i);
      assert.doesNotMatch(answer, /purple dumpster/i);
      assert.match(answer, /⟦artifact⟧/);
    },
  },
  {
    question: 'make a punch list',
    check: (answer) => {
      assert.match(firstSentence(answer), /punch item/i);
      assert.match(answer, /Punch list/);
      assert.doesNotMatch(answer, /4412/);
    },
  },
  {
    question: 'what was said in the office recording',
    check: (answer) => {
      assert.match(answer, /@4(?:\.2)?/);
      assert.match(visible(answer), /tarp came off/i);
      assert.doesNotMatch(visible(answer), /4412/);
    },
  },
];

test('twelve Ask prompts stay answer-first, local, cited, and redacted', async () => {
  assert.ok(prompts.length >= 10);
  for (const prompt of prompts) {
    const result = await ask(prompt.question);
    const body = visible(result.answer);
    assert.equal(result.model, null, prompt.question);
    assert.doesNotMatch(body, /^(Certainly|Great question|Of course|Absolutely)/i, prompt.question);
    assert.doesNotMatch(body, UUID_SAFE, prompt.question);
    assert.doesNotMatch(body, /\bUTC\b/, prompt.question);
    assert.doesNotMatch(body, /video\/[0-9a-f-]+\//i, prompt.question);
    prompt.check(result.answer);
  }
});

const UUID_SAFE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

test('a task plan reads history and the clips before it writes', () => {
  const plan = planAskLookup('write a summary for the homeowner', tiffany);
  assert.ok(plan.some((step) => step.name === 'read_job_history'));
  assert.ok(plan.filter((step) => step.name === 'get_clip').length >= 2);
});

test('model filler and a raw UTC stamp are cleaned before the reader sees them', async () => {
  const result = await answerFromAskLookup({
    question: 'write a summary for the homeowner',
    catalog: tiffany,
    step: async () => ({
      model: 'claude-test',
      text: `Certainly! Here is the note.\n\nOpened at 2026-09-17T16:37:28.774Z by ${EL}.`,
      calls: [],
    }),
  });
  const body = visible(result.answer);
  assert.doesNotMatch(body, /Certainly/i);
  assert.doesNotMatch(body, /16:37/);
  assert.match(body, /11:37 AM CT/);
  assert.doesNotMatch(body, UUID_SAFE);
  assert.match(result.answer, /⟦artifact⟧/);
});

const LIVE_SEP17 = '00608802-140e-4897-9f02-1d5d0db88ecf';
const LIVE_TABLE = 'd088682f-b5c8-400f-ae51-fcbeed97258a';
const LIVE_WALK = 'c8d6e77f-6d86-4eee-8312-076038c15bac';

/** Production shape: one untimed transcript, two clips with segments and words. */
const tiffanyLive: AskLookupCatalog = {
  orgId: ORG,
  jobId: JOB,
  access: 'org',
  jobTitle: 'Project Tiffany & Co.',
  jobAddress: '123 Michigan Ave, Chicago, IL',
  clientName: 'Tiffany & Co.',
  jobDescription: 'Interior walkthrough and an office check-in.',
  timeZone: 'America/Chicago',
  people: [
    {
      userId: EL,
      name: 'El Presidente',
      onThisJob: true,
      recordedProofIds: [LIVE_SEP17, LIVE_TABLE, LIVE_WALK],
      taggedProofIds: [],
    },
  ],
  history: [
    {
      id: '18346820-5594-43cf-9e8b-a13aed56ac95',
      jobId: JOB,
      orgId: ORG,
      summary: 'opened job #12 — Project Tiffany & Co.',
      at: '2026-09-17T16:37:28.774Z',
      actorId: EL,
    },
  ],
  clips: [
    clip({
      proofId: LIVE_SEP17,
      title: 'Clip Opens With Two Nearly Black, Noisy Frames',
      workDate: '2026-09-17',
      summary: 'A single fixed webcam-style take of one seated man speaking to camera from a small office.',
      speakers: ['El Presidente'],
      transcript: 'Sample the intervals.',
      segments: [],
      words: [],
    }),
    clip({
      proofId: LIVE_TABLE,
      title: 'Short Handheld Phone Clip Surveys a Light Whitewashed',
      workDate: '2026-09-21',
      summary: 'Handheld, often blurry phone video shot at a dining/breakfast table inside a home.',
      speakers: ['El Presidente'],
      segments: [
        { start: 0, end: 3, text: "It's all on paper, and I'm like, God help you women people." },
        { start: 3, end: 6, text: 'You guys do this on spreadsheets.' },
        { start: 7, end: 10, text: 'have to have physical paper.' },
        { start: 14.6, end: 16.5, text: "We've just got to go to QuickBooks online." },
        { start: 16.7, end: 19, text: "I mean, that's the main thing." },
        { start: 21, end: 24, text: "I think I'm going to be stuck in here." },
        { start: 25, end: 27, text: "We're getting stuck." },
      ],
      words: [
        { start: 14.6, end: 14.9, text: "We've" },
        { start: 15.1, end: 15.4, text: 'just' },
        { start: 10.6, end: 10.9, text: 'You' },
      ],
    }),
    clip({
      proofId: LIVE_WALK,
      title: 'Handheld Phone Video Shot Sideways Inside a Home',
      workDate: '2026-09-21',
      summary: 'A short handheld interior walkthrough of a furnished home, recorded sideways.',
      speakers: ['El Presidente'],
      segments: [
        { start: 0, end: 2, text: 'her entire life.' },
        { start: 10.6, end: 13, text: 'You know I love that girl.' },
        { start: 30, end: 32, text: 'I think she farts.' },
        { start: 35, end: 37, text: 'I love her so much.' },
        { start: 38, end: 40, text: 'I love that.' },
      ],
      words: [
        { start: 10.6, end: 10.9, text: 'You' },
        { start: 11.2, end: 11.5, text: 'love' },
      ],
    }),
  ],
};

async function askLive(
  question: string,
  history?: Array<{ role?: string | null; text?: string | null }>,
) {
  const prev = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    return await answerFromAskLookup({
      question,
      catalog: tiffanyLive,
      history,
      step: async () => null,
    });
  } finally {
    if (prev.anthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev.anthropic;
    if (prev.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prev.gemini;
    if (prev.google === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prev.google;
  }
}

test('live Tiffany questions answer from the real transcripts', async () => {
  const activity = await askLive('what activity does @El Presidente have in this job file');
  const sep21 = await askLive('What did El Presidente say on Sep 21?');
  const sep17 = await askLive('What did El Presidente say on Sep 17?');

  assert.match(visible(activity.answer), /El Presidente/i);
  assert.match(visible(activity.answer), /3 clips/i);
  assert.match(activity.answer, /11:37 AM CT/);
  assert.match(visible(activity.answer), /Nearly Black/i);
  assert.match(activity.answer, new RegExp(`video/${JOB}/${LIVE_WALK}/[^\\s,⟧]*@10\\.6`));
  assert.match(activity.answer, new RegExp(`video/${JOB}/${LIVE_TABLE}/`));
  assert.doesNotMatch(activity.answer, new RegExp(`video/${JOB}/${LIVE_SEP17}/[^\\s,⟧]*@`));
  assert.notEqual(visible(activity.answer), 'This file does not have that.');

  const said21 = visible(sep21.answer);
  assert.match(said21, /Sep 21/);
  assert.match(said21, /QuickBooks online/);
  assert.match(said21, /love that girl/i);
  assert.match(sep21.answer, /@14\.6/);
  assert.match(sep21.answer, /@10\.6/);
  assert.doesNotMatch(sep21.answer, /Sample the intervals/);
  assert.doesNotMatch(sep21.answer, new RegExp(LIVE_SEP17));
  const quoted21 = parseQuoteTrailer(sep21.answer);
  assert.ok(quoted21.some((quote) => quote.atSeconds === 14.6 && /QuickBooks/.test(quote.text)));
  assert.ok(quoted21.some((quote) => quote.atSeconds === 10.6 && /love that girl/i.test(quote.text)));
  assert.notEqual(said21, 'This file does not have that.');

  const said17 = visible(sep17.answer);
  assert.match(said17, /only one short untimed line/i);
  assert.match(said17, /Sample the intervals/);
  assert.match(said17, /no timed speech/i);
  assert.match(said17, /QuickBooks online/);
  assert.match(sep17.answer, /@14\.6/);
  assert.match(sep17.answer, /@10\.6/);
  assert.notEqual(said17, 'This file does not have that.');

  for (const follow of parseFollowupTrailer(activity.answer)) {
    const next = await askLive(follow);
    assert.notEqual(visible(next.answer), 'This file does not have that.', follow);
    assert.match(visible(next.answer), /Sample the intervals|QuickBooks|love that girl|opened|clip/i, follow);
  }
});

test('what was this job about is an overview of the whole file', async () => {
  const result = await askLive('what was this job about');
  const body = visible(result.answer);
  assert.match(body, /Project Tiffany & Co\./);
  assert.match(body, /123 Michigan Ave, Chicago, IL/);
  assert.match(body, /Client: Tiffany & Co\./);
  assert.match(body, /Interior walkthrough/);
  assert.match(body, /El Presidente/);
  assert.match(body, /Sep 17/);
  assert.match(body, /Sep 21/);
  assert.match(body, /Sample the intervals/);
  assert.match(body, /QuickBooks online|all on paper|love that girl/i);
  assert.notEqual(body, 'This file does not have that.');
  assert.doesNotMatch(body, /^This file does not have that\./);
  assert.doesNotMatch(body, /Co\.\./);
});

test('a follow-up uses the prior turn for the person and the date', async () => {
  const first = await askLive('What did El Presidente say on Sep 17?');
  const history = [
    { role: 'user' as const, text: 'What did El Presidente say on Sep 17?' },
    { role: 'assistant' as const, text: first.answer },
  ];
  const second = await askLive('and on Sep 21?', history);
  const said = visible(second.answer);
  assert.match(said, /Sep 21/);
  assert.match(said, /QuickBooks online/);
  assert.match(said, /love that girl/i);
  assert.doesNotMatch(said, /Sample the intervals/);
  assert.notEqual(said, 'This file does not have that.');

  const remembered = [
    ...history,
    { role: 'user' as const, text: 'and on Sep 21?' },
    { role: 'assistant' as const, text: second.answer },
  ];
  const pronoun = await askLive('what did he say there', remembered);
  const again = visible(pronoun.answer);
  assert.match(again, /El Presidente/);
  assert.match(again, /QuickBooks online|love that girl/i);
  assert.notEqual(again, 'This file does not have that.');
});

test('a privacy-redacted line is never quoted or chipped', async () => {
  const secret = 'The lockbox code is 4412.';
  const result = await ask('What did El Presidente say on Sep 17?');
  assert.doesNotMatch(result.answer, /4412/);
  assert.doesNotMatch(result.answer, /lockbox code/i);
  assert.match(visible(result.answer), /tarp came off/i);
  assert.match(result.answer, /@4\.2/);
  assert.doesNotMatch(result.answer, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('a clip with no transcript is not offered as a follow-up', async () => {
  const empty = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const catalog: AskLookupCatalog = {
    ...tiffanyLive,
    people: [
      {
        userId: EL,
        name: 'El Presidente',
        onThisJob: true,
        recordedProofIds: [LIVE_SEP17, LIVE_TABLE, LIVE_WALK, empty],
        taggedProofIds: [],
      },
    ],
    clips: [
      ...tiffanyLive.clips,
      clip({
        proofId: empty,
        title: 'Silent hallway pan',
        workDate: '2026-09-22',
        summary: 'No one speaks.',
        transcript: '',
        segments: [],
        words: [],
      }),
    ],
  };
  const result = await answerFromAskLookup({
    question: 'what activity does @El Presidente have in this job file',
    catalog,
    step: async () => null,
  });
  const follows = parseFollowupTrailer(result.answer).join(' ');
  assert.doesNotMatch(follows, /Sep 22|Silent hallway/i);
  assert.match(follows, /Sep 21/);
  assert.match(follows, /Sep 17/);
});
