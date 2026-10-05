/**
 * Canonical buckets for customer-facing token metering.
 *
 * Video analysis, chat, and Ask are the three product surfaces that spend
 * tokens. Computer (Chat's browser agent: its tokens plus hosted-browser
 * minutes) is its own line. Web search (Tavily credits, Gemini grounded search) is its own line
 * so search spend is visible on Billing, the allowance and Analytics.
 * Everything else (PM drafts, financial briefs, …) still counts, but lands in
 * `other` so the billing graph stays readable.
 */

export const TOKEN_FEATURES = ['video_analysis', 'chat', 'ask', 'web_search', 'computer', 'other'] as const;
export type TokenFeature = (typeof TOKEN_FEATURES)[number];

export const TOKEN_FEATURE_LABELS: Record<TokenFeature, string> = {
  video_analysis: 'Video analysis',
  chat: 'Chat',
  ask: 'Ask',
  web_search: 'Web search',
  computer: 'Computer',
  other: 'Other',
};

// Chat's browser agent: model tokens (computer_agent) and hosted-browser
// minutes (computer_session). Checked before the video regex.
const COMPUTER = new Set(['computer', 'computer_use', 'computer_agent', 'computer_session', 'computer_browser']);

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

// Research is an Ask mode (multi-step answer); it bills as Ask.
const ASK = new Set(['ask', 'clip_ask', 'proof_ask', 'job_ask', 'job-ask', 'clip-ask', 'proof-ask', 'research']);

const WEB_SEARCH = new Set(['web_search', 'web-search', 'tavily', 'tavily_search', 'gemini_search']);

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
  if (COMPUTER.has(raw) || /^computer([_-]|$)/.test(raw)) return 'computer';
  if (WEB_SEARCH.has(raw)) return 'web_search';
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
