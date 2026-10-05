/**
 * Eval-style checks for grounded Ask: questions and tasks, answer-first,
 * no junk tokens, the asker's timezone, citations, and redaction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import { planAskLookup, type AskLookupCatalog, type AskLookupClip } from '../src/shared/askLookup.js';
import { foldThreadMemory, type StoredAskPair } from '../src/shared/askMemory.js';
import fs from 'node:fs';
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
      assert.match(answer, /^Not found\./);
      assert.match(answer, /I searched .+ clip/);
      assert.doesNotMatch(answer, /4412/);
      assert.doesNotMatch(answer, /toddler said hello/);
    },
  },
  {
    question: "what's the permit number",
    check: (answer) => {
      assert.match(answer, /^Not found\./);
      assert.match(answer, /I searched .+ clip/);
      assert.match(answer, /permit/i);
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
      assert.match(answer, /⟦artifact⟧/);
      assert.match(answer, /Homeowner summary/);
      assert.doesNotMatch(answer, /I checked the clips/i);
      assert.doesNotMatch(visible(answer), /Short Handheld|Nearly Black, Noisy/i);
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
  assert.match(visible(activity.answer), /small office|webcam/i);
  assert.doesNotMatch(visible(activity.answer), /Nearly Black, Noisy/i);
  assert.doesNotMatch(visible(activity.answer), /I checked the clips/i);
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

  const compared = await askLive('compare that to the first visit', remembered);
  const comparison = visible(compared.answer);
  assert.match(comparison, /Sep 17/);
  assert.match(comparison, /Sep 21/);
  assert.match(comparison, /different visits/i);
  assert.match(comparison, /breakfast table|whitewashed/i);
  assert.match(comparison, /sideways|walkthrough/i);
  assert.notEqual(comparison, 'This file does not have that.');
});

test('a conversation mixes a greeting, a clarification, a job question, an opinion, and a correction', async () => {
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  const say = async (question: string) => {
    const result = await askLive(question, turns);
    turns.push({ role: 'user', text: question });
    turns.push({ role: 'assistant', text: result.answer });
    return visible(result.answer);
  };

  const hello = await say('Hey');
  assert.match(hello, /Project Tiffany/);
  assert.match(hello, /El Presidente/);
  assert.match(hello, /Sep 17/);
  assert.match(hello, /Sep 21/);
  assert.doesNotMatch(hello, /Certainly|Great question|This file does not have that/i);
  assert.ok(hello.length > 80);

  const unclear = await say('What did he say?');
  assert.match(unclear, /Which day/i);
  assert.match(unclear, /Sep 17/);
  assert.match(unclear, /Sep 21/);
  assert.match(unclear, /\?/);
  assert.doesNotMatch(unclear, /QuickBooks|Sample the intervals/);

  const sep21 = await say('Sep 21');
  assert.match(sep21, /Sep 21/);
  assert.match(sep21, /QuickBooks online/);
  assert.match(sep21, /love that girl/i);
  assert.doesNotMatch(sep21, /Sample the intervals/);
  assert.notEqual(sep21, 'This file does not have that.');

  const opinion = await say('Thanks. What do you think he was getting at?');
  assert.match(opinion, /Sep 21/);
  assert.match(opinion, /paper/i);
  assert.match(opinion, /spreadsheets/i);
  assert.match(opinion, /QuickBooks/);
  assert.doesNotMatch(opinion, /^(?:thanks|you(?:'|’)re welcome|certainly|great question)\b/i);
  assert.doesNotMatch(opinion, /This file does not have that/i);

  const correction = await say('You got the date wrong. That was Sep 17, and he never mentioned spreadsheets.');
  assert.match(correction, /Sep 21/);
  assert.match(correction, /actually from Sep 21/i);
  assert.match(correction, /not Sep 17/);
  assert.match(correction, /Sample the intervals/);
  assert.match(correction, /spreadsheets/i);
  assert.doesNotMatch(correction, /The file does have that/i);
  // Every quote carries its clip name and time.
  assert.match(correction, /spreadsheets\.” \([^)]+, 0:03\)/);
  assert.doesNotMatch(correction, /^(?:sorry|you(?:'|’)re right)\b/i);
  assert.doesNotMatch(correction, /This file does not have that/i);
  assert.doesNotMatch(correction, /\.\./);
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

test('a thread of 50 turns over a week still recalls an early decision', async () => {
  const start = Date.parse('2026-09-21T15:00:00.000Z');
  const pairs: StoredAskPair[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      question: 'Please keep the homeowner summaries brief. We decided to redo the tabletop in walnut.',
      answer: 'Noted. Homeowner summaries stay brief, and the tabletop will be redone in walnut.',
      createdAt: new Date(start).toISOString(),
    },
  ];
  for (let i = 1; i <= 52; i += 1) {
    pairs.push({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      question: `What is on the clip from visit ${i}?`,
      answer: `Visit ${i} is on the file. Nothing new was decided.`,
      createdAt: new Date(start + i * 3 * 60 * 60 * 1000).toISOString(),
    });
  }
  assert.ok(pairs.length >= 51);
  const now = '2026-09-28T16:00:00.000Z';
  const folded = foldThreadMemory({ pairs, timeZone: 'America/Chicago' });
  assert.ok(folded.recent.length <= 8);
  assert.doesNotMatch(folded.recent.map((turn) => turn.text).join('\n'), /walnut/i);
  assert.match(folded.summary, /walnut/i);

  const result = await answerFromAskLookup({
    question: 'Last week you said something about the tabletop. What did we decide?',
    catalog: tiffanyLive,
    history: folded.recent,
    memory: { summary: folded.summary, notes: folded.notes, now },
    step: async () => null,
  });
  const said = visible(result.answer);
  assert.match(said, /Last week you decided to redo the tabletop in walnut/);
  assert.match(said, /Sep 21/);
  assert.match(said, /walnut/i);
  assert.doesNotMatch(said, /QuickBooks|Sample the intervals|This file does not have that/i);
  assert.equal(result.model, null);

  const excerpt = [
    `Turns: ${pairs.length} from Sep 21 through Sep 28. Recent verbatim window does not include walnut.`,
    '',
    'User (Sep 21): Please keep the homeowner summaries brief. We decided to redo the tabletop in walnut.',
    '',
    '…52 later turns…',
    '',
    'User (Sep 28): Last week you said something about the tabletop. What did we decide?',
    '',
    `Ask: ${said}`,
  ].join('\n');
  const artDir = process.env.ASK_EVAL_ARTIFACTS_DIR || '/tmp/ask-eval-artifacts';
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(`${artDir}/ask-long-memory-excerpt.txt`, excerpt);
});

type RubricRow = {
  question: string;
  answerFirst: boolean;
  grounded: boolean;
  noDeadEnd: boolean;
  contextCarried: boolean;
  answer: string;
};

async function askCatalog(
  question: string,
  catalog: AskLookupCatalog,
  extra?: {
    history?: Array<{ role?: string | null; text?: string | null }>;
    memory?: { summary: string; notes: import('../src/shared/askMemory.js').DurableJobNote[]; now?: string };
  },
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
      catalog,
      history: extra?.history,
      memory: extra?.memory,
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

function scoreAsk(question: string, answer: string, expect: RegExp, forbid?: RegExp): RubricRow {
  const body = visible(answer);
  const first = (body.split(/(?<=[.!?])\s/)[0] ?? body).trim();
  const filler = /^(?:certainly|great question|sure thing|of course|absolutely|happy to help)\b/i.test(first);
  const onlyMiss = /^this file does not have that\.?$/i.test(body.replace(/\s+/g, ' ').trim());
  return {
    question,
    answer,
    answerFirst: Boolean(first) && !filler && !onlyMiss,
    grounded: !/\b4412\b/.test(answer) && !/\$\s?\d/.test(body) && !(forbid ? forbid.test(body) : false),
    noDeadEnd: body.length > 40 || /\?/.test(body) || /⟦artifact⟧/.test(answer),
    contextCarried: expect.test(body),
  };
}

test('Ask rubric scores answer-first, grounded, no dead ends, and carried context', async () => {
  const rows: RubricRow[] = [];
  const turns: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  const say = async (question: string, expect: RegExp, forbid?: RegExp) => {
    const result = await askLive(question, turns);
    turns.push({ role: 'user', text: question });
    turns.push({ role: 'assistant', text: result.answer });
    rows.push(scoreAsk(question, result.answer, expect, forbid));
    return visible(result.answer);
  };

  const hello = await say('Hey', /Project Tiffany/);
  const which = await say('What did he say?', /Which day/i, /QuickBooks/);
  const sep21 = await say('Sep 21', /QuickBooks online/);
  const opinion = await say('Thanks. What do you think he was getting at?', /off paper and onto QuickBooks/i);
  const correction = await say('You got the date wrong. That was Sep 17, and he never mentioned spreadsheets.', /actually from Sep 21/i);

  const fresh = async (question: string, expect: RegExp, forbid?: RegExp) => {
    const result = await askLive(question);
    rows.push(scoreAsk(question, result.answer, expect, forbid));
    return visible(result.answer);
  };
  const overview = await fresh('what was this job about', /Interior walkthrough/);
  const dated = await fresh('What did El Presidente say on Sep 21?', /love that girl/i);
  const summary = await fresh('write a homeowner summary', /Homeowner summary/);
  const punch = await fresh('draft a punch list', /Punch list/);
  const email = await fresh('draft an email to the homeowner', /Email to the homeowner/);
  const estimate = await fresh('draft an estimate', /no prices/i, /\$\s?\d/);
  const missing = await fresh('is there a purple dumpster on this job', /Nothing on this file matches|On file|Sep 17/i, /there is a purple dumpster/i);
  const tarp = await ask('what did El Presidente say about the tarp');
  rows.push(scoreAsk('what did El Presidente say about the tarp', tarp.answer, /tarp came off/i, /Which day/i));

  const remembered = [
    { role: 'user' as const, text: 'What did El Presidente say on Sep 17?' },
    { role: 'assistant' as const, text: (await askLive('What did El Presidente say on Sep 17?')).answer },
  ];
  const follow = await askLive('and on Sep 21?', remembered);
  rows.push(scoreAsk('and on Sep 21?', follow.answer, /Sep 21/));
  const compared = await askLive('compare that to the first visit', [
    ...remembered,
    { role: 'user', text: 'and on Sep 21?' },
    { role: 'assistant', text: follow.answer },
  ]);
  rows.push(scoreAsk('compare that to the first visit', compared.answer, /different visits/i));

  const start = Date.parse('2026-09-21T15:00:00.000Z');
  const pairs: StoredAskPair[] = [
    {
      id: '00000000-0000-4000-8000-000000000001',
      question: 'Please keep the homeowner summaries brief. We decided to redo the tabletop in walnut.',
      answer: 'Noted.',
      createdAt: new Date(start).toISOString(),
    },
  ];
  for (let i = 1; i <= 52; i += 1) {
    pairs.push({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      question: `Routine check ${i}`,
      answer: `Visit ${i} is on the file.`,
      createdAt: new Date(start + i * 3 * 60 * 60 * 1000).toISOString(),
    });
  }
  const folded = foldThreadMemory({ pairs, timeZone: 'America/Chicago' });
  const recall = await askCatalog(
    'Last week you said something about the tabletop. What did we decide?',
    tiffanyLive,
    {
      history: folded.recent,
      memory: { summary: folded.summary, notes: folded.notes, now: '2026-09-28T16:00:00.000Z' },
    },
  );
  rows.push(scoreAsk(recall ? 'Last week you said something about the tabletop. What did we decide?' : '', recall.answer, /walnut/i, /QuickBooks/));

  const otherCatalog: AskLookupCatalog = {
    ...tiffanyLive,
    orgClips: [
      clip({
        proofId: 'other-tarp',
        jobId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        jobTitle: 'Riverside roof',
        title: 'North slope check',
        workDate: '2026-09-18',
        summary: 'A roof slope with the tarp off.',
        segments: [{ start: 3, end: 5, text: 'The tarp came off the north slope again.' }],
      }),
    ],
  };
  const elsewhere = await askCatalog('Have we seen a tarp on other jobs?', otherCatalog);
  rows.push(scoreAsk('Have we seen a tarp on other jobs?', elsewhere.answer, /Riverside roof/));

  const passed = rows.filter((row) => row.answerFirst && row.grounded && row.noDeadEnd && row.contextCarried);
  const report = {
    questions: rows.length,
    passed: passed.length,
    rows: rows.map((row) => ({
      question: row.question,
      answerFirst: row.answerFirst,
      grounded: row.grounded,
      noDeadEnd: row.noDeadEnd,
      contextCarried: row.contextCarried,
    })),
  };
  const artDir = process.env.ASK_EVAL_ARTIFACTS_DIR || '/tmp/ask-eval-artifacts';
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(`${artDir}/ask-rubric-scores.json`, `${JSON.stringify(report, null, 2)}\n`);

  const conversation = (title: string, pairsIn: Array<[string, string]>) =>
    [`## ${title}`, '', ...pairsIn.flatMap(([q, a]) => [`**User:** ${q}`, '', `**Ask:** ${a}`, ''])].join('\n');
  const samples = [
    conversation('A visit, then a correction', [
      ['Hey', hello],
      ['What did he say?', which],
      ['Sep 21', sep21],
      ['Thanks. What do you think he was getting at?', opinion],
      ['You got the date wrong. That was Sep 17, and he never mentioned spreadsheets.', correction],
    ]),
    conversation('Notes the file can actually support', [
      ['what was this job about', overview],
      ['write a homeowner summary', summary],
      ['draft a punch list', punch],
      ['draft an email to the homeowner', email],
      ['draft an estimate', estimate],
    ]),
    conversation('What is missing, what was said, and another job', [
      ['is there a purple dumpster on this job', missing],
      ['what did El Presidente say about the tarp', visible(tarp.answer)],
      ['Have we seen a tarp on other jobs?', visible(elsewhere.answer)],
      ['What did El Presidente say on Sep 21?', dated],
      ['Last week you said something about the tabletop. What did we decide?', visible(recall.answer)],
    ]),
  ].join('\n');
  fs.writeFileSync(`${process.env.ASK_EVAL_ARTIFACTS_DIR || '/tmp/ask-eval-artifacts'}/ask-sample-conversations.md`, samples);

  const failed = rows.filter((row) => !(row.answerFirst && row.grounded && row.noDeadEnd && row.contextCarried));
  assert.equal(failed.length, 0, JSON.stringify(failed.map((row) => ({
    question: row.question,
    answerFirst: row.answerFirst,
    grounded: row.grounded,
    noDeadEnd: row.noDeadEnd,
    contextCarried: row.contextCarried,
    answer: visible(row.answer).slice(0, 400),
  })), null, 2));
  assert.ok(rows.length >= 15);
});
