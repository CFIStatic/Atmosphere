/**
 * Live critical safety: real vs joking / staged / media playback, and alert
 * latency. Providers (Whisper, Haiku screen, Opus confirmation, mail, SMS)
 * are mocked; everything else — rolling context, word list, decisions,
 * incidents, fanout, cap, escalation — is the real code.
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
import { processLiveSafetyChunk, recordWorkerOkForParty, resetLiveSafetyForTests } from '../src/safety/live.js';
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
import { fanoutSafetyAlert } from '../src/safety/alerts.js';
import {
  escalationPlan,
  setSafetyCallProviderForTests,
  startSafetyEscalation,
  twilioProviderFromEnv,
  type SafetyCallProvider,
} from '../src/safety/escalation.js';
import { asPhoneList, isEmergencyServiceNumber, updateOrgSafetySettings } from '../src/safety/settings.js';
import { currentAiUsageScope } from '../src/metering/aiUsageContext.js';
import { PODCAST_NARRATION, PODCAST_SEGMENTS, PODCAST_TRANSCRIPT } from './fixtures/safetyPodcastFalseAlarm.js';
import type { OrgSafetySettings } from '../src/safety/types.js';

const ORG = '8b2cc105-0000-4000-8000-000000000001';
const JOB = '8b2cc105-0000-4000-8000-000000000002';
const PARTY = { org_id: ORG, job_id: JOB, id: '8b2cc105-0000-4000-8000-000000000003' };

type OrgRow = Record<string, unknown>;

function fakeAdmin(opts: { org?: Partial<OrgRow>; proof?: Record<string, unknown> | null } = {}) {
  const org: OrgRow = {
    id: ORG,
    safety_auto_escalate_to_authorities: false,
    safety_alert_webhook_url: null,
    safety_alert_emails: ['dispatch@example.com'],
    wellness_check_enabled: true,
    wellness_no_motion_seconds: 300,
    wellness_critical_after_seconds: 600,
    wellness_require_alone: true,
    safety_live_enabled: true,
    safety_alert_phones: [],
    safety_escalate_after_seconds: 90,
    ...opts.org,
  };
  const tables: Record<string, unknown> = {
    orgs: org,
    org_members: [
      { role: 'global_admin', status: 'active', profiles: { email: 'owner@example.com' } },
      { role: 'global_admin', status: 'active', profiles: { email: 'ops@example.com' } },
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
  setSafetyCallProviderForTests(null);
}

test.afterEach(() => {
  setSafetyProvidersForTests(null);
  setSafetyCallProviderForTests(undefined);
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
  // Every recipient, in parallel, with the live-view link.
  const recipients = calls.mail.map((m) => m.to).sort();
  assert.deepEqual(recipients, ['dispatch@example.com', 'ops@example.com', 'owner@example.com']);
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
  await sleep(20);
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

test('"I\'m OK" is recorded after the alert already went out (never holds it back)', async () => {
  const { admin, out } = await runFight({});
  const before = (await getSafetyIncident(admin, out.incidentId!))!;
  assert.ok(before.alertSentAt, 'alert was sent before any tap');
  const ok = await recordWorkerOkForParty(PARTY, admin, { incidentId: out.incidentId });
  assert.ok(ok.workerOkAt, 'ok.workerOkAt');
  const after = (await getSafetyIncident(admin, out.incidentId!))!;
  assert.equal(after.status, 'open', 'office still has to acknowledge');
  await assert.rejects(
    recordWorkerOkForParty({ ...PARTY, job_id: '8b2cc105-0000-4000-8000-0000000000ff' }, admin, { incidentId: out.incidentId }),
  );
});

test('dismiss stores the reason category', async () => {
  const { admin, out } = await runFight({});
  const d = await dismissSafetyIncident(admin, out.incidentId!, null, 'False alarm: TV / video / podcast playing', 'false_alarm_media');
  assert.equal(d.dismissCategory, 'false_alarm_media');
  assert.match(String(d.dismissReason), /podcast/);
});

/* ------------------------------------------------------------------ */
/* SMS / voice escalation (disabled unless TWILIO_* set; never 911)     */
/* ------------------------------------------------------------------ */

test('SMS provider is disabled without TWILIO_* env vars', () => {
  assert.equal(twilioProviderFromEnv({}), null);
  assert.equal(twilioProviderFromEnv({ TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'x' }), null);
});

test('Twilio provider posts SMS / calls and refuses emergency numbers', async () => {
  const posts: Array<{ url: string; body: string }> = [];
  const fakeFetch = async (url: string, init: any) => {
    posts.push({ url, body: String(init.body) });
    return { ok: true, status: 201, json: async () => ({ sid: 'SM1' }) };
  };
  const p = twilioProviderFromEnv(
    { TWILIO_ACCOUNT_SID: 'AC123', TWILIO_AUTH_TOKEN: 'tok', TWILIO_FROM_NUMBER: '+15550001111', TWILIO_VOICE_ENABLED: 'true' },
    fakeFetch,
  )!;
  assert.ok(p, 'p');
  assert.equal((await p.sendSms('+15125550100', 'hello')).ok, true);
  assert.match(posts[0]!.url, /Accounts\/AC123\/Messages\.json$/);
  assert.match(posts[0]!.body, /To=%2B15125550100/);
  assert.equal((await p.sendSms('911', 'x')).ok, false);
  assert.equal((await p.placeCall('+1911', 'x')).ok, false);
  assert.equal(posts.length, 1, 'emergency numbers never reach the provider');
  assert.equal((await p.placeCall('+15125550100', 'Safety alert')).ok, true);
  assert.match(posts[1]!.url, /Calls\.json$/);
});

test('phone list refuses emergency numbers', async () => {
  assert.equal(isEmergencyServiceNumber('911'), true);
  assert.equal(isEmergencyServiceNumber('+1 911'), true);
  assert.equal(isEmergencyServiceNumber('+15125550100'), false);
  assert.deepEqual(asPhoneList(['+1 (512) 555-0100', '911', '112', 'abc']), ['+15125550100']);
  await assert.rejects(updateOrgSafetySettings(fakeAdmin(), ORG, { alertPhones: ['+15125550100', '911'] }), /never texts or calls emergency/);
});

test('escalation ladder: immediate SMS, then next steps only while unacknowledged', async () => {
  reset();
  const sent: string[] = [];
  const fake: SafetyCallProvider = {
    name: 'fake',
    voiceEnabled: true,
    sendSms: async (to) => (sent.push(`sms:${to}`), { ok: true }),
    placeCall: async (to) => (sent.push(`voice:${to}`), { ok: true }),
  };
  setSafetyCallProviderForTests(fake);
  assert.deepEqual(
    escalationPlan(['+15125550100', '+15125550101'], 60, true).map((s) => `${s.atMs}:${s.kind}:${s.to}`),
    ['0:sms:+15125550100', '60000:sms:+15125550101', '60000:voice:+15125550100', '120000:voice:+15125550101'],
  );
  const admin = fakeAdmin();
  const { incident } = await createSafetyIncident(admin, {
    orgId: ORG,
    jobId: JOB,
    classification: { hit: true, category: 'physical_violence', severity: 'critical', confidence: 0.9, title: 'Fight', description: 'd', recommendedAction: 'contact_authorities', clipTimestampSeconds: 1, model: 'm', signals: {} },
    source: 'live_stream',
  });
  const pending: Array<() => void> = [];
  const settings = { alertPhones: ['+15125550100', '+15125550101'], escalateAfterSeconds: 60 } as OrgSafetySettings;
  assert.equal(startSafetyEscalation(admin, incident, settings, { liveViewUrl: 'https://x/jobs/1' }, { setTimeout: (fn) => pending.push(fn) }), true);
  await sleep(5);
  assert.deepEqual(sent, ['sms:+15125550100']);
  await acknowledgeSafetyIncident(admin, incident.id, null);
  pending.forEach((fn) => fn());
  await sleep(5);
  assert.deepEqual(sent, ['sms:+15125550100'], 'acknowledged → ladder stops');
  setSafetyCallProviderForTests(null);
  assert.equal(startSafetyEscalation(admin, incident, settings, { liveViewUrl: 'x' }), false, 'no provider → disabled');
});
