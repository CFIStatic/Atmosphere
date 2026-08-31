/**
 * Canonical buckets for customer-facing token metering.
 *
 * Video analysis, chat, and Ask are the three product surfaces that spend
 * tokens. Everything else (PM drafts, financial briefs, …) still counts, but
 * lands in `other` so the billing graph stays readable.
 */

export const TOKEN_FEATURES = ['video_analysis', 'chat', 'ask', 'other'] as const;
export type TokenFeature = (typeof TOKEN_FEATURES)[number];

export const TOKEN_FEATURE_LABELS: Record<TokenFeature, string> = {
  video_analysis: 'Video analysis',
  chat: 'Chat',
  ask: 'Ask',
  other: 'Other',
};

const VIDEO = new Set([
  'video_analysis',
  'verification',
  'llm_verifier',
  'vision',
  'analyzer',
  'proof_analysis',
  'frame_analysis',
  'video',
  'vision_analyzer',
  'work_event_verification',
  'escalation',
  'clip_analysis',
]);

const ASK = new Set(['ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask']);

const CHAT = new Set([
  'chat',
  'model_completion',
  'field_assistant',
  'technician',
  'voice',
  'assist',
  'field-assistant',
  'technician_assist',
  'field_assist',
]);

/**
 * Map a free-form feature / action string onto a billing bucket.
 * Kept in lockstep with `public.classify_token_feature` in SQL.
 */
export function classifyTokenFeature(feature: string | null | undefined): TokenFeature {
  const raw = (feature ?? '').trim().toLowerCase();
  if (!raw) return 'other';
  if (VIDEO.has(raw) || /(^|[_-])(video|verif|analys|vision|frame)([_-]|$)/.test(raw)) {
    return 'video_analysis';
  }
  if (ASK.has(raw) || /(^|[_-])ask([_-]|$)/.test(raw)) return 'ask';
  if (CHAT.has(raw) || /(chat|assist|voice|completion)/.test(raw)) return 'chat';
  return 'other';
}

export function isTokenFeature(value: string): value is TokenFeature {
  return (TOKEN_FEATURES as readonly string[]).includes(value);
}
