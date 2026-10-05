import test from 'node:test';
import assert from 'node:assert/strict';
import { stableClipCitationLabel } from '../src/verifier/proofClipTitle.js';
import { formatQuoteTrailer } from '../src/shared/askMoments.js';

test('item 3: stableClipCitationLabel prefers title, else date + clip number', () => {
  assert.equal(stableClipCitationLabel({ title: 'Kitchen Walkthrough', atSeconds: 65 }), 'Kitchen Walkthrough · 1:05');
  assert.equal(stableClipCitationLabel({ workDate: '2026-09-17', clipNumber: 3 }), 'Sep 17 · Clip 3');
  assert.equal(
    stableClipCitationLabel({ title: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', workDate: '2026-10-01' }),
    'Oct 1 clip',
  );
});

test('item 3: quote clip titles truncate on word boundaries', () => {
  const padded = `North Slope Tear Off ${'detail '.repeat(20)}`.trim();
  const trailer = formatQuoteTrailer([
    {
      sourceId: 'video/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/north@4',
      speaker: 'Speaker 1',
      text: 'We need the ridge cap.',
      atSeconds: 4,
      clipTitle: padded,
    },
  ]);
  const field = trailer.match(/\|clip=([^⟧]*)/)?.[1] ?? '';
  assert.ok(field.length <= 80);
  assert.match(field, /\w$/);
  // Hard slice(0,80) would often end mid-"detail"; word-boundary cut ends on a full word.
  assert.doesNotMatch(field, /detai$/);
  assert.doesNotMatch(field, /deta$/);
});
