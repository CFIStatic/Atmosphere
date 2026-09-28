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
  extractPeoplePresent,
  hasPeople,
  resolvePeoplePresent,
  type PeoplePresent,
} from './peoplePresent.js';
import {
  type DictationEvent,
  resolveDictationEntries,
} from '../shared/dictationEvents.js';
import { findVerbatimQuote } from './verbatimTranscript.js';

/**
 * 2: a fact or turn with no time of its own is timed from the transcript line
 * it quotes, or left off the timed log (it stays in the AI summary), instead
 * of being stamped 0:00.
 */
export const EVIDENCE_LOG_VERSION = 2;
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

/**
 * The real seek time for a row: its own time, else the transcript line its
 * quote came from. Null means the row describes the clip, not a moment.
 */
export function momentTime(
  tSec: number | null | undefined,
  quote: string | null | undefined,
  transcript: string | null | undefined,
): number | null {
  if (tSec != null && Number.isFinite(tSec) && tSec >= 0) return roundTime(tSec);
  const found = quote ? findVerbatimQuote(transcript, quote) : null;
  if (found?.tSec != null && Number.isFinite(found.tSec)) return roundTime(found.tSec);
  return null;
}

function decisionEntries(details: ConversationDetails, transcript?: string | null): EvidenceLogEntry[] {
  const push = (
    facts: ConversationQuotedFact[],
    label: string,
    kind: string,
  ): EvidenceLogEntry[] =>
    facts
      .filter((f) => f.text?.trim())
      .flatMap((f) => {
        const at = momentTime(f.tSec, f.quote, transcript);
        // No time and no quoted line to time it by: a clip-level point. It is in
        // the AI summary; a fake 0:00 row on the moment log would misplace it.
        if (at == null) return [];
        return [{
          atSeconds: at,
          text: `${label}: ${f.text}`.slice(0, 500),
          type: 'decision',
          quote: f.quote ?? f.text,
          confidence: f.confidence ?? null,
          owner: f.owner ?? null,
          kind,
        }];
      });

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


function peopleEntries(people: PeoplePresent): EvidenceLogEntry[] {
  const out: EvidenceLogEntry[] = [];
  for (const person of people.people) {
    const moments = person.appearMoments?.length
      ? person.appearMoments
      : person.firstSeenSec != null
        ? [{ tSec: person.firstSeenSec, note: null }]
        : [];
    for (const moment of moments) {
      const note = moment.note?.trim();
      out.push({
        atSeconds: roundTime(moment.tSec),
        text: note
          ? `${person.label}: ${note}`.slice(0, 500)
          : `${person.label} visible`.slice(0, 500),
        type: 'activity',
        speakerLabel: person.speakerLabel ?? null,
        kind: 'person',
        owner: person.role !== 'unknown' ? person.role : null,
      });
    }
  }
  return out;
}

function turnEntries(details: ConversationDetails, transcript?: string | null): EvidenceLogEntry[] {
  return details.turns
    .filter((t) => t.text?.trim())
    .flatMap((t) => {
      const at = momentTime(t.tSec, t.text, transcript);
      if (at == null) return [];
      return [{
        atSeconds: at,
        text: t.text.slice(0, 500),
        type: 'said',
        speakerLabel: t.speakerLabel,
      }];
    });
}

/**
 * Version-1 logs stamped untimed facts and turns at 0. Re-time a 0:00 row
 * from the transcript line it quotes; drop decision rows at 0:00 (clip-level
 * points, still in the AI summary) and quoted rows whose line is no longer in
 * the transcript (built from an older transcript).
 */
function retimeLegacyEntry(entry: EvidenceLogEntry, transcript: string | null | undefined): EvidenceLogEntry | null {
  if (entry.atSeconds !== 0) return entry;
  const quoted = entry.quote ?? (entry.type === 'said' && !entry.kind ? entry.text : null);
  if (entry.type === 'decision') return null;
  if (!quoted) return entry;
  if (!String(transcript || '').trim()) return entry;
  const at = momentTime(null, quoted, transcript);
  if (at == null) return null;
  return { ...entry, atSeconds: at };
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
  /** Stored ai_findings.people or raw vision people. */
  people?: unknown;
  visionPeople?: unknown;
}): EvidenceLogEntry[] {
  if (input.storedLog && typeof input.storedLog === 'object') {
    const row = input.storedLog as StoredEvidenceLog;
    if (Array.isArray(row.entries) && row.entries.length) {
      const legacy = !(Number(row.version) >= 2);
      return dedupeEvidenceLog(
        row.entries
          .filter((e) => e && typeof e.text === 'string' && e.text.trim())
          .filter((e) => e.atSeconds != null && Number.isFinite(Number(e.atSeconds)))
          .map((e) => ({
            atSeconds: roundTime(Number(e.atSeconds)),
            text: String(e.text).trim().slice(0, 500),
            type: String(e.type || 'other').toLowerCase(),
            speakerLabel: e.speakerLabel ?? null,
            quote: e.quote ?? null,
            confidence: e.confidence ?? null,
            owner: e.owner ?? null,
            kind: e.kind ?? null,
          }))
          .flatMap((e) => {
            if (!legacy) return [e];
            const kept = retimeLegacyEntry(e, input.transcript);
            return kept ? [kept] : [];
          }),
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

  const fromTurns = hasConversation(conversation) ? turnEntries(conversation, input.transcript) : [];
  const fromDecisions = hasConversation(conversation) ? decisionEntries(conversation, input.transcript) : [];

  let people = resolvePeoplePresent({
    stored: input.people,
    transcript: input.transcript,
    narrationText: input.narrationText,
    summary: input.summary,
    visionPeople: input.visionPeople,
    actions: input.actions,
  });
  if (!hasPeople(people)) {
    people = extractPeoplePresent({
      narrationText: input.narrationText,
      summary: input.summary,
      transcript: input.transcript,
      conversation: hasConversation(conversation) ? conversation : null,
      visionPeople: input.visionPeople,
      actions: input.actions,
    });
  }
  const fromPeople = hasPeople(people) ? peopleEntries(people) : [];

  // Prefer explicit turns when present; speechEvents already merged in resolveDictationEntries.
  return dedupeEvidenceLog([...fromVision, ...fromTurns, ...fromDecisions, ...fromPeople]);
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
