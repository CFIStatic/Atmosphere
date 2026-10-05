/**
 * Quiet per-user Chat communication-style profile.
 *
 * After each Ask turn we observe the person's message (and a light reaction
 * signal from how they follow up) and update a small trait vector with
 * confidence and time decay. A compact summary is injected into the Chat
 * system prompt so tone, length and format adapt. It never overrides quote
 * grounding, speaker attribution, or job-evidence rules, and never changes
 * facts. Sensitive traits are never inferred or stored.
 *
 * Inference is heuristic and cheap (no extra model call on the hot path).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export const STYLE_PROMPT_CAP = 800;
export const STYLE_DECAY_HALF_LIFE_DAYS = 45;
/** Minimum confidence before a trait influences the prompt summary. */
export const STYLE_PROMPT_MIN_CONFIDENCE = 0.25;
/** How much one turn moves a trait toward the observation (0–1). */
const OBSERVE_BLEND = 0.28;
const CONFIDENCE_GAIN = 0.12;
const MAX_COMMON_TASKS = 8;
const MAX_TRADE_KEYS = 12;

/** Traits we never store or mention — refuse any accidental write. */
const FORBIDDEN_TRAIT_KEYS = new Set([
  'health',
  'mental_health',
  'diagnosis',
  'religion',
  'politics',
  'sexuality',
  'ethnicity',
  'race',
  'finance',
  'finances',
  'income',
  'personality_disorder',
  'disability',
  'age',
  'gender',
  'nationality',
]);

export type StyleTraitScore = {
  /** 0–1 meaning depends on the trait (see TraitMap). */
  value: number;
  confidence: number;
  updatedAt: string;
};

export type StyleTraits = {
  /** 0 = wants detail, 1 = terse. */
  brevity?: StyleTraitScore;
  /** 0 = prose, 1 = bullets / lists. */
  format?: StyleTraitScore;
  /** 0 = casual, 1 = formal. */
  formality?: StyleTraitScore;
  /** 0 = plain language, 1 = technical / trade-heavy. */
  technicalLevel?: StyleTraitScore;
  /** 0 = wants evidence / quotes, 1 = quick bottom line. */
  decisionStyle?: StyleTraitScore;
  /** 0 = calm, 1 = frustrated / wants shorter more direct answers. */
  frustration?: StyleTraitScore;
  tradeVocab?: Record<string, number>;
  commonTasks?: string[];
  /** Hour-of-day counts (local), length 24. */
  hourHistogram?: number[];
  preferredChannels?: Record<string, number>;
};

export type CommunicationStyleRow = {
  userId: string;
  traits: StyleTraits;
  promptSummary: string;
  sampleCount: number;
  lastSignalAt: string | null;
  updatedAt: string | null;
};

export type StyleObservation = {
  question: string;
  /** Prior user question in the same thread, if any (for rephrase / "no" signals). */
  previousQuestion?: string | null;
  /** When the message was sent (ISO). Defaults to now. */
  at?: string | null;
  /** IANA zone for hour-of-day; defaults to America/Chicago. */
  timeZone?: string | null;
  channel?: 'chat' | 'progress_share';
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function daysBetween(aIso: string, bIso: string): number {
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.abs(b - a) / (1000 * 60 * 60 * 24);
}

/** Exponential decay of confidence toward 0. */
export function decayConfidence(confidence: number, daysSince: number, halfLifeDays = STYLE_DECAY_HALF_LIFE_DAYS): number {
  const c = clamp01(confidence);
  if (daysSince <= 0) return c;
  const half = Math.max(1, halfLifeDays);
  return clamp01(c * 2 ** (-daysSince / half));
}

function blendTrait(
  prior: StyleTraitScore | undefined,
  observed: number,
  nowIso: string,
  weight = OBSERVE_BLEND,
): StyleTraitScore {
  const days = prior?.updatedAt ? daysBetween(prior.updatedAt, nowIso) : 0;
  const priorConf = prior ? decayConfidence(prior.confidence, days) : 0;
  const priorVal = prior ? clamp01(prior.value) : clamp01(observed);
  const w = clamp01(weight);
  const value = clamp01(priorVal * (1 - w) + clamp01(observed) * w);
  const confidence = clamp01(priorConf + CONFIDENCE_GAIN * (0.5 + w));
  return { value, confidence, updatedAt: nowIso };
}

const TRADE_LEXICON: Array<{ key: string; re: RegExp }> = [
  { key: 'roofing', re: /\b(roof|roofer|shingle|underlayment|ridge|valley|flashing|drip\s*edge|ice\s*&\s*water|tpo|epdm)\b/i },
  { key: 'restoration', re: /\b(restor(?:e|ation)|mitigation|water\s*damage|mold|dry[- ]?out|contents|pack[- ]?out)\b/i },
  { key: 'insurance', re: /\b(claim|carrier|adjuster|policy|deductible|coverage|xactimate|symbility|supplement)\b/i },
  { key: 'hvac', re: /\b(hvac|furnace|condenser|duct|thermostat|refrigerant)\b/i },
  { key: 'electrical', re: /\b(electrical|breaker|panel|conduit|gfci|wiring)\b/i },
  { key: 'plumbing', re: /\b(plumb(?:ing|er)|pipe|drain|water\s*heater|pex|copper)\b/i },
  { key: 'framing', re: /\b(fram(?:e|ing)|stud|joist|truss|sheathing)\b/i },
  { key: 'permits', re: /\b(permit|inspection|code\s*enforcement|coa)\b/i },
];

const TASK_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'status updates', re: /\b(status|where are we|progress|update me|how's it)\b/i },
  { label: 'punch lists', re: /\b(punch|open items?|to-?dos?|next steps?)\b/i },
  { label: 'quotes and evidence', re: /\b(quote|who said|timestamp|show me|evidence|transcript)\b/i },
  { label: 'drafts', re: /\b(draft|write|compose|email|message to|letter)\b/i },
  { label: 'field invites', re: /\b(invite|field capture|crew|subcontractor)\b/i },
  { label: 'computer / portals', re: /\b(computer|browser|portal|fill out|website)\b/i },
  { label: 'web lookup', re: /\b(search|look up|price|weather|code)\b/i },
];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function localHour(iso: string, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'America/Chicago',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(new Date(iso));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value);
    return Number.isFinite(hour) ? ((hour % 24) + 24) % 24 : -1;
  } catch {
    return -1;
  }
}

function similarQuestion(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const aa = norm(a);
  const bb = norm(b);
  if (!aa || !bb) return false;
  if (aa === bb) return true;
  if (aa.includes(bb) || bb.includes(aa)) return true;
  const as = new Set(aa.split(' ').filter((w) => w.length > 2));
  const bs = bb.split(' ').filter((w) => w.length > 2);
  if (!as.size || !bs.length) return false;
  let hit = 0;
  for (const w of bs) if (as.has(w)) hit += 1;
  return hit / Math.max(as.size, bs.length) >= 0.6;
}

/**
 * Observe one user message and return trait updates (not yet merged).
 * Pure: safe to unit test without a database.
 */
export function observeCommunicationStyle(input: StyleObservation): {
  traits: Partial<StyleTraits>;
  frustrationBump: number;
} {
  const q = trim(input.question);
  const nowIso = trim(input.at) || new Date().toISOString();
  const zone = trim(input.timeZone) || 'America/Chicago';
  const words = wordCount(q);
  const lower = q.toLowerCase();

  let brevityObs = 0.55;
  if (words <= 4) brevityObs = 0.92;
  else if (words <= 10) brevityObs = 0.75;
  else if (words <= 25) brevityObs = 0.45;
  else brevityObs = 0.18;
  if (/\b(brief|short|tl;?dr|bottom line|just tell me|quick)\b/i.test(q)) brevityObs = Math.max(brevityObs, 0.9);
  if (/\b(detail|detailed|explain|walk me through|full|everything|be specific|more detail)\b/i.test(q)) {
    brevityObs = Math.min(brevityObs, 0.15);
  }

  let formatObs = 0.25;
  if (/\b(bullet|bullets|list|checklist|line items?)\b/i.test(q)) formatObs = 0.9;
  if (/\b(paragraph|prose|write it out|in writing)\b/i.test(q)) formatObs = 0.1;

  let formalityObs = 0.35;
  if (/\b(please|kindly|regarding|pursuant|dear|thank you)\b/i.test(q)) formalityObs = 0.75;
  if (/\b(hey|yeah|yep|nah|gonna|wanna|lol|thx|pls)\b/i.test(q)) formalityObs = 0.15;
  if (/^[A-Z][^.!?]*[.!]$/.test(q) && words > 8 && !/'/.test(q)) formalityObs = Math.max(formalityObs, 0.65);

  let technicalObs = 0.3;
  const tradeVocab: Record<string, number> = {};
  for (const row of TRADE_LEXICON) {
    if (row.re.test(q)) {
      tradeVocab[row.key] = 1;
      technicalObs = Math.max(technicalObs, 0.7);
    }
  }
  if (/\b(psf|mil|gauge|r-?\d+|sq\.?\s*ft|square\b|pitch)\b/i.test(q)) technicalObs = Math.max(technicalObs, 0.8);

  let decisionObs = 0.5;
  if (/\b(bottom line|just tell me|yes or no|should we|go \/ no-go|quick call)\b/i.test(q)) decisionObs = 0.85;
  if (/\b(show me|quote|evidence|timestamp|who said|prove|source|cite)\b/i.test(q)) decisionObs = 0.15;

  let frustrationBump = 0;
  if (/^(no|nope|wrong|not that|i said|i meant|stop|again)\b/i.test(lower)) frustrationBump = 0.7;
  if (/\b(i (?:already )?said|that's not|you (?:didn't|did not)|try again|shorter)\b/i.test(q)) {
    frustrationBump = Math.max(frustrationBump, 0.65);
  }
  const prev = trim(input.previousQuestion);
  if (prev && similarQuestion(prev, q) && prev.toLowerCase() !== lower) {
    frustrationBump = Math.max(frustrationBump, 0.55);
  }

  const commonTasks: string[] = [];
  for (const task of TASK_PATTERNS) {
    if (task.re.test(q)) commonTasks.push(task.label);
  }

  const hourHistogram = Array.from({ length: 24 }, () => 0);
  const hour = localHour(nowIso, zone);
  if (hour >= 0) hourHistogram[hour] = 1;

  const preferredChannels: Record<string, number> = {
    [input.channel === 'progress_share' ? 'progress_share' : 'chat']: 1,
  };

  return {
    traits: {
      brevity: { value: brevityObs, confidence: 0.35, updatedAt: nowIso },
      format: { value: formatObs, confidence: 0.3, updatedAt: nowIso },
      formality: { value: formalityObs, confidence: 0.3, updatedAt: nowIso },
      technicalLevel: { value: technicalObs, confidence: tradeVocab && Object.keys(tradeVocab).length ? 0.4 : 0.25, updatedAt: nowIso },
      decisionStyle: { value: decisionObs, confidence: 0.3, updatedAt: nowIso },
      tradeVocab,
      commonTasks,
      hourHistogram,
      preferredChannels,
    },
    frustrationBump,
  };
}

function mergeTradeVocab(prior: Record<string, number> | undefined, next: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = { ...(prior ?? {}) };
  for (const [k, v] of Object.entries(next ?? {})) {
    if (FORBIDDEN_TRAIT_KEYS.has(k)) continue;
    out[k] = Math.min(50, (out[k] ?? 0) + (Number(v) || 0));
  }
  return Object.fromEntries(
    Object.entries(out)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_TRADE_KEYS),
  );
}

function mergeTasks(prior: string[] | undefined, next: string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const label of [...(next ?? []), ...(prior ?? [])]) {
    const key = label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(label.trim());
    if (out.length >= MAX_COMMON_TASKS) break;
  }
  return out;
}

function mergeHistogram(prior: number[] | undefined, next: number[] | undefined): number[] {
  const a = Array.isArray(prior) && prior.length === 24 ? prior : Array.from({ length: 24 }, () => 0);
  const b = Array.isArray(next) && next.length === 24 ? next : Array.from({ length: 24 }, () => 0);
  return a.map((n, i) => Math.min(10_000, (Number(n) || 0) + (Number(b[i]) || 0)));
}

function sanitizeTraits(raw: unknown): StyleTraits {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: StyleTraits = {};
  const takeScore = (key: keyof StyleTraits) => {
    const row = src[key];
    if (!row || typeof row !== 'object') return;
    const rec = row as Record<string, unknown>;
    const value = clamp01(Number(rec.value));
    const confidence = clamp01(Number(rec.confidence));
    const updatedAt = trim(rec.updatedAt) || new Date().toISOString();
    (out as Record<string, unknown>)[key] = { value, confidence, updatedAt };
  };
  takeScore('brevity');
  takeScore('format');
  takeScore('formality');
  takeScore('technicalLevel');
  takeScore('decisionStyle');
  takeScore('frustration');
  if (src.tradeVocab && typeof src.tradeVocab === 'object') {
    out.tradeVocab = mergeTradeVocab(undefined, src.tradeVocab as Record<string, number>);
  }
  if (Array.isArray(src.commonTasks)) {
    out.commonTasks = mergeTasks(undefined, src.commonTasks.map(String));
  }
  if (Array.isArray(src.hourHistogram)) out.hourHistogram = mergeHistogram(undefined, src.hourHistogram.map(Number));
  if (src.preferredChannels && typeof src.preferredChannels === 'object') {
    out.preferredChannels = mergeTradeVocab(undefined, src.preferredChannels as Record<string, number>);
  }
  for (const key of Object.keys(src)) {
    if (FORBIDDEN_TRAIT_KEYS.has(key)) {
      // Drop silently — never persist.
    }
  }
  return out;
}

/** Merge an observation into existing traits with decay. */
export function mergeCommunicationStyle(priorRaw: unknown, observation: StyleObservation): StyleTraits {
  const prior = sanitizeTraits(priorRaw);
  const { traits: obs, frustrationBump } = observeCommunicationStyle(observation);
  const nowIso = trim(observation.at) || new Date().toISOString();

  const next: StyleTraits = {
    brevity: blendTrait(prior.brevity, obs.brevity!.value, nowIso),
    format: blendTrait(prior.format, obs.format!.value, nowIso),
    formality: blendTrait(prior.formality, obs.formality!.value, nowIso),
    technicalLevel: blendTrait(prior.technicalLevel, obs.technicalLevel!.value, nowIso),
    decisionStyle: blendTrait(prior.decisionStyle, obs.decisionStyle!.value, nowIso),
    tradeVocab: mergeTradeVocab(prior.tradeVocab, obs.tradeVocab),
    commonTasks: mergeTasks(prior.commonTasks, obs.commonTasks),
    hourHistogram: mergeHistogram(prior.hourHistogram, obs.hourHistogram),
    preferredChannels: mergeTradeVocab(prior.preferredChannels, obs.preferredChannels),
  };

  if (frustrationBump > 0) {
    next.frustration = blendTrait(prior.frustration, frustrationBump, nowIso, 0.4);
  } else if (prior.frustration) {
    // Calm turns gently lower frustration.
    next.frustration = blendTrait(prior.frustration, 0.15, nowIso, 0.12);
  }

  return next;
}

function peakHours(hist: number[] | undefined): string | null {
  if (!Array.isArray(hist) || hist.length !== 24) return null;
  const ranked = hist
    .map((count, hour) => ({ hour, count: Number(count) || 0 }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count);
  if (!ranked.length) return null;
  const top = ranked.slice(0, 2).map((row) => {
    const h = row.hour % 24;
    const suffix = h < 12 ? 'am' : 'pm';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}${suffix}`;
  });
  return top.join(' / ');
}

/**
 * Build the compact style summary injected into Chat prompts.
 * Communication style only — never labels the person or mentions sensitive traits.
 */
export function buildStylePromptSummary(traitsRaw: unknown): string {
  const traits = sanitizeTraits(traitsRaw);
  const parts: string[] = [];

  const use = (score: StyleTraitScore | undefined) =>
    score && score.confidence >= STYLE_PROMPT_MIN_CONFIDENCE ? score : null;

  const brevity = use(traits.brevity);
  if (brevity) {
    if (brevity.value >= 0.7) parts.push('Prefer brief answers (one or two short sentences).');
    else if (brevity.value <= 0.35) parts.push('They often want more detail — a clear lead answer, then supporting points.');
  }

  const format = use(traits.format);
  if (format) {
    if (format.value >= 0.65) parts.push('Prefer tight bullet lists for parallel facts.');
    else if (format.value <= 0.35) parts.push('Prefer short prose paragraphs over bullets unless listing.');
  }

  const formality = use(traits.formality);
  if (formality) {
    if (formality.value >= 0.65) parts.push('Keep a polished, professional tone.');
    else if (formality.value <= 0.35) parts.push('Keep a casual, conversational tone with contractions.');
  }

  const technical = use(traits.technicalLevel);
  const trades = Object.entries(traits.tradeVocab ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);
  if (technical && technical.value >= 0.55 && trades.length) {
    parts.push(`Trade vocabulary is fine (${trades.join(', ')}).`);
  } else if (technical && technical.value <= 0.35) {
    parts.push('Prefer plain language; explain trade terms when used.');
  }

  const decision = use(traits.decisionStyle);
  if (decision) {
    if (decision.value >= 0.65) parts.push('Lead with the bottom-line recommendation; keep evidence light unless asked.');
    else if (decision.value <= 0.35) parts.push('They often want evidence — include a short grounded quote or source when it helps.');
  }

  const frustration = use(traits.frustration);
  if (frustration && frustration.value >= 0.55) {
    parts.push('Recent signals suggest shorter, more direct answers.');
  }

  if (traits.commonTasks?.length) {
    parts.push(`Common asks: ${traits.commonTasks.slice(0, 4).join(', ')}.`);
  }

  const hours = peakHours(traits.hourHistogram);
  if (hours) parts.push(`Often active around ${hours} local time.`);

  let summary = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (summary.length > STYLE_PROMPT_CAP) summary = `${summary.slice(0, STYLE_PROMPT_CAP - 1).trim()}…`;
  return summary;
}

/**
 * System-prompt addendum. Empty when there is nothing useful yet.
 * Explicitly subordinate to grounding / evidence / speaker rules.
 */
export function stylePromptAddendum(summary: string): string {
  const text = trim(summary);
  if (!text) return '';
  return [

    'COMMUNICATION STYLE (tone, length, and format only):',
    text,
    'This note never overrides quote grounding, speaker attribution, job-evidence rules, or facts. Never invent job details to match a style. Never mention this note or label the person.',
  ].join('\n');
}

export function parseStyleRow(row: Record<string, unknown> | null | undefined): CommunicationStyleRow | null {
  if (!row?.user_id) return null;
  const traits = sanitizeTraits(row.traits);
  return {
    userId: String(row.user_id),
    traits,
    promptSummary: trim(row.prompt_summary).slice(0, STYLE_PROMPT_CAP),
    sampleCount: Math.max(0, Number(row.sample_count) || 0),
    lastSignalAt: row.last_signal_at ? String(row.last_signal_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function loadCommunicationStyle(
  supabase: SupabaseClient,
  userId: string,
): Promise<CommunicationStyleRow | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('ask_communication_styles')
      .select('user_id, traits, prompt_summary, sample_count, last_signal_at, updated_at')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      if (/ask_communication_styles|does not exist|schema cache/i.test(error.message ?? '')) return null;
      return null;
    }
    return parseStyleRow((data ?? null) as Record<string, unknown> | null);
  } catch {
    return null;
  }
}

/**
 * After-turn hook: merge this message into the person's style profile.
 * Fire-and-forget; never throws to the Ask path.
 */
export async function recordCommunicationStyleTurn(
  supabase: SupabaseClient,
  input: {
    userId: string;
    question: string;
    previousQuestion?: string | null;
    at?: string | null;
    timeZone?: string | null;
    channel?: 'chat' | 'progress_share';
  },
): Promise<CommunicationStyleRow | null> {
  const userId = trim(input.userId);
  const question = trim(input.question);
  if (!userId || !question) return null;
  try {
    const existing = await loadCommunicationStyle(supabase, userId);
    const observation: StyleObservation = {
      question,
      previousQuestion: input.previousQuestion,
      at: input.at,
      timeZone: input.timeZone,
      channel: input.channel,
    };
    const traits = mergeCommunicationStyle(existing?.traits ?? {}, observation);
    const promptSummary = buildStylePromptSummary(traits);
    const nowIso = trim(input.at) || new Date().toISOString();
    const sampleCount = (existing?.sampleCount ?? 0) + 1;
    const { data, error } = await supabase
      .from('ask_communication_styles')
      .upsert(
        {
          user_id: userId,
          traits,
          prompt_summary: promptSummary,
          sample_count: sampleCount,
          last_signal_at: nowIso,
          updated_at: nowIso,
        },
        { onConflict: 'user_id' },
      )
      .select('user_id, traits, prompt_summary, sample_count, last_signal_at, updated_at')
      .maybeSingle();
    if (error) {
      if (/ask_communication_styles|does not exist|schema cache/i.test(error.message ?? '')) return null;
      return null;
    }
    return parseStyleRow((data ?? null) as Record<string, unknown> | null);
  } catch {
    return null;
  }
}

export async function deleteCommunicationStyle(supabase: SupabaseClient, userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { error } = await supabase.from('ask_communication_styles').delete().eq('user_id', userId);
    if (error && /ask_communication_styles|does not exist|schema cache/i.test(error.message ?? '')) return true;
    return !error;
  } catch {
    return false;
  }
}
