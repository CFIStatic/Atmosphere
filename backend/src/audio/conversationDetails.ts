/**
 * Pull the useful facts out of a filed mic transcript.
 *
 * Some day films are work. Some are the contractor standing in the kitchen
 * talking to the homeowner. Both are evidence. Vision already described the
 * frames; this is the matching pass for what was said — agreements, rooms,
 * insurance, leaks, "please don't" — so Ask can answer without a second listen.
 *
 * Prefer an LLM when Ask/vision providers are configured. Fall back to a
 * deterministic extractor so the office still gets the facts with no key.
 */

import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { logger } from '../lib/logger.js';

export type ConversationQuotedFact = {
  text: string;
  tSec?: number | null;
  quote?: string | null;
};

export type ConversationTurn = {
  tSec: number | null;
  speakerLabel: string;
  text: string;
};

export type ConversationDetails = {
  summary: string | null;
  details: string[];
  agreements: string[];
  concerns: string[];
  roomsMentioned: string[];
  /** Rich structure for Office Analysis — empty when the mic was silent. */
  turns: ConversationTurn[];
  commitments: ConversationQuotedFact[];
  actionItems: ConversationQuotedFact[];
  /** Quoted agreements / concerns with optional seek times. */
  agreementFacts: ConversationQuotedFact[];
  concernFacts: ConversationQuotedFact[];
  source: 'llm' | 'deterministic' | 'empty';
  model?: string | null;
};

/** Persisted under `ai_findings.conversation`. */
export type StoredConversation = {
  version: number;
  source: 'llm' | 'deterministic' | 'empty';
  model?: string | null;
  summary: string | null;
  details: string[];
  agreements: string[];
  concerns: string[];
  rooms: string[];
  turns?: ConversationTurn[];
  commitments?: ConversationQuotedFact[];
  actionItems?: ConversationQuotedFact[];
  agreementFacts?: ConversationQuotedFact[];
  concernFacts?: ConversationQuotedFact[];
};

export const CONVERSATION_FINDINGS_VERSION = 1;

const ROOMS = [
  'bathroom',
  'kitchen',
  'bedroom',
  'living room',
  'dining room',
  'hallway',
  'garage',
  'basement',
  'attic',
  'laundry',
  'closet',
  'office',
  'den',
  'foyer',
  'stair',
  'roof',
  'driveway',
  'yard',
];

const DETAIL =
  /\b(said|says|told|asked|agreed|approve|approved|declined|don't|do not|insurance|adjuster|claim|leak|mold|water|replace|mirror|cabinet|drywall|flood|cut|extra|change order|deductible|homeowner|owner)\b/i;

const AGREEMENT =
  /\b(agreed|agreement|approve|approved|go ahead|yes[,.]|that's fine|ok to|okay to|you can|please (do|go)(?! not))\b/i;

const CONCERN =
  /\b(don't|do not|worried|concern|mold|leak|smell|refused|declined|not in scope|out of scope|extra|charge)\b/i;

const COMMITMENT =
  /\b(we will|i'll|i will|we'll|going to|gonna|promise|commit|remount|leave the|schedule|come back)\b/i;

const ACTION =
  /\b(need to|have to|must|should|action item|follow up|call the|email|send|get (the )?adjuster|write up)\b/i;

const SPEAKER_LEAD =
  /^(homeowner|owner|home owner|contractor|crew|tech|technician|worker|adjuster|inspector|speaker\s*[a-d]|person\s*[12])\s*[:\-–—]\s*/i;

const EMPTY: ConversationDetails = {
  summary: null,
  details: [],
  agreements: [],
  concerns: [],
  roomsMentioned: [],
  turns: [],
  commitments: [],
  actionItems: [],
  agreementFacts: [],
  concernFacts: [],
  source: 'empty',
  model: null,
};

export function conversationSentences(text: string): string[] {
  return text
    .replace(/\[(?:\d+:)+\d+\]/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 12);
}

function unique(values: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

export function roomsMentionedIn(text: string): string[] {
  const lower = text.toLowerCase();
  return ROOMS.filter((room) => lower.includes(room));
}

function clockToSeconds(raw: string): number | null {
  const parts = raw.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 1) return parts[0]!;
  return null;
}

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function normalizeSpeaker(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (/^home\s*owner|^owner$/.test(s)) return 'Homeowner';
  if (/^contractor|^crew|^tech|^technician|^worker/.test(s)) return 'Crew';
  if (/^adjuster/.test(s)) return 'Adjuster';
  if (/^inspector/.test(s)) return 'Inspector';
  if (/^speaker\s*a|^person\s*1/.test(s)) return 'Speaker A';
  if (/^speaker\s*b|^person\s*2/.test(s)) return 'Speaker B';
  if (/^speaker\s*c/.test(s)) return 'Speaker C';
  if (/^speaker\s*d/.test(s)) return 'Speaker D';
  return raw.trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 24) || 'Speaker A';
}

type StampChunk = { at: number | null; text: string };

/** Split a transcript into timed chunks (Whisper stamps or whole blob). */
export function conversationChunks(transcript: string): StampChunk[] {
  const src = String(transcript || '').trim();
  if (!src) return [];
  const re = /\[((?:\d+:)+\d+)\]/g;
  const stamps: Array<{ at: number; index: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(src))) {
    const at = clockToSeconds(match[1] ?? '');
    if (at == null || !Number.isFinite(at) || at < 0) continue;
    stamps.push({ at, index: match.index, end: match.index + match[0].length });
  }
  if (!stamps.length) return [{ at: null, text: src }];
  const chunks: StampChunk[] = [];
  for (let i = 0; i < stamps.length; i += 1) {
    const stamp = stamps[i]!;
    const next = stamps[i + 1];
    const body = src
      .slice(stamp.end, next ? next.index : src.length)
      .replace(/^[\s:,.\-–—]+/, '')
      .trim();
    if (!body) continue;
    chunks.push({ at: stamp.at, text: body });
  }
  return chunks;
}

function turnsFromChunks(chunks: StampChunk[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let anon = 0;
  let lastLabel: string | null = null;
  for (const chunk of chunks) {
    const pieces = chunk.text
      .split(/(?=(?:Homeowner|Owner|Home owner|Contractor|Crew|Tech(?:nician)?|Worker|Adjuster|Inspector|Speaker\s*[A-D]|Person\s*[12])\s*[:\-–—])/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const parts = pieces.length ? pieces : [chunk.text];
    for (const part of parts) {
      const lead = part.match(SPEAKER_LEAD);
      let speakerLabel: string;
      let text: string;
      if (lead) {
        speakerLabel = normalizeSpeaker(lead[1] ?? 'Speaker');
        text = part.slice(lead[0].length).trim();
        lastLabel = speakerLabel;
      } else if (lastLabel && turns.length) {
        speakerLabel = lastLabel;
        text = part.trim();
      } else {
        anon += 1;
        speakerLabel = anon === 1 ? 'Speaker A' : anon === 2 ? 'Speaker B' : `Speaker ${String.fromCharCode(64 + Math.min(anon, 26))}`;
        text = part.trim();
        lastLabel = speakerLabel;
      }
      if (!text || text.length < 3) continue;
      turns.push({
        tSec: chunk.at == null ? null : roundTime(chunk.at),
        speakerLabel,
        text: text.slice(0, 500),
      });
    }
  }
  return turns.slice(0, 48);
}

function factFromLine(line: string, chunks: StampChunk[]): ConversationQuotedFact {
  const needle = line.toLowerCase().slice(0, 48);
  let tSec: number | null = null;
  for (const chunk of chunks) {
    if (chunk.at == null) continue;
    const hay = chunk.text.toLowerCase();
    if (needle && (hay.includes(needle) || line.toLowerCase().includes(hay.slice(0, 40)))) {
      tSec = roundTime(chunk.at);
      break;
    }
  }
  return { text: line.slice(0, 320), tSec, quote: line.slice(0, 240) };
}

function factsFromLines(lines: string[], chunks: StampChunk[], max = 8): ConversationQuotedFact[] {
  const out: ConversationQuotedFact[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(factFromLine(line, chunks));
    if (out.length >= max) break;
  }
  return out;
}

function textsOf(facts: ConversationQuotedFact[]): string[] {
  return facts.map((f) => f.text);
}

/** Deterministic pass — always available, no provider required. */
export function extractConversationDetails(transcript: string | null | undefined): ConversationDetails {
  const raw = String(transcript || '').trim();
  if (!raw) return { ...EMPTY };

  const chunks = conversationChunks(raw);
  const lines = conversationSentences(raw);
  const details = unique(lines.filter((line) => DETAIL.test(line)));
  const agreements = unique(lines.filter((line) => AGREEMENT.test(line)));
  const concerns = unique(lines.filter((line) => CONCERN.test(line)));
  const commitmentLines = unique(lines.filter((line) => COMMITMENT.test(line)));
  const actionLines = unique(lines.filter((line) => ACTION.test(line)));
  const roomsMentioned = roomsMentionedIn(raw);
  const turns = turnsFromChunks(chunks);
  const agreementFacts = factsFromLines(agreements, chunks);
  const concernFacts = factsFromLines(concerns, chunks);
  const commitments = factsFromLines(commitmentLines, chunks);
  const actionItems = factsFromLines(actionLines, chunks);

  // Filler / noise-only mics must not invent a conversation section.
  const substance =
    details.length > 0 ||
    agreements.length > 0 ||
    concerns.length > 0 ||
    roomsMentioned.length > 0 ||
    commitments.length > 0 ||
    actionItems.length > 0;
  if (!substance) return { ...EMPTY };

  const lead = details[0] || lines[0] || raw.slice(0, 240);
  const summary = roomsMentioned.length
    ? `Conversation on site covering ${roomsMentioned.slice(0, 4).join(', ')}. ${lead}`
    : `Conversation on site. ${lead}`;

  return {
    summary: summary.slice(0, 500),
    details,
    agreements,
    concerns,
    roomsMentioned,
    turns,
    commitments,
    actionItems,
    agreementFacts,
    concernFacts,
    source: 'deterministic',
    model: null,
  };
}

/** Real talk worth a timeline row — not an empty, skipped, or noise-only mic. */
export function hasConversation(details: ConversationDetails): boolean {
  return (
    details.details.length > 0 ||
    details.agreements.length > 0 ||
    details.concerns.length > 0 ||
    details.roomsMentioned.length > 0 ||
    details.commitments.length > 0 ||
    details.actionItems.length > 0
  );
}

function asFactList(value: unknown): ConversationQuotedFact[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationQuotedFact[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      out.push({ text: item.trim().slice(0, 320), tSec: null, quote: item.trim().slice(0, 240) });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const tRaw = (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    const quoteRaw = (item as { quote?: unknown }).quote;
    out.push({
      text: text.slice(0, 320),
      tSec: Number.isFinite(tSec) && tSec >= 0 ? roundTime(tSec) : null,
      quote: typeof quoteRaw === 'string' && quoteRaw.trim() ? quoteRaw.trim().slice(0, 240) : text.slice(0, 240),
    });
  }
  return out.slice(0, 12);
}

function asTurnList(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const speakerLabel = String((item as { speakerLabel?: unknown }).speakerLabel ?? 'Speaker A').trim() || 'Speaker A';
    const tRaw = (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    out.push({
      tSec: Number.isFinite(tSec) && tSec >= 0 ? roundTime(tSec) : null,
      speakerLabel: speakerLabel.slice(0, 24),
      text: text.slice(0, 500),
    });
  }
  return out.slice(0, 48);
}

function asStringList(value: unknown, fallback: string[] = []): string[] {
  if (Array.isArray(value) && value.length) {
    const fromStrings = value
      .map((item) => {
        if (typeof item === 'string') return item.trim();
        if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
          return String((item as { text: string }).text).trim();
        }
        return '';
      })
      .filter(Boolean);
    if (fromStrings.length) return unique(fromStrings);
  }
  return fallback;
}

/** Parse model JSON into ConversationDetails; null when unusable. */
export function parseConversationModelJson(
  raw: string,
  fallback: ConversationDetails,
): ConversationDetails | null {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? trimmed).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }

  const turns = asTurnList(data.turns);
  const agreementFacts = asFactList(data.agreements);
  const concernFacts = asFactList(data.concerns);
  const commitments = asFactList(data.commitments);
  const actionItems = asFactList(data.actionItems);
  const roomsMentioned = asStringList(data.roomsMentioned ?? data.rooms, fallback.roomsMentioned);
  const details = asStringList(data.details, fallback.details);
  const summary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary.trim().slice(0, 500)
      : fallback.summary;

  const parsed: ConversationDetails = {
    summary,
    details: details.length ? details : fallback.details,
    agreements: textsOf(agreementFacts).length ? textsOf(agreementFacts) : fallback.agreements,
    concerns: textsOf(concernFacts).length ? textsOf(concernFacts) : fallback.concerns,
    roomsMentioned,
    turns: turns.length ? turns : fallback.turns,
    commitments: commitments.length ? commitments : fallback.commitments,
    actionItems: actionItems.length ? actionItems : fallback.actionItems,
    agreementFacts: agreementFacts.length ? agreementFacts : fallback.agreementFacts,
    concernFacts: concernFacts.length ? concernFacts : fallback.concernFacts,
    source: 'llm',
    model: null,
  };

  if (!hasConversation(parsed)) return null;
  return parsed;
}

const CONVERSATION_SYSTEM = `You extract structured conversation facts from a job-site film transcript.
Return JSON only (no markdown). Schema:
{
  "summary": "1-2 sentences",
  "turns": [{"tSec": number|null, "speakerLabel": "Homeowner"|"Crew"|"Speaker A"|"Speaker B"|string, "text": "..."}],
  "agreements": [{"text":"...","tSec":number|null,"quote":"..."}],
  "commitments": [{"text":"...","tSec":number|null,"quote":"..."}],
  "concerns": [{"text":"...","tSec":number|null,"quote":"..."}],
  "actionItems": [{"text":"...","tSec":number|null,"quote":"..."}],
  "roomsMentioned": ["bathroom"],
  "details": ["short fact lines"]
}
Rules: use timestamps from [m:ss] stamps when present; Speaker A/B if roles are unclear; never invent speech; empty arrays when silent or noise-only.`;

/**
 * Prefer LLM when Ask providers are configured; otherwise deterministic.
 * Never throws — empty/noise transcripts return an empty structure.
 */
export async function analyzeConversation(
  transcript: string | null | undefined,
  opts?: { durationSeconds?: number | null },
): Promise<ConversationDetails> {
  const fallback = extractConversationDetails(transcript);
  const raw = String(transcript || '').trim();
  if (!raw || !hasConversation(fallback)) {
    return raw ? fallback : { ...EMPTY };
  }
  if (!isAskModelConfigured()) return fallback;

  const duration =
    opts?.durationSeconds != null && Number.isFinite(Number(opts.durationSeconds))
      ? Number(opts.durationSeconds)
      : null;
  const clipped = raw.length > 24_000 ? `${raw.slice(0, 24_000)}\n…` : raw;
  try {
    const completed = await completeAskText({
      system: CONVERSATION_SYSTEM,
      user: [
        duration != null ? `Clip length: ${Math.round(duration)} seconds.` : null,
        'Transcript:',
        clipped,
      ]
        .filter(Boolean)
        .join('\n'),
      maxTokens: 2500,
    });
    if (!completed?.text) return fallback;
    const parsed = parseConversationModelJson(completed.text, fallback);
    if (!parsed) {
      logger.warn('conversation_llm_parse_failed', { chars: completed.text.length });
      return fallback;
    }
    return { ...parsed, source: 'llm', model: completed.model };
  } catch (err) {
    logger.warn('conversation_llm_failed', {
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    });
    return fallback;
  }
}

export function toStoredConversation(details: ConversationDetails): StoredConversation {
  return {
    version: CONVERSATION_FINDINGS_VERSION,
    source: details.source,
    model: details.model ?? null,
    summary: details.summary,
    details: details.details,
    agreements: details.agreements,
    concerns: details.concerns,
    rooms: details.roomsMentioned,
    turns: details.turns,
    commitments: details.commitments,
    actionItems: details.actionItems,
    agreementFacts: details.agreementFacts,
    concernFacts: details.concernFacts,
  };
}

/** Hydrate stored `ai_findings.conversation` (or derive from transcript). */
export function conversationFromStored(
  transcript: unknown,
  stored: unknown,
): ConversationDetails {
  const text = typeof transcript === 'string' ? transcript : '';
  const derived = extractConversationDetails(text);
  if (!stored || typeof stored !== 'object') return derived;

  const row = stored as StoredConversation & Record<string, unknown>;
  const agreementFacts = asFactList(row.agreementFacts ?? row.agreements);
  const concernFacts = asFactList(row.concernFacts ?? row.concerns);
  const commitments = asFactList(row.commitments);
  const actionItems = asFactList(row.actionItems);
  const turns = asTurnList(row.turns);
  const details = asStringList(row.details, derived.details);
  const roomsMentioned = asStringList(row.rooms ?? row.roomsMentioned, derived.roomsMentioned);
  const summary =
    typeof row.summary === 'string' && row.summary.trim() ? row.summary.trim().slice(0, 500) : derived.summary;
  const source =
    row.source === 'llm' || row.source === 'deterministic' || row.source === 'empty'
      ? row.source
      : details.length || turns.length
        ? 'deterministic'
        : 'empty';

  const hydrated: ConversationDetails = {
    summary,
    details,
    agreements: asStringList(row.agreements, textsOf(agreementFacts).length ? textsOf(agreementFacts) : derived.agreements),
    concerns: asStringList(row.concerns, textsOf(concernFacts).length ? textsOf(concernFacts) : derived.concerns),
    roomsMentioned,
    turns: turns.length ? turns : derived.turns,
    commitments: commitments.length ? commitments : derived.commitments,
    actionItems: actionItems.length ? actionItems : derived.actionItems,
    agreementFacts: agreementFacts.length ? agreementFacts : derived.agreementFacts,
    concernFacts: concernFacts.length ? concernFacts : derived.concernFacts,
    source,
    model: typeof row.model === 'string' ? row.model : null,
  };
  return hasConversation(hydrated) ? hydrated : derived;
}

export function publicConversationFields(details: ConversationDetails) {
  return {
    conversationSummary: details.summary,
    conversationDetails: details.details,
    conversationAgreements: details.agreements,
    conversationConcerns: details.concerns,
    conversationRooms: details.roomsMentioned,
    conversationTurns: details.turns,
    conversationCommitments: details.commitments,
    conversationActionItems: details.actionItems,
    conversationAgreementFacts: details.agreementFacts,
    conversationConcernFacts: details.concernFacts,
    conversationSource: details.source,
  };
}
