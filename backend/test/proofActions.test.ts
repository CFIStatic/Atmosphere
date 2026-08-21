import test from 'node:test';
import assert from 'node:assert/strict';
import {
  actionLabels,
  actionsFromLongWindows,
  actionsFromNarrationEntries,
  inferActionFromText,
  parseVisionActions,
  persistProofActions,
  storedProofActions,
} from '../src/shared/proofActions.js';

test('inferActionFromText maps verbs and demo phrases onto the closed vocabulary', () => {
  assert.equal(inferActionFromText('remove'), 'remove');
  assert.equal(inferActionFromText('Tear-out wet drywall'), 'remove');
  assert.equal(inferActionFromText('crew is cutting the baseboard'), 'cut');
  assert.equal(inferActionFromText('installing a dehumidifier'), 'position');
  assert.equal(inferActionFromText('something inscrutable on camera'), 'other');
});

test('parseVisionActions keeps grounded rows and drops empties', () => {
  const parsed = parseVisionActions(
    [
      {
        atSeconds: 12.4,
        action: 'demo',
        description: 'Worker pulling wet drywall off the south wall.',
        object: 'drywall',
        tool: 'utility knife',
        objects: ['drywall', 'knife'],
        confidence: 0.82,
      },
      { atSeconds: 3, action: 'cut', description: '' },
      {
        atSeconds: 40,
        action: 'inspect',
        description: 'Moisture meter on the exposed stud.',
        material: 'stud',
        confidence: 1.4,
      },
    ],
    { frames: [0, 12, 40], model: 'claude-test' },
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]!.atSeconds, 12, 'timestamp snaps to the nearest sampled frame');
  assert.equal(parsed[0]!.action, 'remove');
  assert.equal(parsed[0]!.objectLabel, 'drywall');
  assert.equal(parsed[0]!.toolLabel, 'utility knife');
  assert.equal(parsed[0]!.model, 'claude-test');
  assert.equal(parsed[1]!.action, 'inspect');
  assert.equal(parsed[1]!.confidence, 1);
});

test('actionsFromNarrationEntries and long windows produce a chronological log', () => {
  const fromNotes = actionsFromNarrationEntries(
    [
      { atSeconds: 5, note: 'Opens on the front elevation.' },
      { atSeconds: 42, note: 'North slope stripped to decking.' },
    ],
    { model: 'narrator' },
  );
  assert.equal(fromNotes[0]!.action, 'other');
  assert.equal(fromNotes[1]!.action, 'remove');

  const fromWindows = actionsFromLongWindows(
    [
      {
        startSeconds: 0,
        endSeconds: 600,
        reading: { summary: 'Air movers running in the living room.', activity: ['drying equipment'] },
      },
      {
        startSeconds: 1800,
        endSeconds: 2400,
        reading: { summary: 'Crew cutting out the wet baseboard.', activity: ['cut'] },
      },
    ],
    { model: 'long' },
  );
  assert.equal(fromWindows[0]!.action, 'other');
  assert.equal(fromWindows[1]!.action, 'cut');
  assert.equal(fromWindows[1]!.endSeconds, 2400);
  assert.ok(actionLabels(fromWindows).includes('action:cut'));
});

test('storedProofActions stamps source and model', () => {
  const stored = storedProofActions(
    [
      {
        atSeconds: 0,
        action: 'inspect',
        description: 'Walkthrough of the kitchen.',
        objectLabel: null,
        toolLabel: null,
        materialLabel: null,
        objects: [],
        confidence: 0.5,
        model: null,
      },
    ],
    'vision-1',
  );
  assert.equal(stored[0]!.source, 'ai_vision');
  assert.equal(stored[0]!.model, 'vision-1');
});

test('persistProofActions writes the proof column and episode rows without throwing', async () => {
  const inserts: unknown[] = [];
  const updates: unknown[] = [];
  const admin = {
    from(table: string) {
      return {
        update(patch: unknown) {
          updates.push({ table, patch });
          return { eq: async () => ({ error: null }) };
        },
        select() {
          return {
            eq: () => ({
              maybeSingle: async () =>
                table === 'episode_observations'
                  ? { data: { episode_id: 'ep-1' } }
                  : { data: { sequence: 2 } },
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: { sequence: 2 } }),
                }),
              }),
            }),
          };
        },
        delete() {
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
        insert(row: unknown) {
          inserts.push({ table, row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  await persistProofActions(admin, {
    orgId: 'org-1',
    proofId: 'proof-1',
    capturedAt: '2026-08-20T12:00:00.000Z',
    model: 'claude-test',
    actions: parseVisionActions([
      {
        atSeconds: 8,
        action: 'remove',
        description: 'Pulling wet drywall.',
        object: 'drywall',
        confidence: 0.9,
      },
    ]),
  });

  assert.equal(updates[0] && (updates[0] as { table: string }).table, 'job_proofs');
  const episodeInsert = inserts.find((row) => (row as { table: string }).table === 'episode_actions') as
    | { row: { action: string; sequence: number; proof_id: string } }
    | undefined;
  assert.ok(episodeInsert);
  assert.equal(episodeInsert!.row.action, 'remove');
  assert.equal(episodeInsert!.row.proof_id, 'proof-1');
  assert.equal(episodeInsert!.row.sequence, 3);
});
