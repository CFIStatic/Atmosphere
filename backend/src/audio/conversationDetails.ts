/**
 * Intelligent conversation analysis for job films.
 *
 * LLM-first when Ask/vision providers are configured: full (chunked) transcript
 * plus optional vision dictation context. Every claim should carry a transcript
 * quote and seek time. Deterministic regex is fallback only when no model runs.
 */

import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { logger } from '../lib/logger.js';
import { findVerbatimQuote } from './verbatimTranscript.js';

export type ConversationQuotedFact = {
  text: string;
  tSec?: number | null;
  quote?: string | null;
  confidence?: number | null;
  /** Who owns a promise / action when known. */
  owner?: string | null;
  kind?: string | null;
};

export type ConversationTurn = {
  tSec: number | null;
  speakerLabel: string;
  text: string;
};

export type ConversationKeyMoment = {
  tSec: number | null;
  label: string;
  text: string;
  quote?: string | null;
  confidence?: number | null;
};

export type ConversationDetails = {
  summary: string | null;
  /** Longer office brief (2–5 sentences) when the model produced one. */
  executiveSummary: string | null;
  details: string[];
  agreements: string[];
  concerns: string[];
  roomsMentioned: string[];
  turns: ConversationTurn[];
  commitments: ConversationQuotedFact[];
  actionItems: ConversationQuotedFact[];
  agreementFacts: ConversationQuotedFact[];
  concernFacts: ConversationQuotedFact[];
  refusals: ConversationQuotedFact[];
  scopeChanges: ConversationQuotedFact[];
  changeOrders: ConversationQuotedFact[];
  moneyTalk: ConversationQuotedFact[];
  safety: ConversationQuotedFact[];
  insurance: ConversationQuotedFact[];
  unresolvedQuestions: ConversationQuotedFact[];
  contradictions: ConversationQuotedFact[];
  keyMoments: ConversationKeyMoment[];
  source: 'llm' | 'deterministic' | 'empty';
  model?: string | null;
};

/** Persisted under `ai_findings.conversation`. */
export type StoredConversation = {
  version: number;
  source: 'llm' | 'deterministic' | 'empty';
  model?: string | null;
  summary: string | null;
  executiveSummary?: string | null;
  details: string[];
  agreements: string[];
  concerns: string[];
  rooms: string[];
  turns?: ConversationTurn[];
  commitments?: ConversationQuotedFact[];
  actionItems?: ConversationQuotedFact[];
  agreementFacts?: ConversationQuotedFact[];
  concernFacts?: ConversationQuotedFact[];
  refusals?: ConversationQuotedFact[];
  scopeChanges?: ConversationQuotedFact[];
  changeOrders?: ConversationQuotedFact[];
  moneyTalk?: ConversationQuotedFact[];
  safety?: ConversationQuotedFact[];
  insurance?: ConversationQuotedFact[];
  unresolvedQuestions?: ConversationQuotedFact[];
  contradictions?: ConversationQuotedFact[];
  keyMoments?: ConversationKeyMoment[];
};

export const CONVERSATION_FINDINGS_VERSION = 2;

/** Strong enough for a deep JSON brief; Gemini path already floors high. */
export const CONVERSATION_LLM_MAX_TOKENS = 8_000;
const CHUNK_CHARS = 14_000;
const SINGLE_PASS_CHARS = 22_000;

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
  /\b(said|says|told|asked|agreed|approve|approved|declined|don't|do not|insurance|adjuster|claim|leak|mold|water|replace|mirror|cabinet|drywall|flood|cut|extra|change order|deductible|homeowner|owner|dollars?|\$|safety|ppe)\b/i;

const AGREEMENT =
  /\b(agreed|agreement|approve|approved|go ahead|yes[,.]|that's fine|ok to|okay to|you can|please (do|go)(?! not))\b/i;

const CONCERN =
  /\b(don't|do not|worried|concern|mold|leak|smell|refused|declined|not in scope|out of scope|extra|charge)\b/i;

const COMMITMENT =
  /\b(we will|i'll|i will|we'll|going to|gonna|promise|commit|remount|leave the|schedule|come back)\b/i;

const ACTION =
  /\b(need to|have to|must|should|action item|follow up|call the|email|send|get (the )?adjuster|write up)\b/i;

const REFUSAL =
  /\b(refused|decline|declined|won't|will not|do not want|don't want|not approving|no way|absolutely not)\b/i;

const SCOPE =
  /\b(in scope|out of scope|not in scope|scope change|change the scope|add(ed)? to scope|remove(d)? from scope)\b/i;

const CHANGE_ORDER = /\b(change order|change-order|extras?|upsell|additional work)\b/i;

const MONEY = /\b(deductible|dollars?|\$|cost|price|invoice|bill|pay|payment|estimate|quote)\b/i;

const SAFETY = /\b(safety|ppe|hard hat|fall protection|asbestos|lead|hazard|unsafe)\b/i;

const INSURANCE = /\b(insurance|adjuster|claim|carrier|coverage|policy)\b/i;

const QUESTION = /\b(who|what|when|where|why|how|can you|will you|do we|should we)\b.*\?/i;

const SPEAKER_LEAD =
  /^(homeowner|owner|home owner|contractor|crew|tech|technician|worker|adjuster|inspector|speaker\s*[a-d]|person\s*[12])\s*[:\-–—]\s*/i;

function emptyDetails(): ConversationDetails {
  return {
    summary: null,
    executiveSummary: null,
    details: [],
    agreements: [],
    concerns: [],
    roomsMentioned: [],
    turns: [],
    commitments: [],
    actionItems: [],
    agreementFacts: [],
    concernFacts: [],
    refusals: [],
    scopeChanges: [],
    changeOrders: [],
    moneyTalk: [],
    safety: [],
    insurance: [],
    unresolvedQuestions: [],
    contradictions: [],
    keyMoments: [],
    source: 'empty',
    model: null,
  };
}


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

function clampConfidence(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, Math.round(n * 100) / 100));
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
      .split(
        /(?=(?:\bHomeowner\b|\bOwner\b|\bHome owner\b|\bContractor\b|\bCrew\b|\bTech(?:nician)?\b|\bWorker\b|\bAdjuster\b|\bInspector\b|\bSpeaker\s*[A-D]\b|\bPerson\s*[12]\b)\s*[:\-–—])/i,
      )
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
        speakerLabel =
          anon === 1 ? 'Speaker A' : anon === 2 ? 'Speaker B' : `Speaker ${String.fromCharCode(64 + Math.min(anon, 26))}`;
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
  return turns.slice(0, 2_000);
}

function factFromLine(
  line: string,
  chunks: StampChunk[],
  extras?: Partial<ConversationQuotedFact>,
): ConversationQuotedFact {
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
  return {
    text: line.slice(0, 320),
    tSec,
    quote: line.slice(0, 240),
    confidence: extras?.confidence ?? 0.55,
    owner: extras?.owner ?? null,
    kind: extras?.kind ?? null,
  };
}

function factsFromLines(
  lines: string[],
  chunks: StampChunk[],
  max = 8,
  extras?: Partial<ConversationQuotedFact>,
): ConversationQuotedFact[] {
  const out: ConversationQuotedFact[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(factFromLine(line, chunks, extras));
    if (out.length >= max) break;
  }
  return out;
}

function textsOf(facts: ConversationQuotedFact[]): string[] {
  return facts.map((f) => f.text);
}

function inferOwner(line: string): string | null {
  if (/\b(i|we) will\b|\bwe'll\b|\bi'll\b/i.test(line) && /\b(homeowner|owner)\b/i.test(line)) return 'Homeowner';
  if (/\b(homeowner|owner) will\b/i.test(line)) return 'Homeowner';
  if (/\b(we will|we'll|crew will|contractor will|i'll remount|we'?ll remount)\b/i.test(line)) return 'Crew';
  if (/\bi'll\b|\bi will\b/i.test(line)) return null;
  return null;
}

/** Deterministic fallback — only when no model is configured or the model fails. */
export function extractConversationDetails(transcript: string | null | undefined): ConversationDetails {
  const raw = String(transcript || '').trim();
  if (!raw) return emptyDetails();

  const chunks = conversationChunks(raw);
  const lines = conversationSentences(raw);
  const details = unique(lines.filter((line) => DETAIL.test(line)));
  const agreements = unique(lines.filter((line) => AGREEMENT.test(line)));
  const concerns = unique(lines.filter((line) => CONCERN.test(line)));
  const commitmentLines = unique(lines.filter((line) => COMMITMENT.test(line)));
  const actionLines = unique(lines.filter((line) => ACTION.test(line)));
  const refusalLines = unique(lines.filter((line) => REFUSAL.test(line)));
  const scopeLines = unique(lines.filter((line) => SCOPE.test(line)));
  const changeOrderLines = unique(lines.filter((line) => CHANGE_ORDER.test(line)));
  const moneyLines = unique(lines.filter((line) => MONEY.test(line)));
  const safetyLines = unique(lines.filter((line) => SAFETY.test(line)));
  const insuranceLines = unique(lines.filter((line) => INSURANCE.test(line)));
  const questionLines = unique(lines.filter((line) => QUESTION.test(line) || /\?\s*$/.test(line)));
  const roomsMentioned = roomsMentionedIn(raw);
  const turns = turnsFromChunks(chunks);
  const agreementFacts = factsFromLines(agreements, chunks);
  const concernFacts = factsFromLines(concerns, chunks);
  const commitments = commitmentLines.map((line) =>
    factFromLine(line, chunks, { owner: inferOwner(line), kind: 'promise' }),
  );
  const actionItems = factsFromLines(actionLines, chunks, 8, { kind: 'action' });
  const refusals = factsFromLines(refusalLines, chunks, 8, { kind: 'refusal' });
  const scopeChanges = factsFromLines(scopeLines, chunks, 8, { kind: 'scope' });
  const changeOrders = factsFromLines(changeOrderLines, chunks, 6, { kind: 'change_order' });
  const moneyTalk = factsFromLines(moneyLines, chunks, 8, { kind: 'money' });
  const safety = factsFromLines(safetyLines, chunks, 6, { kind: 'safety' });
  const insurance = factsFromLines(insuranceLines, chunks, 8, { kind: 'insurance' });
  const unresolvedQuestions = factsFromLines(questionLines, chunks, 8, { kind: 'question' });

  const substance =
    details.length > 0 ||
    agreements.length > 0 ||
    concerns.length > 0 ||
    roomsMentioned.length > 0 ||
    commitments.length > 0 ||
    actionItems.length > 0 ||
    refusals.length > 0 ||
    scopeChanges.length > 0 ||
    changeOrders.length > 0 ||
    moneyTalk.length > 0 ||
    safety.length > 0 ||
    insurance.length > 0;
  if (!substance) return emptyDetails();

  const lead = details[0] || lines[0] || raw.slice(0, 240);
  const summary = roomsMentioned.length
    ? `Conversation on site covering ${roomsMentioned.slice(0, 4).join(', ')}. ${lead}`
    : `Conversation on site. ${lead}`;

  const keyMoments: ConversationKeyMoment[] = [
    ...agreementFacts.slice(0, 2).map((f) => ({
      tSec: f.tSec ?? null,
      label: 'Agreement',
      text: f.text,
      quote: f.quote ?? null,
      confidence: f.confidence ?? null,
    })),
    ...refusals.slice(0, 2).map((f) => ({
      tSec: f.tSec ?? null,
      label: 'Refusal',
      text: f.text,
      quote: f.quote ?? null,
      confidence: f.confidence ?? null,
    })),
    ...commitments.slice(0, 2).map((f) => ({
      tSec: f.tSec ?? null,
      label: 'Promise',
      text: f.text,
      quote: f.quote ?? null,
      confidence: f.confidence ?? null,
    })),
  ].slice(0, 8);

  return {
    summary: summary.slice(0, 700),
    executiveSummary: summary.slice(0, 900),
    details,
    agreements,
    concerns,
    roomsMentioned,
    turns,
    commitments,
    actionItems,
    agreementFacts,
    concernFacts,
    refusals,
    scopeChanges,
    changeOrders,
    moneyTalk,
    safety,
    insurance,
    unresolvedQuestions,
    contradictions: [],
    keyMoments,
    source: 'deterministic',
    model: null,
  };
}

/** Real talk worth storing — not empty, skipped, or noise-only. */
export function hasConversation(details: ConversationDetails): boolean {
  return (
    details.details.length > 0 ||
    details.agreements.length > 0 ||
    details.concerns.length > 0 ||
    details.roomsMentioned.length > 0 ||
    details.commitments.length > 0 ||
    details.actionItems.length > 0 ||
    details.refusals.length > 0 ||
    details.scopeChanges.length > 0 ||
    details.changeOrders.length > 0 ||
    details.moneyTalk.length > 0 ||
    details.safety.length > 0 ||
    details.insurance.length > 0 ||
    details.keyMoments.length > 0 ||
    Boolean(details.executiveSummary?.trim()) ||
    Boolean(details.summary?.trim() && details.turns.length > 0)
  );
}

function asFactList(value: unknown): ConversationQuotedFact[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationQuotedFact[] = [];
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      out.push({
        text: item.trim().slice(0, 320),
        tSec: null,
        quote: item.trim().slice(0, 240),
        confidence: null,
        owner: null,
        kind: null,
      });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const tRaw =
      (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    const quoteRaw = (item as { quote?: unknown }).quote;
    const ownerRaw = (item as { owner?: unknown }).owner;
    const kindRaw = (item as { kind?: unknown }).kind;
    out.push({
      text: text.slice(0, 320),
      tSec: Number.isFinite(tSec) && tSec >= 0 ? roundTime(tSec) : null,
      quote:
        typeof quoteRaw === 'string' && quoteRaw.trim()
          ? quoteRaw.trim().slice(0, 240)
          : text.slice(0, 240),
      confidence: clampConfidence((item as { confidence?: unknown }).confidence),
      owner: typeof ownerRaw === 'string' && ownerRaw.trim() ? ownerRaw.trim().slice(0, 32) : null,
      kind: typeof kindRaw === 'string' && kindRaw.trim() ? kindRaw.trim().slice(0, 32) : null,
    });
  }
  return out.slice(0, 16);
}

function asTurnList(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationTurn[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const speakerLabel =
      String((item as { speakerLabel?: unknown }).speakerLabel ?? 'Speaker A').trim() || 'Speaker A';
    const tRaw =
      (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    out.push({
      tSec: Number.isFinite(tSec) && tSec >= 0 ? roundTime(tSec) : null,
      speakerLabel: speakerLabel.slice(0, 24),
      text: text.slice(0, 500),
    });
  }
  return out.slice(0, 2_000);
}

function asKeyMoments(value: unknown): ConversationKeyMoment[] {
  if (!Array.isArray(value)) return [];
  const out: ConversationKeyMoment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const text = String((item as { text?: unknown }).text ?? '').trim();
    if (!text) continue;
    const label = String((item as { label?: unknown }).label ?? 'Moment').trim() || 'Moment';
    const tRaw =
      (item as { tSec?: unknown; atSeconds?: unknown }).tSec ?? (item as { atSeconds?: unknown }).atSeconds;
    const tSec = Number(tRaw);
    const quoteRaw = (item as { quote?: unknown }).quote;
    out.push({
      tSec: Number.isFinite(tSec) && tSec >= 0 ? roundTime(tSec) : null,
      label: label.slice(0, 40),
      text: text.slice(0, 320),
      quote:
        typeof quoteRaw === 'string' && quoteRaw.trim()
          ? quoteRaw.trim().slice(0, 240)
          : text.slice(0, 240),
      confidence: clampConfidence((item as { confidence?: unknown }).confidence),
    });
  }
  return out.slice(0, 16);
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

function preferFacts(primary: ConversationQuotedFact[], fallback: ConversationQuotedFact[]): ConversationQuotedFact[] {
  return primary.length ? primary : fallback;
}

function mergeFactLists(...lists: ConversationQuotedFact[][]): ConversationQuotedFact[] {
  const out: ConversationQuotedFact[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const fact of list) {
      const key = fact.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(fact);
      if (out.length >= 16) return out;
    }
  }
  return out;
}


function groundFactQuotes(facts: ConversationQuotedFact[], transcript: string): ConversationQuotedFact[] {
  return facts.map((fact) => {
    if (fact.quote && transcript.includes(fact.quote)) return fact;
    const hit = findVerbatimQuote(transcript, fact.quote || fact.text);
    if (!hit) return fact;
    return {
      ...fact,
      quote: hit.quote,
      tSec: fact.tSec != null ? fact.tSec : hit.tSec,
    };
  });
}

function groundConversationQuotes(details: ConversationDetails, transcript: string): ConversationDetails {
  const raw = String(transcript || '');
  if (!raw) return details;
  return {
    ...details,
    agreementFacts: groundFactQuotes(details.agreementFacts, raw),
    concernFacts: groundFactQuotes(details.concernFacts, raw),
    commitments: groundFactQuotes(details.commitments, raw),
    refusals: groundFactQuotes(details.refusals, raw),
    actionItems: groundFactQuotes(details.actionItems, raw),
    scopeChanges: groundFactQuotes(details.scopeChanges, raw),
    changeOrders: groundFactQuotes(details.changeOrders, raw),
    moneyTalk: groundFactQuotes(details.moneyTalk, raw),
    safety: groundFactQuotes(details.safety, raw),
    insurance: groundFactQuotes(details.insurance, raw),
    unresolvedQuestions: groundFactQuotes(details.unresolvedQuestions, raw),
    contradictions: groundFactQuotes(details.contradictions, raw),
  };
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
  const concernFacts = asFactList(data.concerns ?? data.objections);
  const commitments = asFactList(data.commitments ?? data.promises);
  const actionItems = asFactList(data.actionItems);
  const refusals = asFactList(data.refusals);
  const scopeChanges = asFactList(data.scopeChanges);
  const changeOrders = asFactList(data.changeOrders);
  const moneyTalk = asFactList(data.moneyTalk ?? data.money);
  const safety = asFactList(data.safety);
  const insurance = asFactList(data.insurance);
  const unresolvedQuestions = asFactList(data.unresolvedQuestions);
  const contradictions = asFactList(data.contradictions);
  const keyMoments = asKeyMoments(data.keyMoments);
  const roomsMentioned = asStringList(data.roomsMentioned ?? data.rooms, fallback.roomsMentioned);
  const details = asStringList(data.details, fallback.details);
  const summary =
    typeof data.summary === 'string' && data.summary.trim()
      ? data.summary.trim().slice(0, 700)
      : fallback.summary;
  const executiveSummary =
    typeof data.executiveSummary === 'string' && data.executiveSummary.trim()
      ? data.executiveSummary.trim().slice(0, 1200)
      : typeof data.brief === 'string' && data.brief.trim()
        ? data.brief.trim().slice(0, 1200)
        : summary;

  const parsed: ConversationDetails = {
    summary,
    executiveSummary,
    details: details.length ? details : fallback.details,
    agreements: textsOf(agreementFacts).length ? textsOf(agreementFacts) : fallback.agreements,
    concerns: textsOf(concernFacts).length ? textsOf(concernFacts) : fallback.concerns,
    roomsMentioned: roomsMentioned.length ? roomsMentioned : fallback.roomsMentioned,
    turns: turns.length ? turns : fallback.turns,
    commitments: preferFacts(commitments, fallback.commitments),
    actionItems: preferFacts(actionItems, fallback.actionItems),
    agreementFacts: preferFacts(agreementFacts, fallback.agreementFacts),
    concernFacts: preferFacts(concernFacts, fallback.concernFacts),
    refusals: preferFacts(refusals, fallback.refusals),
    scopeChanges: preferFacts(scopeChanges, fallback.scopeChanges),
    changeOrders: preferFacts(changeOrders, fallback.changeOrders),
    moneyTalk: preferFacts(moneyTalk, fallback.moneyTalk),
    safety: preferFacts(safety, fallback.safety),
    insurance: preferFacts(insurance, fallback.insurance),
    unresolvedQuestions: preferFacts(unresolvedQuestions, fallback.unresolvedQuestions),
    contradictions: preferFacts(contradictions, fallback.contradictions),
    keyMoments: keyMoments.length ? keyMoments : fallback.keyMoments,
    source: 'llm',
    model: null,
  };

  if (!hasConversation(parsed)) return null;
  return parsed;
}

const CONVERSATION_SYSTEM = `You are an expert claims / restoration office analyst reading a job-site film transcript (and optional vision notes).
Your job is a DEEP, quote-grounded conversation brief — not keyword soup.

Return JSON only (no markdown). Schema:
{
  "executiveSummary": "2-5 sentence intelligent brief for the office: what was decided, refused, promised, money/insurance, open questions",
  "summary": "1-2 sentence headline",
  "turns": [{"tSec": number|null, "speakerLabel": "Homeowner"|"Crew"|"Adjuster"|"Speaker A"|"Speaker B"|string, "text": "..."}],
  "agreements": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"owner":null,"kind":"agreement"}],
  "refusals": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"owner":null,"kind":"refusal"}],
  "commitments": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"owner":"Crew"|"Homeowner"|string,"kind":"promise"}],
  "concerns": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0}],
  "scopeChanges": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"kind":"scope"}],
  "changeOrders": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"kind":"change_order"}],
  "moneyTalk": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"kind":"money"}],
  "safety": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"kind":"safety"}],
  "insurance": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"kind":"insurance"}],
  "actionItems": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0,"owner":"...","kind":"action"}],
  "unresolvedQuestions": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0}],
  "contradictions": [{"text":"...","tSec":number|null,"quote":"...","confidence":0.0}],
  "keyMoments": [{"tSec":number|null,"label":"Agreement|Refusal|Promise|Money|Insurance|Scope|Safety|Question","text":"...","quote":"...","confidence":0.0}],
  "roomsMentioned": ["bathroom"],
  "details": ["short fact lines"]
}

Rules:
- Use [m:ss] / [h:mm:ss] stamps for tSec whenever present. Quote must be a verbatim transcript span.
- confidence 0–1 reflecting how clearly the transcript supports the claim.
- commitments MUST set owner when clear ("Crew will…", "Homeowner will…").
- Prefer Homeowner/Crew/Adjuster labels; else Speaker A/B.
- Never invent speech. Empty arrays when silent or noise-only.
- CRITICAL: quote fields must be EXACT verbatim substrings of the transcript. Do not paraphrase quotes. Do not rewrite the transcript. Structure sits ON TOP OF the verbatim log.
- Surface money/deductible, insurance/adjuster, change orders, scope in/out, safety, refusals, and unresolved questions explicitly.
- keyMoments: the 4–10 most important seekable beats for the office player.`;

function planTranscriptChunks(transcript: string): string[] {
  const raw = transcript.trim();
  if (raw.length <= SINGLE_PASS_CHARS) return [raw];
  const stamped = conversationChunks(raw);
  if (stamped.length <= 1) {
    const parts: string[] = [];
    for (let i = 0; i < raw.length; i += CHUNK_CHARS) {
      parts.push(raw.slice(i, i + CHUNK_CHARS));
    }
    return parts;
  }
  const parts: string[] = [];
  let buf = '';
  for (const chunk of stamped) {
    const piece = chunk.at == null ? chunk.text : `[${formatStamp(chunk.at)}] ${chunk.text}`;
    if (buf && buf.length + piece.length + 1 > CHUNK_CHARS) {
      parts.push(buf);
      buf = piece;
    } else {
      buf = buf ? `${buf}\n${piece}` : piece;
    }
  }
  if (buf) parts.push(buf);
  return parts.length ? parts : [raw.slice(0, SINGLE_PASS_CHARS)];
}

function formatStamp(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function mergeParsedChunks(parts: ConversationDetails[], fallback: ConversationDetails): ConversationDetails {
  if (!parts.length) return fallback;
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;
  const executive = parts
    .map((p) => p.executiveSummary || p.summary)
    .filter(Boolean)
    .slice(0, 4)
    .join(' ');
  return {
    ...first,
    summary: (first.summary || executive).slice(0, 700),
    executiveSummary: (executive || first.executiveSummary || first.summary || '').slice(0, 1200),
    details: unique(parts.flatMap((p) => p.details), 16),
    agreements: unique(parts.flatMap((p) => p.agreements), 16),
    concerns: unique(parts.flatMap((p) => p.concerns), 16),
    roomsMentioned: unique(parts.flatMap((p) => p.roomsMentioned), 12),
    turns: parts.flatMap((p) => p.turns).slice(0, 2_000),
    commitments: mergeFactLists(...parts.map((p) => p.commitments)),
    actionItems: mergeFactLists(...parts.map((p) => p.actionItems)),
    agreementFacts: mergeFactLists(...parts.map((p) => p.agreementFacts)),
    concernFacts: mergeFactLists(...parts.map((p) => p.concernFacts)),
    refusals: mergeFactLists(...parts.map((p) => p.refusals)),
    scopeChanges: mergeFactLists(...parts.map((p) => p.scopeChanges)),
    changeOrders: mergeFactLists(...parts.map((p) => p.changeOrders)),
    moneyTalk: mergeFactLists(...parts.map((p) => p.moneyTalk)),
    safety: mergeFactLists(...parts.map((p) => p.safety)),
    insurance: mergeFactLists(...parts.map((p) => p.insurance)),
    unresolvedQuestions: mergeFactLists(...parts.map((p) => p.unresolvedQuestions)),
    contradictions: mergeFactLists(...parts.map((p) => p.contradictions)),
    keyMoments: parts
      .flatMap((p) => p.keyMoments)
      .sort((a, b) => (a.tSec ?? 1e9) - (b.tSec ?? 1e9))
      .slice(0, 16),
    source: 'llm',
    model: first.model,
  };
}

export type AnalyzeConversationOpts = {
  durationSeconds?: number | null;
  /** Vision dictation / day-film summary already on the proof. */
  visionContext?: string | null;
};

/**
 * LLM-first when Ask providers are configured; deterministic only as fallback.
 * Never throws — empty/noise transcripts return an empty structure.
 */
export async function analyzeConversation(
  transcript: string | null | undefined,
  opts?: AnalyzeConversationOpts,
): Promise<ConversationDetails> {
  const raw = String(transcript || '').trim();
  if (!raw) return emptyDetails();

  const fallback = extractConversationDetails(raw);
  if (!isAskModelConfigured()) return fallback;

  const duration =
    opts?.durationSeconds != null && Number.isFinite(Number(opts.durationSeconds))
      ? Number(opts.durationSeconds)
      : null;
  const vision = String(opts?.visionContext || '').trim().slice(0, 4000);
  const chunks = planTranscriptChunks(raw);

  try {
    const parsedParts: ConversationDetails[] = [];
    let model: string | null = null;
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const completed = await completeAskText({
        system: CONVERSATION_SYSTEM,
        user: [
          duration != null ? `Clip length: ${Math.round(duration)} seconds.` : null,
          chunks.length > 1 ? `Transcript chunk ${i + 1} of ${chunks.length}.` : null,
          vision ? `Vision / dictation context (may be incomplete; transcript is ground truth for speech):\n${vision}` : null,
          'Transcript:',
          chunk,
        ]
          .filter(Boolean)
          .join('\n\n'),
        maxTokens: CONVERSATION_LLM_MAX_TOKENS,
        mode: 'analysis',
      });
      if (!completed?.text) continue;
      model = completed.model;
      const parsed = parseConversationModelJson(completed.text, fallback);
      if (parsed) parsedParts.push({ ...parsed, model: completed.model });
      else logger.warn('conversation_llm_parse_failed', { chunk: i + 1, chars: completed.text.length });
    }

    if (!parsedParts.length) {
      // Model ran but produced nothing usable — still prefer empty over inventing
      // if regex also found no substance.
      return fallback;
    }

    let merged = mergeParsedChunks(parsedParts, fallback);

    // Second pass: synthesize a single executive brief when we chunked.
    if (chunks.length > 1 && isAskModelConfigured()) {
      const sketch = JSON.stringify(
        {
          summary: merged.summary,
          agreements: merged.agreementFacts.slice(0, 6),
          refusals: merged.refusals.slice(0, 6),
          commitments: merged.commitments.slice(0, 6),
          moneyTalk: merged.moneyTalk.slice(0, 4),
          insurance: merged.insurance.slice(0, 4),
          scopeChanges: merged.scopeChanges.slice(0, 4),
          unresolvedQuestions: merged.unresolvedQuestions.slice(0, 4),
          keyMoments: merged.keyMoments.slice(0, 8),
        },
        null,
        0,
      ).slice(0, 12_000);
      const synth = await completeAskText({
        system: CONVERSATION_SYSTEM,
        user: [
          'Synthesize one final office conversation brief from these chunk extractions.',
          'Keep quote grounding and tSec values. Fill executiveSummary carefully.',
          'Extractions JSON:',
          sketch,
          vision ? `Vision context:\n${vision}` : null,
        ]
          .filter(Boolean)
          .join('\n\n'),
        maxTokens: CONVERSATION_LLM_MAX_TOKENS,
        mode: 'analysis',
      });
      if (synth?.text) {
        const finalParsed = parseConversationModelJson(synth.text, merged);
        if (finalParsed) {
          merged = {
            ...finalParsed,
            // Preserve the richer merged catalogs when synthesis trims too hard.
            turns: finalParsed.turns.length ? finalParsed.turns : merged.turns,
            agreementFacts: preferFacts(finalParsed.agreementFacts, merged.agreementFacts),
            concernFacts: preferFacts(finalParsed.concernFacts, merged.concernFacts),
            commitments: preferFacts(finalParsed.commitments, merged.commitments),
            refusals: preferFacts(finalParsed.refusals, merged.refusals),
            scopeChanges: preferFacts(finalParsed.scopeChanges, merged.scopeChanges),
            changeOrders: preferFacts(finalParsed.changeOrders, merged.changeOrders),
            moneyTalk: preferFacts(finalParsed.moneyTalk, merged.moneyTalk),
            safety: preferFacts(finalParsed.safety, merged.safety),
            insurance: preferFacts(finalParsed.insurance, merged.insurance),
            actionItems: preferFacts(finalParsed.actionItems, merged.actionItems),
            unresolvedQuestions: preferFacts(finalParsed.unresolvedQuestions, merged.unresolvedQuestions),
            contradictions: preferFacts(finalParsed.contradictions, merged.contradictions),
            keyMoments: finalParsed.keyMoments.length ? finalParsed.keyMoments : merged.keyMoments,
            source: 'llm',
            model: synth.model || model,
          };
        }
      }
    }

    return groundConversationQuotes({ ...merged, source: 'llm', model: merged.model || model }, raw);
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
    executiveSummary: details.executiveSummary,
    details: details.details,
    agreements: details.agreements,
    concerns: details.concerns,
    rooms: details.roomsMentioned,
    turns: details.turns,
    commitments: details.commitments,
    actionItems: details.actionItems,
    agreementFacts: details.agreementFacts,
    concernFacts: details.concernFacts,
    refusals: details.refusals,
    scopeChanges: details.scopeChanges,
    changeOrders: details.changeOrders,
    moneyTalk: details.moneyTalk,
    safety: details.safety,
    insurance: details.insurance,
    unresolvedQuestions: details.unresolvedQuestions,
    contradictions: details.contradictions,
    keyMoments: details.keyMoments,
  };
}

/** Hydrate stored `ai_findings.conversation` (or derive from transcript). */
export function conversationFromStored(transcript: unknown, stored: unknown): ConversationDetails {
  const text = typeof transcript === 'string' ? transcript : '';
  const derived = extractConversationDetails(text);
  if (!stored || typeof stored !== 'object') return derived;

  const row = stored as StoredConversation & Record<string, unknown>;
  const agreementFacts = asFactList(row.agreementFacts ?? row.agreements);
  const concernFacts = asFactList(row.concernFacts ?? row.concerns);
  const commitments = asFactList(row.commitments);
  const actionItems = asFactList(row.actionItems);
  const refusals = asFactList(row.refusals);
  const scopeChanges = asFactList(row.scopeChanges);
  const changeOrders = asFactList(row.changeOrders);
  const moneyTalk = asFactList(row.moneyTalk);
  const safety = asFactList(row.safety);
  const insurance = asFactList(row.insurance);
  const unresolvedQuestions = asFactList(row.unresolvedQuestions);
  const contradictions = asFactList(row.contradictions);
  const keyMoments = asKeyMoments(row.keyMoments);
  const turns = asTurnList(row.turns);
  const details = asStringList(row.details, derived.details);
  const roomsMentioned = asStringList(row.rooms ?? row.roomsMentioned, derived.roomsMentioned);
  const summary =
    typeof row.summary === 'string' && row.summary.trim() ? row.summary.trim().slice(0, 700) : derived.summary;
  const executiveSummary =
    typeof row.executiveSummary === 'string' && row.executiveSummary.trim()
      ? row.executiveSummary.trim().slice(0, 1200)
      : derived.executiveSummary || summary;
  const source =
    row.source === 'llm' || row.source === 'deterministic' || row.source === 'empty'
      ? row.source
      : details.length || turns.length
        ? 'deterministic'
        : 'empty';

  const hydrated: ConversationDetails = {
    summary,
    executiveSummary,
    details,
    agreements: asStringList(
      row.agreements,
      textsOf(agreementFacts).length ? textsOf(agreementFacts) : derived.agreements,
    ),
    concerns: asStringList(
      row.concerns,
      textsOf(concernFacts).length ? textsOf(concernFacts) : derived.concerns,
    ),
    roomsMentioned,
    turns: turns.length ? turns : derived.turns,
    commitments: preferFacts(commitments, derived.commitments),
    actionItems: preferFacts(actionItems, derived.actionItems),
    agreementFacts: preferFacts(agreementFacts, derived.agreementFacts),
    concernFacts: preferFacts(concernFacts, derived.concernFacts),
    refusals: preferFacts(refusals, derived.refusals),
    scopeChanges: preferFacts(scopeChanges, derived.scopeChanges),
    changeOrders: preferFacts(changeOrders, derived.changeOrders),
    moneyTalk: preferFacts(moneyTalk, derived.moneyTalk),
    safety: preferFacts(safety, derived.safety),
    insurance: preferFacts(insurance, derived.insurance),
    unresolvedQuestions: preferFacts(unresolvedQuestions, derived.unresolvedQuestions),
    contradictions: preferFacts(contradictions, derived.contradictions),
    keyMoments: keyMoments.length ? keyMoments : derived.keyMoments,
    source,
    model: typeof row.model === 'string' ? row.model : null,
  };
  return hasConversation(hydrated) ? hydrated : derived;
}

export function publicConversationFields(details: ConversationDetails) {
  return {
    conversationSummary: details.summary,
    conversationExecutiveSummary: details.executiveSummary,
    conversationDetails: details.details,
    conversationAgreements: details.agreements,
    conversationConcerns: details.concerns,
    conversationRooms: details.roomsMentioned,
    conversationTurns: details.turns,
    conversationCommitments: details.commitments,
    conversationActionItems: details.actionItems,
    conversationAgreementFacts: details.agreementFacts,
    conversationConcernFacts: details.concernFacts,
    conversationRefusals: details.refusals,
    conversationScopeChanges: details.scopeChanges,
    conversationChangeOrders: details.changeOrders,
    conversationMoneyTalk: details.moneyTalk,
    conversationSafety: details.safety,
    conversationInsurance: details.insurance,
    conversationUnresolvedQuestions: details.unresolvedQuestions,
    conversationContradictions: details.contradictions,
    conversationKeyMoments: details.keyMoments,
    conversationSource: details.source,
    conversationModel: details.model ?? null,
  };
}
