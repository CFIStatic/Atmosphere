import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateWellness,
  processWellnessHeartbeat,
  resetWellnessSessionsForTests,
} from './wellness.js';
import { resetSafetyIncidentsForTests, listSafetyIncidents } from './incidents.js';
import {
  WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
  WELLNESS_DEFAULT_NO_MOTION_SECONDS,
  type OrgSafetySettings,
} from './types.js';
import { buildSafetyAlertPayload } from './alerts.js';

const baseSettings = (): OrgSafetySettings => ({
  orgId: '11111111-1111-4111-8111-111111111111',
  autoEscalateToAuthorities: false,
  alertWebhookUrl: null,
  alertEmails: [],
  wellnessCheckEnabled: true,
  wellnessNoMotionSeconds: WELLNESS_DEFAULT_NO_MOTION_SECONDS,
  wellnessCriticalAfterSeconds: WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS,
  wellnessRequireAlone: true,
});

test('evaluateWellness stays quiet within threshold', () => {
  const ev = evaluateWellness(baseSettings(), {
    noMotionSeconds: 120,
    aloneOnSite: true,
    recordingActive: true,
  });
  assert.equal(ev.shouldAlert, false);
  assert.equal(ev.reason, 'within_threshold');
});

test('evaluateWellness watch after no-motion threshold while alone', () => {
  const ev = evaluateWellness(baseSettings(), {
    noMotionSeconds: 300,
    aloneOnSite: true,
    recordingActive: true,
  });
  assert.equal(ev.shouldAlert, true);
  assert.equal(ev.severity, 'watch');
});

test('evaluateWellness critical after longer no-motion', () => {
  const ev = evaluateWellness(baseSettings(), {
    noMotionSeconds: 600,
    aloneOnSite: true,
    recordingActive: true,
  });
  assert.equal(ev.shouldAlert, true);
  assert.equal(ev.severity, 'critical');
});

test('evaluateWellness requires alone when configured', () => {
  const ev = evaluateWellness(baseSettings(), {
    noMotionSeconds: 900,
    aloneOnSite: false,
    recordingActive: true,
  });
  assert.equal(ev.shouldAlert, false);
  assert.equal(ev.reason, 'not_alone');
});

test('evaluateWellness can ignore alone when requireAlone=false', () => {
  const settings = { ...baseSettings(), wellnessRequireAlone: false };
  const ev = evaluateWellness(settings, {
    noMotionSeconds: 300,
    aloneOnSite: false,
    recordingActive: true,
  });
  assert.equal(ev.shouldAlert, true);
  assert.equal(ev.severity, 'watch');
});

test('evaluateWellness disabled / not recording are misses', () => {
  assert.equal(
    evaluateWellness({ ...baseSettings(), wellnessCheckEnabled: false }, {
      noMotionSeconds: 9999,
      aloneOnSite: true,
      recordingActive: true,
    }).shouldAlert,
    false,
  );
  assert.equal(
    evaluateWellness(baseSettings(), {
      noMotionSeconds: 9999,
      aloneOnSite: true,
      recordingActive: false,
    }).reason,
    'not_recording',
  );
});

test('heartbeat creates watch incident then rate-limits; never contact_authorities', async () => {
  process.env.SAFETY_STORE = 'memory';
  process.env.WELLNESS_STORE = 'memory';
  resetSafetyIncidentsForTests();
  resetWellnessSessionsForTests();

  const orgId = '11111111-1111-4111-8111-111111111111';
  const jobId = '22222222-2222-4222-8222-222222222222';
  const party = { org_id: orgId, job_id: jobId, id: '33333333-3333-4333-8333-333333333333' };

  // Stub loadOrgSafetySettings by writing settings into memory path via env —
  // processWellnessHeartbeat calls real loadOrgSafetySettings which needs admin.
  // Use a fake admin that returns org wellness columns.
  const admin = {
    from(table: string) {
      if (table === 'orgs') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: orgId,
                      safety_auto_escalate_to_authorities: false,
                      safety_alert_webhook_url: null,
                      safety_alert_emails: [],
                      wellness_check_enabled: true,
                      wellness_no_motion_seconds: 60,
                      wellness_critical_after_seconds: 120,
                      wellness_require_alone: true,
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const t0 = 1_700_000_000_000;
  const first = await processWellnessHeartbeat(admin, party, {
    motionScore: 0,
    aloneOnSite: true,
    recordingActive: true,
    clipId: 'clipA1',
    clientNowMs: t0,
  });
  // First beat seeds last_motion_at — no alert yet.
  assert.equal(first.hit, false);

  const watch = await processWellnessHeartbeat(admin, party, {
    motionScore: 0.01,
    aloneOnSite: true,
    recordingActive: true,
    clipId: 'clipA1',
    clientNowMs: t0 + 65_000,
  });
  assert.equal(watch.hit, true);
  assert.equal(watch.created, true);
  assert.equal(watch.incident?.category, 'silent_panic_wellness');
  assert.equal(watch.incident?.severity, 'watch');
  assert.equal(watch.incident?.recommendedAction, 'monitor');
  assert.equal(watch.incident?.source, 'wellness_heartbeat');

  const dup = await processWellnessHeartbeat(admin, party, {
    motionScore: 0,
    aloneOnSite: true,
    recordingActive: true,
    clipId: 'clipA1',
    clientNowMs: t0 + 90_000,
  });
  assert.equal(dup.hit, true);
  assert.equal(dup.created, false);
  assert.equal(dup.suppressedDuplicate, true);

  const critical = await processWellnessHeartbeat(admin, party, {
    motionScore: 0,
    aloneOnSite: true,
    recordingActive: true,
    clipId: 'clipA1',
    // Outside rate-limit window (10m) so a new severity can open after we
    // acknowledge conceptually — here we just assert payload policy.
    clientNowMs: t0 + 130_000,
  });
  // Still rate-limited within 10 minutes for same category.
  assert.equal(critical.suppressedDuplicate || critical.created === false, true);

  const payload = buildSafetyAlertPayload(watch.incident!, false);
  assert.equal(payload.escalateToAuthorities, false);
  assert.match(payload.authoritiesNote, /never dials 911/i);

  const open = await listSafetyIncidents(null, { orgId, status: 'open' });
  assert.equal(open.length, 1);
  assert.equal(open[0].recommendedAction !== 'contact_authorities', true);
});

test('motion score resets the no-motion clock', async () => {
  process.env.SAFETY_STORE = 'memory';
  process.env.WELLNESS_STORE = 'memory';
  resetSafetyIncidentsForTests();
  resetWellnessSessionsForTests();

  const orgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const jobId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const party = { org_id: orgId, job_id: jobId, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
  const admin = {
    from(table: string) {
      if (table === 'orgs') {
        return {
          select() {
            return {
              eq() {
                return {
                  maybeSingle: async () => ({
                    data: {
                      id: orgId,
                      wellness_check_enabled: true,
                      wellness_no_motion_seconds: 60,
                      wellness_critical_after_seconds: 120,
                      wellness_require_alone: true,
                      safety_auto_escalate_to_authorities: false,
                      safety_alert_webhook_url: null,
                      safety_alert_emails: [],
                    },
                    error: null,
                  }),
                };
              },
            };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  const t0 = 1_800_000_000_000;
  await processWellnessHeartbeat(admin, party, {
    motionScore: 0,
    aloneOnSite: true,
    recordingActive: true,
    clientNowMs: t0,
  });
  // Motion resumes before threshold.
  const moved = await processWellnessHeartbeat(admin, party, {
    motionScore: 0.2,
    aloneOnSite: true,
    recordingActive: true,
    clientNowMs: t0 + 50_000,
  });
  assert.equal(moved.motionReset, true);
  assert.equal(moved.hit, false);
  assert.equal(moved.noMotionSeconds, 0);

  // Still under threshold after reset.
  const later = await processWellnessHeartbeat(admin, party, {
    motionScore: 0,
    aloneOnSite: true,
    recordingActive: true,
    clientNowMs: t0 + 80_000,
  });
  assert.equal(later.hit, false);
  assert.ok(later.noMotionSeconds < 60);
});
