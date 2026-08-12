/**
 * Shared types for the video work-verification pipeline.
 *
 * These mirror the Postgres enums/tables added in
 * `20260812090001_video_work_verification.sql`. Keep them in sync with Zod
 * schemas in `./schemas.ts` — runtime validation is the trust boundary for
 * model output and API input.
 */

export const VIDEO_STATUSES = [
  'uploaded',
  'queued',
  'processing',
  'completed',
  'failed',
  'needs_review',
  'cancelled',
] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

export const PROCESSING_STAGES = [
  'validate_video',
  'extract_metadata',
  'transcode_video',
  'extract_frames',
  'score_frame_quality',
  'deduplicate_frames',
  'classify_scenes',
  'analyze_frames',
  'compare_timeline',
  'llm_verify_evidence',
  'generate_verifications',
  'generate_verified_events',
  'update_project_graph',
  'calculate_confidence',
  'privacy_scan',
  'evaluate_dataset_eligibility',
  'create_dataset_examples',
  'finalize_report',
] as const;
export type ProcessingStage = (typeof PROCESSING_STAGES)[number];

export const STEP_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
  'cancelled',
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const VERIFICATION_STATUSES = [
  'verified',
  'likely_verified',
  'partially_verified',
  'uncertain',
  'contradicted',
  'rejected',
  'human_verified',
  'needs_review',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

export const ROOM_TYPES = [
  'kitchen',
  'bathroom',
  'bedroom',
  'hallway',
  'basement',
  'exterior',
  'mechanical_room',
  'living_room',
  'garage',
  'attic',
  'laundry',
  'unidentified',
] as const;
export type RoomType = (typeof ROOM_TYPES)[number];

/** Canonical work activities the rules engine understands. */
export const WORK_ACTIVITIES = [
  'drywall_removed',
  'insulation_removed',
  'framing_exposed',
  'drying_equipment_installed',
  'dehumidifier_operating',
  'air_mover_present',
  'containment_installed',
  'flooring_removed',
  'subfloor_exposed',
  'drywall_installed',
  'drywall_finished',
  'primer_applied',
  'painting_completed',
  'flooring_installed',
  'cabinets_installed',
  'debris_removed',
  'final_cleaning_completed',
  'insulation_installed',
] as const;
export type WorkActivity = (typeof WORK_ACTIVITIES)[number];

export const ALLOWED_VIDEO_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-msvideo',
] as const;
export type VideoMimeType = (typeof ALLOWED_VIDEO_MIME_TYPES)[number];

export interface DeviceMetadata {
  make?: string;
  model?: string;
  os?: string;
  appVersion?: string;
  [key: string]: unknown;
}

export interface VerificationVideoRecord {
  id: string;
  orgId: string;
  jobId: string;
  proofId: string | null;
  partyId: string | null;
  uploaderId: string | null;
  fileName: string;
  fileSize: number | null;
  mimeType: VideoMimeType;
  durationSeconds: number | null;
  captureDate: string | null;
  uploadDate: string;
  deviceMetadata: DeviceMetadata;
  latitude: number | null;
  longitude: number | null;
  storagePath: string;
  contentHash: string | null;
  thumbnailPath: string | null;
  status: VideoStatus;
  statusDetail: string | null;
  processingError: string | null;
}

export interface FrameQualityScores {
  qualityScore: number;
  blurScore: number;
  brightnessScore: number;
  motionScore: number;
}

export interface ConfidenceBreakdown {
  modelConfidence: number;
  supportingFrameCount: number;
  visualQuality: number;
  temporalConsistency: number;
  sceneMatchConfidence: number;
  modelAgreement: number;
  rulesEngineScore: number;
  contradictionPenalty: number;
  metadataQuality: number;
  humanConfirmation: number;
  final: number;
}

export interface TimelineEvent {
  id: string;
  observedAt: string | null;
  roomOrArea: string | null;
  title: string;
  activityType: string;
  status: VerificationStatus;
  systemConfidence: number | null;
  modelConfidence: number | null;
  summary: string | null;
  /** Source verification video, when known. */
  videoId?: string | null;
  /** Linked job_proofs row, when the video was filed from Field Capture. */
  proofId?: string | null;
  evidenceFrameIds: string[];
  videoTimestamps: number[];
  reviewStatus: string | null;
}
