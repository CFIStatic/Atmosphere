import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAnalysis,
  parseDayFilmAnalysis,
  keepKnownScope,
  formatCollectionRecord,
  groundedCollectionAnswer,
  collectionClipsFromRows,
} from '../src/shared/proofAnalyst.js';

/**
 * Reading the model's reply.
 *
 * The failure that matters is not a crash. It is a malformed reply half-parsed
 * into a summary that reads authoritative and says nothing true — attached to a
 * day somebody is about to pay for. So anything not exactly the shape asked for
 * comes back null, and null means "not analysed", which is honest.
 */

test('a well-formed reply parses', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Drywall hung across the north wall of the master bedroom.',
      changes: ['Bare studs in the before, hung and taped board in the after'],
      cannotTell: ['The ceiling is out of frame in both'],
      scopeTouched: ['Hang and finish drywall, level 2'],
      concerns: [],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.changes.length, 1);
  assert.equal(parsed.cannotTell.length, 1);
  assert.equal(parsed.concerns.length, 0);
});

test('a fenced code block is accepted rather than thrown away', () => {
  // The model is told JSON only; a fence is the common near-miss and discarding
  // a good answer over punctuation would be worse than accepting it.
  const parsed = parseAnalysis('```json\n{"summary":"No visible change between the two."}\n```');
  assert.ok(parsed);
  assert.equal(parsed.summary, 'No visible change between the two.');
  assert.deepEqual(parsed.changes, []);
});

test('the opening judgement parses, and anything malformed reads unclear', () => {
  const good = parseAnalysis(
    JSON.stringify({
      summary: 'Work across the slope.',
      opening: { before: 'exterior', after: 'not_exterior' },
    }),
  );
  assert.ok(good);
  assert.deepEqual(good.opening, { before: 'exterior', after: 'not_exterior' });

  // Missing entirely: unclear, never a verdict either way.
  const missing = parseAnalysis(JSON.stringify({ summary: 'Work across the slope.' }));
  assert.ok(missing);
  assert.deepEqual(missing.opening, { before: 'unclear', after: 'unclear' });

  // An invented word must not survive as one — 'inside' is not in the
  // vocabulary and a guess about filming habit is worse than no answer.
  const invented = parseAnalysis(
    JSON.stringify({
      summary: 'Work across the slope.',
      opening: { before: 'inside', after: 'outdoors probably' },
    }),
  );
  assert.ok(invented);
  assert.deepEqual(invented.opening, { before: 'unclear', after: 'unclear' });
});

test('prose instead of JSON comes back null', () => {
  assert.equal(parseAnalysis('It looks like they hung some drywall today.'), null);
  assert.equal(parseAnalysis(''), null);
  assert.equal(parseAnalysis('{'), null);
});

test('JSON without a summary is not an analysis', () => {
  // A day with changes and no summary would render as a confident finding with
  // nothing standing behind it.
  assert.equal(parseAnalysis(JSON.stringify({ changes: ['something'] })), null);
  assert.equal(parseAnalysis(JSON.stringify({ summary: '   ' })), null);
  assert.equal(parseAnalysis(JSON.stringify({ summary: 42 })), null);
});

test('non-string list entries are dropped, not coerced', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Something happened.',
      changes: ['real', 42, null, { a: 1 }, '', '  ', 'also real'],
      concerns: 'not a list',
    }),
  );
  assert.ok(parsed);
  assert.deepEqual(parsed.changes, ['real', 'also real']);
  assert.deepEqual(parsed.concerns, []);
});

test('a runaway list is capped', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Something happened.',
      changes: Array.from({ length: 50 }, (_, i) => `change ${i}`),
    }),
  );
  assert.equal(parsed?.changes.length, 12);
});

test('"no visible change" survives intact', () => {
  // The most important answer this thing can give, and the easiest to lose to
  // over-eager normalising.
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'The before and after frames look substantially the same.',
      changes: [],
      cannotTell: ['Lighting differs, but no work is visible in either'],
    }),
  );
  assert.ok(parsed);
  assert.match(parsed.summary, /substantially the same/);
  assert.deepEqual(parsed.changes, []);
});

/* ---- Completion verdicts ------------------------------------------------- */

test('scope verdicts parse, and invented verdict words are dropped', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Drywall work on the north wall.',
      scopeVerdicts: [
        { title: 'Hang and finish drywall', verdict: 'appears_complete', because: 'Board hung and taped across the wall in the after frames.' },
        { title: 'Paint', verdict: 'not_visible', because: 'No painted surfaces in frame.' },
        { title: 'Trim', verdict: 'mostly_done', because: 'Invented verdict.' },
        { title: '', verdict: 'in_progress', because: 'No title.' },
        { verdict: 'appears_complete' },
      ],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.scopeVerdicts.length, 2);
  assert.deepEqual(
    parsed.scopeVerdicts.map((v) => v.verdict),
    ['appears_complete', 'not_visible'],
  );
});

test('a verdict about work nobody ordered is discarded', () => {
  // A completion claim against a line that is not in the scope is worse than
  // no claim: it is an assertion that unordered work was done and finished.
  const kept = keepKnownScope(
    [
      { title: 'Hang and finish drywall', verdict: 'appears_complete', because: 'x' },
      { title: 'Replace the windows', verdict: 'appears_complete', because: 'nobody asked for this' },
    ],
    ['Hang and finish drywall', 'Paint the ceiling'],
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Hang and finish drywall');
});

test('scope titles are matched loosely but stored exactly', () => {
  // The model echoes titles back with its own spacing and casing; the stored
  // title has to win so the dashboard can line the verdict up with its row.
  const kept = keepKnownScope(
    [{ title: '  hang and FINISH drywall ', verdict: 'in_progress', because: 'x' }],
    ['Hang and finish drywall'],
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Hang and finish drywall');
});

test('a duplicated verdict for one line is kept once', () => {
  const kept = keepKnownScope(
    [
      { title: 'Paint', verdict: 'appears_complete', because: 'first' },
      { title: 'paint', verdict: 'not_visible', because: 'second' },
    ],
    ['Paint'],
  );
  assert.equal(kept.length, 1);
  assert.equal(kept[0].because, 'first');
});

test('no verdicts at all is valid — the camera may not have covered anything', () => {
  const parsed = parseAnalysis(JSON.stringify({ summary: 'Nothing much visible.' }));
  assert.ok(parsed);
  assert.deepEqual(parsed.scopeVerdicts, []);
});

/* ---- Material change ----------------------------------------------------- */

test('the material-change verdict parses, with its grounding', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Roof work on the north slope.',
      materialChange: 'significant',
      materialBecause: 'Bare deck in the before; underlayment and shingles across two thirds in the after.',
      changes: ['Underlayment laid', 'Shingles to the ridge line'],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.materialChange, 'significant');
  assert.match(parsed.materialBecause, /underlayment/i);
});

test('a change-claim with nothing behind it is downgraded, not trusted', () => {
  // The exact shape of output that releases a payment for work the frames do
  // not show: "significant", and an empty changes list.
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'Lots of progress.',
      materialChange: 'significant',
      materialBecause: 'It seems like a full day of work.',
      changes: [],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.materialChange, 'unclear');
  assert.match(parsed.materialBecause, /cited nothing visible/);
});

test('"none" needs no cited changes — that is what none means', () => {
  const parsed = parseAnalysis(
    JSON.stringify({
      summary: 'The frames look substantially the same.',
      materialChange: 'none',
      materialBecause: 'Same bare studs, same debris, same equipment positions.',
      changes: [],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.materialChange, 'none');
});

test('a missing or invented verdict word reads as unclear, never as a pass', () => {
  const missing = parseAnalysis(JSON.stringify({ summary: 'Something happened.' }));
  assert.equal(missing?.materialChange, 'unclear');
  assert.match(missing!.materialBecause, /did not say/);

  const invented = parseAnalysis(
    JSON.stringify({ summary: 'Something happened.', materialChange: 'substantial-ish' }),
  );
  assert.equal(invented?.materialChange, 'unclear');
});

test('a day-film reply parses work performed without a before/after pair', () => {
  const parsed = parseDayFilmAnalysis(
    JSON.stringify({
      summary: 'Crew cut wet drywall along the south wall and set two air movers.',
      workPerformed: ['Cut drywall to 24 inches on the south wall', 'Set two air movers'],
      cannotTell: ['Bathroom not in frame'],
      concerns: [],
      opening: 'not_exterior',
    }),
  );
  assert.ok(parsed);
  assert.match(parsed.summary, /wet drywall/);
  assert.equal(parsed.workPerformed.length, 2);
  assert.equal(parsed.opening, 'not_exterior');
  assert.deepEqual(parsed.scopeVerdicts, []);
});

test('a day-film reply without a summary is not an analysis', () => {
  assert.equal(parseDayFilmAnalysis(JSON.stringify({ workPerformed: ['something'] })), null);
  assert.equal(parseDayFilmAnalysis('They hung some drywall today.'), null);
});

/* ---- Asking the collection ---------------------------------------------- */

test('formatCollectionRecord includes morning clips, transcripts, and day films', () => {
  const text = formatCollectionRecord([
    {
      workDate: '2026-08-20',
      phase: 'before',
      company: 'Acme',
      summary: 'Empty hall',
      transcript: 'We have not started the subfloor yet',
    },
    {
      workDate: '2026-08-20',
      phase: 'after',
      company: 'Acme',
      summary: 'Drywall hung',
      narration: 'Board across the north wall',
      changes: ['Hung drywall'],
      concerns: ['Wet corner'],
    },
  ]);
  assert.match(text, /morning clip/);
  assert.match(text, /Heard on the mic: We have not started the subfloor yet/);
  assert.match(text, /day film/);
  assert.match(text, /Drywall hung/);
  assert.match(text, /Wet corner/);
});

test('groundedCollectionAnswer finds a hit on a morning-clip transcript', () => {
  const answer = groundedCollectionAnswer('when was the subfloor mentioned', [
    { workDate: '2026-08-21', phase: 'after', summary: 'Painted the ceiling' },
    {
      workDate: '2026-08-20',
      phase: 'before',
      summary: 'Empty hall before the crew started.',
      transcript: 'The subfloor is exposed in the hall',
    },
  ]);
  assert.match(answer, /2026-08-20/);
  assert.match(answer, /morning clip/);
  assert.match(answer, /subfloor/);
});

test('groundedCollectionAnswer says so when nothing is filed', () => {
  assert.match(groundedCollectionAnswer('any drywall?', []), /nothing to answer/i);
});

test('collectionClipsFromRows keeps every clip, not only after-phase', () => {
  const clips = collectionClipsFromRows([
    {
      work_date: '2026-08-20',
      phase: 'before',
      ai_summary: 'Morning',
      transcript_text: 'hello',
    },
    {
      work_date: '2026-08-20',
      phase: 'after',
      narration_text: 'Day film',
      ai_findings: { workPerformed: ['cut drywall'], concerns: ['open junction'] },
    },
  ]);
  assert.equal(clips.length, 2);
  assert.equal(clips[0]!.phase, 'before');
  assert.equal(clips[0]!.transcript, 'hello');
  assert.equal(clips[1]!.summary, 'Day film');
  assert.deepEqual(clips[1]!.changes, ['cut drywall']);
  assert.deepEqual(clips[1]!.concerns, ['open junction']);
});
