import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHonestNotFound,
  formatHonestNotFound,
  looksLikeNotFound,
  stripEmptyJobBoilerplate,
} from '../src/shared/askNotFound.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const catalog: AskLookupCatalog = {
  orgId: 'o',
  jobId: 'j',
  jobTitle: 'Sample roof',
  access: 'org',
  clips: [
    {
      proofId: 'p1',
      orgId: 'o',
      jobId: 'j',
      title: 'Clip 1',
      transcript: 'We talked about the roof schedule.',
      workDate: '2026-10-01',
    },
  ],
  history: [{ at: '2026-10-01T12:00:00Z', summary: 'Note about materials' }],
} as AskLookupCatalog;

test('formatHonestNotFound leads with Not found and search counts', () => {
  const text = formatHonestNotFound({
    question: 'Did anyone mention a dollar amount, price or deadline for the roof work?',
    catalog,
    searched: {
      phrases: ['dollar amount', 'price', 'deadline'],
      terms: ['roof'],
      clipCount: 1,
      hitCount: 0,
      noteCount: 1,
      documentCount: 0,
      transcriptChunkCount: 1,
    },
  });
  assert.match(text, /^Not found\./);
  assert.match(text, /1 clip/);
  assert.match(text, /1 note/);
  assert.match(text, /0 document/);
  assert.doesNotMatch(text, /Field Capture can still film/i);
  assert.doesNotMatch(text, /[“”]/);
  assert.match(text, /dollar amount; price; deadline/);
});

test('stripEmptyJobBoilerplate drops Field Capture filler when clips exist', () => {
  const raw =
    'Work type: construction. No work description yet. Field Capture can still film — AI will describe what happened from the video.';
  const cleaned = stripEmptyJobBoilerplate(raw, catalog);
  assert.doesNotMatch(cleaned, /Field Capture can still film/i);
  assert.doesNotMatch(cleaned, /Work type:/i);
});

test('looksLikeNotFound catches soft denials from live Sample Job phrasing', () => {
  assert.equal(
    looksLikeNotFound("No, there's **no QuickBooks quote** on this job. The file has no quote."),
    true,
  );
  assert.equal(
    looksLikeNotFound("No, the file doesn't show a tarp being installed on this job."),
    true,
  );
  assert.equal(
    looksLikeNotFound("There's no claim number on this job. The claim field is empty."),
    true,
  );
  assert.equal(
    looksLikeNotFound('An unidentified speaker laid out tomorrow, but the file does not name who promised to come back.'),
    true,
  );
  assert.equal(looksLikeNotFound('There are **1** videos on this job.'), false);
});

test('applyHonestNotFound rewrites hedges and boilerplate', () => {
  const ok = applyHonestNotFound('There are **2** clips on this job.', catalog, 'how many');
  assert.match(ok, /2/);
  const hedged = applyHonestNotFound('Nothing on this file matches that.', catalog, 'purple?');
  assert.match(hedged, /^Not found\./);
  const boiler = applyHonestNotFound(
    'Work type: construction. No work description yet. Field Capture can still film — AI will describe what happened from the video.',
    catalog,
    'Did anyone mention a dollar amount for the roof?',
  );
  assert.match(boiler, /^Not found\./);
  assert.doesNotMatch(boiler, /Field Capture/i);
});

test('applyHonestNotFound rewrites live unanswerable soft denials to exact Not found. lead-in', () => {
  const cases = [
    ["No, there's **no QuickBooks quote** on this job. The file has no quote, estimate or pricing.", 'QuickBooks'],
    ["No, the file doesn't show a tarp being installed on this job.", 'tarp'],
    ['An unidentified speaker laid out the plan for the next day, but the file does not name who promised to come back tomorrow.', 'promised'],
    ["There's no claim number on this job. The claim field is empty.", 'claim'],
  ] as const;
  for (const [raw, needle] of cases) {
    const out = applyHonestNotFound(raw, catalog, needle);
    assert.match(out, /^Not found\./, raw);
    assert.match(out, /I searched .+ clip/);
    assert.match(out, /transcript section/);
    assert.match(out, /note/);
    assert.match(out, /document/);
  }
});

test('applyHonestNotFound rewrites ungrounded denials when noGroundedClaim', () => {
  const compare =
    'Day 1 covers cabinets; day 2 is not on this file so a full comparison is not possible.';
  const kept = applyHonestNotFound(compare, catalog, 'compare day 1 to day 2');
  // Without noGroundedClaim, soft "not on this file" still rewrites via DENIAL.
  assert.match(kept, /^Not found\./);
  const withCite = applyHonestNotFound(
    'Day 1 is Oct 4.\n⟦sources: video/j/p1@0⟧',
    catalog,
    'compare day 1 to day 2',
    { noGroundedClaim: false },
  );
  assert.doesNotMatch(withCite, /^Not found\./);
});
