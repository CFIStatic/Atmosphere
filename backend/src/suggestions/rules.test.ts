/**
 * Suggested work trigger rules: an estimate only once the inspection is
 * documented, gaps first, supplements only on a scope change, CRM updates
 * only on meaningful change, homeowner updates at milestones, and nothing for
 * routine progress footage. Never the same suggestion twice for one state.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateSuggestions,
  causeOfLossFrom,
  dedupeCandidates,
  eventsFrom,
  inspectionGaps,
  mentionsMoistureReadings,
  milestonesFrom,
  staleOpenKinds,
  workOutsideScope,
  type JobState,
  type PriorSuggestion,
  type SuggestionCandidate,
} from './rules.js';
import { judgeCandidates, parseDecisions } from './judge.js';

function state(over: Partial<JobState> = {}): JobState {
  return {
    jobId: 'job-1',
    orgId: 'org-1',
    title: 'TEST Water loss',
    status: 'in_progress',
    lossType: 'water',
    analyzedClipCount: 3,
    roomsOnVideo: ['Kitchen', 'Hallway'],
    affectedRooms: ['Kitchen'],
    expectedRooms: [],
    moistureReadings: true,
    causeOfLoss: 'burst supply line',
    estimate: null,
    newDamageRoomsSinceEstimate: [],
    workNotInEstimate: [],
    milestones: [],
    events: [],
    ...over,
  };
}

const kinds = (cs: SuggestionCandidate[]) => cs.map((c) => c.kind).sort();

function decided(c: SuggestionCandidate, status: PriorSuggestion['status'] = 'dismissed'): PriorSuggestion {
  return { kind: c.kind, status, stateFingerprint: c.stateFingerprint, evidence: c.evidence, createdAt: '2026-10-20T00:00:00Z' };
}

test('documented inspection with no estimate suggests building the estimate', () => {
  const cs = candidateSuggestions(state());
  assert.ok(kinds(cs).includes('build_estimate'));
  assert.ok(!kinds(cs).includes('capture_missing'));
  const est = cs.find((c) => c.kind === 'build_estimate')!;
  assert.match(est.prompt, /Xactimate/);
  assert.match(est.prompt, /approval/);
});

test('missing moisture readings: ask for the footage first, not an estimate', () => {
  const cs = candidateSuggestions(state({ moistureReadings: false }));
  assert.ok(!kinds(cs).includes('build_estimate'));
  const gap = cs.find((c) => c.kind === 'capture_missing')!;
  assert.match(gap.detail, /moisture readings/);
});

test('a room the documents name but nobody filmed is a gap', () => {
  const gaps = inspectionGaps(state({ expectedRooms: ['Kitchen', 'Laundry room'] }));
  assert.deepEqual(gaps, ['the Laundry room on video']);
});

test('no cause of loss, or no damage on video, blocks the estimate', () => {
  assert.ok(!kinds(candidateSuggestions(state({ causeOfLoss: null }))).includes('build_estimate'));
  assert.ok(!kinds(candidateSuggestions(state({ affectedRooms: [] }))).includes('build_estimate'));
});

test('a fire loss does not need moisture readings', () => {
  assert.deepEqual(inspectionGaps(state({ lossType: 'fire', moistureReadings: false })), []);
});

test('progress footage on an already-estimated job suggests nothing', () => {
  const estimate = { ref: 'doc:1', at: '2026-10-10T00:00:00Z', scopeTitles: ['Remove drywall kitchen'] };
  // First look after the estimate: the walkthrough CRM update was already handled.
  const first = candidateSuggestions(state({ estimate }));
  const prior = first.map((c) => decided(c, 'approved'));
  // Same rooms, same status, more footage.
  const again = candidateSuggestions(state({ estimate, analyzedClipCount: 9 }), prior);
  assert.deepEqual(dedupeCandidates(again, prior).create, []);
  assert.ok(!kinds(again).includes('build_estimate'));
  assert.ok(!kinds(again).includes('supplement_packet'));
});

test('new damage after the estimate suggests a supplement packet', () => {
  const estimate = { ref: 'doc:1', at: '2026-10-10T00:00:00Z', scopeTitles: ['Remove drywall kitchen'] };
  const cs = candidateSuggestions(state({ estimate, newDamageRoomsSinceEstimate: ['Hallway'] }));
  const sup = cs.find((c) => c.kind === 'supplement_packet')!;
  assert.match(sup.detail, /new damage in Hallway/);
  assert.equal(sup.needsModelCheck, false);
  assert.match(sup.prompt, /Do not send/);
});

test('work on video outside the approved scope suggests a supplement the model must confirm', () => {
  const estimate = { ref: 'doc:1', at: '2026-10-10T00:00:00Z', scopeTitles: ['Remove drywall kitchen'] };
  const extra = workOutsideScope(['Removed drywall in kitchen', 'Replaced subfloor under dishwasher'], estimate.scopeTitles);
  assert.deepEqual(extra, ['Replaced subfloor under dishwasher']);
  const sup = candidateSuggestions(state({ estimate, workNotInEstimate: extra })).find((c) => c.kind === 'supplement_packet')!;
  assert.equal(sup.needsModelCheck, true);
});

test('CRM update: the first walkthrough, then only on meaningful change', () => {
  const first = candidateSuggestions(state()).find((c) => c.kind === 'crm_update')!;
  assert.match(first.detail, /walkthrough/);
  const prior = [decided(first, 'approved')];
  // Routine footage: nothing.
  assert.ok(!kinds(candidateSuggestions(state({ analyzedClipCount: 7 }), prior)).includes('crm_update'));
  // Status change.
  const status = candidateSuggestions(state({ status: 'on_hold' }), prior).find((c) => c.kind === 'crm_update')!;
  assert.match(status.detail, /status is now on hold/);
  // New room.
  const room = candidateSuggestions(state({ roomsOnVideo: ['Kitchen', 'Hallway', 'Basement'] }), prior).find((c) => c.kind === 'crm_update')!;
  assert.match(room.detail, /new room: Basement/);
  assert.equal(room.needsModelCheck, false);
  // Adjuster visit heard on video: a soft signal the model confirms.
  const visit = candidateSuggestions(
    state({ events: [{ kind: 'adjuster_visit', proofId: 'p9', quote: 'The adjuster came out and walked the kitchen.' }] }),
    prior,
  ).find((c) => c.kind === 'crm_update')!;
  assert.match(visit.detail, /adjuster visited/);
  assert.equal(visit.needsModelCheck, true);
});

test('homeowner update at drying complete, once', () => {
  const cs = candidateSuggestions(state({ milestones: ['drying_complete'] }));
  const ho = cs.find((c) => c.kind === 'homeowner_update')!;
  assert.match(ho.detail, /drying is complete/);
  assert.match(ho.prompt, /do not send/);
  const prior = [decided(ho, 'approved')];
  assert.ok(!kinds(candidateSuggestions(state({ milestones: ['drying_complete'] }), prior)).includes('homeowner_update'));
  // A new milestone is a new update.
  const next = candidateSuggestions(state({ milestones: ['drying_complete', 'demo_complete'] }), prior).find((c) => c.kind === 'homeowner_update')!;
  assert.match(next.detail, /demo is complete/);
  assert.doesNotMatch(next.detail, /drying/);
});

test('a dismissed suggestion is not made again for the same state', () => {
  const cs = candidateSuggestions(state());
  const prior = cs.map((c) => decided(c, 'dismissed'));
  assert.deepEqual(dedupeCandidates(candidateSuggestions(state()), prior).create, []);
});

test('an open suggestion is not duplicated; a changed state replaces it', () => {
  const gap = candidateSuggestions(state({ moistureReadings: false, causeOfLoss: null })).find((c) => c.kind === 'capture_missing')!;
  const prior = [decided(gap, 'open')];
  const same = dedupeCandidates(candidateSuggestions(state({ moistureReadings: false, causeOfLoss: null }), prior), prior);
  assert.ok(!same.create.some((c) => c.kind === 'capture_missing'));
  const changed = dedupeCandidates(candidateSuggestions(state({ moistureReadings: false }), prior), prior);
  assert.ok(changed.create.some((c) => c.kind === 'capture_missing'));
  assert.deepEqual(changed.supersede.filter((k) => k === 'capture_missing'), ['capture_missing']);
});

test('an estimate arriving retires an open "build the estimate"', () => {
  const est = candidateSuggestions(state()).find((c) => c.kind === 'build_estimate')!;
  const prior = [decided(est, 'open')];
  const now = candidateSuggestions(state({ estimate: { ref: 'doc:1', at: '2026-10-21T00:00:00Z', scopeTitles: [] } }), prior);
  assert.deepEqual(staleOpenKinds(now, prior), ['build_estimate']);
});

test('closed jobs and jobs with no analysed footage get nothing', () => {
  assert.deepEqual(candidateSuggestions(state({ status: 'completed' })), []);
  assert.deepEqual(candidateSuggestions(state({ analyzedClipCount: 0 })), []);
});

test('text signals', () => {
  assert.ok(mentionsMoistureReadings('Pin meter shows 28% MC on the drywall.'));
  assert.ok(!mentionsMoistureReadings('Water on the floor.'));
  assert.equal(causeOfLossFrom('Looks like a burst pipe under the sink.'), 'burst pipe');
  assert.deepEqual(milestonesFrom('Drying is complete, equipment pulled today.'), ['drying_complete']);
  assert.deepEqual(milestonesFrom('Drying is not complete yet.'), []);
  assert.deepEqual(milestonesFrom('Demo finished in the kitchen.'), ['demo_complete']);
  assert.equal(eventsFrom('p1', 'The adjuster came out this morning.')[0]?.kind, 'adjuster_visit');
  assert.equal(eventsFrom('p1', 'The homeowner approved the cabinets.')[0]?.kind, 'homeowner_decision');
});

test('model check: keeps, vetoes, and without a model drops only the soft ones', async () => {
  const s = state({ milestones: ['drying_complete'] });
  const cs = candidateSuggestions(s);
  const none = await judgeCandidates(s, cs, async () => null);
  assert.ok(none.some((c) => c.kind === 'build_estimate'));
  assert.ok(!none.some((c) => c.kind === 'homeowner_update'));

  const veto = await judgeCandidates(s, cs, async () => ({
    model: 'test-model',
    text: '{"decisions":[{"kind":"build_estimate","keep":false,"why":"Readings still wet."},{"kind":"homeowner_update","keep":true,"why":"Drying done."}]}',
  }));
  assert.ok(!veto.some((c) => c.kind === 'build_estimate'));
  const ho = veto.find((c) => c.kind === 'homeowner_update')!;
  assert.equal(ho.judgedBy, 'rules+model');
  // The model cannot add a kind the rules did not propose.
  const added = await judgeCandidates(state(), candidateSuggestions(state()), async () => ({
    model: 'm',
    text: '{"decisions":[{"kind":"supplement_packet","keep":true,"why":"x"}]}',
  }));
  assert.ok(!added.some((c) => c.kind === 'supplement_packet'));
  assert.equal(parseDecisions('not json').size, 0);
});
