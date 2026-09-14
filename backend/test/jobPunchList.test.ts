import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildJobPunchList,
  fingerprintFromTaskDetails,
  punchMarkerLine,
  taskPayloadFromPunchItem,
  type PunchListClipInput,
} from '../src/shared/jobPunchList.js';

const clip = (over: Partial<PunchListClipInput> & Pick<PunchListClipInput, 'id'>): PunchListClipInput => ({
  workDate: '2026-08-05',
  phase: 'after',
  company: 'Delgado Roofing',
  partyId: 'pty-2',
  ...over,
});

test('empty analysis yields no punch items — never invents', () => {
  const items = buildJobPunchList({
    clips: [clip({ id: 'empty', conversation: null, aiFindings: null })],
  });
  assert.deepEqual(items, []);
});

test('action items keep seek timestamps and owner labels', () => {
  const items = buildJobPunchList({
    clips: [
      clip({
        id: 'talk',
        conversation: {
          conversationActionItems: [
            {
              text: 'Remount the chest cam before drywall',
              tSec: 94,
              quote: "I'll remount the cam before we close the wall",
              owner: 'Crew',
            },
          ],
        },
      }),
    ],
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]!.source, 'action');
  assert.equal(items[0]!.seekSeconds, 94);
  assert.equal(items[0]!.ownerLabel, 'Crew');
  assert.equal(items[0]!.proofId, 'talk');
  assert.match(items[0]!.quote ?? '', /remount/i);
});

test('not_visible and cannotTell never become punch items', () => {
  const items = buildJobPunchList({
    clips: [
      clip({
        id: 'gaps',
        aiFindings: {
          scopeVerdicts: [
            { title: 'Install underlayment', verdict: 'not_visible', because: 'Camera never showed the eave.' },
            { title: 'Replace drip edge', verdict: 'in_progress', because: 'Half the run is on, half bare.' },
          ],
          concerns: ['Flashing at the chimney looks unfinished.'],
        },
        events: [
          { atSeconds: 12, text: 'Walking the eave; underlayment rolls in frame.' },
          { atSeconds: 40, text: 'Drip edge half installed; bare fascia still open.' },
          { atSeconds: 55, text: 'Chimney flashing looks unfinished.' },
        ],
      }),
    ],
  });
  assert.equal(items.length, 2);
  assert.ok(items.every((i) => i.source === 'scope_in_progress' || i.source === 'concern'));
  assert.ok(!items.some((i) => /underlayment/i.test(i.text) && i.source === 'scope_in_progress'));
  const drip = items.find((i) => /drip edge/i.test(i.text));
  assert.ok(drip);
  assert.equal(drip!.source, 'scope_in_progress');
  assert.ok(drip!.seekSeconds == null || drip!.seekSeconds > 0);
});

test('assigned tasks match via punch marker fingerprint', () => {
  const items = buildJobPunchList({
    clips: [
      clip({
        id: 'c1',
        conversation: {
          conversationActionItems: [{ text: 'Order matching shingles', tSec: 20 }],
        },
      }),
    ],
  });
  assert.equal(items.length, 1);
  const fp = items[0]!.fingerprint;
  const linked = buildJobPunchList({
    clips: [
      clip({
        id: 'c1',
        conversation: {
          conversationActionItems: [{ text: 'Order matching shingles', tSec: 20 }],
        },
      }),
    ],
    assignedTasks: [
      {
        id: 'task-9',
        title: 'Order matching shingles',
        status: 'todo',
        details: `From film\n${punchMarkerLine(fp, 20, 'c1')}`,
      },
    ],
  });
  assert.equal(linked[0]!.assignedTaskId, 'task-9');
  assert.equal(fingerprintFromTaskDetails(punchMarkerLine(fp, 20, 'c1')), fp);
});

test('taskPayloadFromPunchItem embeds machine marker for round-trip', () => {
  const items = buildJobPunchList({
    clips: [
      clip({
        id: 'c2',
        conversation: {
          conversationUnresolvedQuestions: [
            { text: 'Is the skylight in scope?', tSec: 71, quote: 'Is the skylight in scope?' },
          ],
        },
      }),
    ],
  });
  const payload = taskPayloadFromPunchItem(items[0]!);
  assert.match(payload.details, /atmosphere\.punch:/);
  assert.equal(fingerprintFromTaskDetails(payload.details), items[0]!.fingerprint);
  assert.match(payload.title, /skylight/i);
});

test('duplicate text on same clip collapses to one item', () => {
  const items = buildJobPunchList({
    clips: [
      clip({
        id: 'dup',
        conversation: {
          conversationActionItems: [
            { text: 'Call the adjuster', tSec: 10 },
            { text: 'Call the adjuster', tSec: 40 },
          ],
        },
      }),
    ],
  });
  assert.equal(items.length, 1);
});
