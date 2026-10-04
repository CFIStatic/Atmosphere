/**
 * Near-real-time safety sample path.
 *
 * Field Capture streams upload parts while the camera runs. Between parts
 * (or on a timer) the client POSTs sparse JPEG frames + optional transcript
 * snippet here. We classify → persist incident → fan out alerts.
 *
 * True WebRTC live analysis is not wired yet — see TODO below.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { runWithAiUsageScope } from '../metering/aiUsageContext.js';
import { VIDEO_ANALYSIS_FEATURE } from '../metering/backgroundUsage.js';
import { assertOrgProductActionsAllowed } from '../lib/paidWorkspace.js';
import { classifySafetySample } from './classify.js';
import { createSafetyIncident } from './incidents.js';
import { fanoutSafetyAlert } from './alerts.js';
import type { SafetyIncident, SafetySource } from './types.js';
import type { SafetyMediaContext } from './confirm.js';

// TODO(true-live): WebRTC / MediaStream track sampling for sub-second
// detection. Today FC uploads chunks while recording; this sample endpoint
// is the near-real-time path (seconds after a segment / frame sample).

export const safetySampleSchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  phase: z.enum(['before', 'after']).optional(),
  clipId: z.string().regex(/^[a-zA-Z0-9_-]{6,64}$/).optional(),
  proofId: z.string().uuid().optional(),
  clipTimestampSeconds: z.number().min(0).max(86_400).optional(),
  transcriptSnippet: z.string().max(2000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationLabel: z.string().max(400).optional(),
  source: z.enum(['live_sample', 'upload_chunk', 'post_upload', 'transcript']).default('live_sample'),
  frames: z
    .array(
      z.object({
        atSeconds: z.number().min(0).max(86_400),
        base64: z.string().min(80).max(350_000),
      }),
    )
    .max(3)
    .optional(),
  allowModel: z.boolean().optional(),
});

export type SafetySampleResult = {
  hit: boolean;
  incident: SafetyIncident | null;
  created: boolean;
  suppressedDuplicate: boolean;
  channels: string[];
  classification: Awaited<ReturnType<typeof classifySafetySample>>;
};

export async function processSafetySample(
  admin: any,
  party: { org_id: string; job_id: string; id: string },
  body: unknown,
): Promise<SafetySampleResult> {
  await assertOrgProductActionsAllowed(admin, party.org_id);
  const input = safetySampleSchema.parse(body ?? {});
  return processSafetyInput(admin, party, input);
}

/**
 * Server-side entry: may carry more frames (confirmation takes up to 8) and a
 * media context built from our own analysis — never from the client body.
 */
async function processSafetyInput(
  admin: any,
  party: { org_id: string; job_id: string; id: string },
  input: z.infer<typeof safetySampleSchema> & {
    serverFrames?: Array<{ atSeconds: number; base64: string }>;
    mediaContext?: SafetyMediaContext;
  },
): Promise<SafetySampleResult> {
  // The frame check is a vision call on this job's footage: video analysis.
  const classification = await runWithAiUsageScope(
    {
      client: admin,
      orgId: party.org_id,
      jobId: party.job_id,
      requestId: `safety:${party.id}:${randomUUID()}`,
      meterFeature: VIDEO_ANALYSIS_FEATURE,
    },
    () =>
      classifySafetySample({
        frames: input.serverFrames ?? input.frames,
        transcriptSnippet: input.transcriptSnippet,
        clipTimestampSeconds: input.clipTimestampSeconds ?? null,
        allowModel: input.allowModel,
        mediaContext: input.mediaContext,
      }),
  );

  if (!classification.hit) {
    return {
      hit: false,
      incident: null,
      created: false,
      suppressedDuplicate: false,
      channels: [],
      classification,
    };
  }

  const source = input.source as SafetySource;
  const { incident, created, suppressedDuplicate, upgraded } = await createSafetyIncident(admin, {
    orgId: party.org_id,
    jobId: party.job_id,
    partyId: party.id,
    proofId: input.proofId ?? null,
    clipId: input.clipId ?? null,
    classification,
    source,
    lat: input.lat ?? null,
    lon: input.lon ?? null,
    locationLabel: input.locationLabel ?? null,
  });

  let channels: string[] = [];
  if (created || upgraded) {
    try {
      const fanout = await fanoutSafetyAlert(admin, incident, { upgraded: Boolean(upgraded) });
      channels = fanout.channels;
    } catch (err) {
      console.warn('[safety] fanout failed:', err instanceof Error ? err.message : err);
    }
  }

  return {
    hit: true,
    incident,
    created,
    suppressedDuplicate,
    channels,
    classification,
  };
}

/**
 * Post-upload / transcript hook: classify stored frames or a transcript
 * segment for a filed proof. Fire-and-forget safe.
 */
export async function runSafetyScanForProof(
  admin: any,
  input: {
    orgId: string;
    jobId: string;
    partyId: string;
    proofId: string;
    clipId?: string | null;
    frames?: Array<{ atSeconds: number; base64: string }>;
    transcriptSnippet?: string | null;
    lat?: number | null;
    lon?: number | null;
    locationLabel?: string | null;
    source?: SafetySource;
    allowModel?: boolean;
    clipTimestampSeconds?: number | null;
    mediaContext?: SafetyMediaContext;
  },
): Promise<SafetySampleResult> {
  const party = { org_id: input.orgId, job_id: input.jobId, id: input.partyId };
  await assertOrgProductActionsAllowed(admin, party.org_id);
  const parsed = safetySampleSchema.parse({
    proofId: input.proofId,
    clipId: input.clipId ?? undefined,
    transcriptSnippet: input.transcriptSnippet ? input.transcriptSnippet.slice(0, 2000) : undefined,
    lat: input.lat ?? undefined,
    lon: input.lon ?? undefined,
    locationLabel: input.locationLabel ?? undefined,
    source: input.source ?? 'post_upload',
    allowModel: input.allowModel,
    clipTimestampSeconds: input.clipTimestampSeconds ?? input.frames?.[0]?.atSeconds,
  });
  return processSafetyInput(admin, party, {
    ...parsed,
    // The confirmation stage takes up to 8 frames; the full window text.
    serverFrames: input.frames?.slice(0, 8),
    transcriptSnippet: input.transcriptSnippet ?? undefined,
    mediaContext: input.mediaContext,
  });
}

/**
 * Whole-transcript scan after Whisper finishes. The word list runs over the
 * FULL transcript in ±30 s windows (it used to read only the first 2,000
 * characters); each candidate window is confirmed by the model with stills
 * near that moment and the clip's media-window tagging (a TV / monitor /
 * podcast playing). Words alone never page anyone.
 */
export async function runTranscriptSafetyScan(
  admin: any,
  input: {
    orgId: string;
    jobId: string;
    partyId: string;
    proofId: string;
    clipId?: string | null;
    transcriptText: string;
    segments?: Array<{ start: number; end: number; text: string }> | null;
    lat?: number | null;
    lon?: number | null;
  },
): Promise<SafetySampleResult[]> {
  const { transcriptCandidateWindows } = await import('./classify.js');
  const windows = transcriptCandidateWindows({ segments: input.segments, text: input.transcriptText, maxWindows: 4 });
  if (!windows.length) return [];
  const { proofMediaContext, loadProofFramesNear } = await import('./proofContext.js');
  const media = await proofMediaContext(admin, input.proofId, input.transcriptText);
  const results: SafetySampleResult[] = [];
  for (const window of windows) {
    const frames = await loadProofFramesNear(admin, input.proofId, window.atSeconds, 6);
    results.push(
      await runSafetyScanForProof(admin, {
        orgId: input.orgId,
        jobId: input.jobId,
        partyId: input.partyId,
        proofId: input.proofId,
        clipId: input.clipId ?? null,
        frames,
        transcriptSnippet: window.text,
        clipTimestampSeconds: window.atSeconds,
        lat: input.lat ?? null,
        lon: input.lon ?? null,
        source: 'transcript',
        mediaContext: media,
      }),
    );
  }
  return results;
}


/** proofRoute / fieldApp adapter: (party, admin, body). */
export async function processSafetySampleForParty(
  party: { org_id: string; job_id: string; id: string },
  admin: any,
  body: unknown,
): Promise<SafetySampleResult> {
  return processSafetySample(admin, party, body);
}
