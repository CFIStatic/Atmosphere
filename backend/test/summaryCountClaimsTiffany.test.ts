import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryClaimContradictions } from '../src/audio/summaryValidation.ts';

// Real Tiffany & Co. (job #12) clip text, read-only from production 2026-09-28.
const CLIP44_TRANSCRIPT =
  '[0:00] her entire life.\n[0:11] You know I love that girl.\n[0:30] I think she farts.\n[0:35] I love her so much.\n[0:38] I love that.';

test('44s clip: "only two intelligible speech events" over a 5-line transcript is a contradiction', () => {
  const hits = summaryClaimContradictions(
    {
      details: [
        'Only two intelligible speech events: "You know I love that girl." at [0:11] and "I love her so much." at [0:35] — both personal small talk about an unnamed third person.',
      ],
      executiveSummary:
        'The only intelligible speech is brief personal small talk about a third person — "You know I love that girl." at [0:11] and "I love her so much." at [0:35].',
    },
    CLIP44_TRANSCRIPT,
  );
  assert.equal(hits.length, 2);
  assert.ok(hits.some((h) => /two intelligible speech events/.test(h)));
  assert.ok(hits.some((h) => /The only intelligible speech/.test(h)));
  assert.ok(hits.every((h) => /5 lines/.test(h)));
});

test('1-line clip: "the only transcript line" and "only transcribed speech" stay valid', () => {
  const hits = summaryClaimContradictions(
    {
      summary:
        'Fixed-webcam clip of one seated man talking to camera in an office; the only transcript line is a boilerplate "For more information, visit www.fema.gov" tag.',
      keyMoments: [{ text: 'Only transcribed speech in the clip is a boilerplate FEMA reference line.' }],
    },
    '[0:30] For more information, visit www.fema.gov',
  );
  assert.deepEqual(hits, []);
});

test('QuickBooks clip: topic lines are not read as speech counts', () => {
  const hits = summaryClaimContradictions(
    {
      summary:
        'Informal table conversation about paper vs. spreadsheet recordkeeping and moving to QuickBooks online; no jobsite, scope, money, or insurance content in the clip.',
      details: ['Stated priority action: "We\'ve just got to go to QuickBooks online." [0:15]'],
    },
    Array.from({ length: 15 }, (_, i) => `[0:${String(i).padStart(2, '0')}] line ${i}`).join('\n'),
  );
  assert.deepEqual(hits, []);
});

test('regeneration is told the transcript line count and what was rejected', async () => {
  const { regenerationCorrection } = await import('../src/audio/proofConversation.ts');
  const text = regenerationCorrection(CLIP44_TRANSCRIPT, ['"two intelligible speech events" but the transcript has 5 lines']);
  assert.match(text, /The transcript has 5 lines/);
  assert.match(text, /Rejected: "two intelligible speech events"/);
});
