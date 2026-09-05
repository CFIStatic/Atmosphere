import test from 'node:test';
import assert from 'node:assert/strict';
import {
  disputesForProof,
  seekSecondsFor,
  surfaceDisputes,
  type DisputeClip,
} from '../src/shared/disputeSurfacing.js';

const scope = [
  { title: 'Remove temporary tarp', state: 'included' },
  { title: 'Install synthetic underlayment', state: 'approved' },
  { title: 'Do not touch the skylights', state: 'excluded', reason: 'Carrier pulled them.' },
];

const clip = (over: Partial<DisputeClip> & Pick<DisputeClip, 'id'>): DisputeClip => ({
  workDate: '2026-08-05',
  phase: 'after',
  company: 'Delgado Roofing',
  partyId: 'pty-2',
  ...over,
});

test('off-site integrity fail is a high dispute with a real seek, not 0:00', () => {
  const moments = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'off-site',
        checks: [
          {
            key: 'on_site',
            verdict: 'fail',
            what: 'Filmed on site',
            detail: 'Filmed 2.14 miles from the site — a different address.',
          },
        ],
        events: [
          { atSeconds: 0, text: 'Opens on a roof that does not match the job.' },
          { atSeconds: 8, text: 'Street trees and a different pitch come into frame.' },
        ],
      }),
    ],
  });
  assert.equal(moments.length, 1);
  assert.equal(moments[0]!.kind, 'integrity');
  assert.equal(moments[0]!.severity, 'high');
  assert.match(moments[0]!.title, /Filmed on site/i);
  assert.equal(moments[0]!.seekSeconds, 8);
  assert.notEqual(moments[0]!.seekSeconds, 0);
});

test('excluded scope visible in events is the dispute GCs tap for', () => {
  const moments = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'skylight',
        concerns: ['Crew appears to work the skylights, which are out of scope.'],
        events: [
          { atSeconds: 12, text: 'Walking the eave; underlayment in progress.' },
          { atSeconds: 41, text: 'Hands on the skylight flashing; tools in frame.' },
        ],
        scopeVerdicts: [
          { title: 'Do not touch the skylights', verdict: 'in_progress', because: 'Tools on the flashing.' },
        ],
      }),
    ],
  });
  const scopeHits = moments.filter((m) => m.kind === 'scope');
  assert.ok(scopeHits.length >= 1, JSON.stringify(moments, null, 2));
  assert.equal(scopeHits[0]!.severity, 'high');
  assert.match(scopeHits[0]!.title, /skylights/i);
  assert.equal(scopeHits[0]!.seekSeconds, 41);
  assert.equal(scopeHits[0]!.scopeTitle, 'Do not touch the skylights');
});

test('two after clips that disagree on an included line surface as a clip conflict', () => {
  const moments = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'tue',
        workDate: '2026-08-05',
        scopeVerdicts: [{ title: 'Remove temporary tarp', verdict: 'appears_complete', because: 'Tarp is gone.' }],
        events: [{ atSeconds: 12, text: 'Tarp gone, deck exposed.' }],
      }),
      clip({
        id: 'thu',
        workDate: '2026-08-07',
        scopeVerdicts: [{ title: 'Remove temporary tarp', verdict: 'in_progress', because: 'Tarp is clipped again at the ridge.' }],
        events: [{ atSeconds: 19, text: 'Temporary tarp is back on the north slope.' }],
      }),
    ],
  });
  const clash = moments.find((m) => m.kind === 'clip');
  assert.ok(clash, JSON.stringify(moments, null, 2));
  assert.deepEqual(clash!.relatedProofIds.sort(), ['thu', 'tue']);
  assert.equal(clash!.proofId, 'thu');
  assert.equal(clash!.seekSeconds, 19);
  assert.match(clash!.title, /disagree|tarp/i);
});

test('a before clip saying not_visible is not a dispute', () => {
  const moments = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'morning',
        phase: 'before',
        scopeVerdicts: [
          { title: 'Remove temporary tarp', verdict: 'not_visible' },
          { title: 'Do not touch the skylights', verdict: 'not_visible' },
        ],
        events: [{ atSeconds: 6, text: 'Tarp still on; nobody on the roof.' }],
      }),
    ],
  });
  assert.deepEqual(moments, []);
});

test('no-change after is a medium clip dispute; clean pass is silent', () => {
  const quiet = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'clean',
        checks: [{ key: 'on_site', verdict: 'pass', detail: 'On site.' }],
        materialChange: 'significant',
        scopeVerdicts: [{ title: 'Remove temporary tarp', verdict: 'appears_complete' }],
      }),
    ],
  });
  assert.deepEqual(quiet, []);

  const none = surfaceDisputes({
    scope,
    clips: [clip({ id: 'same', materialChange: 'none' })],
  });
  assert.equal(none.length, 1);
  assert.equal(none[0]!.kind, 'clip');
  assert.equal(none[0]!.severity, 'medium');
});

test('disputesForProof keeps related clip-vs-clip rows on either side', () => {
  const moments = surfaceDisputes({
    scope,
    clips: [
      clip({
        id: 'a',
        scopeVerdicts: [{ title: 'Remove temporary tarp', verdict: 'appears_complete' }],
      }),
      clip({
        id: 'b',
        workDate: '2026-08-08',
        scopeVerdicts: [{ title: 'Remove temporary tarp', verdict: 'in_progress' }],
      }),
    ],
  });
  assert.ok(disputesForProof(moments, 'a').length >= 1);
  assert.ok(disputesForProof(moments, 'b').length >= 1);
});

test('seekSecondsFor never invents a 0:00 blob when nothing timed matches', () => {
  assert.equal(seekSecondsFor([], 'tarp'), null);
  assert.equal(seekSecondsFor([{ atSeconds: 0, text: 'Whole clip dump.' }], 'tarp'), null);
  assert.equal(seekSecondsFor([{ atSeconds: 14, text: 'Tarp pulled off the ridge.' }], 'tarp'), 14);
});
