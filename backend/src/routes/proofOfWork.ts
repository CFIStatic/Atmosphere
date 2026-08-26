import { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { HttpError } from '../lib/errors.js';
import { requireOrgContext } from '../lib/orgContext.js';
import { createAdminClient } from '../lib/supabase.js';
import {
  verifyDay,
  verifyProof,
  payable,
  type ProofUpload,
} from '../shared/proofVerifier.js';
import {
  analyseDayFilm,
  answerFromProofs,
  collectionClipsFromRows,
  type MaterialChange,
  type ProofFrame,
} from '../shared/proofAnalyst.js';
import { RetryQueue } from '../shared/retryQueue.js';
import { attachProofToEpisode } from '../episodes/attach.js';
import { ingestPhysicalWorkFromProof } from '../physicalWork/ingest.js';
import { isModelProviderConfigured } from '../lib/anthropic.js';
import { config } from '../config.js';
import { DailyBudget } from '../shared/liveBudget.js';
import { labelsForProof } from '../verifier/library.js';
import { buildCaptureGuide } from '../shared/captureGuide.js';
import { scopeForParty } from '../shared/jobRecord.js';
import { analyseLongRecording } from '../shared/longAnalyst.js';
import { prepareVideoFrames } from '../shared/videoIntelligence.js';
import { probeMetadata } from '../verification/frames/extract.js';
import {
  narrateProofVideo,
  observeLiveFrame,
  stepsForNarration,
} from '../shared/liveNarrator.js';
import {
  describeRecordingWithoutScope,
  descriptionFindings,
} from '../shared/workerActivityAnalysis.js';
import {
  actionLabels,
  actionsFromLongWindows,
  persistProofActions,
  type VisionAction,
} from '../shared/proofActions.js';
import { applyOpenHoldToProof, markSourceDeleted, recordUserAction, vaultFromProof } from '../legal/index.js';
import { queueProofTranscript } from '../audio/proofTranscript.js';

/**
 * Proof of work: the endpoints.
 *
 * Two audiences, as everywhere in the shared record. The subcontractor uploads
 * through their job token from the app; the general contractor reads, accepts
 * and asks questions through their session.
 *
 * The video itself never passes through this API. The device uploads straight
 * to storage with a short-lived signed URL and then posts the key, the hash and
 * the capture facts here. A hundred-megabyte clip through an Express route is a
 * request that times out on a truck's signal and an API that falls over when
 * two crews finish at once.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const PROOF_BUCKET = 'job-proofs';

const PROOF_SELECT =
  'id, party_id, work_date, phase, storage_path, byte_size, duration_seconds, content_hash, ' +
  'captured_at, received_at, lat, lon, accuracy_m, state, checks, ai_summary, ai_findings, ' +
  'ai_model, ai_material_change, analysis_status, analysis_error, analysed_at, ' +
  'narration, narration_text, narration_status, narration_error, actions, ' +
  'transcript_status, transcript_text, transcript_error, transcribed_at, ' +
  'decided_at, decided_note, created_at';

/** The row shape the verifier wants. */
function asUpload(row: any): ProofUpload {
  return {
    id: row.id,
    phase: row.phase,
    workDate: row.work_date,
    capturedAt: row.captured_at,
    receivedAt: row.received_at,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    contentHash: row.content_hash,
    lat: row.lat === null ? null : Number(row.lat),
    lon: row.lon === null ? null : Number(row.lon),
    accuracyM: row.accuracy_m === null ? null : Number(row.accuracy_m),
  };
}

/**
 * Where the job is, for the on-site check.
 *
 * From the property when there is one, then the paired Operations project.
 * Returns null rather than a guess: the verifier reports "no location on file"
 * as unknown, which is the honest outcome and stops a payment just as firmly as
 * a failure would.
 */
async function siteLocation(supabase: any, orgId: string, jobId: string) {
  const { data: job } = await supabase
    .from('crm_jobs')
    .select('property_id')
    .eq('org_id', orgId)
    .eq('id', jobId)
    .maybeSingle();

  if ((job as any)?.property_id) {
    // The columns are latitude/longitude — selecting the wrong names here
    // silently returned null and left every on-site check "unknown", which
    // blocks payment honestly but wrongly. The names are load-bearing.
    const { data: property } = await supabase
      .from('crm_properties')
      .select('latitude, longitude')
      .eq('id', (job as any).property_id)
      .maybeSingle();
    const lat = (property as any)?.latitude;
    const lon = (property as any)?.longitude;
    if (lat !== null && lat !== undefined && lon !== null && lon !== undefined) {
      return { lat: Number(lat), lon: Number(lon) };
    }
  }
  return null;
}

/* ---- The subcontractor's side ------------------------------------------- */

/**
 * POST /api/job-share/:token/proof/upload-url
 * A short-lived signed URL to put the video straight into storage.
 */
export async function createUploadUrl(
  party: any,
  admin: any,
  body: unknown,
): Promise<{ path: string; token: string; uploadUrl: string }> {
  const input = z
    .object({
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      phase: z.enum(['before', 'after']),
      extension: z.string().regex(/^[a-z0-9]{2,5}$/).default('mp4'),
    })
    .parse(body ?? {});

  // Path carries the job and party so a leaked signed URL cannot be aimed at
  // another job's folder.
  const path = `${party.org_id}/${party.job_id}/${party.id}/${input.workDate}-${input.phase}.${input.extension}`;

  const { data, error } = await admin.storage.from(PROOF_BUCKET).createSignedUploadUrl(path, {
    upsert: true,
  });
  if (error || !(data as { signedUrl?: string } | null)?.signedUrl) {
    throw new HttpError(500, error?.message ?? 'Could not mint upload URL', 'upload_url_failed');
  }
  const signed = data as { signedUrl: string; token: string };
  return { path, token: signed.token, uploadUrl: signed.signedUrl };
}

const recordSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  phase: z.enum(['before', 'after']),
  storagePath: z.string().min(1).max(500),
  byteSize: z.number().int().positive().optional(),
  // Day-length / overnight recordings are first-class. The hard ceiling is
  // config.verification.maxDurationSeconds (default 24h); above that the
  // phone must split the day rather than ship an unbounded file.
  durationSeconds: z
    .number()
    .min(0)
    .max(config.verification.maxDurationSeconds)
    .optional(),
  /** SHA-256 hex, computed on the device before upload. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  capturedAt: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().min(0).optional(),
  /** Stills the phone pulled from the clip, as base64 JPEG. */
  frames: z
    .array(z.object({ atSeconds: z.number().min(0), base64: z.string().min(100).max(4_000_000) }))
    .max(12)
    .optional(),
});

/**
 * POST /api/job-share/:token/proof
 * Record an uploaded video, run the checks, and store the findings.
 *
 * The checks run here rather than on read, so the record shows what was known
 * at the time — including a re-upload check against everything already on the
 * job, which is only meaningful at the moment of upload.
 */
export async function recordProof(party: any, admin: any, body: unknown) {
  const input = recordSchema.parse(body);

  // Everything already filed on this job, for the re-upload check. Hashes only.
  const { data: priorRows } = await admin
    .from('job_proofs')
    .select('content_hash')
    .eq('job_id', party.job_id)
    .not('content_hash', 'is', null);
  const seenHashes = new Set(((priorRows ?? []) as any[]).map((r) => r.content_hash));

  const receivedAt = new Date().toISOString();
  const site = await siteLocation(admin, party.org_id, party.job_id);

  const checks = verifyProof(
    {
      id: 'pending',
      phase: input.phase,
      workDate: input.workDate,
      capturedAt: input.capturedAt ?? null,
      receivedAt,
      durationSeconds: input.durationSeconds ?? null,
      contentHash: input.contentHash ?? null,
      lat: input.lat ?? null,
      lon: input.lon ?? null,
      accuracyM: input.accuracyM ?? null,
    },
    site,
    { seenHashes },
  );

  // Visible unique (party, day, phase): a second attempt replaces the live
  // row. A customer-deleted clip stays in the vault and does not block a refilm.
  const proofRow = {
    org_id: party.org_id,
    job_id: party.job_id,
    party_id: party.id,
    work_date: input.workDate,
    phase: input.phase,
    storage_path: input.storagePath,
    byte_size: input.byteSize ?? null,
    duration_seconds: input.durationSeconds ?? null,
    content_hash: input.contentHash ?? null,
    captured_at: input.capturedAt ?? null,
    received_at: receivedAt,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    accuracy_m: input.accuracyM ?? null,
    state: 'checked',
    checks,
  };
  const { data: existingVisible } = await admin
    .from('job_proofs')
    .select('id')
    .eq('party_id', party.id)
    .eq('work_date', input.workDate)
    .eq('phase', input.phase)
    .is('deleted_at', null)
    .maybeSingle();

  const write = existingVisible?.id
    ? admin.from('job_proofs').update(proofRow).eq('id', existingVisible.id)
    : admin.from('job_proofs').insert(proofRow);
  const { data: proof, error } = await write.select(PROOF_SELECT).single();
  if (error) throw new HttpError(400, error.message, 'proof_failed');

  if (input.frames?.length) {
    for (const frame of input.frames) {
      const path = `${party.org_id}/${party.job_id}/${party.id}/${input.workDate}-${input.phase}-f${Math.round(frame.atSeconds)}.jpg`;
      const bytes = Buffer.from(frame.base64, 'base64');
      await admin.storage.from(PROOF_BUCKET).upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      await admin.from('job_proof_frames').upsert(
        {
          org_id: party.org_id,
          proof_id: (proof as any).id,
          at_seconds: frame.atSeconds,
          storage_path: path,
        },
        { onConflict: 'proof_id,at_seconds' },
      );
    }
  }

  // Two readings queue here, not one. The narration is per-video. The scene
  // reading describes what this file shows — every upload is analysed on its
  // own, however the crew labelled it.
  //
  // Day-length recordings and the iOS app often arrive with zero device
  // frames. Those still queue: the worker sparsely extracts stills from
  // storage with FFmpeg before reading.
  await queueNarration(admin, party, (proof as any).id, input.phase, input.workDate);
  const analysis = await queueDayAnalysis(admin, party, input.workDate, (proof as any).id);

  // The clip's own length and stills, settled off the critical path. Neither
  // needs a model, and a crew standing in a doorway must not wait on FFmpeg
  // to be told their video is filed.
  void ensureStillsAndDuration(admin, (proof as any).id).catch((err) => {
    console.warn('[proof] stills failed:', err instanceof Error ? err.message : err);
  });

  // The same upload, seen as an episode. Additive and non-blocking: it never
  // throws into this path, because a crew in a doorway must not get an error
  // from a table that enriches a record which is already complete without it.
  await attachProofToEpisode(admin, {
    orgId: party.org_id,
    jobId: party.job_id,
    partyId: party.id,
    workDate: input.workDate,
    proofId: (proof as any).id,
    proofPhase: input.phase,
    performerLabel: `${party.contact_name ? `${party.contact_name}, ` : ''}${party.company}`,
  });
  await queueProofTranscript(admin, (proof as any).id);

  await recordAccess(admin, {
    orgId: party.org_id,
    jobId: party.job_id,
    proofId: (proof as any).id,
    action: 'uploaded',
    partyId: party.id,
    actorLabel: `${party.contact_name ? `${party.contact_name}, ` : ''}${party.company}`,
    actorRole: party.role ?? 'subcontractor',
    detail: `${input.phase} · ${input.workDate}`,
  });

  void vaultFromProof(proof as any).catch((err) => {
    console.warn('[legal] vault proof failed:', err instanceof Error ? err.message : err);
  });
  void applyOpenHoldToProof({
    orgId: party.org_id,
    jobId: party.job_id,
    proofId: (proof as any).id,
  }).catch((err) => {
    console.warn('[legal] apply job hold failed:', err instanceof Error ? err.message : err);
  });
  void recordUserAction({
    orgId: party.org_id,
    action: 'video.uploaded',
    resourceType: 'proof',
    resourceId: (proof as any).id,
    actorLabel: `${party.contact_name ? `${party.contact_name}, ` : ''}${party.company}`,
    detail: { phase: input.phase, workDate: input.workDate, jobId: party.job_id },
  });

  // Optional deep verification pipeline (FFmpeg / rules / review). Additive and
  // non-blocking: payment-gate analysis above must not wait on it, and a missing
  // migration must not fail the crew's upload.
  if (process.env.VERIFICATION_PIPELINE_FROM_PROOF !== 'false') {
    void enqueueVerificationFromProof(admin, party, proof as any).catch((err) => {
      console.error('[verification.enqueue_from_proof]', err instanceof Error ? err.message : err);
    });
  }

  return {
    proof,
    checks,
    analysis,
    // Said back immediately, in the app, while the crew is still on site. A
    // problem told to somebody on Friday about Tuesday's video is not
    // actionable; the same problem told at 4pm is.
    problems: checks.filter((c) => c.verdict === 'fail').map((c) => c.detail),
  };
}

async function enqueueVerificationFromProof(admin: any, party: any, proof: any): Promise<void> {
  const { linkProofAsVerificationVideo, getVerificationOrchestrator, pipelineIdempotencyKey } =
    await import('../verification/index.js');
  const videoId = await linkProofAsVerificationVideo(
    { supabase: admin, orgId: party.org_id, uploaderId: null },
    {
      id: proof.id,
      jobId: party.job_id,
      partyId: party.id,
      storagePath: proof.storage_path,
      fileSize: proof.byte_size,
      durationSeconds: proof.duration_seconds === null ? null : Number(proof.duration_seconds),
      contentHash: proof.content_hash,
      capturedAt: proof.captured_at,
      lat: proof.lat === null || proof.lat === undefined ? null : Number(proof.lat),
      lon: proof.lon === null || proof.lon === undefined ? null : Number(proof.lon),
    },
  );
  await getVerificationOrchestrator().enqueue({
    supabase: admin,
    orgId: party.org_id,
    videoId,
    jobId: party.job_id,
    idempotencyKey: pipelineIdempotencyKey(videoId),
  });
}

type DayAnalysisResult =
  | { outcome: 'done'; materialChange: MaterialChange | null; summary: string }
  | { outcome: 'skipped'; reason: string };

/**
 * Load one video's frames and run the model over them.
 *
 * Three ways out, and keeping them apart is the point of the refactor:
 * 'done' wrote findings; 'skipped' means there was nothing to run against and
 * says why; a throw means the model flaked and the attempt is worth retrying.
 * The old version collapsed all three into a silent return.
 */
async function runDayAnalysis(
  admin: any,
  party: any,
  workDate: string,
  proofId: string,
): Promise<DayAnalysisResult> {
  const { data: film } = await admin
    .from('job_proofs')
    .select('id, phase, duration_seconds, byte_size, storage_path')
    .eq('id', proofId)
    .maybeSingle();

  if (!film) {
    return { outcome: 'skipped', reason: 'No video on file yet.' };
  }
  if (!isModelProviderConfigured()) {
    return { outcome: 'skipped', reason: 'Model access is not configured on this server.' };
  }

  const loadFrames = async (row: any): Promise<ProofFrame[]> => {
    if (!row) return [];
    const frames = await framesFor(admin, row.id);
    if (frames.length) return frames.slice(0, 12);
    const durationSeconds = Number(row.duration_seconds ?? 0);
    await ensureSparseFramesFromStorage(admin, row.id, durationSeconds || 60);
    return (await framesFor(admin, row.id)).slice(0, 12);
  };

  const filmFrames = await loadFrames(film);
  if (!filmFrames.length) {
    return {
      outcome: 'skipped',
      reason: 'Could not extract frames from this video for analysis.',
    };
  }

  const { data: scope } = await admin
    .from('job_scope_items')
    .select('title, party_id, state')
    .eq('job_id', party.job_id)
    .in('state', ['included', 'approved']);

  const titles = ((scope ?? []) as any[])
    .filter((s) => !s.party_id || s.party_id === party.id)
    .map((s) => s.title);

  const analysis = await analyseDayFilm({
    frames: filmFrames,
    scopeTitles: titles,
    workDate,
    trade: party.trade,
  });
  if (!analysis) throw new Error('The model reply was not usable.');

  await admin.from('job_proofs').update({
    state: 'analysed',
    ai_summary: analysis.summary,
    ai_material_change: null,
    ai_findings: {
      kind: 'day_film',
      scopeCrossRef: titles.length > 0,
      workPerformed: analysis.workPerformed,
      changes: analysis.workPerformed,
      cannotTell: analysis.cannotTell,
      scopeTouched: analysis.scopeTouched,
      scopeVerdicts: analysis.scopeVerdicts,
      concerns: analysis.concerns,
      opening: { before: 'unclear', after: analysis.opening },
    },
    ai_model: analysis.model,
  }).eq('id', film.id);

  await ingestPhysicalWorkFromProof(admin, { orgId: party.org_id, proofId: film.id });
  return { outcome: 'done', materialChange: null, summary: analysis.summary };
}

/** The verdict, in the words the custody log keeps. */
function materialChangeWords(change: MaterialChange | null): string {
  if (!change) return 'work described from the day film';
  const words: Record<MaterialChange, string> = {
    significant: 'work materially changed',
    minor: 'a small visible change',
    none: 'no visible change between the videos',
    unclear: 'the footage did not allow a comparison',
  };
  return words[change];
}

interface AnalysisJob {
  key: string;
  orgId: string;
  jobId: string;
  partyId: string;
  workDate: string;
  trade: string | null;
  proofId: string;
}

/**
 * One attempt, with its bookkeeping. Shared by the queue and the retry button
 * so there is exactly one account of what an attempt does — two versions of
 * this choreography is how a status column starts lying.
 */
async function performAnalysis(admin: any, job: AnalysisJob, attempt: number): Promise<DayAnalysisResult> {
  await admin
    .from('job_proofs')
    .update({ analysis_status: 'running', analysis_attempts: attempt })
    .eq('id', job.proofId);

  const result = await runDayAnalysis(
    admin,
    { id: job.partyId, org_id: job.orgId, job_id: job.jobId, trade: job.trade },
    job.workDate,
    job.proofId,
  );

  if (result.outcome === 'skipped') {
    // Recorded, because "why has this day never been read" is a question the
    // dashboard has to answer without somebody grepping server logs.
    await admin
      .from('job_proofs')
      .update({ analysis_status: 'skipped', analysis_error: result.reason })
      .eq('id', job.proofId);
    return result;
  }

  await admin
    .from('job_proofs')
    .update({ analysis_status: 'done', analysis_error: null, analysed_at: new Date().toISOString() })
    .eq('id', job.proofId);

  // The read goes into the chain of custody like any other access — the model
  // looked at the evidence, and that is a fact about the evidence.
  await recordAccess(admin, {
    orgId: job.orgId,
    jobId: job.jobId,
    proofId: job.proofId,
    action: 'analysed',
    actorLabel: 'Atmosphere',
    detail: `${job.workDate} — ${materialChangeWords(result.materialChange)}`,
  });

  return result;
}

const analysisQueue = new RetryQueue<AnalysisJob>({
  run: async (job, attempt) => {
    const admin = createAdminClient();
    if (!admin) throw new Error('Storage is not configured.');
    await performAnalysis(admin, job, attempt);
  },
  onGaveUp: async (job, error) => {
    // The write the old code never made. 'failed' is retryable and visible;
    // swallowing it made "the model was down" indistinguishable from "nobody
    // asked".
    const admin = createAdminClient();
    if (!admin) return;
    await admin
      .from('job_proofs')
      .update({
        analysis_status: 'failed',
        analysis_error: error instanceof Error ? error.message : 'Analysis failed.',
      })
      .eq('id', job.proofId);
  },
});

/**
 * Queue one video — or every video on that day — for a scene reading.
 *
 * Each file is its own job. Returns 'queued' when the model will read,
 * 'waiting' only when nothing has been filed yet.
 */
async function queueDayAnalysis(
  admin: any,
  party: any,
  workDate: string,
  proofId?: string,
): Promise<'queued' | 'waiting'> {
  const { data } = await admin
    .from('job_proofs')
    .select('id, phase')
    .eq('party_id', party.id)
    .eq('work_date', workDate);

  const rows = (data ?? []) as any[];
  const films = proofId ? rows.filter((r) => r.id === proofId) : rows;
  if (!films.length) return 'waiting';

  for (const film of films) {
    await admin.from('job_proofs').update({ analysis_status: 'queued' }).eq('id', film.id);
    analysisQueue.enqueue({
      key: film.id,
      orgId: party.org_id,
      jobId: party.job_id,
      partyId: party.id,
      workDate,
      trade: party.trade ?? null,
      proofId: film.id,
    });
  }
  return 'queued';
}

/* ---- Per-video narration -------------------------------------------------- */

interface NarrationJob {
  key: string;
  proofId: string;
  orgId: string;
  jobId: string;
  partyId: string;
  phase: string;
  workDate: string;
}

/** The shot list this crew was actually given, for grounding the narration. */
async function guideStepsFor(admin: any, jobId: string, partyId: string, phase: string) {
  const { data: scope } = await admin
    .from('job_scope_items')
    .select('title, state, reason, party_id, created_at')
    .eq('job_id', jobId)
    .order('created_at');
  const mine = scopeForParty((scope ?? []) as any[], partyId);
  const guide = buildCaptureGuide({
    phase: phase === 'after' ? 'after' : 'before',
    scope: mine.map((s: any) => ({ title: s.title, state: s.state, reason: s.reason })),
  });
  return {
    steps: stepsForNarration(guide.steps),
    scopeTitles: mine.filter((s: any) => s.state !== 'declined').map((s: any) => s.title),
  };
}

/**
 * Read one video's stored frames back out of the bucket. Short clips still
 * arrive with device-extracted JPEGs; day-length clips are filled in by
 * ensureSparseFramesFromStorage when the device sent none.
 */
async function framesFor(admin: any, proofId: string) {
  const { data: rows } = await admin
    .from('job_proof_frames')
    .select('at_seconds, storage_path')
    .eq('proof_id', proofId)
    .order('at_seconds');
  const frames: Array<{ atSeconds: number; base64: string }> = [];
  for (const row of (rows ?? []) as any[]) {
    const { data: blob } = await admin.storage.from(PROOF_BUCKET).download(row.storage_path);
    if (!blob) continue;
    frames.push({
      atSeconds: Number(row.at_seconds),
      base64: Buffer.from(await blob.arrayBuffer()).toString('base64'),
    });
  }
  return frames;
}

/**
 * For a long recording with few or no device stills, stream-extract a sparse
 * set of JPEGs from the stored video via the shared video-intelligence
 * pipeline (same path any inbound video can use). Node never holds the
 * multi‑GB file.
 */
async function ensureSparseFramesFromStorage(
  admin: any,
  proofId: string,
  durationSeconds: number,
): Promise<number> {
  const { data: existing } = await admin
    .from('job_proof_frames')
    .select('id')
    .eq('proof_id', proofId);
  const have = (existing ?? []).length;
  // A short guided clip with a handful of device frames is already enough.
  // A workday needs a real sample across the timeline.
  // Device stills (≤12) are never enough for a workday. Always re-extract
  // sparsely + diversely for long-form so we do not narrate six near-identical
  // phone thumbnails.
  const minWanted = 1;
  if (have >= config.verification.sparseMaxFrames) return have;

  const { data: proof } = await admin
    .from('job_proofs')
    .select('storage_path, org_id, job_id, party_id, work_date, phase')
    .eq('id', proofId)
    .maybeSingle();
  if (!proof?.storage_path) return have;

  const { data: signed, error: signErr } = await admin.storage
    .from(PROOF_BUCKET)
    .createSignedUrl((proof as any).storage_path, 60 * 60);
  if (signErr || !signed?.signedUrl) {
    throw new Error(signErr?.message ?? 'Could not mint a signed URL for sparse extract.');
  }

  // Same prepareVideoFrames call used by /api/media/video — proof is just
  // one source kind among several.
  const prepared = await prepareVideoFrames({
    id: proofId,
    source: 'proof_of_work',
    url: signed.signedUrl,
    durationSeconds,
  });
  if (!prepared.frames.length) return have;

  // Replace device samples with the diversity-filtered server timeline.
  if (have >= minWanted) {
    await admin.from('job_proof_frames').delete().eq('proof_id', proofId);
  }

  for (const frame of prepared.frames) {
    const path = `${(proof as any).org_id}/${(proof as any).job_id}/${(proof as any).party_id}/${(proof as any).work_date}-${(proof as any).phase}-sf${Math.round(frame.atSeconds)}.jpg`;
    await admin.storage.from(PROOF_BUCKET).upload(path, frame.jpeg, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    await admin.from('job_proof_frames').upsert(
      {
        org_id: (proof as any).org_id,
        proof_id: proofId,
        at_seconds: frame.atSeconds,
        storage_path: path,
      },
      { onConflict: 'proof_id,at_seconds' },
    );
  }
  return prepared.frames.length;
}

/**
 * Settle the two facts about a recording that need no model: how long it is,
 * and what it looks like.
 *
 * Both were trapped behind the narration until now, and the narration bails
 * the moment no model is configured — so a server without a key ended up with
 * clips that claimed to be 0:00 and had not one still between them. That is
 * the office list showing a drawn placeholder for real footage.
 *
 * The length matters because a browser recording does not carry one. A phone
 * filming into MediaRecorder produces WebM with no duration in the header, so
 * the page reads 0, uploads 0, and — because the client extractor gives up on
 * a clip it cannot measure — sends no frames either. FFprobe over the stored
 * file settles it, and the answer is written back: the list, the length check
 * and retention all read that column.
 *
 * Idempotent and safe to call from anywhere. A clip that already has both is
 * two cheap selects, and a clip FFmpeg cannot open is attempted once per
 * process rather than on every list render.
 */
const stillsAttempted = new Set<string>();

export async function ensureStillsAndDuration(
  admin: any,
  proofId: string,
): Promise<{ durationSeconds: number; longForm: boolean; error: string | null }> {
  const { data: proofRow } = await admin
    .from('job_proofs')
    .select('duration_seconds, byte_size, storage_path')
    .eq('id', proofId)
    .maybeSingle();

  let durationSeconds = Number((proofRow as any)?.duration_seconds ?? 0);
  const byteSize = Number((proofRow as any)?.byte_size ?? 0);
  const storagePath = (proofRow as any)?.storage_path ?? null;
  let error: string | null = null;

  if (!(durationSeconds > 0) && storagePath) {
    try {
      const { data: signed } = await admin.storage
        .from(PROOF_BUCKET)
        .createSignedUrl(storagePath, 600);
      if (signed?.signedUrl) {
        // FFprobe reads over HTTP, so the multi-GB case never lands on disk.
        const meta = await probeMetadata(signed.signedUrl);
        const probed = Number(meta.durationSeconds ?? 0);
        if (Number.isFinite(probed) && probed > 0) {
          durationSeconds = Math.round(probed * 100) / 100;
          await admin
            .from('job_proofs')
            .update({ duration_seconds: durationSeconds })
            .eq('id', proofId);
        }
      }
    } catch (err) {
      // A length nobody could read stays unknown. It never blocks the stills.
      error = err instanceof Error ? err.message : String(err);
    }
  }

  const longForm = durationSeconds > config.verification.longFormSeconds || byteSize > 80_000_000;

  const { count } = await admin
    .from('job_proof_frames')
    .select('id', { count: 'exact', head: true })
    .eq('proof_id', proofId);
  const have = count ?? 0;

  // A workday always gets the server's spread — a handful of device stills
  // does not cover eight hours. Anything else only needs filling when the
  // device sent nothing.
  const wanted = longForm || have === 0;
  if (wanted && storagePath && !stillsAttempted.has(proofId)) {
    stillsAttempted.add(proofId);
    try {
      await ensureSparseFramesFromStorage(
        admin,
        proofId,
        durationSeconds || (longForm ? 24 * 60 * 60 : 60),
      );
      // A clip that yielded stills is worth retrying later if it is asked for
      // again; only a genuine failure needs the once-per-process brake.
      stillsAttempted.delete(proofId);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }

  return { durationSeconds, longForm, error };
}

async function finishProofActions(
  admin: any,
  job: NarrationJob,
  actions: VisionAction[],
  model?: string | null,
): Promise<void> {
  await persistProofActions(admin, {
    orgId: job.orgId,
    proofId: job.proofId,
    actions,
    model: model ?? null,
  });
}

async function performNarration(admin: any, job: NarrationJob): Promise<void> {
  await admin.from('job_proofs').update({ narration_status: 'running' }).eq('id', job.proofId);

  const write = async (patch: Record<string, unknown>) =>
    admin.from('job_proofs').update(patch).eq('id', job.proofId);

  // Length and stills first, and deliberately before the model check. Both are
  // facts about the file rather than readings of it — the office list prints
  // the length, the preview and the scrubber are the stills — and a server
  // with no model key should still leave a clip looking like itself.
  const settled = await ensureStillsAndDuration(admin, job.proofId);

  if (!isModelProviderConfigured()) {
    await write({ narration_status: 'skipped', narration_error: 'No model is configured.' });
    return;
  }

  const durationSeconds = settled.durationSeconds;
  const longForm = settled.longForm;

  const ready = await framesFor(admin, job.proofId);
  if (!ready.length) {
    // Honest and terminal after FFmpeg had a chance at the stored file.
    await write({
      narration_status: 'skipped',
      narration_error: settled.error
        ? `Could not extract frames from this recording: ${settled.error}`
        : 'Could not extract frames from this recording for analysis.',
    });
    return;
  }

  // A workday-length recording is a different reading problem from a guided
  // walk: hours of frames go through windows on the cheap model, then one
  // synthesis on the strong one, with verdicts capped by actual sightings.
  if (longForm) {
    await performLongFormAnalysis(
      admin,
      job,
      ready,
      durationSeconds || ready[ready.length - 1]?.atSeconds || 0,
    );
    return;
  }

  const { steps, scopeTitles } = await guideStepsFor(admin, job.jobId, job.partyId, job.phase);
  const { data: partyRow } = await admin
    .from('job_parties')
    .select('trade')
    .eq('id', job.partyId)
    .maybeSingle();
  const trade = (partyRow as any)?.trade ?? null;

  // Scope attached → shot-list narration cross-referenced to those lines.
  // No scope → plain description of what the worker is doing in the frames.
  if (!scopeTitles.length) {
    const dictation = await describeRecordingWithoutScope({
      proofId: job.proofId,
      durationSeconds: durationSeconds || ready[ready.length - 1]?.atSeconds || 60,
      frames: ready,
      longForm: false,
      trade,
    });
    await write({
      ai_summary: (dictation.narrationSummary || dictation.narrationText).slice(0, 500),
      ai_findings: descriptionFindings(dictation),
      ai_model: dictation.model,
      analysis_status: 'done',
      narration: { entries: [], coverage: [], model: dictation.model },
      narration_text: dictation.narrationText,
      narration_status: 'done',
      narration_error: null,
      narrated_at: new Date().toISOString(),
      labels: labelsForProof({
        phase: job.phase,
        trade,
        narration: { coverage: [] },
        stageKinds: [],
        actions: dictation.actions,
      }),
    });
    await finishProofActions(admin, job, dictation.actions, dictation.model);
    await recordAccess(admin, {
      orgId: job.orgId,
      jobId: job.jobId,
      proofId: job.proofId,
      action: 'analysed',
      actorLabel: 'Atmosphere',
      detail: `described · no scope · ${job.phase} · ${job.workDate}`,
    });
    return;
  }

  const narration = await narrateProofVideo({
    frames: ready,
    steps,
    scopeTitles,
    phase: job.phase,
    workDate: job.workDate,
  });
  if (!narration) throw new Error('The model reply was not usable.');

  // The historical index rides the same write: phase, trade, and the stages
  // the narration actually saw, flattened for the GIN index so "every
  // flood-cut video ever" stays a millisecond query.
  await write({
    narration: { entries: narration.entries, coverage: narration.coverage, model: narration.model },
    narration_text: narration.report,
    narration_status: 'done',
    narration_error: null,
    narrated_at: new Date().toISOString(),
    ai_findings: {
      scopeCrossRef: true,
      scopeTitles,
      actions: narration.actions,
    },
    labels: labelsForProof({
      phase: job.phase,
      trade,
      narration: { coverage: narration.coverage },
      stageKinds: steps.map((s) => s.kind),
      actions: narration.actions,
    }),
  });
  await finishProofActions(admin, job, narration.actions, narration.model);

  await recordAccess(admin, {
    orgId: job.orgId,
    jobId: job.jobId,
    proofId: job.proofId,
    action: 'analysed',
    actorLabel: 'Atmosphere',
    detail: `narrated · scope cross-ref · ${job.phase} · ${job.workDate}`,
  });
}

/**
 * The workday path: hours of footage, read honestly.
 *
 * With agreed scope: windows on the cheap model, synthesis on the strong one,
 * per-line verdicts capped by actual sightings.
 * Without scope: AI still reads the frames and dictates what happened — we do
 * not skip a day of video just because nobody attached a scope yet.
 */
async function performLongFormAnalysis(
  admin: any,
  job: NarrationJob,
  frames: Array<{ atSeconds: number; base64: string }>,
  durationSeconds: number,
): Promise<void> {
  const write = (patch: Record<string, unknown>) =>
    admin.from('job_proofs').update(patch).eq('id', job.proofId);

  const { data: scopeRows } = await admin
    .from('job_scope_items')
    .select('id, party_id, title, state')
    .eq('job_id', job.jobId);
  const mine = scopeForParty((scopeRows ?? []) as any[], job.partyId);
  const scopeTitles = mine
    .filter((s: any) => s.state === 'included' || s.state === 'approved')
    .map((s: any) => s.title as string);

  const { data: partyRow } = await admin
    .from('job_parties')
    .select('trade')
    .eq('id', job.partyId)
    .maybeSingle();
  const trade = ((partyRow as any)?.trade ?? '').trim().toLowerCase();

  if (!scopeTitles.length) {
    const dictation = await describeRecordingWithoutScope({
      proofId: job.proofId,
      durationSeconds,
      frames,
      longForm: true,
      trade,
    });
    await write({
      ai_summary: (dictation.narrationSummary || dictation.narrationText).slice(0, 500),
      ai_findings: descriptionFindings(dictation),
      ai_model: dictation.model,
      analysis_status: 'done',
      narration: { entries: [], coverage: [], model: dictation.model },
      narration_text: dictation.narrationText,
      narration_status: 'done',
      narration_error: null,
      narrated_at: new Date().toISOString(),
      labels: [job.phase, trade || null, 'workday', 'no_scope', ...actionLabels(dictation.actions)]
        .filter(Boolean)
        .slice(0, 24),
    });
    await finishProofActions(admin, job, dictation.actions, dictation.model);
    await recordAccess(admin, {
      orgId: job.orgId,
      jobId: job.jobId,
      proofId: job.proofId,
      action: 'analysed',
      actorLabel: 'Atmosphere',
      detail: `workday described · no scope · ${(durationSeconds / 3600).toFixed(1)}h · ${dictation.frameCount} frames`,
    });
    return;
  }

  const result = await analyseLongRecording({ frames, scopeTitles, durationSeconds });
  if (!result) throw new Error('The model reply was not usable.');

  // Replace, not append: a re-run is a new reading of the same recording.
  await admin.from('job_proof_segments').delete().eq('proof_id', job.proofId);
  for (const window of result.windows) {
    await admin.from('job_proof_segments').insert({
      org_id: job.orgId,
      proof_id: job.proofId,
      idx: window.idx,
      start_seconds: window.startSeconds,
      end_seconds: window.endSeconds,
      frame_count: window.frameCount,
      reading: window.reading,
      model: config.technician.assistant.liveModel,
    });
  }

  const timeline = result.windows.map((window) => ({
    idx: window.idx,
    startSeconds: window.startSeconds,
    endSeconds: window.endSeconds,
    summary: window.reading ? window.reading.summary : 'This window could not be read.',
    scopeTouched: window.reading?.scopeTouched ?? [],
  }));

  const activities = [
    ...new Set(result.windows.flatMap((w) => w.reading?.activity ?? [])),
  ].slice(0, 12);

  const actions = actionsFromLongWindows(result.windows, { model: result.report.model });

  await write({
    ai_summary: result.report.narrative.slice(0, 500),
    ai_findings: {
      longForm: true,
      scopeCrossRef: true,
      summary: result.report.narrative,
      materialChange: null,
      materialBecause: null,
      changes: [],
      cannotTell: result.report.couldNotTell,
      scopeVerdicts: result.report.verdicts.map((v) => ({
        title: v.title,
        verdict: v.verdict,
        because: v.because,
        seenInWindows: v.seenInWindows,
      })),
      concerns: [],
      timeline,
      windowsTotal: result.windows.length,
      windowsRead: result.windows.filter((w) => w.reading).length,
      actions,
    },
    ai_model: result.report.model,
    analysis_status: 'done',
    narration: { entries: [], coverage: [], model: result.report.model },
    narration_text: result.report.narrative,
    narration_status: 'done',
    narration_error: null,
    narrated_at: new Date().toISOString(),
    labels: [job.phase, trade || null, 'workday', ...activities, ...actionLabels(actions)]
      .filter(Boolean)
      .slice(0, 24),
  });
  await finishProofActions(admin, job, actions, result.report.model);

  await recordAccess(admin, {
    orgId: job.orgId,
    jobId: job.jobId,
    proofId: job.proofId,
    action: 'analysed',
    actorLabel: 'Atmosphere',
    detail: `workday read · scope cross-ref · ${(durationSeconds / 3600).toFixed(1)}h · ${result.windows.length} windows · ${scopeTitles.length} scope lines`,
  });
}

const narrationQueue = new RetryQueue<NarrationJob>({
  run: async (job) => {
    const admin = createAdminClient();
    if (!admin) throw new Error('Storage is not configured.');
    await performNarration(admin, job);
  },
  onGaveUp: async (job, error) => {
    const admin = createAdminClient();
    if (!admin) return;
    await admin
      .from('job_proofs')
      .update({
        narration_status: 'failed',
        narration_error: error instanceof Error ? error.message : 'Narration failed.',
      })
      .eq('id', job.proofId);
  },
});

export async function queueNarration(admin: any, party: any, proofId: string, phase: string, workDate: string) {
  await admin.from('job_proofs').update({ narration_status: 'queued' }).eq('id', proofId);
  narrationQueue.enqueue({
    key: `narr:${proofId}`,
    proofId,
    orgId: party.org_id,
    jobId: party.job_id,
    partyId: party.id,
    phase,
    workDate,
  });
}

/**
 * POST /api/operations/shared/:jobId/live-observe
 *
 * The live half: one frame from a camera that is recording right now, answered
 * with which stage of the shot list is on screen. Stateless on purpose — the
 * caller carries its own history — so a dropped connection costs one frame,
 * not a session.
 */
const liveBudget = new DailyBudget(config.technician.assistant.liveDailyCapPerOrg);

export async function liveObserve(req: Request, res: Response, next: NextFunction) {
  try {
    const body = z
      .object({
        phase: z.enum(['before', 'after']).default('before'),
        frameBase64: z.string().min(100).max(2_000_000),
        lastStageIndex: z.number().int().min(-1).nullish(),
      })
      .parse(req.body);
    const { orgId, supabase } = await requireOrgContext(req);

    if (!isModelProviderConfigured()) {
      throw new HttpError(503, 'Live monitoring needs a configured model.', 'no_model');
    }

    // The cost fuse. Spent before the model call, because the point of a
    // ceiling is that nothing above it gets billed. The client shows
    // "monitoring unavailable" and the recording carries on untouched.
    const budget = liveBudget.spend(orgId);
    if (!budget.allowed) {
      throw new HttpError(
        429,
        "Today's live-monitoring allowance is used up. Filed videos still get their narrated reports; live commentary returns tomorrow.",
        'live_budget_exhausted',
      );
    }

    const { data: scope } = await supabase
      .from('job_scope_items')
      .select('title, state, reason, party_id, created_at')
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .order('created_at');
    const guide = buildCaptureGuide({
      phase: body.phase,
      scope: ((scope ?? []) as any[]).map((s) => ({
        title: s.title,
        state: s.state,
        reason: s.reason,
      })),
    });
    const steps = stepsForNarration(guide.steps);

    const observation = await observeLiveFrame({
      frameBase64: body.frameBase64,
      steps,
      lastStageIndex: body.lastStageIndex ?? null,
    });
    if (!observation) {
      throw new HttpError(502, 'The model reply was not usable.', 'observe_failed');
    }

    res.json({
      stageIndex: observation.stageIndex,
      stageLabel:
        observation.stageIndex >= 0 ? steps[observation.stageIndex].label : 'Could not tell',
      stageKind: observation.stageIndex >= 0 ? steps[observation.stageIndex].kind : null,
      note: observation.note,
      confidence: observation.confidence,
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/job-share/:token/proof — what this sub has filed. */
export async function listPartyProofs(party: any, admin: any) {
  const { data } = await admin
    .from('job_proofs')
    .select(PROOF_SELECT)
    .eq('party_id', party.id)
    .is('deleted_at', null)
    .order('work_date', { ascending: false })
    .limit(60);

  const rows = (data ?? []) as any[];
  const site = await siteLocation(admin, party.org_id, party.job_id);
  const byDate = new Map<string, any[]>();
  for (const row of rows) {
    const list = byDate.get(row.work_date) ?? [];
    list.push(row);
    byDate.set(row.work_date, list);
  }

  return {
    days: [...byDate.entries()].map(([workDate, list]) => {
      const before = list.find((r) => r.phase === 'before');
      const after = list.find((r) => r.phase === 'after');
      const verdict = verifyDay({
        workDate,
        before: before ? asUpload(before) : null,
        after: after ? asUpload(after) : null,
        site,
      });
      return {
        workDate,
        hasBefore: verdict.hasBefore,
        hasAfter: verdict.hasAfter,
        summary: verdict.summary,
        // The sub sees what failed, so they can refilm today rather than argue
        // in a fortnight.
        problems: verdict.checks.filter((c) => c.verdict === 'fail').map((c) => c.detail),
        accepted: list.every((r) => r.state === 'accepted'),
      };
    }),
  };
}

/** One video's narration, as the day view carries it. Null when no clip. */
function proofReport(row: any) {
  if (!row) return null;
  return {
    status: row.narration_status ?? null,
    text: row.narration_text ?? null,
    entries: row.narration?.entries ?? [],
    coverage: row.narration?.coverage ?? [],
    error: row.narration_error ?? null,
  };
}

/* ---- The general contractor's side --------------------------------------- */

/** Assemble proof-of-work days for one job — shared by org routes and progress shares. */
export async function buildJobProofPayload(supabase: any, orgId: string, jobId: string) {
  const [{ data: proofRows }, { data: partyRows }, site] = await Promise.all([
    supabase
      .from('job_proofs')
      .select(PROOF_SELECT)
      .eq('org_id', orgId)
      .eq('job_id', jobId)
      .is('deleted_at', null)
      .order('work_date', { ascending: false })
      .limit(200),
    supabase.from('job_parties').select('id, company, trade').eq('job_id', jobId),
    siteLocation(supabase, orgId, jobId),
  ]);

  const rows = (proofRows ?? []) as any[];
  const company = new Map(((partyRows ?? []) as any[]).map((p) => [p.id, p.company]));

  // Grouped by party and day, because a day is what gets paid.
  const grouped = new Map<string, any[]>();
  for (const row of rows) {
    const key = `${row.party_id}|${row.work_date}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  const days = [...grouped.entries()].map(([key, list]) => {
    const [partyId, workDate] = key.split('|');
    const before = list.find((r) => r.phase === 'before');
    const after = list.find((r) => r.phase === 'after');
    const verdict = verifyDay({
      workDate,
      before: before ? asUpload(before) : null,
      after: after ? asUpload(after) : null,
      site,
    });
    const pay = payable(verdict);
    const film = after ?? before;
    const aiSummary =
      (typeof film?.ai_summary === 'string' && film.ai_summary.trim()) ||
      (typeof after?.narration_text === 'string' && after.narration_text.trim()) ||
      (typeof before?.narration_text === 'string' && before.narration_text.trim()) ||
      null;

    return {
      partyId,
      company: company.get(partyId) ?? 'Company',
      workDate,
      hasBefore: verdict.hasBefore,
      hasAfter: verdict.hasAfter,
      checks: verdict.checks,
      contradicted: verdict.contradicted,
      summary: verdict.summary,
      payable: pay.ok,
      payableBecause: pay.because,
      accepted: list.every((r) => r.state === 'accepted'),
      rejected: list.some((r) => r.state === 'rejected'),
      aiSummary: aiSummary ? String(aiSummary).slice(0, 2000) : null,
      aiFindings: after?.ai_findings ?? before?.ai_findings ?? null,
      materialChange: after?.ai_material_change ?? before?.ai_material_change ?? null,
      analysisStatus: after?.analysis_status ?? before?.analysis_status ?? null,
      analysisError: after?.analysis_error ?? before?.analysis_error ?? null,
      reports: {
        before: proofReport(before),
        after: proofReport(after),
      },
      proofIds: list.map((r) => r.id),
    };
  });

  days.sort((a, b) => b.workDate.localeCompare(a.workDate));

  const videos = rows.map((row) => ({
    id: row.id,
    partyId: row.party_id,
    company: company.get(row.party_id) ?? 'Company',
    workDate: row.work_date,
    phase: row.phase,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    analysisStatus: row.analysis_status ?? null,
    narrationStatus: row.narration_status ?? null,
    transcriptStatus: row.transcript_status ?? null,
    transcriptError: row.transcript_error ?? null,
    aiSummary: row.ai_summary ?? row.narration_text ?? null,
    heardOnMic: typeof row.transcript_text === 'string' ? String(row.transcript_text).slice(0, 400) : null,
  }));

  return {
    days,
    videos,
    counts: {
      days: days.length,
      videos: videos.length,
      payable: days.filter((d) => d.payable && !d.accepted).length,
      contradicted: days.filter((d) => d.contradicted).length,
      analysing: days.filter(
        (d) => d.analysisStatus === 'queued' || d.analysisStatus === 'running',
      ).length,
      awaitingAfter: days.filter((d) => d.hasBefore && !d.hasAfter).length,
    },
    siteKnown: Boolean(site),
  };
}

/** GET /api/operations/shared/:jobId/proof */
export async function jobProofs(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    res.json(await buildJobProofPayload(supabase, orgId, req.params.jobId));
  } catch (err) {
    next(err);
  }
}

/** POST /api/operations/shared/:jobId/proof/:workDate/decide */
export async function decideProofDay(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = z
      .object({
        partyId: z.string().uuid(),
        decision: z.enum(['accepted', 'rejected']),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(req.body ?? {});

    const { error } = await supabase
      .from('job_proofs')
      .update({
        state: input.decision,
        decided_by: userId,
        decided_at: new Date().toISOString(),
        decided_note: input.note ?? null,
      })
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .eq('party_id', input.partyId)
      .eq('work_date', req.params.workDate);
    if (error) throw new HttpError(400, error.message, 'decide_failed');

    // Against the day rather than one file, because accepting a day is a
    // decision about the pair.
    const actor = await actorFor(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: req.params.jobId,
      action: input.decision,
      detail: `${req.params.workDate}${input.note ? ` — ${input.note}` : ''}`,
      ...actor,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/operations/shared/:jobId/proof/ask
 * Ask a question of the record.
 *
 * The answer is stored with the question and the days it was drawn from, so
 * "you told me the subfloor was done" is answerable six weeks later rather
 * than a matter of recollection.
 */
export async function askAboutProofs(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = z.object({ question: z.string().trim().min(3).max(1000) }).parse(req.body ?? {});

    const [{ data }, { data: partyRows }] = await Promise.all([
      supabase
        .from('job_proofs')
        .select('party_id, work_date, phase, ai_summary, ai_findings, narration_text, transcript_text')
        .eq('org_id', orgId)
        .eq('job_id', req.params.jobId)
        .is('deleted_at', null)
        .order('work_date', { ascending: false })
        .limit(80),
      supabase.from('job_parties').select('id, company').eq('job_id', req.params.jobId),
    ]);

    const company = new Map(((partyRows ?? []) as any[]).map((p) => [p.id, p.company]));
    const clips = collectionClipsFromRows(
      ((data ?? []) as any[]).map((row) => ({
        ...row,
        company: company.get(row.party_id) ?? null,
      })),
    );

    const result = await answerFromProofs({ question: input.question, clips });
    if (!result) {
      throw new HttpError(503, 'The assistant is not available right now.', 'model_unavailable');
    }

    const groundedOn = clips.map((clip) => `${clip.workDate}:${clip.phase ?? 'clip'}`);
    const { data: stored } = await supabase
      .from('job_proof_questions')
      .insert({
        org_id: orgId,
        job_id: req.params.jobId,
        question: input.question,
        answer: result.answer,
        model: result.model,
        grounded_on: groundedOn,
        asked_by: userId,
      })
      .select('id, question, answer, grounded_on, created_at')
      .single();

    res.status(201).json({ answer: result.answer, question: stored, groundedOn: groundedOn.length });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/proof/questions */
export async function proofQuestions(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data } = await supabase
      .from('job_proof_questions')
      .select('id, question, answer, grounded_on, created_at')
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .order('created_at', { ascending: false })
      .limit(30);
    res.json({ questions: data ?? [] });
  } catch (err) {
    next(err);
  }
}

/**
 * A short-lived link to actually watch a video.
 *
 * Signed rather than public: these are the insides of somebody's house.
 */
export async function proofVideoUrl(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const { data: proof } = await supabase
      .from('job_proofs')
      .select('storage_path, job_id, work_date, phase')
      .eq('org_id', orgId)
      .eq('id', req.params.proofId)
      .maybeSingle();
    if (!proof) throw new HttpError(404, 'No such video.', 'not_found');

    const admin = createAdminClient();
    if (!admin) throw new HttpError(503, 'Storage is not configured.', 'no_admin');

    const { data, error } = await admin.storage
      .from(PROOF_BUCKET)
      .createSignedUrl((proof as any).storage_path, 600);
    if (error) throw new HttpError(500, error.message, 'signed_url_failed');

    // Logged here rather than on playback: this is the moment the file becomes
    // watchable, and it is the only moment the server reliably hears about.
    // Somebody who fetched the link and closed the tab still had it.
    const actor = await actorFor(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: (proof as any).job_id,
      proofId: req.params.proofId,
      action: 'viewed',
      detail: `${(proof as any).phase} · ${(proof as any).work_date}`,
      ...actor,
    });

    res.json({ url: (data as any).signedUrl, expiresInSeconds: 600 });
  } catch (err) {
    next(err);
  }
}


/**
 * POST /api/operations/shared/:jobId/proof/:workDate/analyse
 * Read every video on that day again.
 *
 * Analysis normally runs the moment a file lands. This exists for the two
 * cases where that is not enough: the model was unavailable at the time, or
 * the scope has since changed and the old verdicts were written against a list
 * that no longer exists.
 */
export async function reanalyseProofDay(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const input = z.object({ partyId: z.string().uuid() }).parse(req.body ?? {});

    const { data: party } = await supabase
      .from('job_parties')
      .select('id, org_id, job_id, trade')
      .eq('org_id', orgId)
      .eq('id', input.partyId)
      .maybeSingle();
    if (!party) throw new HttpError(404, 'No such company on this job.', 'party_not_found');

    const admin = createAdminClient();
    if (!admin) throw new HttpError(503, 'Storage is not configured.', 'no_admin');

    const { data: filmRows } = await admin
      .from('job_proofs')
      .select('id, phase')
      .eq('party_id', input.partyId)
      .eq('work_date', req.params.workDate);
    const films = (filmRows ?? []) as any[];
    if (!films.length) {
      throw new HttpError(409, 'Nothing to analyse yet — no video has been filed.', 'no_film');
    }

    // Synchronous through the same choreography the queue uses — the button is
    // somebody standing at the screen waiting, and two implementations of one
    // attempt is how a status column starts lying. One attempt, no backoff: a
    // person retries by pressing again.
    let result: DayAnalysisResult | null = null;
    let lastId = films[0]!.id as string;
    for (const film of films) {
      const job: AnalysisJob = {
        key: film.id,
        orgId,
        jobId: (party as any).job_id,
        partyId: input.partyId,
        workDate: req.params.workDate,
        trade: (party as any).trade ?? null,
        proofId: film.id,
      };
      try {
        result = await performAnalysis(admin, job, 1);
        lastId = film.id;
      } catch (error) {
        await admin
          .from('job_proofs')
          .update({
            analysis_status: 'failed',
            analysis_error: error instanceof Error ? error.message : 'Analysis failed.',
          })
          .eq('id', job.proofId);
        throw new HttpError(
          502,
          'The assistant could not read this video. It is recorded as failed — try again in a minute.',
          'analysis_failed',
        );
      }
    }

    const { data: read } = await supabase
      .from('job_proofs')
      .select('ai_summary, ai_findings, ai_model, ai_material_change, analysis_status, analysis_error')
      .eq('org_id', orgId)
      .eq('id', lastId)
      .maybeSingle();

    res.json({
      outcome: result?.outcome ?? 'skipped',
      // Present when the run was skipped, so the button can say why rather
      // than appearing to do nothing.
      skippedBecause: result?.outcome === 'skipped' ? result.reason : null,
      summary: (read as any)?.ai_summary ?? null,
      materialChange: (read as any)?.ai_material_change ?? null,
      findings: (read as any)?.ai_findings ?? null,
      model: (read as any)?.ai_model ?? null,
    });
  } catch (err) {
    next(err);
  }
}

/* ---- Evidence: the list, the custody log, and holds ---------------------- */

/**
 * Write a line into the chain of custody.
 *
 * Never throws into the caller. An access that failed to log is bad; a video
 * that failed to play because logging the view fell over is worse, and the
 * second failure hides the first behind a support ticket about playback.
 */
export async function recordAccess(
  supabase: any,
  input: {
    orgId: string;
    jobId: string;
    proofId?: string | null;
    action: string;
    actorId?: string | null;
    partyId?: string | null;
    actorLabel: string;
    actorRole?: string | null;
    detail?: string | null;
  },
): Promise<void> {
  try {
    await supabase.from('job_evidence_access').insert({
      org_id: input.orgId,
      job_id: input.jobId,
      proof_id: input.proofId ?? null,
      action: input.action,
      actor_id: input.actorId ?? null,
      party_id: input.partyId ?? null,
      actor_label: input.actorLabel,
      actor_role: input.actorRole ?? null,
      detail: input.detail ?? null,
    });
  } catch {
    /* see above */
  }
}

/** Who is asking, in the words the log will keep forever. */
async function actorFor(supabase: any, userId: string) {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, email')
    .eq('id', userId)
    .maybeSingle();
  return {
    actorId: userId,
    actorLabel: (data as any)?.full_name ?? (data as any)?.email ?? 'Office',
    actorRole: 'general_contractor',
  };
}

/**
 * GET /api/operations/shared/:jobId/evidence
 * Every file on this job, as a list wants it.
 */
export async function jobEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('job_evidence_items')
      .select('*')
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .order('work_date', { ascending: false })
      .order('phase');
    if (error) throw new HttpError(500, error.message, 'evidence_failed');

    const rows = (data ?? []) as any[];
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        partyId: row.party_id,
        company: row.party_company,
        trade: row.party_trade,
        workDate: row.work_date,
        phase: row.phase,
        category: row.category,
        title: row.title,
        tags: row.tags ?? [],
        durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
        byteSize: row.byte_size === null ? null : Number(row.byte_size),
        capturedAt: row.captured_at,
        receivedAt: row.received_at,
        hasLocation: row.lat !== null && row.lon !== null,
        state: row.state,
        checks: row.checks ?? [],
        aiSummary: row.ai_summary,
        legalHold: row.legal_hold,
        retentionUntil: row.retention_until,
        // Shown truncated. The full digest is on the detail panel, because the
        // point of it there is that somebody can compare it to a file they
        // were sent.
        contentHash: row.content_hash,
        viewCount: Number(row.view_count ?? 0),
        lastViewedAt: row.last_viewed_at,
      })),
      counts: {
        items: rows.length,
        onHold: rows.filter((r) => r.legal_hold).length,
        neverViewed: rows.filter((r) => Number(r.view_count ?? 0) === 0).length,
      },
    });
  } catch (err) {
    next(err);
  }
}

/** GET /api/operations/shared/:jobId/evidence/:proofId/custody */
export async function evidenceCustody(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, supabase } = await requireOrgContext(req);
    const { data, error } = await supabase
      .from('job_evidence_access')
      .select('id, action, actor_label, actor_role, detail, occurred_at')
      .eq('org_id', orgId)
      .eq('proof_id', req.params.proofId)
      .order('occurred_at', { ascending: false })
      .limit(200);
    if (error) throw new HttpError(500, error.message, 'custody_failed');
    res.json({ entries: data ?? [] });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/operations/shared/:jobId/evidence/:proofId/hold
 * Put a file beyond the reach of retention, or let it go again.
 *
 * Both directions are logged, because "who released the hold on the file we
 * needed" is a question somebody eventually asks.
 */
export async function setEvidenceHold(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const input = z
      .object({ hold: z.boolean(), reason: z.string().trim().max(500).optional() })
      .parse(req.body ?? {});

    if (input.hold && !input.reason) {
      throw new HttpError(
        400,
        'Say why it is on hold. A hold nobody can explain is one somebody lifts.',
        'reason_required',
      );
    }

    const { error } = await supabase
      .from('job_proofs')
      .update({
        legal_hold: input.hold,
        hold_reason: input.hold ? (input.reason ?? null) : null,
      })
      .eq('org_id', orgId)
      .eq('id', req.params.proofId);
    if (error) throw new HttpError(400, error.message, 'hold_failed');

    const actor = await actorFor(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: req.params.jobId,
      proofId: req.params.proofId,
      action: input.hold ? 'held' : 'released',
      detail: input.reason ?? null,
      ...actor,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/operations/shared/:jobId/evidence/:proofId
 * Hide a clip from the customer library. The vault keeps the file.
 */
export async function deleteEvidence(req: Request, res: Response, next: NextFunction) {
  try {
    const { orgId, userId, supabase } = await requireOrgContext(req);
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('job_proofs')
      .update({ deleted_at: now, deleted_by: userId })
      .eq('org_id', orgId)
      .eq('job_id', req.params.jobId)
      .eq('id', req.params.proofId)
      .is('deleted_at', null)
      .select('id, storage_path, job_id')
      .maybeSingle();
    if (error) throw new HttpError(400, error.message, 'delete_failed');
    if (!data) throw new HttpError(404, 'Evidence not found', 'proof_not_found');

    await markSourceDeleted('job_proof', req.params.proofId);
    const actor = await actorFor(supabase, userId);
    await recordAccess(supabase, {
      orgId,
      jobId: req.params.jobId,
      proofId: req.params.proofId,
      action: 'deleted',
      detail: 'Customer deleted this clip from their library. The vault still holds it.',
      ...actor,
    });
    await recordUserAction({
      actorUserId: userId,
      actorLabel: actor.actorLabel,
      orgId,
      action: 'video.deleted',
      resourceType: 'proof',
      resourceId: req.params.proofId,
      detail: { jobId: req.params.jobId },
    });

    res.json({ ok: true, deletedAt: now });
  } catch (err) {
    next(err);
  }
}
