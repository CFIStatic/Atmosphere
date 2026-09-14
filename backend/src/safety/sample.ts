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
import { classifySafetySample } from './classify.js';
import { createSafetyIncident } from './incidents.js';
import { fanoutSafetyAlert } from './alerts.js';
import type { SafetyIncident, SafetySource } from './types.js';

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
  const input = safetySampleSchema.parse(body ?? {});
  const classification = await classifySafetySample({
    frames: input.frames,
    transcriptSnippet: input.transcriptSnippet,
    clipTimestampSeconds: input.clipTimestampSeconds ?? null,
    allowModel: input.allowModel,
  });

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
  const { incident, created, suppressedDuplicate } = await createSafetyIncident(admin, {
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
  if (created) {
    try {
      const fanout = await fanoutSafetyAlert(admin, incident);
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
  },
): Promise<SafetySampleResult> {
  return processSafetySample(
    admin,
    { org_id: input.orgId, job_id: input.jobId, id: input.partyId },
    {
      proofId: input.proofId,
      clipId: input.clipId ?? undefined,
      frames: input.frames?.slice(0, 3),
      transcriptSnippet: input.transcriptSnippet ?? undefined,
      lat: input.lat ?? undefined,
      lon: input.lon ?? undefined,
      locationLabel: input.locationLabel ?? undefined,
      source: input.source ?? 'post_upload',
      allowModel: input.allowModel,
      clipTimestampSeconds: input.frames?.[0]?.atSeconds,
    },
  );
}


/** proofRoute / fieldApp adapter: (party, admin, body). */
export async function processSafetySampleForParty(
  party: { org_id: string; job_id: string; id: string },
  admin: any,
  body: unknown,
): Promise<SafetySampleResult> {
  return processSafetySample(admin, party, body);
}
