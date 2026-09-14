import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySafetyFromTranscript, classifySafetySample } from './classify.js';
import { buildSafetyAlertPayload } from './alerts.js';
import {
  acknowledgeSafetyIncident,
  createSafetyIncident,
  dismissSafetyIncident,
  listSafetyIncidents,
  recentDuplicate,
  resetSafetyIncidentsForTests,
} from './incidents.js';
import type { SafetyClassification, SafetyIncident } from './types.js';

test('transcript heuristics catch verbal threats as critical contact_authorities', () => {
  const hit = classifySafetyFromTranscript('I will kill you if you come closer', 42);
  assert.equal(hit.hit, true);
  assert.equal(hit.category, 'verbal_threat');
  assert.equal(hit.severity, 'critical');
  assert.equal(hit.recommendedAction, 'contact_authorities');
  assert.ok((hit.confidence ?? 0) >= 0.85);
  assert.equal(hit.clipTimestampSeconds, 42);
});

test('transcript heuristics catch fall / person down', () => {
  const hit = classifySafetyFromTranscript('Help, he fell down the stairs and cannot get up');
  assert.equal(hit.hit, true);
  assert.equal(hit.category, 'fall_person_down');
  assert.equal(hit.severity, 'critical');
  assert.equal(hit.recommendedAction, 'dispatch_help');
});

test('ordinary work talk is a miss (precision bias)', () => {
  const miss = classifySafetyFromTranscript('We hung the drywall in the master bedroom');
  assert.equal(miss.hit, false);
});

test('classifySafetySample uses transcript before vision when model disabled', async () => {
  const result = await classifySafetySample({
    transcriptSnippet: 'Call an ambulance, she cannot breathe',
    allowModel: false,
    clipTimestampSeconds: 10,
  });
  assert.equal(result.hit, true);
  assert.equal(result.category, 'medical_distress');
});

test('incident create + rate-limit + ack/dismiss', async () => {
  process.env.SAFETY_STORE = 'memory';
  resetSafetyIncidentsForTests();

  const classification: SafetyClassification = {
    hit: true,
    category: 'physical_violence',
    severity: 'critical',
    confidence: 0.92,
    title: 'Assault cues',
    description: 'Clear striking visible',
    recommendedAction: 'contact_authorities',
    clipTimestampSeconds: 12,
    model: 'heuristic',
    signals: {},
  };

  const first = await createSafetyIncident(null, {
    orgId: '11111111-1111-4111-8111-111111111111',
    jobId: '22222222-2222-4222-8222-222222222222',
    classification,
    source: 'live_sample',
  });
  assert.equal(first.created, true);
  assert.equal(first.suppressedDuplicate, false);

  const second = await createSafetyIncident(null, {
    orgId: '11111111-1111-4111-8111-111111111111',
    jobId: '22222222-2222-4222-8222-222222222222',
    classification,
    source: 'live_sample',
  });
  assert.equal(second.created, false);
  assert.equal(second.suppressedDuplicate, true);
  assert.equal(second.incident.id, first.incident.id);

  const dup = await recentDuplicate(null, {
    orgId: first.incident.orgId,
    jobId: first.incident.jobId,
    category: 'physical_violence',
  });
  assert.ok(dup);

  const acked = await acknowledgeSafetyIncident(null, first.incident.id, 'user-1');
  assert.equal(acked.status, 'acknowledged');

  const dismissed = await dismissSafetyIncident(null, first.incident.id, 'user-1', 'false positive');
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(dismissed.dismissReason, 'false positive');

  const open = await listSafetyIncidents(null, {
    orgId: first.incident.orgId,
    status: 'open',
  });
  assert.equal(open.length, 0);
});

test('authorities escalation gated by org policy flag (default false)', () => {
  const incident = {
    id: 'inc-1',
    orgId: 'org-1',
    jobId: 'job-1',
    partyId: null,
    proofId: null,
    clipId: null,
    category: 'verbal_threat' as const,
    severity: 'critical' as const,
    confidence: 0.9,
    title: 'Threat',
    description: 'Threat',
    clipTimestampSeconds: 1,
    lat: null,
    lon: null,
    locationLabel: null,
    recommendedAction: 'contact_authorities' as const,
    status: 'open' as const,
    source: 'transcript' as const,
    model: null,
    signals: {},
    alertSentAt: null,
    alertChannels: [],
    acknowledgedAt: null,
    acknowledgedBy: null,
    dismissedAt: null,
    dismissedBy: null,
    dismissReason: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } satisfies SafetyIncident;

  const off = buildSafetyAlertPayload(incident, false);
  assert.equal(off.escalateToAuthorities, false);
  assert.match(off.authoritiesNote, /gated off/i);

  const on = buildSafetyAlertPayload(incident, true);
  assert.equal(on.escalateToAuthorities, true);
  assert.match(on.authoritiesNote, /does not call 911/i);
});
