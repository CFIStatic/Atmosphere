import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveProofClipTitle,
  proofClipListLabel,
  proofTitleWritePatch,
  persistProofClipTitleIfEmpty,
} from '../src/verifier/proofClipTitle.js';

test('deriveProofClipTitle: prefers a short narration summary', () => {
  assert.equal(
    deriveProofClipTitle({
      narrationSummary: 'Inspection',
      narration: 'A long walk through of the attic with tools on the floor.',
    }),
    'Inspection',
  );
});

test('deriveProofClipTitle: clamps long prose to a few words', () => {
  const title = deriveProofClipTitle({
    summary:
      'The crew strips the north slope through the morning, then lays underlayment after lunch on the south side.',
  });
  assert.ok(title);
  assert.ok(title!.split(/\s+/).length <= 8);
  assert.ok(title!.length <= 60);
  assert.match(title!, /North|Slope|Strips|Crew/i);
});

test('deriveProofClipTitle: falls back to action object labels', () => {
  assert.equal(
    deriveProofClipTitle({
      actions: [{ action: 'inspect', objectLabel: 'electrical panel', description: 'Looking at breakers.' }],
    }),
    'Electrical Panel',
  );
});

test('deriveProofClipTitle: skips noise labels and uses a useful one', () => {
  assert.equal(
    deriveProofClipTitle({
      labels: ['after', 'change:significant', 'action:cut', 'flood cut'],
    }),
    'Flood Cut',
  );
});

test('deriveProofClipTitle: leaves an existing title alone', () => {
  assert.equal(
    deriveProofClipTitle({
      existingTitle: 'Custom name',
      narrationSummary: 'Inspection',
    }),
    null,
  );
  assert.deepEqual(
    proofTitleWritePatch({
      existingTitle: 'Custom name',
      narrationSummary: 'Inspection',
    }),
    {},
  );
});

test('proofClipListLabel: title wins; nested never repeats the job name', () => {
  assert.equal(
    proofClipListLabel({
      title: 'Work done xyz',
      phase: 'after',
      underJob: true,
      jobName: 'Von mour test',
    }),
    'Work done xyz',
  );
  assert.equal(
    proofClipListLabel({
      title: null,
      phase: 'before',
      capturedAt: '2026-09-09T21:28:00Z',
      underJob: true,
      jobName: 'Von mour test',
    }).startsWith('Video'),
    true,
  );
  assert.notEqual(
    proofClipListLabel({
      title: '',
      phase: 'after',
      underJob: true,
      jobName: 'Von mour test',
    }),
    'Von mour test',
  );
  assert.equal(
    proofClipListLabel({
      title: null,
      phase: 'walkthrough',
      underJob: true,
      jobName: 'Von mour test',
    }),
    'Walkthrough',
  );
});

test('persistProofClipTitleIfEmpty: writes only when title is empty', async () => {
  const updates: Array<Record<string, unknown>> = [];
  let currentTitle: string | null = null;
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                maybeSingle: async () => ({ data: { title: currentTitle }, error: null }),
              };
            },
          };
        },
        update(patch: Record<string, unknown>) {
          updates.push(patch);
          return {
            async eq() {
              currentTitle = String(patch.title ?? '');
              return { error: null };
            },
          };
        },
      };
    },
  };

  const first = await persistProofClipTitleIfEmpty(admin as any, 'p1', {
    narrationSummary: 'Inspection',
  });
  assert.equal(first, 'Inspection');
  assert.equal(updates.length, 1);

  const second = await persistProofClipTitleIfEmpty(admin as any, 'p1', {
    narrationSummary: 'Different later title',
  });
  assert.equal(second, null);
  assert.equal(updates.length, 1);
  assert.equal(currentTitle, 'Inspection');
});
