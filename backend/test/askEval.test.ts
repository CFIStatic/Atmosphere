/**
 * Eval-style checks for grounded Ask: questions and tasks, answer-first,
 * no junk tokens, the asker's timezone, citations, and redaction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromAskLookup } from '../src/shared/askReasoning.js';
import { planAskLookup, type AskLookupCatalog, type AskLookupClip } from '../src/shared/askLookup.js';
import { stripMomentTrailers } from '../src/shared/askMoments.js';

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
