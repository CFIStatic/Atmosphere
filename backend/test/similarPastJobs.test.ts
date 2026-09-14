import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cosineSimilarity,
  normalizeLabel,
  rankSimilarPastJobs,
  roomsFromAnalysis,
  scoreSimilarJob,
  textEmbedding,
  uniqueLabels,
} from '../src/shared/similarPastJobs.js';

test('normalizeLabel + uniqueLabels collapse trade aliases', () => {
  assert.equal(normalizeLabel('Roofing'), 'roofing');
  assert.deepEqual(uniqueLabels(['Roofing', 'roofing', '  electrical ', '']), [
    'roofing',
    'electrical',
  ]);
});

test('textEmbedding cosine — identical analysis is near 1', () => {
  const a = textEmbedding('Bathroom water mitigation demo drywall mold kitchen.');
  const b = textEmbedding('Bathroom water mitigation demo drywall mold kitchen.');
  assert.ok(cosineSimilarity(a, b) > 0.99);
});

test('textEmbedding cosine — unrelated prose is low', () => {
  const a = textEmbedding('Roof tear-off underlayment shingles ridge vent.');
  const b = textEmbedding('Payroll spreadsheet invoice accounting ledger.');
  assert.ok(cosineSimilarity(a, b) < 0.25);
});

test('scoreSimilarJob rewards work type, trade, rooms, and analysis', () => {
  const source = {
    jobId: 'job-a',
    title: 'Harbor unit water loss',
    workType: 'mitigation',
    trades: ['water mitigation'],
    rooms: ['bathroom', 'kitchen'],
    analysisText: 'Demo wet drywall in bathroom; extract water from kitchen cabinets.',
  };
  const twin = {
    jobId: 'job-b',
    title: 'Lakeview kitchen + bath',
    workType: 'mitigation',
    trades: ['water mitigation'],
    rooms: ['bathroom', 'kitchen'],
    analysisText: 'Extract water kitchen cabinets; bathroom drywall demo for mold.',
  };
  const unrelated = {
    jobId: 'job-c',
    title: 'New build framing',
    workType: 'construction',
    trades: ['framing'],
    rooms: ['garage'],
    analysisText: 'Stick frame exterior walls and set trusses.',
  };

  const good = scoreSimilarJob(source, twin);
  const bad = scoreSimilarJob(source, unrelated);
  assert.ok(good.score > bad.score);
  assert.ok(good.score >= 0.5);
  assert.ok(good.sharedRooms.includes('bathroom'));
  assert.ok(good.reasons.some((r) => /work type/i.test(r)));
  assert.ok(good.reasons.some((r) => /trade/i.test(r)));
});

test('rankSimilarPastJobs excludes self and respects limit', () => {
  const source = {
    jobId: 'job-a',
    title: 'Source',
    workType: 'mitigation',
    trades: ['plumbing'],
    rooms: ['bathroom'],
    analysisText: 'Supply line burst under vanity.',
  };
  const candidates = [
    source,
    {
      jobId: 'job-b',
      title: 'Close match',
      workType: 'mitigation',
      trades: ['plumbing'],
      rooms: ['bathroom'],
      analysisText: 'Vanity supply line burst; bathroom flooded.',
    },
    {
      jobId: 'job-c',
      title: 'Weak',
      workType: 'construction',
      trades: ['roofing'],
      rooms: ['attic'],
      analysisText: 'Shingle replacement north slope.',
    },
  ];
  const ranked = rankSimilarPastJobs(source, candidates, { limit: 1, minScore: 0.1 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.jobId, 'job-b');
});

test('roomsFromAnalysis merges findings + text scanner', () => {
  const rooms = roomsFromAnalysis(
    'Standing water in the basement hallway.',
    {
      conversation: { roomsMentioned: ['kitchen'] },
      rooms: ['attic'],
    },
    (text) => {
      const hits: string[] = [];
      if (/basement/i.test(text)) hits.push('basement');
      if (/hallway/i.test(text)) hits.push('hallway');
      return hits;
    },
  );
  assert.deepEqual(rooms.sort(), ['attic', 'basement', 'hallway', 'kitchen'].sort());
});
