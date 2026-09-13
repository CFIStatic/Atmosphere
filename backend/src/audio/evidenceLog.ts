/**
 * Complete evidence log for a filed video.
 *
 * The product is a dense, searchable, seekable log — every useful visual and
 * speech beat — not a 12-row highlights reel. Near-duplicate text at the same
 * second is deduped; hard caps are only a safety ceiling for pathological dumps.
 */

import {
  conversationFromStored,
  hasConversation,
  type ConversationDetails,
  type ConversationQuotedFact,
} from './conversationDetails.js';
import {
  type DictationEvent,
  resolveDictationEntries,
} from '../shared/dictationEvents.js';

export const EVIDENCE_LOG_VERSION = 1;
/** Safety ceiling only — a full workday can still be dense. */
export const MAX_EVIDENCE_LOG_ENTRIES = 2_000;

export const EVIDENCE_LOG_FILTERS = [
  'all',
  'said',
  'work',
  'scene',
  'camera',
  'activity',
  'decision',
  'speech',
  'other',
] as const;

export type EvidenceLogFilter = (typeof EVIDENCE_LOG_FILTERS)[number];

export type EvidenceLogEntry = {
  atSeconds: number;
  text: string;
  /** said | work | scene | camera | activity | decision | speech | other */
  type: string;
  speakerLabel?: string | null;
  quote?: string | null;
  confidence?: number | null;
  owner?: string | null;
  kind?: string | null;
};

export type StoredEvidenceLog = {
  version: number;
  entries: EvidenceLogEntry[];
};

function roundTime(seconds: number): number {
  return Math.round(Math.max(0, seconds) * 100) / 100;
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Soft near-dupe: same second + highly overlapping text. */
function isNearDuplicate(a: EvidenceLogEntry, b: EvidenceLogEntry): boolean {
  if (Math.abs(a.atSeconds - b.atSeconds) > 1.5) return false;
  if ((a.type || '') !== (b.type || '')) return false;
  const left = normalizeKey(a.text);
  const right = normalizeKey(b.text);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.length >= 24 && right.includes(left.slice(0, 24))) return true;
  if (right.length >= 24 && left.includes(right.slice(0, 24))) return true;
  return false;
}

export function dedupeEvidenceLog(entries: EvidenceLogEntry[]): EvidenceLogEntry[] {
  const sorted = [...entries].sort(
    (a, b) => a.atSeconds - b.atSeconds || a.text.localeCompare(b.text),
  );
  const out: EvidenceLogEntry[] = [];
  for (const entry of sorted) {
    if (out.some((prev) => isNearDuplicate(prev, entry))) continue;
    out.push(entry);
    if (out.length >= MAX_EVIDENCE_LOG_ENTRIES) break;
  }
  return out;
}

function decisionEntries(details: ConversationDetails): EvidenceLogEntry[] {
  const push = (
    facts: ConversationQuotedFact[],
    label: string,
    kind: string,
  ): EvidenceLogEntry[] =>
    facts
      .filter((f) => f.text?.trim())
      .map((f) => ({
        atSeconds: f.tSec != null && Number.isFinite(f.tSec) ? roundTime(f.tSec) : 0,
        text: `${label}: ${f.text}`.slice(0, 500),
        type: 'decision',
        quote: f.quote ?? f.text,
        confidence: f.confidence ?? null,
        owner: f.owner ?? null,
        kind,
      }));

  return [
    ...push(details.agreementFacts, 'Agreement', 'agreement'),
    ...push(details.refusals, 'Refusal', 'refusal'),
    ...push(details.commitments, 'Promise', 'promise'),
    ...push(details.concernFacts, 'Concern', 'concern'),
    ...push(details.scopeChanges, 'Scope', 'scope'),
    ...push(details.changeOrders, 'Change order', 'change_order'),
    ...push(details.moneyTalk, 'Money', 'money'),
    ...push(details.insurance, 'Insurance', 'insurance'),
    ...push(details.safety, 'Safety', 'safety'),
    ...push(details.actionItems, 'Action', 'action'),
    ...push(details.unresolvedQuestions, 'Open question', 'question'),
    ...push(details.contradictions, 'Contradiction', 'contradiction'),
  ];
}

function turnEntries(details: ConversationDetails): EvidenceLogEntry[] {
  return details.turns
    .filter((t) => t.text?.trim())
    .map((t) => ({
      atSeconds: t.tSec != null && Number.isFinite(t.tSec) ? roundTime(t.tSec) : 0,
      text: t.text.slice(0, 500),
      type: 'said',
      speakerLabel: t.speakerLabel,
    }));
}

/**
 * Build the complete evidence log from vision narration + mic + conversation facts.
 */
export function buildEvidenceLog(input: {
  storedEntries?: unknown;
  narrationText?: string | null;
  summary?: string | null;
  actions?: Array<{ atSeconds?: number; description?: string; action?: string; room?: string | null }>;
  durationSeconds?: number | null;
  transcript?: string | null;
  conversation?: ConversationDetails | null;
  storedLog?: unknown;
}): EvidenceLogEntry[] {
  if (input.storedLog && typeof input.storedLog === 'object') {
    const row = input.storedLog as StoredEvidenceLog;
    if (Array.isArray(row.entries) && row.entries.length) {
      return dedupeEvidenceLog(
        row.entries
          .filter((e) => e && typeof e.text === 'string' && e.text.trim())
          .map((e) => ({
            atSeconds: Number.isFinite(Number(e.atSeconds)) ? roundTime(Number(e.atSeconds)) : 0,
            text: String(e.text).trim().slice(0, 500),
            type: String(e.type || 'other').toLowerCase(),
            speakerLabel: e.speakerLabel ?? null,
            quote: e.quote ?? null,
            confidence: e.confidence ?? null,
            owner: e.owner ?? null,
            kind: e.kind ?? null,
          })),
      );
    }
  }

  const conversation =
    input.conversation ??
    conversationFromStored(input.transcript, null);

  const visionAndSpeech = resolveDictationEntries({
    stored: input.storedEntries,
    narrationText: input.narrationText,
    summary: input.summary,
    actions: input.actions,
    durationSeconds: Number(input.durationSeconds) || undefined,
    transcript: input.transcript,
    conversation,
  });

  const fromVision: EvidenceLogEntry[] = visionAndSpeech.map((event: DictationEvent) => ({
    atSeconds: event.atSeconds,
    text: event.text,
    type: (event.type || 'other').toLowerCase(),
  }));

  const fromTurns = hasConversation(conversation) ? turnEntries(conversation) : [];
  const fromDecisions = hasConversation(conversation) ? decisionEntries(conversation) : [];

  // Prefer explicit turns when present; speechEvents already merged in resolveDictationEntries.
  return dedupeEvidenceLog([...fromVision, ...fromTurns, ...fromDecisions]);
}

export function toStoredEvidenceLog(entries: EvidenceLogEntry[]): StoredEvidenceLog {
  return {
    version: EVIDENCE_LOG_VERSION,
    entries: entries.slice(0, MAX_EVIDENCE_LOG_ENTRIES),
  };
}

export function filterEvidenceLog(
  entries: EvidenceLogEntry[],
  filter: EvidenceLogFilter | string,
): EvidenceLogEntry[] {
  if (!filter || filter === 'all') return entries;
  const want = filter.toLowerCase();
  if (want === 'decision') return entries.filter((e) => e.type === 'decision');
  if (want === 'said') return entries.filter((e) => e.type === 'said' || e.type === 'speech');
  return entries.filter((e) => e.type === want);
}
