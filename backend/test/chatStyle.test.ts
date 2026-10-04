/**
 * Chat replies should read like Grok Bot: the answer first, plain words, no
 * meta openers or filler closings, no internal text, and a friendly reply to
 * a bare "?". These are eval-style checks on the four typical turns (a job
 * summary, a general question, a document question, a short "?") plus the
 * shared prompt and post-processing they all go through.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { answerFromJobFile, readableJobFileAnswer, type JobFileAskContext } from '../src/shared/jobFileAsk.js';
import { ASK_PROSE_FORMAT_RULES, CHAT_VOICE_RULES, trimChatFiller } from '../src/shared/askProse.js';
import { UPLOAD_ANSWER_SYSTEM } from '../src/shared/askUploadAnswer.js';

const here = dirname(fileURLToPath(import.meta.url));

const file: JobFileAskContext = {
  job: {
    title: 'Cedar Ridge — storm damage',
    jobNumber: 1038,
    claimNumber: 'CLM-88396',
    status: 'in_progress',
    description: 'Roof tarp and rebuild after hail.',
  },
  facts: {
    'Site address': '2214 Cedar Ridge Dr, Round Rock TX',
    'Gate / access': 'Lockbox on the side gate — 4412',
    Permit: 'BP-2026-8841',
  },
  briefNote: 'Carrier approved the deck replacement; skylights removed from scope.',
  scope: [{ state: 'excluded', title: 'Do not remove the skylights', reason: 'Carrier declined them.' }],
  parties: [{ company: 'Delgado Roofing', trade: 'roofing', contact: 'Hector Delgado' }],
  tasks: [{ title: 'Call the carrier about the deck', status: 'todo', assignee: 'Priya Shah' }],
  clips: [
    {
      workDate: '2026-08-05',
      phase: 'after',
      company: 'Delgado Roofing',
      summary: 'North slope stripped to decking.',
      transcript: 'Homeowner asked us not to touch the skylights.',
    },
  ],
};

const FUTURE_TEXT = [
  'The Future By Jack Cyganiak 8/11/2023',
  'Jettx – Long distance wireless power transmission.',
  'Blox Group – Automated construction, Flying movable apartment units.',
  'Aero Corp – Hypersonic individual air travel for freight and people.',
].join('\n');
const FUTURE_DOC = {
  id: 'future-style',
  filename: 'The Future.docx',
  attached: false,
  relevance: 'not_related',
  extractedText: FUTURE_TEXT,
  chunks: [{ location: 'document', text: FUTURE_TEXT }],
};

/** Internal or system text that must never reach the reader. */
const INTERNAL =
  /brief · |scope · |note · |clip · |mic · |Do not: Do not|doesn't appear to be about this job|String must contain|validation_error|Unidentified speaker|jobNumber|workDate|in_progress/;
const META_OPENER = /^(?:here(?:'|’)s|here is|based on|great question|certainly|sure)\b/i;
const FILLER_CLOSING = /(let me know if|hope this helps|feel free to|anything else)[^\n]*$/i;

function sentences(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part.trim()).length;
}

async function withoutModels<T>(run: () => Promise<T>): Promise<T> {
  const keys = [
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'ASK_WEB_SEARCH_API_KEY',
    'ASK_WEB_SEARCH_PROVIDER',
    'BRAVE_SEARCH_API_KEY',
    'SERPER_API_KEY',
    'TAVILY_API_KEY',
  ];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  try {
    return await run();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('every Chat prompt carries the Grok Bot voice rules', () => {
  for (const rule of [/Lead with the answer/, /contractions/, /1–3 short sentences/, /Prose by default/, /Bold sparingly/, /Never reply with only a quote/, /No internal or system text/, /"\?", "ok", "hi", "thanks"/]) {
    assert.match(CHAT_VOICE_RULES, rule);
  }
  assert.ok(ASK_PROSE_FORMAT_RULES.includes(CHAT_VOICE_RULES), 'job-file and clip prompts');
  assert.ok(UPLOAD_ANSWER_SYSTEM.includes(CHAT_VOICE_RULES), 'upload prompt');
  const reasoning = readFileSync(join(here, '../src/shared/askReasoning.ts'), 'utf8');
  assert.match(reasoning, /\$\{system\}\\n\\n\$\{CHAT_VOICE_RULES\}/, 'lookup prompts (full and fast)');
  // The old format rules asked for an opener and an invite to go deeper. Gone.
  assert.doesNotMatch(ASK_PROSE_FORMAT_RULES, /short opener paragraph|invite to go deeper/);
  const jobFile = readFileSync(join(here, '../src/shared/jobFileAsk.ts'), 'utf8');
  assert.doesNotMatch(jobFile, /short natural opener|optional invite to go deeper/);
});

test('post-processing drops meta openers and filler closings, nothing else', () => {
  const snapshots: Array<[string, string, string?]> = [
    [
      "Here's a quick summary of this job:\n\nCedar Ridge is a hail roof job in Round Rock. The deck replacement is approved and the skylights stay.\n\nLet me know if you'd like more detail!",
      'Cedar Ridge is a hail roof job in Round Rock. The deck replacement is approved and the skylights stay.',
    ],
    ['Based on the job file, the lockbox code is 4412. Hope this helps!', 'The lockbox code is 4412.'],
    ['Great question! Yes, the permit is BP-2026-8841.', 'Yes, the permit is BP-2026-8841.'],
    [
      'The skylights stay. Feel free to ask about anything else.\n\n⟦sources: job/1/brief⟧\n⟦followups: Who is on the job? ;; What did the videos show?⟧',
      'The skylights stay.\n\n⟦sources: job/1/brief⟧\n⟦followups: Who is on the job? ;; What did the videos show?⟧',
    ],
    // A draft the user asked for keeps its own closing line.
    ['Hi Dana, the tarp is on. Let me know if you have questions.', 'Hi Dana, the tarp is on. Let me know if you have questions.', 'draft a text to the homeowner'],
    ['Here it is.\n\n⟦artifact⟧\nHi Dana. Let me know if you have questions.\n⟦/artifact⟧', 'Here it is.\n\n⟦artifact⟧\nHi Dana. Let me know if you have questions.\n⟦/artifact⟧'],
    // A plain answer is left exactly as written.
    ['Yes. The deck replacement was approved.', 'Yes. The deck replacement was approved.'],
    // Lists keep their last item.
    ['Three people are on it:\n\n- Hector Delgado\n- Priya Shah\n- Dana Ruiz', 'Three people are on it:\n\n- Hector Delgado\n- Priya Shah\n- Dana Ruiz'],
  ];
  for (const [raw, expected, question] of snapshots) {
    assert.equal(trimChatFiller(raw, { question: question ?? 'what is going on' }), expected);
  }
});

test('eval: a job summary leads with the job, in plain sentences', async () => {
  await withoutModels(async () => {
    const result = await answerFromJobFile({ question: 'what is this job about', file, apiKey: null });
    assert.match(result.answer, /^Cedar Ridge — storm damage, at 2214 Cedar Ridge Dr, Round Rock TX — it's in progress\./);
    assert.match(result.answer, /Roof tarp and rebuild after hail\./);
    assert.match(result.answer, /Do not remove the skylights\./);
    assert.doesNotMatch(result.answer, INTERNAL);
    assert.doesNotMatch(result.answer, META_OPENER);
    assert.ok(sentences(result.answer) <= 5, result.answer);
    assert.ok(result.groundedOn > 0, 'a job answer is labelled as coming from the job file');
  });
});

test('eval: a field lookup answers with the value, not internal tags', async () => {
  await withoutModels(async () => {
    const lockbox = await answerFromJobFile({ question: 'what is the lockbox code', file, apiKey: null });
    assert.equal(lockbox.answer, 'Gate / access: Lockbox on the side gate — 4412.');
    const permit = readableJobFileAnswer("what's the permit number", file);
    assert.equal(permit, 'Permit: BP-2026-8841.');
    const scope = readableJobFileAnswer('should we remove the skylights', file);
    assert.doesNotMatch(scope, INTERNAL);
    assert.match(scope, /Do not remove the skylights — Carrier declined them\./);
  });
});

test('eval: a general question is answered directly and is not labelled as the job file', async () => {
  await withoutModels(async () => {
    const result = await answerFromJobFile({ question: 'can you search the web?', file, apiKey: null });
    assert.match(result.answer, /^(Yes|Not right now)\b/);
    assert.doesNotMatch(result.answer, FILLER_CLOSING);
    assert.doesNotMatch(result.answer, /Want me to/);
    assert.doesNotMatch(result.answer, INTERNAL);
    assert.equal(result.groundedOn, 0);
    assert.ok(sentences(result.answer) <= 3);
  });
});

test('eval: a document question gets a summary with no openers, closings or job-match note', async () => {
  await withoutModels(async () => {
    const raw =
      "Here's a summary of the document:\n\nThis is a 2023 vision note by Jack Cyganiak about four ventures: Jettx (long-distance wireless power), Blox Group (automated construction), and Aero Corp (hypersonic air travel).\n\nThis document doesn't appear to be about this job. Let me know if you'd like more details!";
    const result = await answerFromJobFile({
      question: 'what is this about',
      file,
      apiKey: null,
      sessionDocuments: [FUTURE_DOC],
      uploadComplete: (async () => ({ text: raw, model: 'stub-model', usage: null })) as never,
    });
    assert.match(result.answer, /^This is a 2023 vision note by Jack Cyganiak/);
    assert.doesNotMatch(result.answer, INTERNAL);
    assert.doesNotMatch(result.answer, META_OPENER);
    assert.doesNotMatch(result.answer, FILLER_CLOSING);
    assert.equal(result.groundedOn, 0);
  });
});

test('eval: "?", "ok", "hi" and "thanks" get a friendly reply, never an error', async () => {
  await withoutModels(async () => {
    const replies: Record<string, RegExp> = {
      '?': /^What do you want to know\?/,
      ok: /^Got it\.$/,
      hi: /^Hi! What do you want to know about this job\?$/,
      thanks: /^You're welcome\.$/,
    };
    for (const [question, expected] of Object.entries(replies)) {
      const result = await answerFromJobFile({ question, file, apiKey: null });
      assert.match(result.answer, expected, question);
      assert.doesNotMatch(result.answer, INTERNAL, question);
      assert.doesNotMatch(result.answer, /does not have that/, question);
      assert.equal(result.groundedOn, 0, `${question} is not labelled "From this job file"`);
    }
  });
});
