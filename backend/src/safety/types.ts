/**
 * Field Capture safety incident vocabulary.
 *
 * High-precision bias: prefer a miss over a false alarm that pages the
 * office. Severity splits "keep an eye on" (watch) from "act now" (critical).
 * Authorities escalation is a recommendedAction + org policy flag only —
 * Atmosphere never dials 911.
 */

export const SAFETY_CATEGORIES = [
  'fall_person_down',
  'physical_violence',
  'verbal_threat',
  'medical_distress',
  'other_emergency',
  'silent_panic_wellness',
] as const;
export type SafetyCategory = (typeof SAFETY_CATEGORIES)[number];

export const SAFETY_SEVERITIES = ['watch', 'critical'] as const;
export type SafetySeverity = (typeof SAFETY_SEVERITIES)[number];

export const SAFETY_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type SafetyStatus = (typeof SAFETY_STATUSES)[number];

export const SAFETY_RECOMMENDED_ACTIONS = [
  'monitor',
  'dispatch_help',
  'contact_authorities',
] as const;
export type SafetyRecommendedAction = (typeof SAFETY_RECOMMENDED_ACTIONS)[number];

export const SAFETY_SOURCES = [
  'live_sample',
  'upload_chunk',
  'post_upload',
  'transcript',
  'wellness_heartbeat',
  'live_stream',
] as const;
export type SafetySource = (typeof SAFETY_SOURCES)[number];

/**
 * Is what was seen / heard actually happening? A word list or a fast frame
 * screen only flags a candidate; the confirmation model answers this.
 */
export const SAFETY_REALITIES = ['real', 'joking', 'staged', 'media_playback', 'unclear'] as const;
export type SafetyReality = (typeof SAFETY_REALITIES)[number];

/** confirmed = real above threshold; unconfirmed = high-severity unclear. */
export type SafetyConfirmation = 'confirmed' | 'unconfirmed';

/** Why the office dismissed an alert (required in Platform). */
export const SAFETY_DISMISS_CATEGORIES = [
  'false_alarm_media',
  'joking',
  'staged',
  'not_an_emergency',
  'handled',
  'duplicate',
  'other',
] as const;
export type SafetyDismissCategory = (typeof SAFETY_DISMISS_CATEGORIES)[number];

export type SafetyFrame = {
  atSeconds: number;
  /** Base64 JPEG (no data: prefix). Keep small — live samples are sparse. */
  base64: string;
};

export type SafetyClassification = {
  hit: boolean;
  category: SafetyCategory | null;
  severity: SafetySeverity | null;
  confidence: number;
  title: string | null;
  description: string | null;
  recommendedAction: SafetyRecommendedAction;
  clipTimestampSeconds: number | null;
  model: string | null;
  signals: Record<string, unknown>;
  /** Model verdict on whether it is really happening (null = not checked). */
  reality?: SafetyReality | null;
  confirmation?: SafetyConfirmation | null;
};

export type SafetyIncident = {
  id: string;
  orgId: string;
  jobId: string | null;
  partyId: string | null;
  proofId: string | null;
  clipId: string | null;
  category: SafetyCategory;
  severity: SafetySeverity;
  confidence: number;
  title: string;
  description: string;
  clipTimestampSeconds: number | null;
  lat: number | null;
  lon: number | null;
  locationLabel: string | null;
  recommendedAction: SafetyRecommendedAction;
  status: SafetyStatus;
  source: SafetySource;
  model: string | null;
  signals: Record<string, unknown>;
  alertSentAt: string | null;
  alertChannels: string[];
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  dismissReason: string | null;
  dismissCategory: SafetyDismissCategory | null;
  reality: SafetyReality | null;
  confirmation: SafetyConfirmation | null;
  workerOkAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrgSafetySettings = {
  orgId: string;
  autoEscalateToAuthorities: boolean;
  alertWebhookUrl: string | null;
  alertEmails: string[];
  /** Silent panic / wellness check (no auto-911). */
  wellnessCheckEnabled: boolean;
  /** Seconds of no significant motion before a watch nudge. */
  wellnessNoMotionSeconds: number;
  /** Seconds of no motion before critical (still office-only). */
  wellnessCriticalAfterSeconds: number;
  /** When true, require alone_on_site before alerting. */
  wellnessRequireAlone: boolean;
  /** Critical live safety while recording. Default ON; org may opt out. */
  liveSafetyEnabled: boolean;
  /** E.164 numbers for SMS / voice escalation (ladder order). */
  alertPhones: string[];
  /** Unacknowledged seconds before the next SMS / voice step. */
  escalateAfterSeconds: number;
};

/** Minimum confidence to open an incident (high precision bias). */
export const SAFETY_MIN_CONFIDENCE_WATCH = 0.72;
export const SAFETY_MIN_CONFIDENCE_CRITICAL = 0.85;

/** Confirmation (Opus) thresholds: alert only on "real" at or above these. */
export const SAFETY_CONFIRM_MIN_REAL_CRITICAL = 0.8;
export const SAFETY_CONFIRM_MIN_REAL_WATCH = 0.72;

/** At most this many pages (email / SMS) per job per rolling hour. */
export const SAFETY_ALERT_CAP_PER_JOB_HOUR = 6;

/** Do not re-alert the same job+category within this window. */
export const SAFETY_ALERT_RATE_LIMIT_MS = 10 * 60 * 1000;

/** Default wellness thresholds (seconds). Org settings may override. */
export const WELLNESS_DEFAULT_NO_MOTION_SECONDS = 300;
export const WELLNESS_DEFAULT_CRITICAL_AFTER_SECONDS = 600;
/** Motion score at or above this resets the no-motion clock. */
export const WELLNESS_MOTION_SCORE_THRESHOLD = 0.04;
