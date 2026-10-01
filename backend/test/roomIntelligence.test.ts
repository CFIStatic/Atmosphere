import test from 'node:test';
import assert from 'node:assert/strict';
import {
  answerRoomQuestion,
  applyCrossClipRoomIdentity,
  isRoomQuestion,
  matchRoomsAcrossClips,
  parseRoomSegmentPayload,
  roomAnalysisFingerprint,
  roomWorkDuration,
  segmentClipRooms,
  shouldRewriteRooms,
  type RoomClipInput,
} from '../src/shared/roomIntelligence.js';
import { routeAskResearch, runAskResearch } from '../src/shared/askResearch.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

const kitchen: RoomClipInput = {
  proofId: 'k1',
  title: 'Kitchen walkthrough',
  workDate: '2026-09-21',
  phase: 'after',
  durationSeconds: 40,
  actions: [
    {
      atSeconds: 12,
      room: 'kitchen',
      action: 'position',
      description: 'Installs the cabinet boxes along the east wall.',
    },
  ],
  transcriptSegments: [{ start: 14, end: 16, text: 'The east wall is open.', speaker: 'SPEAKER_0' }],
};

const bathStart: RoomClipInput = {
  proofId: 'b1',
  title: 'Bathroom start',
  workDate: '2026-09-03',
  phase: 'before',
  durationSeconds: 30,
  actions: [{ atSeconds: 8, room: 'bathroom', action: 'remove', description: 'Removes the old vanity.' }],
};

const bathFinish: RoomClipInput = {
  proofId: 'b2',
  title: 'Bathroom finish',
  workDate: '2026-09-24',
  phase: 'after',
  durationSeconds: 36,
  actions: [
    { atSeconds: 20, room: 'bathroom', action: 'position', description: 'Sets the new vanity and caulks the seam.' },
  ],
};

const living: RoomClipInput = {
  proofId: 'l1',
  title: 'Living room close-up',
  workDate: '2026-09-10',
  phase: 'before',
  durationSeconds: 20,
  actions: [
    { atSeconds: 6, room: 'living room', action: 'inspect', description: 'Crack in the drywall above the window.' },
  ],
};

const fileClips = [kitchen, bathStart, bathFinish, living];

test('parseRoomSegmentPayload drops invalid rows and does not invent a room', () => {
  const spans = parseRoomSegmentPayload([
    { startSec: 0, endSec: 12, room: 'kitchen', confidence: 0.8 },
    { room: 'bathroom' },
    { start: 12, end: 20, label: '' },
    { startSeconds: 20, endSeconds: 30, name: 'room unclear', confidence: 2 },
  ]);
  assert.equal(spans.length, 3);
  assert.equal(spans[0]!.identity.roomType, 'kitchen');
  assert.equal(spans[1]!.identity.roomType, 'unclear');
  assert.equal(spans[2]!.identity.roomType, 'unclear');
  assert.equal(spans[2]!.confidence, 1);
});

test('segmentClipRooms splits a clip, keeps two bathrooms apart, and ties speech', () => {
  const kitchenSpans = segmentClipRooms(kitchen);
  assert.equal(kitchenSpans[0]!.roomName, 'room unclear');
  const kitchenSpan = kitchenSpans.find((span) => span.roomName === 'kitchen');
  assert.ok(kitchenSpan);
  assert.equal(kitchenSpan!.startSeconds, 12);
  assert.equal(kitchenSpan!.endSeconds, 40);
  assert.equal(kitchenSpan!.findings[0]!.text, 'Installs the cabinet boxes along the east wall.');
  assert.equal(kitchenSpan!.findings[0]!.atSeconds, 12);
  assert.equal(kitchenSpan!.speech[0]!.text, 'The east wall is open.');
  assert.equal(kitchenSpan!.speech[0]!.speaker, 'Speaker 1');

  const late = segmentClipRooms({
    proofId: 'late',
    durationSeconds: 30,
    actions: [{ atSeconds: 8, room: 'hallway', action: 'inspect', description: 'Looks down the hallway.' }],
  });
  assert.equal(late[0]!.roomName, 'room unclear');
  assert.equal(late[0]!.endSeconds, 8);
  assert.equal(late[1]!.roomName, 'hallway');

  const baths = segmentClipRooms({
    proofId: 'two',
    durationSeconds: 40,
    actions: [
      { atSeconds: 4, room: 'bathroom 1', action: 'inspect', description: 'Tub along the west wall.' },
      { atSeconds: 22, room: 'bathroom 2', action: 'inspect', description: 'Shower on the east wall.' },
    ],
  });
  const names = baths.map((span) => span.roomName);
  assert.ok(names.includes('bathroom 1'));
  assert.ok(names.includes('bathroom 2'));
  assert.equal(new Set(names.filter((name) => name.startsWith('bathroom'))).size, 2);
});

test('a bathroom label stays, and redacted intervals are not quoted', () => {
  const spans = segmentClipRooms({
    proofId: 'priv',
    title: 'Bath',
    durationSeconds: 20,
    actions: [{ atSeconds: 6, room: 'bathroom', action: 'inspect', description: 'Water stain along the vanity toe kick.' }],
    transcriptSegments: [{ start: 6, end: 8, text: 'Do not quote this.', speaker: 'SPEAKER_0' }],
    privacyRedactions: { ranges: [{ startSec: 4, endSec: 10, reason: 'bathroom', confidence: 0.9, source: 'vision' }] },
  });
  const bath = spans.find((span) => span.roomName === 'bathroom');
  assert.ok(bath);
  assert.equal(bath!.findings.length, 0);
  assert.equal(bath!.speech.length, 0);
});

test('the same kitchen on two days is one room; numbered bathrooms stay apart', () => {
  const rooms = matchRoomsAcrossClips([
    kitchen,
    { ...kitchen, proofId: 'k2', title: 'Kitchen return', workDate: '2026-09-28' },
    {
      proofId: 'n1',
      title: 'Bath one',
      workDate: '2026-09-01',
      durationSeconds: 10,
      actions: [{ atSeconds: 2, room: 'bathroom 1', action: 'inspect', description: 'Tub along the wall.' }],
    },
    {
      proofId: 'n2',
      title: 'Bath two',
      workDate: '2026-09-02',
      durationSeconds: 10,
      actions: [{ atSeconds: 2, room: 'bathroom 2', action: 'inspect', description: 'Shower on the wall.' }],
    },
  ]);
  const kitchenRoom = rooms.find((room) => room.roomName === 'kitchen');
  assert.ok(kitchenRoom);
  assert.deepEqual(kitchenRoom!.datesWorked, ['2026-09-21', '2026-09-28']);
  assert.equal(kitchenRoom!.sightings.length, 2);
  assert.equal(rooms.filter((room) => room.roomType === 'bathroom').length, 2);
});

test('a generic bathroom folds into the only specific bathroom unless fixtures conflict', () => {
  const merged = matchRoomsAcrossClips([
    {
      proofId: 'p',
      title: 'Primary',
      workDate: '2026-09-01',
      durationSeconds: 10,
      actions: [{ atSeconds: 1, room: 'primary bathroom', action: 'inspect', description: 'Vanity on the north wall.' }],
    },
    {
      proofId: 'g',
      title: 'Later bath',
      workDate: '2026-09-04',
      durationSeconds: 10,
      actions: [{ atSeconds: 1, room: 'bathroom', action: 'inspect', description: 'Looks at the vanity.' }],
    },
  ]);
  assert.equal(merged.filter((room) => room.roomType === 'bathroom').length, 1);
  assert.equal(merged.find((room) => room.roomType === 'bathroom')!.roomName, 'primary bathroom');
  assert.equal(merged[0]!.sightings.length, 2);
  const generic = segmentClipRooms({
    proofId: 'g',
    title: 'Later bath',
    workDate: '2026-09-04',
    durationSeconds: 10,
    actions: [{ atSeconds: 1, room: 'bathroom', action: 'inspect', description: 'Looks at the vanity.' }],
  }).find((segment) => segment.roomType === 'bathroom')!;
  const stored = applyCrossClipRoomIdentity('g', [generic], merged);
  assert.equal(stored[0]!.roomKey, 'bathroom::primary');
  assert.equal(stored[0]!.roomName, 'primary bathroom');

  const split = matchRoomsAcrossClips([
    {
      proofId: 'p',
      title: 'Primary',
      workDate: '2026-09-01',
      durationSeconds: 10,
      actions: [{ atSeconds: 1, room: 'primary bathroom', action: 'inspect', description: 'Shower on the north wall.' }],
    },
    {
      proofId: 'g',
      title: 'Other',
      workDate: '2026-09-04',
      durationSeconds: 10,
      actions: [{ atSeconds: 1, room: 'bathroom', action: 'inspect', description: 'Tub along the west wall.' }],
    },
  ]);
  assert.equal(split.filter((room) => room.roomType === 'bathroom').length, 2);
});

test('bathroom duration is first work clip to last, and completion is not assumed', () => {
  const room = matchRoomsAcrossClips([bathStart, bathFinish]).find((item) => item.roomName === 'bathroom')!;
  const duration = roomWorkDuration(room);
  assert.equal(duration.label, 'about 3 weeks');
  assert.equal(duration.completionEstablished, false);
  assert.match(duration.prose, /Sep 3, 2026/);
  assert.match(duration.prose, /Sep 24, 2026/);
  assert.match(duration.prose, /Bathroom start/);
  assert.match(duration.prose, /Bathroom finish/);
  assert.match(duration.prose, /about 3 weeks/);
  assert.match(duration.prose, /does not establish completion/);

  const done = matchRoomsAcrossClips([
    bathStart,
    {
      ...bathFinish,
      actions: [
        {
          atSeconds: 20,
          room: 'bathroom',
          action: 'inspect',
          description: 'The vanity work is complete.',
        },
      ],
    },
  ]).find((item) => item.roomName === 'bathroom')!;
  assert.equal(roomWorkDuration(done).completionEstablished, true);
  assert.match(roomWorkDuration(done).prose, /describes that work as complete/);
});

test('room questions answer from tagged evidence and say when a room is missing', () => {
  assert.equal(isRoomQuestion('please remove the tarp'), false);
  assert.equal(isRoomQuestion('what was done in the bathroom?'), true);
  assert.equal(isRoomQuestion('what was said in the office recording'), false);
  assert.equal(isRoomQuestion('At any point did the worker go in the bathroom?'), false);
  assert.equal(isRoomQuestion('Did they work in the kitchen?'), false);
  assert.equal(isRoomQuestion('what rooms are on file?'), true);
  assert.equal(isRoomQuestion('what damage is in the living room?'), true);
  assert.equal(isRoomQuestion('where is the lockbox in the living room?'), false);
  assert.equal(isRoomQuestion('who uploaded the dining room video?'), false);
  assert.equal(isRoomQuestion('search the web for living room paint prices'), false);
  assert.equal(routeAskResearch('where is the lockbox in the living room?').reason, 'simple');
  assert.equal(routeAskResearch('what damage is in the living room?').reason, 'room');

  const kitchenAnswer = answerRoomQuestion('what work was completed in the kitchen on Sep 21?', fileClips);
  assert.match(kitchenAnswer!, /Installs the cabinet boxes along the east wall/);
  assert.match(kitchenAnswer!, /Kitchen walkthrough, 0:12/);
  assert.match(kitchenAnswer!, /Sep 21/);

  const bath = answerRoomQuestion('what was done in the bathroom?', fileClips);
  assert.match(bath!, /Removes the old vanity/);
  assert.match(bath!, /Sets the new vanity and caulks the seam/);

  const weeks = answerRoomQuestion('how many weeks did it take to fix the bathroom?', fileClips);
  assert.match(weeks!, /about 3 weeks/);
  assert.match(weeks!, /does not establish completion/);

  const damage = answerRoomQuestion('what damage is in the living room?', fileClips);
  assert.match(damage!, /Crack in the drywall above the window/);
  assert.match(damage!, /Living room close-up, 0:06/);

  const missing = answerRoomQuestion('what damage is in the attic?', fileClips);
  assert.match(missing!, /An attic is not on file/);

  const ambiguous = answerRoomQuestion('what was done in the bathroom?', [
    {
      proofId: 'n1',
      title: 'One',
      workDate: '2026-09-01',
      durationSeconds: 8,
      actions: [{ atSeconds: 1, room: 'bathroom 1', action: 'remove', description: 'Removes the old vanity.' }],
    },
    {
      proofId: 'n2',
      title: 'Two',
      workDate: '2026-09-02',
      durationSeconds: 8,
      actions: [{ atSeconds: 1, room: 'bathroom 2', action: 'position', description: 'Sets the new vanity and caulks the seam.' }],
    },
  ]);
  assert.match(ambiguous!, /bathroom 1 and bathroom 2/);
  assert.match(ambiguous!, /does not say which one/);
});

test('room questions route into research and the loop answers without a planner model', async () => {
  assert.deepEqual(routeAskResearch('what work was completed in the kitchen on Sep 21?'), {
    route: 'research',
    reason: 'room',
  });
  assert.equal(routeAskResearch('What changed between the first and last visit?').reason, 'timeline');

  const catalog: AskLookupCatalog = {
    orgId: 'org',
    jobId: 'job',
    access: 'org',
    jobTitle: 'Synthetic Room Job',
    timeZone: 'America/Chicago',
    clips: fileClips.map((clip) => ({
      proofId: clip.proofId,
      jobId: 'job',
      orgId: 'org',
      title: clip.title ?? 'Clip',
      workDate: clip.workDate,
      durationSeconds: clip.durationSeconds,
      transcript: '',
      segments: (clip.transcriptSegments as Array<{ start: number; end: number; text: string; speaker?: string }>) ?? [],
      findings: { actions: clip.actions },
    })),
  };
  const result = await runAskResearch({
    question: 'how many weeks did it take to fix the bathroom?',
    catalog,
    anthropicApiKey: null,
    complete: async () => {
      throw new Error('planner must not run for a room question');
    },
  });
  assert.match(result.answer, /about 3 weeks/);
  assert.match(result.answer, /does not establish completion/);
  assert.ok(result.meta.steps.some((step) => step.tools.includes('lookup_room')));
});

test('a stored room fingerprint does not change when the same bounds are written back', () => {
  const segments = segmentClipRooms(kitchen);
  const bounds = segments.map((segment) => ({
    startSec: segment.startSeconds,
    endSec: segment.endSeconds,
    room: segment.roomName,
    confidence: segment.confidence,
  }));
  const stored = roomAnalysisFingerprint({ ...kitchen, roomSegments: bounds });
  const again = segmentClipRooms({ ...kitchen, roomSegments: bounds });
  const againBounds = again.map((segment) => ({
    startSec: segment.startSeconds,
    endSec: segment.endSeconds,
    room: segment.roomName,
    confidence: segment.confidence,
  }));
  assert.deepEqual(againBounds, bounds);
  assert.equal(roomAnalysisFingerprint({ ...kitchen, roomSegments: againBounds }), stored);
  assert.equal(shouldRewriteRooms([{ fingerprint: stored }], stored), false);
  assert.equal(shouldRewriteRooms([], stored), true);
  assert.equal(shouldRewriteRooms([{ fingerprint: stored, userCorrected: true }], 'different'), false);
});
