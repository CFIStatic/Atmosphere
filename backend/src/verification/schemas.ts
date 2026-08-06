/**
 * Zod schemas for the verification pipeline.
 *
 * Model output must pass these before anything is stored as an observation.
 * Never trust unvalidated model JSON.
 */

import { z } from 'zod';
import {
  ALLOWED_VIDEO_MIME_TYPES,
  ROOM_TYPES,
  VERIFICATION_STATUSES,
  VIDEO_STATUSES,
  WORK_ACTIVITIES,
} from './types.js';

export const deviceMetadataSchema = z
  .object({
    make: z.string().max(80).optional(),
    model: z.string().max(80).optional(),
    os: z.string().max(80).optional(),
    appVersion: z.string().max(40).optional(),
  })
  .passthrough()
  .default({});

export const createVideoUploadSchema = z.object({
  jobId: z.string().uuid(),
  partyId: z.string().uuid().optional().nullable(),
  proofId: z.string().uuid().optional().nullable(),
  fileName: z
    .string()
    .min(1)
    .max(260)
    .regex(/^[^\\/]+$/, 'File name must not contain path separators'),
  fileSize: z.number().int().positive().max(2_000_000_000).optional().nullable(),
  mimeType: z.enum(ALLOWED_VIDEO_MIME_TYPES).default('video/mp4'),
  durationSeconds: z.number().nonnegative().max(4 * 60 * 60).optional().nullable(),
  captureDate: z.string().datetime().optional().nullable(),
  deviceMetadata: deviceMetadataSchema.optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i, 'contentHash must be SHA-256 hex')
    .optional()
    .nullable(),
});

export const completeVideoUploadSchema = z.object({
  storagePath: z.string().min(1).max(1000),
  fileSize: z.number().int().positive().optional().nullable(),
  durationSeconds: z.number().nonnegative().optional().nullable(),
  contentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/i)
    .optional()
    .nullable(),
  enqueue: z.boolean().default(true),
});

export const evidenceRegionSchema = z.object({
  label: z.string().max(120).optional(),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});

/** Structured output required from the primary vision model. */
export const frameObservationSchema = z.object({
  room_type: z.enum(ROOM_TYPES).or(z.string().min(1).max(80)),
  observed_conditions: z.array(z.string().max(120)).default([]),
  damage_types: z.array(z.string().max(120)).default([]),
  work_activities: z.array(z.string().max(120)).default([]),
  materials_present: z.array(z.string().max(120)).default([]),
  equipment_present: z.array(z.string().max(120)).default([]),
  completion_indicators: z.array(z.string().max(120)).default([]),
  safety_issues: z.array(z.string().max(120)).default([]),
  visible_text: z.array(z.string().max(200)).default([]),
  uncertainty_reasons: z.array(z.string().max(200)).default([]),
  confidence: z.number().min(0).max(1),
  evidence_regions: z.array(evidenceRegionSchema).default([]),
  model_name: z.string().min(1).max(120).optional(),
  model_version: z.string().max(80).optional().nullable(),
});

export type FrameObservationParsed = z.output<typeof frameObservationSchema>;

export const sequenceAnalysisSchema = z.object({
  room_type: z.enum(ROOM_TYPES).or(z.string().min(1).max(80)),
  progression_summary: z.string().max(2000),
  observed_activities: z.array(z.string().max(120)).default([]),
  before_state: z.string().max(500).optional().nullable(),
  after_state: z.string().max(500).optional().nullable(),
  confidence: z.number().min(0).max(1),
  uncertainty_reasons: z.array(z.string().max(200)).default([]),
});

export const frameComparisonSchema = z.object({
  same_area: z.boolean(),
  before_state: z.string().max(500),
  after_state: z.string().max(500),
  inferred_activity: z.string().max(120).nullable(),
  evidence: z.array(z.string().max(300)).default([]),
  conflicting_evidence: z.array(z.string().max(300)).default([]),
  confidence: z.number().min(0).max(1),
  uncertainty_reasons: z.array(z.string().max(200)).default([]),
});

export const humanReviewDecisionSchema = z.object({
  decision: z.enum([
    'approve',
    'reject',
    'edit_activity',
    'adjust_room',
    'add_evidence',
    'request_reanalysis',
    'comment',
  ]),
  editedActivity: z.string().max(120).optional().nullable(),
  adjustedRoom: z.string().max(120).optional().nullable(),
  additionalFrameIds: z.array(z.string().uuid()).default([]),
  comment: z.string().max(4000).optional().nullable(),
  reason: z.string().max(1000).optional().nullable(),
  finalStatus: z.enum(VERIFICATION_STATUSES).optional().nullable(),
});

export const linkOutcomeSchema = z.object({
  timelineEventId: z.string().uuid().optional().nullable(),
  resultId: z.string().uuid().optional().nullable(),
  outcomeType: z.enum([
    'estimate_line',
    'invoice_line',
    'claim_approval',
    'claim_denial',
    'payment',
    'supplement',
    'customer_complaint',
    'warranty_issue',
    'rework',
    'callback',
    'inspection_result',
    'project_completion',
    'schedule_performance',
    'gross_margin',
    'insurer_decision',
    'lender_decision',
  ]),
  externalRef: z.string().max(200).optional().nullable(),
  amountCents: z.number().int().optional().nullable(),
  occurredAt: z.string().datetime().optional().nullable(),
  payload: z.record(z.unknown()).optional(),
});

export const roomCorrectionSchema = z.object({
  roomType: z.enum(ROOM_TYPES).or(z.string().min(1).max(80)),
  label: z.string().max(120).optional().nullable(),
  locationId: z.string().uuid().optional().nullable(),
});

export const videoStatusSchema = z.enum(VIDEO_STATUSES);
export const workActivitySchema = z.enum(WORK_ACTIVITIES);

/** Strip markdown fences and parse JSON, then validate. */
export function parseModelJson<S extends z.ZodTypeAny>(text: string, schema: S): z.output<S> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error('Model response was not valid JSON');
  }
  return schema.parse(parsed) as z.output<S>;
}
