/**
 * Live critical safety: real vs joking / staged / media playback, and alert
 * latency. Providers (Whisper, Haiku screen, Opus confirmation, mail) are
 * mocked; everything else — rolling context, word list, decisions,
 * incidents, admin-only email fanout, cap — is the real code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SAFETY_STORE = 'memory';

import {
  classifySafetyFromTranscript,
  classifySafetySample,
  transcriptCandidateWindows,
} from '../src/safety/classify.js';
import { decideFromConfirmation, type ConfirmInput, type ConfirmResult } from '../src/safety/confirm.js';
import type { ScreenInput, ScreenResult } from '../src/safety/screen.js';
import { processLiveSafetyChunk, processLiveSafetyChunkForParty, resetLiveSafetyForTests } from '../src/safety/live.js';
import { runTranscriptSafetyScan } from '../src/safety/sample.js';
import { setSafetyProvidersForTests } from '../src/safety/providers.js';
import {
  acknowledgeSafetyIncident,
  createSafetyIncident,
  dismissSafetyIncident,
  getSafetyIncident,
  listSafetyIncidents,
  markIncidentAlerted,
  resetSafetyIncidentsForTests,
} from '../src/safety/incidents.js';
import { fanoutSafetyAlert, orgAdminEmails } from '../src/safety/alerts.js';
import { loadOrgSafetySettings } from '../src/safety/settings.js';
import { currentAiUsageScope } from '../src/metering/aiUsageContext.js';
import { PODCAST_NARRATION, PODCAST_SEGMENTS, PODCAST_TRANSCRIPT } from './fixtures/safetyPodcastFalseAlarm.js';

const ORG = '8b2cc105-0000-4000-8000-000000000001';
const JOB = '8b2cc105-0000-4000-8000-000000000002';
const PARTY = { org_id: ORG, job_id: JOB, id: '8b2cc105-0000-4000-8000-000000000003' };
const OWNER_USER = '8b2cc105-0000-4000-8000-0000000000a1';

/** The account's admins — the ONLY people a safety alert may email. */
const ADMIN_EMAILS = ['admin2@example.com', 'office-mgr@example.com', 'owner@example.com'];
/**
 * Everyone else the org row or roster knows about. None of these may ever get
 * the alert: the recording worker, employees, invited / removed admins, the
 * legacy custom recipient list, and the legacy webhook.
 */
const NON_ADMIN_EMAILS = [
  'worker@example.com',
  'employee@example.com',
  'pm@example.com',
  'invited-admin@example.com',
  'removed-admin@example.com',
  'dispatch@example.com',
];

type OrgRow = Record<string, unknown>;

function fakeAdmin(opts: { org?: Partial<OrgRow>; proof?: Record<string, unknown> | null } = {}) {
  const org: OrgRow = {
    id: ORG,
    safety_auto_escalate_to_authorities: false,
    created_by: OWNER_USER,
    // Legacy recipient sources still on the org row — must be ignored.
    safety_alert_webhook_url: 'https://hooks.example.com/safety',
    safety_alert_emails: ['dispatch@example.com'],
    wellness_check_enabled: true,
    wellness_no_motion_seconds: 300,
    wellness_critical_after_seconds: 600,
    wellness_require_alone: true,
    safety_live_enabled: true,
    ...opts.org,
  };
  const tables: Record<string, unknown> = {
    orgs: org,
    org_members: [
      // Account owner (org creator) — included even if their seat says employee.
      { user_id: OWNER_USER, role: 'employee', status: 'active', profiles: { email: 'Owner@Example.com' } },
      { user_id: 'u-admin2', role: 'global_admin', status: 'active', profiles: { email: 'admin2@example.com' } },
      // Legacy role that maps onto Global Admin.
      { user_id: 'u-om', role: 'office_manager', status: 'active', profiles: { email: 'office-mgr@example.com' } },
      { user_id: 'u-worker', role: 'field_technician', status: 'active', profiles: { email: 'worker@example.com' } },
      { user_id: 'u-emp', role: 'employee', status: 'active', profiles: { email: 'employee@example.com' } },
      { user_id: 'u-pm', role: 'project_manager', status: 'active', profiles: { email: 'pm@example.com' } },
      { user_id: 'u-inv', role: 'global_admin', status: 'invited', profiles: { email: 'invited-admin@example.com' } },
      { user_id: 'u-rm', role: 'global_admin', status: 'removed', profiles: { email: 'removed-admin@example.com' } },
    ],
    job_proofs: opts.proof ?? null,
    job_proof_frames: [],
    org_billing: null,
  };
  const builder = (table: string): any => {
    const result = { data: tables[table] ?? null, error: null };
    const chain: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') return (resolve: any) => resolve(result);
          if (prop === 'maybeSingle' || prop === 'single') return async () => result;
          return () => chain;
        },
      },
    );
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    rpc: async () => ({ data: null, error: null }),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: 'none' } }) }) },
  };
}

/** A JPEG stand-in whose bytes say what the frame shows (the mock models read it). */
function frame(atSeconds: number, scene: string): { atSeconds: number; base64: string } {
  return { atSeconds, base64: Buffer.from(`SCENE:${scene}:${atSeconds}`.padEnd(120, '.')).toString('base64') };
}
function sceneOf(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8').split(':')[1] ?? '';
}
function audio(startSeconds: number, words: string) {
  return {
    startSeconds,
    durationSeconds: 10,
    mimeType: 'audio/webm;codecs=opus',
    base64: Buffer.from(`AUDIO:${words}`.padEnd(400, ' ')).toString('base64'),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type MockDelays = { whisper?: number; screen?: number; confirm?: number; mail?: number };

/**
 * Mock providers that behave like the real models would on these fixtures.
 * The confirmation "oracle" only sees what the pipeline passes it — frames,
 * transcript window and media context — so a wrong context fails the test.
 */
function installMocks(delays: MockDelays = {}) {
  const calls = {
    whisper: 0,
    screen: 0,
    confirm: [] as ConfirmInput[],
    mail: [] as Array<{ to: string; subject: string; html: string; at: number }>,
    flat: [] as Array<Record<string, unknown>>,
    scopes: [] as Array<string | undefined>,
  };
  setSafetyProvidersForTests({
    transcribe: async (bytes, _mime, offset) => {
      calls.whisper += 1;
      if (delays.whisper) await sleep(delays.whisper);
      const words = bytes.toString('utf8').replace(/^AUDIO:/, '').trim();
      return { text: words, segments: words ? [{ start: offset, end: offset + 10, text: words }] : [] };
    },
    screen: async (input: ScreenInput): Promise<ScreenResult> => {
      calls.screen += 1;
      calls.scopes.push(currentAiUsageScope()?.meterFeature);
      if (delays.screen) await sleep(delays.screen);
      const scene = sceneOf(input.frame.base64);
      return {
        candidate: scene === 'fight' || scene === 'person_down' || scene === 'monitor_fight',
        category: scene === 'person_down' ? 'fall_person_down' : scene.includes('fight') ? 'physical_violence' : null,
        severity: scene.includes('fight') || scene === 'person_down' ? 'critical' : null,
        confidence: scene.includes('fight') || scene === 'person_down' ? 0.7 : 0.05,
        screenPlaying: scene.startsWith('monitor'),
        peopleVisible: scene.startsWith('monitor') ? 0 : 2,
        note: scene,
        model: 'claude-haiku-4-5-20251001',
      };
    },
    confirm: async (input: ConfirmInput): Promise<ConfirmResult> => {
      calls.confirm.push(input);
      calls.scopes.push(currentAiUsageScope()?.meterFeature);
      if (delays.confirm) await sleep(delays.confirm);
      const scenes = input.frames.map((f) => sceneOf(f.base64));
      const t = input.transcriptWindow.toLowerCase();
      const ctx = input.mediaContext;
      const base = { category: input.candidate.category, severity: input.candidate.severity, cues: [] as string[], model: 'claude-opus-5' };
      if ((ctx.screenVisibleFrames ?? 0) > 0 || ctx.mediaUntimed || ctx.mediaWindows?.length || scenes.some((s) => s.startsWith('monitor'))) {
        return { ...base, reality: 'media_playback', confidence: 0.94, title: 'Podcast on a monitor', description: 'Words come from a YouTube video.' };
      }
      if (/haha|just kidding|lol/.test(t)) {
        return { ...base, reality: 'joking', confidence: 0.9, title: 'Banter', description: 'Laughing, joking.' };
      }
      if (scenes.includes('fight') || /get off me|he's hitting me/.test(t)) {
        return {
          ...base,
          category: 'physical_violence',
          severity: 'critical',
          reality: 'real',
          confidence: 0.93,
          title: 'Worker being assaulted',
          description: 'Two people struggling; a worker shouts "get off me".',
        };
      }
      return { ...base, reality: 'unclear', confidence: 0.4, title: 'Possible person down', description: 'Cannot tell.' };
    },
    sendMail: async (msg) => {
      if (delays.mail) await sleep(delays.mail);
      calls.mail.push({ ...msg, at: Date.now() });
      return { ok: true };
    },
    meterFlat: (row) => calls.flat.push(row),
  });
  return calls;
}

function reset() {
  resetSafetyIncidentsForTests();
  resetLiveSafetyForTests();
  setSafetyProvidersForTests(null);
}

test.afterEach(() => {
  setSafetyProvidersForTests(null);
});

/* ------------------------------------------------------------------ */
/* Regression: tonight's YouTube podcast "fighting" false alarm          */
/* ------------------------------------------------------------------ */

test('regression: podcast "fighting" is still a word-list candidate — but only a candidate', () => {
  const hit = classifySafetyFromTranscript(PODCAST_TRANSCRIPT, null);
  assert.equal(hit.hit, true);
  assert.equal(hit.category, 'physical_violence');
  assert.equal(hit.signals.candidate, true);
  assert.equal(hit.model, 'word_list');
});

test('regression: podcast "fighting" does NOT alert after upload (confirmation says media_playback)', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin({ proof: { narration_text: PODCAST_NARRATION, ai_findings: {}, actions: [] } });
  const results = await runTranscriptSafetyScan(admin, {
    orgId: ORG,
    jobId: JOB,
    partyId: PARTY.id,
    proofId: '626d2992-6f45-49af-9e88-3035324bd12c',
    transcriptText: PODCAST_TRANSCRIPT,
    segments: PODCAST_SEGMENTS,
  });
  assert.equal(results.length, 1, 'one candidate window (0:51)');
  assert.equal(results[0]!.hit, false, 'no incident');
  assert.equal(results[0]!.classification.reality, 'media_playback');
  assert.equal(calls.mail.length, 0, 'nobody is emailed');
  assert.equal((await listSafetyIncidents(admin, { orgId: ORG, status: 'all' })).length, 0);
  // The confirmation saw the whole window and the media-window tagging.
  const seen = calls.confirm[0]!;
  assert.match(seen.transcriptWindow, /fighting/);
  assert.match(seen.transcriptWindow, /SEAL team/);
  assert.match(String(seen.mediaContext.mediaUntimed), /YouTube/);
  assert.equal(seen.clipTimestampSeconds, 51);
});

test('regression: podcast does NOT alert even when the confirmation model is down (media evidence)', async () => {
  reset();
  setSafetyProvidersForTests({ confirm: async () => null, sendMail: async () => ({ ok: true }) });
  const admin = fakeAdmin({ proof: { narration_text: PODCAST_NARRATION, ai_findings: {}, actions: [] } });
  const results = await runTranscriptSafetyScan(admin, {
    orgId: ORG,
    jobId: JOB,
    partyId: PARTY.id,
    proofId: '626d2992-6f45-49af-9e88-3035324bd12c',
    transcriptText: PODCAST_TRANSCRIPT,
    segments: PODCAST_SEGMENTS,
  });
  assert.equal(results[0]!.hit, false);
  assert.equal(results[0]!.classification.signals.reason, 'unconfirmed_media_evidence');
});

test('regression: podcast played live on a monitor does NOT alert', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  let seq = 0;
  let last: Awaited<ReturnType<typeof processLiveSafetyChunk>> | null = null;
  for (let t = 5; t <= 60; t += 5) {
    const body: Record<string, unknown> = { clipId: 'clip_podcast', seq: seq++, frame: frame(t, 'monitor_talking') };
    if (t % 10 === 0) {
      const lines = PODCAST_SEGMENTS.filter((s) => s.start >= t - 10 && s.start < t).map((s) => s.text).join(' ');
      body.audio = audio(t - 10, lines);
    }
    last = await processLiveSafetyChunk(admin, PARTY, body);
    assert.equal(last.alert, null, `no alert at ${t}s`);
  }
  assert.ok(calls.confirm.length >= 1, 'the word "fighting" reached the confirmation stage');
  assert.ok((calls.confirm[0]!.mediaContext.screenVisibleFrames ?? 0) > 0, 'screen verdicts passed as media signal');
  assert.equal(calls.mail.length, 0);
});

/* ------------------------------------------------------------------ */
/* Real fight: MUST alert, fast                                         */
/* ------------------------------------------------------------------ */

async function runFight(delays: MockDelays) {
  reset();
  const calls = installMocks(delays);
  const admin = fakeAdmin();
  const EVENT_AT = 33; // clip seconds the fight starts
  let seq = 0;
  const out: { alertAtClipSeconds: number | null; serverMs: number; timings: Record<string, number>; incidentId: string | null } = {
    alertAtClipSeconds: null,
    serverMs: 0,
    timings: {},
    incidentId: null,
  };
  for (let t = 5; t <= 50; t += 5) {
    const scene = t < 35 ? 'work' : 'fight';
    const body: Record<string, unknown> = { clipId: 'clip_fight', seq: seq++, frame: frame(t, scene) };
    if (t % 10 === 0) {
      body.audio = audio(
        t - 10,
        t <= 30 ? 'Hand me the drill. Mark the stud at sixteen.' : "Stop! Get off me! He's hitting me — help!",
      );
    }
    const res = await processLiveSafetyChunk(admin, PARTY, body);
    if (res.alert && out.alertAtClipSeconds == null) {
      out.alertAtClipSeconds = t;
      out.serverMs = res.serverMs;
      out.timings = res.timings;
      out.incidentId = res.alert.incidentId;
    }
  }
  return { calls, admin, EVENT_AT, out };
}

test('real fight (transcript + frames) MUST alert — confirmed, parallel email with live view, latency measured', async () => {
  const { calls, admin, EVENT_AT, out } = await runFight({});
  assert.ok(out.incidentId, 'an alert was raised');
  const incident = (await getSafetyIncident(admin, out.incidentId!))!;
  assert.equal(incident.severity, 'critical');
  assert.equal(incident.category, 'physical_violence');
  assert.equal(incident.confirmation, 'confirmed');
  assert.equal(incident.reality, 'real');
  assert.equal(incident.source, 'live_stream');
  assert.ok(incident.alertChannels.includes('email'), `channels ${incident.alertChannels}`);
  // Email only, to the account admins only, in parallel, with the live-view link.
  assert.deepEqual(incident.alertChannels.filter((c) => c !== 'platform').sort(), ['email']);
  const recipients = calls.mail.map((m) => m.to).sort();
  assert.deepEqual(recipients, ADMIN_EMAILS);
  for (const other of NON_ADMIN_EMAILS) assert.ok(!recipients.includes(other), `${other} must not be emailed`);
  for (const m of calls.mail) {
    assert.match(m.html, /Open live view/);
    assert.match(m.html, new RegExp(`/job-progress\\?job=${JOB}&amp;section=timeline`));
    assert.match(m.subject, /CRITICAL: Worker being assaulted/);
  }
  // Confirmation got 6–8 frames from the last 20 s plus the transcript window.
  const conf = calls.confirm.at(-1)!;
  assert.ok(conf.frames.length >= 4 && conf.frames.length <= 8, `frames ${conf.frames.length}`);
  assert.ok(conf.frames.every((f) => f.atSeconds >= (out.alertAtClipSeconds ?? 0) - 20), 'frames from the last 20 s');
  // Metering: every model call ran in a video_analysis scope; Whisper fees per segment.
  assert.ok(calls.scopes.length > 0 && calls.scopes.every((s) => s === 'video_analysis'), `scopes ${calls.scopes}`);
  // Whisper fees are metered off the request path; give a loaded runner time.
  for (let i = 0; i < 100 && calls.flat.length === 0; i++) await sleep(20);
  assert.ok(calls.flat.length >= 1, `flat ${calls.flat.length}`);
  assert.ok(
    calls.flat.every((r) => r.feature === 'video_analysis' && String(r.requestId).startsWith('whisper_live:clip_fight:')),
    `whisper fees ${JSON.stringify(calls.flat.map((r) => r.requestId))}`,
  );
  const e2eMs = ((out.alertAtClipSeconds ?? 0) - EVENT_AT) * 1000 + out.serverMs;
  console.log(
    `[latency] instant mocks: alert on the ${out.alertAtClipSeconds}s chunk; server ${out.serverMs} ms; event→alert ${e2eMs} ms`,
  );
  assert.ok(e2eMs <= 15_000, `event→alert ${e2eMs} ms must be within 15 s`);
});

test('real fight latency with realistic provider delays stays within 5–15 s', async () => {
  const delays = { whisper: 1500, screen: 900, confirm: 4500, mail: 400 };
  const { out, EVENT_AT } = await runFight(delays);
  assert.ok(out.incidentId, 'out.incidentId');
  const e2eMs = ((out.alertAtClipSeconds ?? 0) - EVENT_AT) * 1000 + out.serverMs;
  console.log(
    `[latency] simulated providers ${JSON.stringify(delays)}: alert on the ${out.alertAtClipSeconds}s chunk; server ${out.serverMs} ms (${JSON.stringify(out.timings)}); event→alert ${e2eMs} ms (+ upload)`,
  );
  assert.ok(e2eMs <= 15_000, 'e2eMs <= 15_000');
});

test('audio-only real emergency (frames calm) still alerts on the 10 s segment', async () => {
  reset();
  installMocks();
  const admin = fakeAdmin();
  const res1 = await processLiveSafetyChunk(admin, PARTY, { clipId: 'clip_audio', seq: 1, frame: frame(5, 'work') });
  assert.equal(res1.alert, null);
  const res2 = await processLiveSafetyChunk(admin, PARTY, {
    clipId: 'clip_audio',
    seq: 2,
    frame: frame(10, 'work'),
    audio: audio(0, "Get off me! He's hitting me!"),
  });
  assert.ok(res2.alert, 'res2.alert');
  assert.equal(res2.alert!.confirmation, 'confirmed');
});

test('audio-only path latency (word heard at the start of a 10 s segment = worst case)', async () => {
  reset();
  installMocks({ whisper: 1500, screen: 900, confirm: 4500, mail: 400 });
  const admin = fakeAdmin();
  const res = await processLiveSafetyChunk(admin, PARTY, {
    clipId: 'clip_audio_lat',
    seq: 1,
    frame: frame(10, 'work'),
    audio: audio(0, "Get off me! He's hitting me!"),
  });
  assert.ok(res.alert, 'alerted from audio alone');
  const worst = 10_000 + res.serverMs;
  const typical = 5_000 + res.serverMs;
  console.log(
    `[latency] audio path, simulated providers: server ${res.serverMs} ms (${JSON.stringify(res.timings)}); event→alert typical ${typical} ms, worst ${worst} ms (+ upload)`,
  );
});

/* ------------------------------------------------------------------ */
/* Joking / unclear / upgrade                                           */
/* ------------------------------------------------------------------ */

test('joking threat with laughter does NOT alert', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const res = await processLiveSafetyChunk(admin, PARTY, {
    clipId: 'clip_joke',
    seq: 1,
    frame: frame(10, 'work'),
    audio: audio(0, "Haha I'll kill you if you scratch that floor, just kidding"),
  });
  assert.equal(res.screened, true);
  assert.equal(res.reality, 'joking');
  assert.equal(res.alert, null);
  assert.equal(calls.mail.length, 0);
});

test('high-severity unclear sends "Unconfirmed: check live view"; a later confirmed real upgrades it', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const res = await processLiveSafetyChunk(admin, PARTY, { clipId: 'clip_down', seq: 1, frame: frame(5, 'person_down') });
  assert.ok(res.alert, 'res.alert');
  assert.equal(res.alert!.confirmation, 'unconfirmed');
  assert.match(res.alert!.title, /^Unconfirmed: check live view/);
  assert.match(calls.mail[0]!.subject, /UNCONFIRMED — check live view/);
  assert.match(calls.mail[0]!.html, /Unconfirmed\./);

  // Same job + category confirmed real a bit later → upgraded + re-alerted.
  const c = decideFromConfirmation(
    { reality: 'real', confidence: 0.9, category: 'fall_person_down', severity: 'critical', title: 'Worker fell from ladder', description: 'Not moving.', cues: [], model: 'claude-opus-5' },
    { category: 'fall_person_down', severity: 'critical', trigger: 'frame_screen', reason: 'x' },
    { clipTimestampSeconds: 20, mediaContext: {} },
  );
  const up = await createSafetyIncident(admin, { orgId: ORG, jobId: JOB, classification: c, source: 'live_stream' });
  assert.equal(up.upgraded, true);
  assert.equal(up.incident.id, res.alert!.incidentId);
  assert.equal(up.incident.confirmation, 'confirmed');
  const before = calls.mail.length;
  await fanoutSafetyAlert(admin, up.incident, { upgraded: true });
  assert.match(calls.mail[before]!.subject, /NOW CONFIRMED CRITICAL/);
});

test('decision table: only real ≥ threshold confirms; unclear pages only for critical physical harm', () => {
  const cand = { category: 'physical_violence' as const, severity: 'critical' as const, trigger: 'word_list' as const, reason: 'r' };
  const mk = (reality: ConfirmResult['reality'], confidence: number, severity: 'watch' | 'critical' = 'critical'): ConfirmResult => ({
    reality, confidence, category: 'physical_violence', severity, title: 't', description: 'd', cues: [], model: 'm',
  });
  const opts = { clipTimestampSeconds: 1, mediaContext: {} };
  assert.equal(decideFromConfirmation(mk('real', 0.9), cand, opts).confirmation, 'confirmed');
  assert.equal(decideFromConfirmation(mk('real', 0.6), cand, opts).confirmation, 'unconfirmed');
  assert.equal(decideFromConfirmation(mk('unclear', 0.5), cand, opts).confirmation, 'unconfirmed');
  assert.equal(decideFromConfirmation(mk('unclear', 0.5, 'watch'), { ...cand, severity: 'watch' }, opts).hit, false);
  for (const r of ['joking', 'staged', 'media_playback'] as const) {
    assert.equal(decideFromConfirmation(mk(r, 0.99), cand, opts).hit, false, r);
  }
  // Model down + no media evidence + critical physical harm → unconfirmed (safe default).
  assert.equal(decideFromConfirmation(null, cand, opts).confirmation, 'unconfirmed');
  // Model down + a playing screen seen → no page.
  assert.equal(decideFromConfirmation(null, cand, { ...opts, mediaContext: { screenedFrames: 4, screenVisibleFrames: 3 } }).hit, false);
});

test('word-list-only candidate with no model never becomes a confirmed alert', async () => {
  const r = await classifySafetySample({ transcriptSnippet: 'Call an ambulance, she cannot breathe', allowModel: false });
  assert.equal(r.hit, true);
  assert.equal(r.confirmation, 'unconfirmed');
});

/* ------------------------------------------------------------------ */
/* Full transcript in windows                                           */
/* ------------------------------------------------------------------ */

test('transcript scan covers the whole clip, not the first 2,000 characters', () => {
  const segments = [];
  for (let s = 0; s < 1800; s += 6) segments.push({ start: s, end: s + 6, text: 'Running the wire through the second floor joists now.' });
  segments.push({ start: 1500, end: 1504, text: "Somebody call an ambulance, he's not breathing!" });
  const text = segments.map((s) => `[${Math.floor(s.start / 60)}:${String(s.start % 60).padStart(2, '0')}] ${s.text}`).join('\n');
  assert.ok(text.indexOf('ambulance') > 2000, "text.indexOf('ambulance') > 2000");
  const windows = transcriptCandidateWindows({ segments });
  assert.equal(windows.length, 1);
  assert.equal(windows[0]!.atSeconds, 1500);
  assert.equal(windows[0]!.category, 'medical_distress');
  assert.match(windows[0]!.text, /\[25:00\] Somebody call an ambulance/);
  // Stamped text without segments works too.
  assert.equal(transcriptCandidateWindows({ text })[0]!.atSeconds, 1500);
});

/* ------------------------------------------------------------------ */
/* Cap, opt-out, worker OK, dismiss reasons                             */
/* ------------------------------------------------------------------ */

test('alerts are capped per job per hour; the incident is still recorded', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const cats = ['fall_person_down', 'physical_violence', 'verbal_threat', 'medical_distress', 'other_emergency', 'silent_panic_wellness'] as const;
  for (const category of cats) {
    const { incident } = await createSafetyIncident(admin, {
      orgId: ORG,
      jobId: JOB,
      classification: { hit: true, category, severity: 'critical', confidence: 0.9, title: 't', description: 'd', recommendedAction: 'dispatch_help', clipTimestampSeconds: 1, model: 'm', signals: {} },
      source: 'live_stream',
    });
    await markIncidentAlerted(admin, incident.id, ['email', 'platform']);
    await acknowledgeSafetyIncident(admin, incident.id, null);
  }
  const { incident } = await createSafetyIncident(admin, {
    orgId: ORG,
    jobId: JOB,
    classification: { hit: true, category: 'physical_violence', severity: 'critical', confidence: 0.9, title: 'seventh', description: 'd', recommendedAction: 'dispatch_help', clipTimestampSeconds: 1, model: 'm', signals: {} },
    source: 'live_stream',
  });
  const out = await fanoutSafetyAlert(admin, incident);
  assert.equal(out.capped, true);
  assert.equal(calls.mail.length, 0);
  assert.ok(out.channels.includes('capped'), "out.channels.includes('capped')");
});

test('org opt-out: live safety off → no provider calls, no alert', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin({ org: { safety_live_enabled: false } });
  const res = await processLiveSafetyChunk(admin, PARTY, { clipId: 'clip_off', seq: 1, frame: frame(5, 'fight'), audio: audio(0, 'Get off me!') });
  assert.equal(res.enabled, false);
  assert.equal(calls.screen + calls.whisper + calls.confirm.length, 0);
});

test('the worker\'s phone is never told about an alert (response is { enabled } only)', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const res = await processLiveSafetyChunkForParty(PARTY, admin, {
    clipId: 'clip_worker_view',
    seq: 1,
    frame: frame(10, 'fight'),
    audio: audio(0, "Get off me! He's hitting me!"),
  });
  assert.equal(calls.mail.length, ADMIN_EMAILS.length, 'the admins were emailed');
  assert.deepEqual(res, { enabled: true }, 'nothing about the alert goes back to the phone');
  const off = await processLiveSafetyChunkForParty(PARTY, fakeAdmin({ org: { safety_live_enabled: false } }), {
    clipId: 'clip_worker_off',
    seq: 1,
    frame: frame(5, 'work'),
  });
  assert.deepEqual(off, { enabled: false });
});

test('dismiss stores the reason category', async () => {
  const { admin, out } = await runFight({});
  const d = await dismissSafetyIncident(admin, out.incidentId!, null, 'False alarm: TV / video / podcast playing', 'false_alarm_media');
  assert.equal(d.dismissCategory, 'false_alarm_media');
  assert.match(String(d.dismissReason), /podcast/);
});

/* ------------------------------------------------------------------ */
/* Recipients: account admins only, email only                          */
/* ------------------------------------------------------------------ */

test('recipients are exactly the account admins: Global Admins + the account owner, active only', async () => {
  const got = (await orgAdminEmails(fakeAdmin(), ORG)).sort();
  assert.deepEqual(got, ADMIN_EMAILS);
  for (const other of NON_ADMIN_EMAILS) assert.ok(!got.includes(other), `${other} is not an admin`);
});

test('non-admins get nothing: a critical alert emails only admins — no webhook, custom list, SMS or worker', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (url: any) => {
    fetched.push(String(url));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const { incident } = await createSafetyIncident(admin, {
      orgId: ORG,
      jobId: JOB,
      partyId: PARTY.id,
      classification: { hit: true, category: 'physical_violence', severity: 'critical', confidence: 0.95, title: 'Fight', description: 'd', recommendedAction: 'contact_authorities', clipTimestampSeconds: 1, model: 'm', signals: {} },
      source: 'live_stream',
    });
    const out = await fanoutSafetyAlert(admin, incident);
    assert.deepEqual(out.recipients.sort(), ADMIN_EMAILS);
    assert.deepEqual(calls.mail.map((m) => m.to).sort(), ADMIN_EMAILS);
    assert.deepEqual(out.channels.sort(), ['email', 'platform']);
    assert.deepEqual(fetched, [], 'no webhook / SMS / voice request is made');
  } finally {
    globalThis.fetch = realFetch;
  }
  // Watch severity: recorded in Platform, nobody emailed.
  const before = calls.mail.length;
  const { incident: watch } = await createSafetyIncident(admin, {
    orgId: ORG,
    jobId: JOB,
    classification: { hit: true, category: 'medical_distress', severity: 'watch', confidence: 0.8, title: 'Coughing', description: 'd', recommendedAction: 'monitor', clipTimestampSeconds: 1, model: 'm', signals: {} },
    source: 'live_stream',
  });
  await fanoutSafetyAlert(admin, watch);
  assert.equal(calls.mail.length, before);
});

test('an org with no admin emails sends nothing to anyone else', async () => {
  reset();
  const calls = installMocks();
  const admin = fakeAdmin();
  const noAdmins = {
    ...admin,
    from: (table: string) =>
      table === 'org_members'
        ? fakeAdmin().from('job_proof_frames') // [] — nobody on the roster
        : admin.from(table),
  };
  const { incident } = await createSafetyIncident(noAdmins, {
    orgId: ORG,
    jobId: JOB,
    classification: { hit: true, category: 'physical_violence', severity: 'critical', confidence: 0.95, title: 'Fight', description: 'd', recommendedAction: 'dispatch_help', clipTimestampSeconds: 1, model: 'm', signals: {} },
    source: 'live_stream',
  });
  const out = await fanoutSafetyAlert(noAdmins, incident);
  assert.equal(calls.mail.length, 0, 'the legacy custom list (dispatch@) is not a fallback');
  assert.deepEqual(out.channels, ['platform'], 'still shown in Platform');
});

test('settings carry no phone / escalation / custom-recipient fields', async () => {
  const settings = await loadOrgSafetySettings(fakeAdmin(), ORG);
  for (const k of ['alertPhones', 'escalateAfterSeconds', 'alertEmails', 'alertWebhookUrl']) {
    assert.equal(k in settings, false, `${k} removed`);
  }
  assert.equal(settings.liveSafetyEnabled, true);
});
