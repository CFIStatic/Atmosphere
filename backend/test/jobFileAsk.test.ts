import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerFromJobFile,
  countJobFileSources,
  formatJobFileRecord,
  groundedJobFileAnswer,
  jobFileHasContent,
  type JobFileAskContext,
} from '../src/shared/jobFileAsk.js';

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
    'Permit': 'BP-2026-8841',
  },
  briefNote: 'Carrier approved the deck replacement; skylights removed from scope.',
  scope: [
    {
      state: 'excluded',
      title: 'Do not remove the skylights',
      reason: 'Carrier declined them. Removing them is unpaid work.',
    },
    { state: 'included', title: 'Tear off and replace roof' },
  ],
  messages: [
    { author: 'Homeowner', body: 'Please do not touch the skylights — we have a separate guy for those.' },
  ],
  parties: [{ company: 'Delgado Roofing', trade: 'roofing', contact: 'Hector Delgado' }],
  tasks: [{ title: 'Call the carrier about the valley rot', status: 'todo', assignee: 'Priya Shah' }],
  clips: [
    {
      workDate: '2026-08-05',
      phase: 'after',
      company: 'Delgado Roofing',
      summary: 'North slope stripped to decking; underlayment down on two thirds.',
      transcript: 'Homeowner asked us not to touch the skylights.',
    },
  ],
};

test('formatJobFileRecord includes brief facts, scope, notes, and clips', () => {
  const text = formatJobFileRecord(file);
  assert.match(text, /2214 Cedar Ridge Dr/);
  assert.match(text, /Lockbox on the side gate/);
  assert.match(text, /\[excluded\] Do not remove the skylights/);
  assert.match(text, /Homeowner: Please do not touch the skylights/);
  assert.match(text, /Delgado Roofing/);
  assert.match(text, /Call the carrier about the valley rot/);
  assert.match(text, /Heard on the mic: Homeowner asked us not to touch the skylights/);
  assert.match(text, /CLM-88396/);
});

test('groundedJobFileAnswer reads a brief field that is not a video', () => {
  const answer = groundedJobFileAnswer('what is the lockbox', file);
  assert.match(answer, /4412/);
  assert.match(answer, /Gate \/ access|lockbox/i);
});

test('groundedJobFileAnswer reads the site address from arbitrary brief facts', () => {
  const answer = groundedJobFileAnswer('what is the site address', file);
  assert.match(answer, /2214 Cedar Ridge Dr/);
});

test('groundedJobFileAnswer reads a do-not from scope', () => {
  const answer = groundedJobFileAnswer('should we remove the skylights', file);
  assert.match(answer, /skylights/i);
  assert.match(answer, /excluded|do not|unpaid/i);
});

test('groundedJobFileAnswer lists do-nots for “what should we not do”', () => {
  const answer = groundedJobFileAnswer('what should we not do?', file);
  assert.match(answer, /skylights/i);
  assert.match(answer, /Do not/i);
});

test('groundedJobFileAnswer reads a task that is not on a clip', () => {
  const answer = groundedJobFileAnswer('what task is about the carrier', file);
  assert.match(answer, /valley rot/i);
});

test('groundedJobFileAnswer still finds a clip transcript', () => {
  const answer = groundedJobFileAnswer('what did the homeowner say about the skylights', file);
  assert.match(answer, /skylights/i);
});

test('groundedJobFileAnswer works when the file has no videos', () => {
  const briefOnly: JobFileAskContext = {
    facts: { 'Dry standard': '16% WME, control reading 12%' },
    scope: [{ state: 'excluded', title: 'Do not pull the hardwood in the dining room' }],
  };
  assert.equal(jobFileHasContent(briefOnly), true);
  assert.match(groundedJobFileAnswer('what is the dry standard', briefOnly), /16% WME/);
  assert.match(groundedJobFileAnswer('can we pull the hardwood', briefOnly), /dining room/);
});

test('groundedJobFileAnswer does not invent a fact', () => {
  const answer = groundedJobFileAnswer('what is the dumpster color', file);
  assert.match(answer, /does not have that/i);
});

test('empty file says so', () => {
  assert.equal(jobFileHasContent({}), false);
  assert.match(groundedJobFileAnswer('anything?', {}), /nothing is on this job file/i);
  assert.equal(countJobFileSources({}), 0);
});

test('answerFromJobFile uses the grounded file when no model key is wired', async () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await answerFromJobFile({ question: 'what is the permit number', file, apiKey: null });
    assert.equal(result.model, null);
    assert.match(result.answer, /BP-2026-8841/);
    assert.ok(result.groundedOn >= 4);
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
  }
});
