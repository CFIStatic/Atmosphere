import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyHonestNotFound,
  formatHonestNotFound,
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
});

test('stripEmptyJobBoilerplate drops Field Capture filler when clips exist', () => {
  const raw =
    'Work type: construction. No work description yet. Field Capture can still film — AI will describe what happened from the video.';
  const cleaned = stripEmptyJobBoilerplate(raw, catalog);
  assert.doesNotMatch(cleaned, /Field Capture can still film/i);
  assert.doesNotMatch(cleaned, /Work type:/i);
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
