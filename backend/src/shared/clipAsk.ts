/**
 * Answer a question about one clip from the reading already on file.
 *
 * The office product is one video + one reading. Re-reading the bytes for every
 * "did anything happen?" is slow and invites a second, looser inference pass.
 * The dictation, actions, timeline and scope verdicts were produced under
 * "describe only what is visible", so an answer built from them inherits that
 * discipline.
 *
 * When a model is configured (Anthropic or Gemini) it writes the prose; when
 * it is not, a grounded lookup still answers from the same record so the Ask
 * tab works in demo and in environments without a provider.
 */
import { isSpeechCountQuestion, speechCountContradictions, transcriptLineCount, transcriptLines } from './speechCount.js';
import { answerQualityFailures, normalizeForMatch } from './askVerify.js';
import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { activitySystemAddendum } from './mentions.js';
import { ASK_PROSE_FORMAT_RULES, normalizeAskProse } from './askProse.js';
import { type MeasuredUsage } from '../lib/anthropic.js';
import {
  extractPeoplePresent,
  formatPeopleAnswer,
  hasPeople,
  type PeoplePresent,
  type PersonPresent,
  type SpeakerIndex,
} from '../audio/peoplePresent.js';
import { resolveSpeakerDisplayName } from '../audio/speakerIdentity.js';
import {
  PRIVACY_REDACTED_LABEL,
  privacyRedactionsFromStored,
  redactTranscriptForAsk,
  secondsInPrivacyRange,
  type PrivacyRedactionRange,
} from '../audio/privacyRedactions.js';
import {
  CHILD_PRIVACY_REDACTED_LABEL,
  childPrivacyRedactionsFromStored,
  redactTranscriptForChildPrivacy,
  secondsInChildPrivacyRange,
  type ChildPrivacyRange,
} from '../audio/childPrivacyRedactions.js';

export type ClipAskAnalysisState =
  | 'done'
  | 'queued'
  | 'failed'
  | 'skipped'
  | 'none'
  | string
  | null
  | undefined;

export type ClipAskAction = {
  atSeconds?: number | null;
  action?: string | null;
  description?: string | null;
  room?: string | null;
  object?: string | null;
  objectLabel?: string | null;
  objects?: string[];
};

export type ClipAskRecord = {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
  dictation?: string | null;
  summary?: string | null;
  materialChange?: string | null;
  materialBecause?: string | null;
  changes?: string[];
  concerns?: string[];
  couldNotTell?: string[];
  actions?: ClipAskAction[];
  dictationEntries?: Array<{ atSeconds?: number | null; text?: string | null; note?: string | null; summary?: string | null }>;
  timeline?: Array<{ startSeconds?: number | null; summary?: string | null }> | null;
  scope?: Array<{ title?: string | null; verdict?: string | null; because?: string | null }>;
  /** What was heard on the mic — contractor / homeowner talk included. */
  transcript?: string | null;
  /** idle | queued | running | done | skipped | failed */
  transcriptStatus?: string | null;
  conversationDetails?: string[];
  conversationAgreements?: string[];
  conversationConcerns?: string[];
  conversationRooms?: string[];
  conversationSummary?: string | null;
  conversationExecutiveSummary?: string | null;
  conversationTurns?: Array<{ tSec?: number | null; speakerLabel?: string; text?: string }>;
  conversationCommitments?: Array<{ text?: string; owner?: string | null } | string>;
  conversationActionItems?: Array<{ text?: string; owner?: string | null } | string>;
  conversationMoneyTalk?: Array<{ text?: string } | string>;
  conversationInsurance?: Array<{ text?: string } | string>;
  conversationKeyMoments?: Array<{ tSec?: number | null; label?: string; text?: string }>;
  conversationAgreementFacts?: Array<{ text?: string; quote?: string | null; tSec?: number | null } | string>;
  conversationConcernFacts?: Array<{ text?: string; quote?: string | null; tSec?: number | null } | string>;
  conversationRefusals?: Array<{ text?: string; quote?: string | null; tSec?: number | null } | string>;
  /** WHO is in frame / talking — structured people log. */
  peoplePresent?: PersonPresent[];
  peopleCount?: number | null;
  peopleSpeakers?: SpeakerIndex[];
  peopleSource?: string | null;
  /** Private intervals — Ask must not quote speech inside these ranges. */
  privacyRedactions?: PrivacyRedactionRange[] | { ranges?: PrivacyRedactionRange[] } | null;
  childPrivacyRedactions?: ChildPrivacyRange[] | { ranges?: ChildPrivacyRange[] } | null;
  /** Summary freshness from the library item (fresh | updating | failed | untracked | none). */
  summaryState?: string | null;
  /**
   * True when the AI conversation summary was built from an older transcript
   * (or contradicts the current one). Ask then drops it and answers from the
   * raw transcript, which is authoritative.
   */
  conversationStale?: boolean | null;
};


export type ClipAskTurn = { role: 'user' | 'assistant'; text: string };

const STOP = new Set([
  'the',
  'a',
  'an',
  'in',
  'on',
  'of',
  'to',
  'and',
  'or',
  'did',
  'does',
  'do',
  'is',
  'was',
  'are',
  'were',
  'this',
  'that',
  'it',
  'any',
  'anything',
  'something',
  'what',
  'when',
  'where',
  'how',
  'who',
  'why',
  'clip',
  'video',
  'footage',
  'they',
  'them',
  'their',
  'there',
  'for',
  'with',
  'from',
  'about',
  'have',
  'has',
  'been',
  'show',
  'shows',
  'seen',
  'visible',
  'worker',
  'workers',
  'crew',
  'person',
  'people',
  'someone',
  'somebody',
  'anyone',
  'anybody',
  'went',
  'going',
  'gone',
  'enter',
  'entered',
  'entering',
  'point',
  'anytime',
  'anypoint',
  'ever',
  'into',
  'inside',
]);

const CLIP_QA_SYSTEM = `You are a sharp, friendly expert who has already watched this video and read the mic transcript. Answer like a top-tier chat assistant (Claude / ChatGPT / Grok): natural, clear, easy to scan — never a forensic dump or a thin keyword match.

Rules:
1. Answer only from the reading given (frame description + VERBATIM Whisper transcript when present). Never invent people, quotes, times, rooms, or events.
2. If the reading does not contain the answer, say so plainly in the first sentence ("The footage on file does not show that") and stop. Do not guess. EXCEPTION: when a "Raw transcript" is present and the question is about talk / conversation / what was said, answer from that transcript — never deny on-file speech (including TV/laptop audio in the room).
3. LAYERED DEFAULT (Glance style) for broad asks ("what is happening", "what's going on", "describe this", "what are they talking about", "summarize") unless the user asks for depth:
   - Open with ONE plain sentence on what happened.
   - Follow with a few markdown bullets only (use **Label:** sparingly) — prefer who was involved, what was decided, and what's next when the reading has them.
   - Optionally invite a deeper dig ("Want the exact quotes / who said what / timestamps?").
   - Do NOT paste every timestamped quote, the full transcript, or a wall of evidence on this first pass. A desk, TV, news clip, or conversation is a valid scene — not every film is construction.
4. GO DEEP when they ask for specifics: exact quotes, who said X, timestamps, "be specific", "more detail", full conversation, verbatim, or follow-ups that dig in. Then quote EXACT transcript words with seek times ([m:ss] / spoken clock). Never invent, paraphrase, or clean up dialogue. Structured agreements may summarize, but any speech claim in deep mode still needs an exact quote.
5. Each video is standalone. Do not mention before/after pairing or ask for another clip.
6. For yes/no questions, start with Yes or No. If yes, say what was visible or said and when (spoken timestamp when the reading has one).
7. When asked who is present / talking, answer ONLY from the People present / speakers section. Use labels like "Person 1 (crew-like)" — never invent a legal name that is not in the reading.
8. Never estimate cost, hours, or whether work was worth paying for.
9. Preserve uncertainty marked in the reading ("unclear", "cannot confirm"). Prefer "the footage does not show that" over a plausible guess.
10. Tone: warm expert colleague, lightly structured, no stiff disclaimers, no wall-of-evidence unless depth was requested.
11. The raw transcript is authoritative for what was said and how much. The AI summary of the conversation may be stale (built from an older transcript). When they disagree, follow the raw transcript and never repeat the summary's claim.
12. COUNTS FIRST: when asked how many (lines, utterances, quotes, things said), the first sentence is the number, counted from the raw transcript lines ("There are **5** lines in the raw transcript."). Then list them if asked. Never open with a summary.
13. NOT IN THE EVIDENCE: when the question assumes something the reading does not show (an object, a brand, a model, an install, a repair, a person, an event, a color or other visual detail), say so plainly in the first sentence ("Not shown" / "Not established") — e.g. "The footage on file does not show a ceiling light being installed, and no brand is visible or mentioned." Do not guess, do not name a brand or time that is not in the reading, and do not answer with a nearby detail as if it were the thing asked. If the reading says a detail is illegible or unclear, say that.
14. ANSWER FORMAT for a specific question: one sentence that answers it directly, then only the supporting quotes or events with their [m:ss] times. Never paste the whole transcript or every event for a narrow question. The AI summary is supplementary; never answer from it when a transcript line or timed event covers the question.

` + ASK_PROSE_FORMAT_RULES;

type CorpusRow = { at: number | null; text: string; kind: string };

export function clipRecordFromEvidenceItem(item: {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
  transcriptStatus?: string | null;
  analysis?: ClipAskRecord | null;
}): ClipAskRecord {
  const analysis = item.analysis ?? null;
  return {
    workDate: item.workDate ?? null,
    phase: item.phase ?? null,
    company: item.company ?? null,
    durationSeconds: item.durationSeconds ?? null,
    analysisState: item.analysisState ?? analysis?.analysisState ?? null,
    dictation: analysis?.dictation ?? null,
    summary: analysis?.summary ?? null,
    materialChange: analysis?.materialChange ?? null,
    materialBecause: analysis?.materialBecause ?? null,
    changes: Array.isArray(analysis?.changes) ? analysis.changes : [],
    concerns: Array.isArray(analysis?.concerns) ? analysis.concerns : [],
    couldNotTell: Array.isArray(analysis?.couldNotTell) ? analysis.couldNotTell : [],
    actions: Array.isArray(analysis?.actions) ? analysis.actions : [],
    dictationEntries: Array.isArray(analysis?.dictationEntries) ? analysis.dictationEntries : [],
    timeline: Array.isArray(analysis?.timeline) ? analysis.timeline : null,
    scope: Array.isArray(analysis?.scope) ? analysis.scope : [],
    transcript: analysis?.transcript ?? null,
    transcriptStatus: item.transcriptStatus ?? analysis?.transcriptStatus ?? null,
    privacyRedactions: analysis?.privacyRedactions ?? null,
    childPrivacyRedactions: analysis?.childPrivacyRedactions ?? null,
    conversationDetails: Array.isArray(analysis?.conversationDetails) ? analysis.conversationDetails : [],
    conversationAgreements: Array.isArray(analysis?.conversationAgreements)
      ? analysis.conversationAgreements
      : [],
    conversationConcerns: Array.isArray(analysis?.conversationConcerns) ? analysis.conversationConcerns : [],
    conversationRooms: Array.isArray(analysis?.conversationRooms) ? analysis.conversationRooms : [],
    conversationSummary:
      typeof analysis?.conversationSummary === 'string' ? analysis.conversationSummary : null,
    conversationExecutiveSummary:
      typeof analysis?.conversationExecutiveSummary === 'string'
        ? analysis.conversationExecutiveSummary
        : null,
    conversationTurns: Array.isArray(analysis?.conversationTurns) ? analysis.conversationTurns : [],
    conversationCommitments: Array.isArray(analysis?.conversationCommitments)
      ? analysis.conversationCommitments
      : [],
    conversationActionItems: Array.isArray(analysis?.conversationActionItems)
      ? analysis.conversationActionItems
      : [],
    conversationRefusals: Array.isArray(analysis?.conversationRefusals) ? analysis.conversationRefusals : [],
    conversationMoneyTalk: Array.isArray(analysis?.conversationMoneyTalk) ? analysis.conversationMoneyTalk : [],
    conversationInsurance: Array.isArray(analysis?.conversationInsurance) ? analysis.conversationInsurance : [],
    conversationKeyMoments: Array.isArray(analysis?.conversationKeyMoments)
      ? analysis.conversationKeyMoments
      : [],
    conversationAgreementFacts: Array.isArray(analysis?.conversationAgreementFacts)
      ? analysis.conversationAgreementFacts
      : [],
    conversationConcernFacts: Array.isArray(analysis?.conversationConcernFacts)
      ? analysis.conversationConcernFacts
      : [],
    peoplePresent: Array.isArray(analysis?.peoplePresent) ? analysis.peoplePresent : [],
    peopleCount: analysis?.peopleCount ?? (Array.isArray(analysis?.peoplePresent) ? analysis.peoplePresent.length : null),
    peopleSpeakers: Array.isArray(analysis?.peopleSpeakers) ? analysis.peopleSpeakers : [],
    peopleSource: typeof analysis?.peopleSource === 'string' ? analysis.peopleSource : null,
    summaryState: typeof analysis?.summaryState === 'string' ? analysis.summaryState : null,
    conversationStale:
      analysis?.conversationStale === true ||
      analysis?.summaryState === 'updating' ||
      analysis?.summaryState === 'failed' ||
      analysis?.summaryState === 'quarantined',
  };
}

export function formatClipTime(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/** Spoken clock for Ask answers: "1 hour and 52 minutes into the recording". */
export function formatClipTimeSpoken(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const parts: string[] = [];
  if (h) parts.push(h === 1 ? '1 hour' : `${h} hours`);
  if (m) parts.push(m === 1 ? '1 minute' : `${m} minutes`);
  if (!h && !m) parts.push(r === 1 ? '1 second' : `${r} seconds`);
  else if (!h && r) parts.push(r === 1 ? '1 second' : `${r} seconds`);
  return `${parts.join(' and ')} into the recording`;
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => (token.length > 2 || SHORT_KEEP.has(token)) && !STOP.has(token));
}

/** Two-letter words that name a real thing in a question ("is the TV on?"). */
const SHORT_KEEP = new Set(['tv', 'pc', 'ac', 'hd']);

function parseClock(stamp: string): number | null {
  const parts = stamp.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
}


function privacyRangesOf(record: ClipAskRecord): PrivacyRedactionRange[] {
  return privacyRedactionsFromStored(record.privacyRedactions);
}

function childPrivacyRangesOf(record: ClipAskRecord): ChildPrivacyRange[] {
  return childPrivacyRedactionsFromStored(record.childPrivacyRedactions);
}

/** Transcript + conversation turns with private + child intervals scrubbed for Ask. */
export function speechSafeClipRecord(record: ClipAskRecord): ClipAskRecord {
  const ranges = privacyRangesOf(record);
  const childRanges = childPrivacyRangesOf(record);
  if (!ranges.length && !childRanges.length) return record;
  let transcript = redactTranscriptForAsk(record.transcript, ranges);
  transcript = redactTranscriptForChildPrivacy(transcript, childRanges);
  const turns = Array.isArray(record.conversationTurns)
    ? record.conversationTurns.map((t) => {
        const tSec = t.tSec == null ? null : Number(t.tSec);
        if (tSec == null || !Number.isFinite(tSec)) return t;
        if (secondsInPrivacyRange(tSec, ranges)) {
          return { ...t, text: PRIVACY_REDACTED_LABEL };
        }
        if (secondsInChildPrivacyRange(tSec, childRanges)) {
          return { ...t, text: CHILD_PRIVACY_REDACTED_LABEL };
        }
        return t;
      })
    : record.conversationTurns;
  return { ...record, transcript, conversationTurns: turns };
}

const CONVERSATION_FIELDS = [
  'conversationDetails',
  'conversationAgreements',
  'conversationConcerns',
  'conversationRooms',
  'conversationTurns',
  'conversationCommitments',
  'conversationActionItems',
  'conversationMoneyTalk',
  'conversationInsurance',
  'conversationKeyMoments',
  'conversationAgreementFacts',
  'conversationConcernFacts',
  'conversationRefusals',
] as const;

/** Every AI-conversation claim on the record, for checking against the transcript. */
function conversationClaims(record: ClipAskRecord): string {
  const out: string[] = [String(record.conversationExecutiveSummary ?? ''), String(record.conversationSummary ?? '')];
  for (const line of record.conversationDetails ?? []) out.push(String(line ?? ''));
  return out.filter((line) => line.trim()).join('\n');
}

/**
 * The raw transcript is authoritative. When the AI conversation summary is
 * marked stale, or it states an amount of speech the transcript contradicts
 * ("the only speech is a single fragment" over five lines), drop every
 * summary-derived field so no Ask path can repeat it. Idempotent.
 */
export function withAuthoritativeTranscript(record: ClipAskRecord): ClipAskRecord {
  const transcript = String(record.transcript ?? '').trim();
  if (!transcript) return record;
  const hasSummary = Boolean(conversationClaims(record)) || (record.conversationTurns ?? []).length > 0;
  if (!hasSummary) return record;
  const contradicted = speechCountContradictions(conversationClaims(record), [transcriptLineCount(transcript)]).length > 0;
  if (!record.conversationStale && !contradicted) return record;
  const out: ClipAskRecord = { ...record, conversationStale: true, conversationSummary: null, conversationExecutiveSummary: null };
  for (const key of CONVERSATION_FIELDS) (out as Record<string, unknown>)[key] = [];
  return out;
}

function splitTranscript(transcript: string | null | undefined): Array<{ at: number | null; text: string }> {
  const raw = String(transcript || '').trim();
  if (!raw) return [];
  const rows: Array<{ at: number | null; text: string }> = [];
  for (const chunk of raw.split(/\n+/)) {
    const match = chunk.match(/^\[((?:\d+:)+\d+)\]\s*(.+)$/);
    if (match) {
      const text = match[2]!.trim();
      if (text) rows.push({ at: parseClock(match[1]!), text });
      continue;
    }
    const text = chunk.trim();
    if (text) rows.push({ at: null, text });
  }
  return rows;
}

function tokensOverlap(query: string, hay: string): boolean {
  if (query === hay) return true;
  // Short words like "room" must not match "bathroom".
  if (query.length < 5 || hay.length < 5) return false;
  return hay.includes(query) || query.includes(hay);
}

function clipCorpus(record: ClipAskRecord): CorpusRow[] {
  const rows: CorpusRow[] = [];
  const push = (at: number | null | undefined, text: string | null | undefined, kind: string) => {
    const t = String(text || '').trim();
    if (!t) return;
    rows.push({ at: at == null || !Number.isFinite(at) ? null : Number(at), text: t, kind });
  };

  push(null, record.dictation, 'dictation');
  if (record.summary && record.summary !== record.dictation) push(null, record.summary, 'summary');
  if (record.materialBecause) push(null, record.materialBecause, 'material');
  for (const line of splitTranscript(record.transcript)) {
    push(line.at, line.text, 'heard');
  }
  for (const detail of record.conversationDetails ?? []) push(null, detail, 'heard');
  for (const line of record.conversationAgreements ?? []) push(null, line, 'heard');
  for (const line of record.conversationConcerns ?? []) push(null, line, 'heard');
  for (const room of record.conversationRooms ?? []) push(null, `Talked about the ${room}`, 'heard');
  // Prefer exact quotes from structured facts when present.
  for (const fact of record.conversationAgreementFacts ?? []) {
    if (typeof fact === 'string') {
      push(null, fact, 'heard');
      continue;
    }
    const quote = fact?.quote || fact?.text;
    if (quote) push(fact?.tSec ?? null, quote, 'heard');
  }
  for (const fact of record.conversationConcernFacts ?? []) {
    if (typeof fact === 'string') {
      push(null, fact, 'heard');
      continue;
    }
    const quote = fact?.quote || fact?.text;
    if (quote) push(fact?.tSec ?? null, quote, 'heard');
  }
  for (const fact of record.conversationRefusals ?? []) {
    if (typeof fact === 'string') {
      push(null, fact, 'heard');
      continue;
    }
    const quote = fact?.quote || fact?.text;
    if (quote) push(fact?.tSec ?? null, quote, 'heard');
  }

  for (const entry of record.dictationEntries ?? []) {
    push(entry.atSeconds, entry.text || entry.note || entry.summary, 'beat');
  }
  for (const action of record.actions ?? []) {
    const verb = String(action.action || '').replace(/_/g, ' ').trim();
    const room = String(action.room || '').trim();
    const object = String(action.objectLabel || action.object || '').trim();
    const extras = (action.objects ?? []).filter(Boolean).join(' ');
    const body = [room, verb, action.description, object, extras].filter(Boolean).join(' — ');
    push(action.atSeconds, body, 'action');
  }
  for (const window of record.timeline ?? []) {
    push(window.startSeconds, window.summary, 'window');
  }
  for (const change of record.changes ?? []) push(null, change, 'change');
  for (const line of record.scope ?? []) {
    const verdict = String(line.verdict || '').replace(/_/g, ' ');
    const body = [line.title, verdict, line.because].filter(Boolean).join(' — ');
    push(null, body, 'scope');
  }
  for (const concern of record.concerns ?? []) push(null, concern, 'concern');
  for (const gap of record.couldNotTell ?? []) push(null, gap, 'gap');
  return rows;
}

function hasReading(record: ClipAskRecord): boolean {
  return clipCorpus(record).length > 0;
}

function isWhatHappened(question: string): boolean {
  const q = question.toLowerCase();
  return /what('?s| is| was)? (happening|happing|happeniong|happened|going on)|what (did|work)|did anything|anything happen|what('s| is) (visible|going on|in this|on (the |this )?(clip|video|film|screen))|what do you see|describe (this |the )?(clip|video|film|footage)|any work/.test(
    q,
  );
}

export function isTranscriptPending(status: string | null | undefined): boolean {
  return !status || status === 'idle' || status === 'queued' || status === 'running';
}

const HEARING_MIC =
  "Still hearing the mic on this clip. Ask again in a moment for what was said.";

function isWhatWasSaid(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(talking|talk|conversation|discuss(?:ed|ing)?|said|saying|mention(?:ed)?|heard on the mic|on the mic|what was said|anything said)\b/.test(
      q,
    ) ||
    /what (are|is|was|were|did) (they|people|everyone|somebody|someone|he|she|we|you|the )?(homeowner|owner|contractor|crew|worker|they)?.{0,40}\b(talk|say|ask|tell|agree|mention|discuss)/.test(
      q,
    ) ||
    /what (did|was) (the )?(homeowner|owner|contractor|they|he|she|worker).*(say|ask|tell|agree|mention)/.test(q) ||
    /did (the )?(homeowner|owner|contractor|they).*(say|mention|agree)/.test(q) ||
    /what did they agree/.test(q) ||
    /\btopic\b|about what/.test(q)
  );
}

function hasUsableSpeech(record: ClipAskRecord): boolean {
  if (String(record.transcript || '').trim()) return true;
  if ((record.conversationDetails ?? []).some((d) => String(d || '').trim())) return true;
  if ((record.conversationTurns ?? []).some((t) => String(t?.text || '').trim())) return true;
  if (String(record.conversationExecutiveSummary || record.conversationSummary || '').trim()) return true;
  if ((record.conversationAgreements ?? []).length) return true;
  if ((record.conversationConcerns ?? []).length) return true;
  if ((record.conversationAgreementFacts ?? []).length) return true;
  if ((record.conversationKeyMoments ?? []).length) return true;
  return false;
}

function isConversationTopic(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /what (are|is|was|were) they talking about/.test(q) ||
    /what('?s| is| was) the (topic|conversation|discussion)/.test(q) ||
    /what did they (talk|discuss) about/.test(q) ||
    /what (is|was) (this |the )?(talk|conversation|discussion) about/.test(q) ||
    /\btopic\b|about what/.test(q)
  );
}

function conversationTopic(record: ClipAskRecord): string | null {
  const brief = String(record.conversationExecutiveSummary || record.conversationSummary || '').trim();
  if (brief) return brief;
  const first = splitTranscript(record.transcript).find((row) => row.text.trim());
  if (first?.text) {
    const spoken = first.text.replace(/^[^:]{1,40}:\s*/, '').trim();
    if (spoken) return spoken.length > 160 ? `${spoken.slice(0, 157)}…` : spoken;
  }
  const detail = (record.conversationDetails ?? []).map((d) => String(d || '').trim()).find(Boolean);
  return detail || null;
}

/**
 * "How many lines were said?" — the number first, from the raw transcript,
 * then each line with its time. Never from the AI summary.
 */
export function speechCountAnswer(record: ClipAskRecord): string {
  record = speechSafeClipRecord(record);
  const rows = splitTranscript(record.transcript);
  if (!rows.length) {
    if (isTranscriptPending(record.transcriptStatus)) return HEARING_MIC;
    return 'There are **0** lines in the raw transcript. No speech was transcribed on this clip.';
  }
  const n = rows.length;
  const head = `There ${n === 1 ? 'is' : 'are'} **${n}** ${n === 1 ? 'line' : 'lines'} in the raw transcript of this clip.`;
  const list = rows.slice(0, 40).map((row, i) => {
    const seek = formatClipTime(row.at);
    return `${i + 1}. ${seek ? `[${seek}] ` : ''}“${row.text}”`;
  });
  const more = n > 40 ? `\n\n(${n - 40} more lines in the transcript.)` : '';
  return `${head}\n\n${list.join('\n')}${more}`;
}

/** Words that describe the question, not the thing asked about. */
const QUESTION_FRAME = new Set([
  'timestamp', 'timestamps', 'time', 'times', 'exactly', 'exact', 'point', 'moment', 'second', 'seconds', 'minute',
  'happen', 'happens', 'happened', 'does', 'doing', 'did', 'tell', 'know', 'which', 'many', 'much', 'there',
  'recording', 'camera', 'frame', 'filmed', 'film', 'see', 'can', 'you', 'your', 'describe', 'visible',
]);
/** Specific details that need a literal hit in the reading; never inferred. */
const LITERAL_DETAIL = /^(brand|brands|make|model|manufacturer|maker|serial|sku|part|price|prices|cost|costs|dollars?|warranty|license|plate|address|phone|model number)$/;

/**
 * Question words the clip's reading and raw transcript never mention. Two or
 * more, or any literal detail like a brand or price, means the question
 * assumes something the evidence does not show.
 */
export function missingFromEvidence(question: string, record: ClipAskRecord): { missing: string[]; literal: string[] } {
  const hay = clipCorpus(record).flatMap((row) => tokens(row.text));
  const asked = tokens(question).filter((token) => !QUESTION_FRAME.has(token));
  const missing = asked.filter((token) => !hay.some((h) => tokensOverlap(token, h) || h.startsWith(token.slice(0, 5)) && token.length >= 6));
  return { missing, literal: missing.filter((token) => LITERAL_DETAIL.test(token)) };
}

function notInEvidenceAnswer(missing: string[], yesNo: boolean, record: ClipAskRecord): string {
  const words = missing.slice(0, 4).map((word) => `“${word}”`).join(', ');
  const lead = yesNo ? 'No. The footage on file does not show that.' : 'The footage on file does not show that.';
  const labelSeen = clipCorpus(record).find((row) => /\b(maker'?s name|manufacturer|logo|brand name|label|printed)\b/i.test(row.text));
  const labelNote =
    missing.some((word) => /^(brand|make|maker|manufacturer|model)$/.test(word)) && labelSeen
      ? ' The reading notes a printed name or label on something in frame but does not say what it reads.'
      : '';
  return `${lead} Nothing in this clip's reading or raw transcript mentions ${words}, so I can't give a time or detail for it.${labelNote}`;
}

/** The sentence of a long reading row that best matches the question, so a detail question is not answered with the whole narration. */
function focusRow(text: string, qTokens: string[]): string {
  if (text.length <= 320) return text;
  const parts = text.split(/(?<=[.;!?])\s+/).filter((part) => part.trim());
  let best = parts[0] ?? text;
  let bestScore = -1;
  for (const part of parts) {
    const hay = tokens(part);
    const score = qTokens.filter((token) => hay.some((h) => tokensOverlap(token, h))).length;
    if (score > bestScore) {
      best = part;
      bestScore = score;
    }
  }
  return best.trim();
}

/** Words that frame a talk question rather than name its subject. */
const TALK_FRAME = new Set([
  'mention', 'mentioned', 'mentions', 'mentioning', 'talk', 'talked', 'talking', 'talks', 'said', 'saying', 'say', 'says',
  'discuss', 'discussed', 'discussing', 'conversation', 'topic', 'heard', 'hear', 'mic', 'spoken', 'speak', 'spoke',
  'quote', 'quotes', 'verbatim', 'transcript', 'words', 'word', 'line', 'lines', 'exact', 'exactly', 'full',
  'agree', 'agreed', 'decide', 'decided', 'promise', 'promised', 'ask', 'asked', 'tell', 'told', 'want', 'wanted',
  'come', 'comes', 'came', 'bring', 'brought', 'anyone', 'everyone', 'somebody', 'recording', 'whole', 'entire',
  'give', 'read', 'back', 'list', 'repeat', 'share', 'provide', 'please', 'everything', 'all', 'each', 'every',
  // Who spoke is not what was said about: role words frame the question.
  'homeowner', 'homeowners', 'owner', 'owners', 'contractor', 'contractors', 'client', 'customer', 'adjuster',
  'inspector', 'tenant', 'guy', 'lady', 'man', 'woman', 'speaker', 'speakers', 'voice', 'voices', 'she', 'he', 'her', 'him',
]);

function askedTerm(question: string, token: string): string {
  const m = question.match(new RegExp(`\\b(${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\w*)`, 'i'));
  return m ? m[1]! : token;
}

/**
 * The transcript lines about the thing asked, with times. Null when the
 * question names no subject (a broad "what was said?"). When nothing in the
 * transcript mentions the subject, says so plainly instead of dumping lines.
 */
export function topicalSpeechAnswer(question: string, record: ClipAskRecord): string | null {
  const heard = splitTranscript(record.transcript);
  if (!heard.length) return null;
  const asked = tokens(question).filter((token) => !TALK_FRAME.has(token) && !QUESTION_FRAME.has(token));
  if (!asked.length) return null;
  const scored = heard
    .map((row) => {
      const hay = tokens(row.text);
      return { row, score: asked.filter((token) => hay.some((h) => tokensOverlap(token, h))).length };
    })
    .filter((entry) => entry.score > 0);
  const yesNo = isYesNoQuestion(question);
  const terms = asked.slice(0, 3).map((token) => `“${askedTerm(question, token)}”`).join(', ');
  const n = heard.length;
  if (!scored.length) {
    const lead = yesNo ? 'No. ' : '';
    return `${lead}Not established: the raw transcript (${n} ${n === 1 ? 'line' : 'lines'}) never mentions ${terms}.`;
  }
  const best = Math.max(...scored.map((entry) => entry.score));
  const hits = scored.filter((entry) => entry.score === best).slice(0, 6);
  const times = hits.map((entry) => formatClipTime(entry.row.at)).filter(Boolean) as string[];
  const when = times.length ? ` at ${times.length > 2 ? `${times.slice(0, -1).join(', ')}, and ${times[times.length - 1]}` : times.join(' and ')}` : '';
  const subject = asked
    .filter((token) => hits.some((entry) => tokens(entry.row.text).some((h) => tokensOverlap(token, h))))
    .slice(0, 3)
    .map((token) => `“${askedTerm(question, token)}”`)
    .join(' and ');
  const unmatched = asked
    .filter((token) => !hits.some((entry) => tokens(entry.row.text).some((h) => tokensOverlap(token, h))))
    .slice(0, 3)
    .map((token) => `“${askedTerm(question, token)}”`);
  const quotesOf = (list: typeof hits) =>
    list.map((entry) => {
      const seek = formatClipTime(entry.row.at);
      return `- ${seek ? `[${seek}] ` : ''}“${entry.row.text}”`;
    });
  // A yes/no question is only "yes" when one line carries everything asked;
  // a line that shares one word ("table") does not establish a price agreement.
  if (yesNo && unmatched.length) {
    return `No. Not established: the raw transcript (${n} ${n === 1 ? 'line' : 'lines'}) never mentions ${unmatched.join(' or ')} alongside ${subject}.\n\nClosest line${hits.length === 1 ? '' : 's'}, for context:\n${quotesOf(hits.slice(0, 3)).join('\n')}`;
  }
  // Every term is there, but in different lines: not a yes to a question about
  // them together. Say where each one comes up instead.
  if (yesNo && !unmatched.length && best < asked.length) {
    const where = asked
      .slice(0, 3)
      .map((token) => {
        const first = hits.find((entry) => tokens(entry.row.text).some((h) => tokensOverlap(token, h)));
        const at = first ? formatClipTime(first.row.at) : null;
        return `“${askedTerm(question, token)}”${at ? ` at ${at}` : ''}`;
      })
      .join('; ');
    return `Not established in any single line: ${where}.\n\n${quotesOf(hits).join('\n')}`;
  }
  const missingNote = unmatched.length ? ` ${unmatched.join(' and ')} ${unmatched.length === 1 ? 'is' : 'are'} never mentioned.` : '';
  const lead = yesNo ? `Yes. ${subject} comes up${when}.` : `${subject[0]?.toUpperCase() ?? ''}${subject.slice(1)} comes up${when}.${missingNote}`;
  return `${lead}\n\n${quotesOf(hits).join('\n')}`;
}

/** User asked to dig in — quotes, who said what, timestamps, more detail. */
export function wantsAskDepth(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\b(exact quotes?|verbatim|word[- ]for[- ]word|full (transcript|conversation|quotes?)|who said|timestamps?|seek times?|be (more )?specific|more details?|go deeper|dig (in|deeper)|every quote|quote (that|them|it|him|her)|what did (\w+ ){0,4}say)\b/.test(
      q,
    ) || /\b(tell me (exactly|precisely)|read (it|that|them) back)\b/.test(q)
  );
}

function trimSentence(value: string): string {
  return value.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
}

function bulletBlock(points: string[]): string {
  const clean = points.map((p) => trimSentence(p)).filter(Boolean);
  if (!clean.length) return '';
  return clean.map((p) => `- ${p}`).join('\n');
}

/**
 * Conversational first-turn briefing: short opener + a few key points +
 * optional invite to go deeper. No quote dump.
 */
export function layeredClipBriefing(record: ClipAskRecord, kind: 'scene' | 'topic' = 'scene'): string | null {
  const date = record.workDate ? ` on ${record.workDate}` : '';
  const changes = (record.changes ?? []).map((c) => String(c || '').trim()).filter(Boolean);
  const actions = (record.actions ?? [])
    .map((a) => String(a.description || '').trim())
    .filter(Boolean);
  const summary = String(record.dictation || record.summary || '').trim();
  const topic = conversationTopic(record);
  const points: string[] = [];

  if (kind === 'topic') {
    if (!topic && !hasUsableSpeech(record)) return null;
    const brief = record.conversationStale
      ? ''
      : String(record.conversationExecutiveSummary || record.conversationSummary || '').trim();
    const heard = splitTranscript(record.transcript);
    const otherTalk = [...(record.conversationDetails ?? []), ...(record.conversationAgreements ?? []), ...(record.conversationConcerns ?? [])]
      .some((line) => String(line || '').trim());
    if (!brief && heard.length && (record.conversationStale || !otherTalk)) {
      // No usable AI summary: say what the raw transcript has instead of
      // promoting its first line to "the topic".
      const n = heard.length;
      const shown = heard.slice(0, 5).map((row) => {
        const seek = formatClipTime(row.at);
        return `${seek ? `[${seek}] ` : ''}“${row.text}”`;
      });
      const more = n > 5 ? `\n- …and ${n - 5} more` : '';
      return `What they're talking about, from the raw transcript (${n} ${n === 1 ? 'line' : 'lines'}); no work topic is stated:\n\n${bulletBlock(shown)}${more}\n\nWant the full transcript with timestamps?`;
    }
    const opener = topic
      ? `What they're talking about, per the AI summary: ${trimSentence(topic)}.`
      : 'There is conversation on the mic in this clip.';
    for (const line of (record.conversationAgreements ?? []).slice(0, 2)) {
      const t = String(line || '').trim();
      if (t) points.push(t);
    }
    for (const line of (record.conversationConcerns ?? []).slice(0, 2)) {
      const t = String(line || '').trim();
      if (t) points.push(t);
    }
    if (!points.length && topic) points.push(trimSentence(topic));
    const body = bulletBlock(points.slice(0, 4));
    const invite = '\n\nWant the exact quotes, who said what, or timestamps?';
    return body ? `${opener}\n\n${body}${invite}` : `${opener}${invite}`;
  }

  // scene / what-is-happening
  let opener = '';
  if (changes.length) {
    opener = `Yes — the footage${date} shows ${trimSentence(changes[0]!)}.`;
  } else if (summary) {
    const first = summary.split(/(?<=\.)\s+/)[0] || summary;
    opener = trimSentence(first) + '.';
  } else if (topic) {
    opener = `This clip${date} is mainly a conversation.`;
  } else if (actions.length) {
    opener = `Yes — the footage${date} shows activity on camera.`;
  } else {
    return null;
  }

  for (const c of changes.slice(0, 3)) points.push(c);
  if (!changes.length) {
    for (const a of actions.slice(0, 2)) points.push(a);
  }
  for (const line of (record.conversationAgreements ?? []).slice(0, 2)) {
    const t = String(line || '').trim();
    if (t) points.push(`Decided: ${trimSentence(t)}`);
  }
  for (const item of (record.conversationActionItems ?? []).slice(0, 2)) {
    const t = typeof item === 'string' ? item : String(item?.text || '').trim();
    if (t) points.push(`Next: ${trimSentence(t)}`);
  }
  if (topic) {
    const shortTopic = topic.length > 140 ? `${topic.slice(0, 137)}…` : topic;
    points.push(`On the mic: ${trimSentence(shortTopic)}`);
  }
  // Deduplicate near-identical points
  const seen = new Set<string>();
  const unique = points.filter((p) => {
    const key = p.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const body = bulletBlock(unique.slice(0, 5));
  const invite = hasUsableSpeech(record)
    ? '\n\nWant the exact quotes, who said what, or timestamps?'
    : unique.length
      ? '\n\nWant timestamps for those moments?'
      : '';
  return body ? `${opener}\n\n${body}${invite}` : `${opener}${invite}`;
}

/** Topic + exact quotes with seek times from the Whisper log (turns as fallback). */
function exactSpeechAnswer(record: ClipAskRecord, opts?: { topic?: boolean }): string | null {
  record = speechSafeClipRecord(record);
  const heard = splitTranscript(record.transcript).filter((row) => row.text.trim());
  const lines: string[] = [];
  if (heard.length) {
    const cap = opts?.topic ? 8 : 40;
    for (const row of heard.slice(0, cap)) {
      const when = formatClipTimeSpoken(row.at) || formatClipTime(row.at);
      const clock = when ? ` (${when})` : '';
      const seek = formatClipTime(row.at);
      const stamp = seek ? ` [${seek}]` : '';
      lines.push(`“${row.text}”${clock}${stamp}`);
    }
  } else {
    for (const turn of record.conversationTurns ?? []) {
      const text = String(turn?.text || '').trim();
      if (!text) continue;
      const when = formatClipTimeSpoken(turn.tSec) || formatClipTime(turn.tSec);
      const clock = when ? ` (${when})` : '';
      const seek = formatClipTime(turn.tSec);
      const stamp = seek ? ` [${seek}]` : '';
      const people = peopleFromRecord(record);
      const whoLabel = turn.speakerLabel
        ? resolveSpeakerDisplayName(turn.speakerLabel, people) || turn.speakerLabel
        : '';
      const who = whoLabel ? `${whoLabel}: ` : '';
      lines.push(`“${who}${text}”${clock}${stamp}`);
    }
    for (const detail of record.conversationDetails ?? []) {
      const text = String(detail || '').trim();
      if (text) lines.push(`“${text}”`);
    }
  }
  if (!lines.length) return null;
  const topic = record.conversationStale ? null : conversationTopic(record);
  if (heard.length && !opts?.topic) {
    // Quoted straight from the raw transcript; the AI summary is not the source.
    return `Exact words from the raw transcript (${heard.length} ${heard.length === 1 ? 'line' : 'lines'}): ${lines.join(' ')}`;
  }
  if (opts?.topic) {
    const head = topic ? `AI summary: ${topic}` : 'From the raw transcript:';
    return `${head} Exact words from the recording: ${lines.join(' ')}`;
  }
  return `Exact words from the recording: ${lines.join(' ')}`;
}

function isYesNoQuestion(question: string): boolean {
  const q = question.toLowerCase().trim();
  return (
    /^(did|does|do|was|were|is|are|has|have|had|at any|anytime)\b/.test(q) ||
    /\b(go in|went in|go into|went into|enter|entered|ever go|at any point)\b/.test(q)
  );
}

function rowDeniesWork(row: CorpusRow): boolean {
  return /\b(no work|not visible|not worked|untouched|never |none of|did not|does not show)\b/i.test(
    row.text,
  );
}

function yesFromRow(row: CorpusRow): string {
  const text = row.text.replace(/\.$/, '');
  const spoken = formatClipTimeSpoken(row.at);
  if (rowDeniesWork(row)) {
    return spoken ? `No. ${text}. That was ${spoken}.` : `No. ${text}.`;
  }
  if (spoken) return `Yes. ${text}. That happened at ${spoken}.`;
  return `Yes. ${text}.`;
}

function unreadAnswer(state: ClipAskAnalysisState, _question?: string): string | null {
  if (!state || state === 'done') return null;
  if (state === 'failed') {
    return 'The reading of this clip failed. The footage itself is unaffected; re-run the analysis from the platform.';
  }
  if (state === 'skipped') {
    return 'This clip could not be read. The footage itself is unaffected.';
  }
  return 'This clip is still being read. Ask again once the dictation lands.';
}


function isWhoQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\bwho (is|are|was|were)\b/.test(q) ||
    /\bwho('?s| is) (in|on|talking|speaking|present|visible|there)\b/.test(q) ||
    /\bwho('?s| is) talking\b/.test(q) ||
    /\bpeople (in|on|present|visible)\b/.test(q) ||
    /\bwho (can|do) (you|we) see\b/.test(q)
  );
}

function peopleFromRecord(record: ClipAskRecord): PeoplePresent {
  if (Array.isArray(record.peoplePresent) && record.peoplePresent.length) {
    return {
      count: record.peopleCount ?? record.peoplePresent.length,
      people: record.peoplePresent,
      speakers: record.peopleSpeakers ?? [],
      source: (record.peopleSource as PeoplePresent['source']) || 'deterministic',
      model: null,
    };
  }
  return extractPeoplePresent({
    narrationText: record.dictation,
    summary: record.summary,
    transcript: record.transcript,
    conversation: {
      summary: null,
      executiveSummary: null,
      details: [],
      agreements: [],
      concerns: [],
      roomsMentioned: [],
      turns: (record.conversationTurns ?? []).map((t) => ({
        tSec: t.tSec ?? null,
        speakerLabel: String(t.speakerLabel || 'Speaker A'),
        text: String(t.text || ''),
      })),
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
      source: 'empty' as const,
      model: null,
    },
    actions: (record.actions ?? []).map((a) => ({
      atSeconds: a.atSeconds ?? undefined,
      description: a.description ?? undefined,
      room: a.room ?? null,
    })),
  });
}

/**
 * Deterministic answer from the clip's reading. Used when no model is
 * configured, and as a fallback if the model call fails.
 */
export function groundedAnswerFromClip(question: string, record: ClipAskRecord): string {
  record = withAuthoritativeTranscript(speechSafeClipRecord(record));
  const q = question.trim();
  if (isSpeechCountQuestion(q)) return speechCountAnswer(record);
  if (isWhoQuestion(q)) {
    const people = peopleFromRecord(record);
    const answer = formatPeopleAnswer(people);
    if (answer) return answer;
    return 'The footage on file does not identify who is present.';
  }
  // Depth / exact-recall asks get verbatim quotes. Broad topic asks stay layered.
  // (Leave what-happened+depth to the scene briefing path below.)
  if (isWhatWasSaid(q) || /\b(quote|quotes|verbatim|transcript)\b/i.test(q)) {
    const topical = topicalSpeechAnswer(q, record);
    if (topical) return topical;
  }
  if (
    wantsAskDepth(q) &&
    hasUsableSpeech(record) &&
    !isWhatHappened(q) &&
    (isWhatWasSaid(q) || /\b(quote|quotes|verbatim|transcript|who said|full conversation)\b/i.test(q))
  ) {
    const speech = exactSpeechAnswer(record, { topic: false });
    if (speech) return speech;
  }
  if (isWhatWasSaid(q)) {
    // A narrow question ("what was said about the accounting app, and when") gets the
    // matching transcript lines with times, never the whole transcript.
    const topical = topicalSpeechAnswer(q, record);
    if (topical) return topical;
    if (isConversationTopic(q) && !wantsAskDepth(q)) {
      const layered = layeredClipBriefing(record, 'topic');
      if (layered) return layered;
    }
    const speech = exactSpeechAnswer(record, { topic: false });
    if (speech) return speech;
    if (isTranscriptPending(record.transcriptStatus) || unreadAnswer(record.analysisState, q)) {
      return HEARING_MIC;
    }
    return 'The footage on file does not include usable speech.';
  }

  const unread = unreadAnswer(record.analysisState, question);
  if (unread && !hasReading(record)) return unread;

  const rows = clipCorpus(record);
  if (!rows.length) {
    return unread ?? 'This clip is still being read. Ask again once the dictation lands.';
  }

  if (isWhatHappened(q)) {
    if (wantsAskDepth(q) && hasUsableSpeech(record)) {
      const deep = exactSpeechAnswer(record, { topic: false });
      if (deep) {
        const layered = layeredClipBriefing(record, 'scene');
        return layered ? `${layered}\n\n${deep}` : deep;
      }
    }
    const layered = layeredClipBriefing(record, 'scene');
    if (layered) return layered;
    return 'The footage on file does not show that.';
  }

  const qTokens = tokens(q);
  if (!qTokens.length) {
    // Only a speech question gets the transcript; a narrow question with no
    // content words gets the scene reading, never a whole-transcript dump.
    if (isWhatWasSaid(q)) {
      const speech = exactSpeechAnswer(record);
      if (speech) return speech;
    }
    const layered = layeredClipBriefing(record, 'scene');
    if (layered) return layered;
    return (record.dictation || record.summary || 'The footage on file does not show that.').trim();
  }

  const yesNo = isYesNoQuestion(q);
  const need = Math.min(qTokens.length >= 2 ? 2 : 1, qTokens.length);
  const scored = rows
    .map((row) => {
      const hay = tokens(row.text);
      const hits = qTokens.filter((token) => hay.some((h) => tokensOverlap(token, h)));
      return { row, score: hits.length };
    })
    .filter((entry) => entry.score >= need)
    .sort((a, b) => b.score - a.score || (a.row.at ?? 0) - (b.row.at ?? 0));

  // A question that assumes something the reading never mentions (a brand, an
  // install) is answered plainly as not in the evidence, not with the nearest match.
  const gap = missingFromEvidence(q, record);
  if (gap.literal.length || gap.missing.length >= 2) return notInEvidenceAnswer(gap.missing, yesNo, record);

  if (!scored.length) {
    // Never deny on-file speech for talk-ish questions when Whisper heard it.
    if (hasUsableSpeech(record) && isWhatWasSaid(q)) {
      const speech = exactSpeechAnswer(record);
      if (speech) return speech;
    }
    return yesNo
      ? 'No. The footage on file does not show that.'
      : 'The footage on file does not show that.';
  }

  if (yesNo) {
    const state = stateAnswer(q, scored.map((entry) => entry.row), qTokens);
    if (state) return state;
    const timed = scored.find((entry) => entry.row.at != null) ?? scored[0];
    return yesFromRow(timed.row);
  }

  const best = scored[0];
  const timed = scored.find((entry) => entry.row.at != null);
  const top = timed && timed !== best ? [best, timed] : scored.slice(0, 2);
  return (
    top
      .map(({ row }) => {
        const spoken = formatClipTimeSpoken(row.at);
        const clock = formatClipTime(row.at);
        const text = focusRow(row.text, qTokens).replace(/\.$/, '');
        if (spoken) return `At ${clock}, ${text[0].toLowerCase()}${text.slice(1)}. That was ${spoken}`;
        return text;
      })
      .join('. ') + '.'
  );
}

/** On/off style states: a row that names the thing is not a yes unless it states the asked state. */
const STATE_PAIRS: Array<[RegExp, RegExp]> = [
  // "On" as a state (is on / turned on / "on," at a clause end), never the preposition ("on the ceiling").
  [
    /\b(?:is|was|are|were|turned|switched|left|stays?|remains?|powered|comes?|came) on\b|\bon\s*(?:[),.;?!]|$)|\bplaying\b|\brunning\b|\b(?:screen|display) (?:is )?(?:lit|showing)\b/i,
    /\boff\b|\bblack\/off\b|\bnot (on|playing|running)\b|\bscreen (is )?(black|dark)\b/i,
  ],
  [/\b(?:is|was|are|were|left|stands?|swung|propped) open\b|\bopen\s*(?:[),.;?!]|$)|\bopened\b/i, /\bclosed\b|\bshut\b/i],
];

function stateAnswer(question: string, rows: CorpusRow[], qTokens: string[]): string | null {
  const q = question.replace(/^\s*(is|are|was|were)\b/i, '');
  for (const [yes, no] of STATE_PAIRS) {
    const askYes = yes.test(q);
    const askNo = no.test(q);
    if (!askYes && !askNo) continue;
    const sentences = rows.flatMap((row) =>
      row.text.split(/(?<=[.;!?])\s+/).map((text) => ({ row, text: text.trim() })),
    ).filter((entry) => {
      const hay = tokens(entry.text);
      return qTokens.some((token) => hay.some((h) => tokensOverlap(token, h)));
    }).sort((a, b) => Number(a.row.at == null) - Number(b.row.at == null) || a.text.length - b.text.length);
    const said = (entry: { row: CorpusRow; text: string }) => {
      const clock = formatClipTime(entry.row.at);
      return `${entry.text.replace(/[.;,:]+$/, '')}${clock ? ` (${clock})` : ''}.`;
    };
    const negative = sentences.find((entry) => no.test(entry.text));
    const positive = sentences.find((entry) => yes.test(entry.text));
    if (askYes && negative) return `No. ${said(negative)}`;
    if (askYes && positive) return `Yes. ${said(positive)}`;
    if (askNo && negative) return `Yes. ${said(negative)}`;
    if (askNo && positive) return `No. ${said(positive)}`;
    if (sentences.length) return `Not established: the footage on file shows it but does not say either way. ${said(sentences[0]!)}`;
  }
  return null;
}

export function formatClipRecordForModel(record: ClipAskRecord): string {
  record = withAuthoritativeTranscript(speechSafeClipRecord(record));
  const lines: string[] = [];
  if (record.workDate) lines.push(`Work date: ${record.workDate}`);
  if (record.phase) lines.push(`Phase: ${record.phase}`);
  if (record.company) lines.push(`Crew: ${record.company}`);
  if (record.durationSeconds != null) lines.push(`Duration: ${formatClipTime(record.durationSeconds) ?? record.durationSeconds}s`);
  // The raw transcript goes first and is labeled authoritative: it decides
  // what was said and how much, over any AI summary below.
  if (record.transcript) {
    const count = splitTranscript(record.transcript).length;
    lines.push(
      `Raw transcript (authoritative; verbatim Whisper; ${count} ${count === 1 ? 'line' : 'lines'}; quote exactly; never invent dialogue):\n${record.transcript}`,
    );
  } else if (isTranscriptPending(record.transcriptStatus)) {
    lines.push('Raw transcript: not ready yet.');
  } else {
    lines.push('Raw transcript: none (no speech was transcribed).');
  }
  if (record.conversationStale) {
    lines.push('AI summary of the conversation: left out. It was built from an older transcript and is being regenerated; use the raw transcript.');
  }
  // Timed analysis events come next; the untimed AI description of the whole
  // clip is supplementary and goes after them.
  const overview: string[] = [];
  if (record.dictation) overview.push(`AI description of the whole clip (supplementary, untimed): ${record.dictation}`);
  if (record.summary && record.summary !== record.dictation) overview.push(`AI clip summary (supplementary, untimed): ${record.summary}`);
  if (record.materialChange) {
    lines.push(
      `Material change: ${record.materialChange}${record.materialBecause ? ` — ${record.materialBecause}` : ''}`,
    );
  }
  for (const entry of record.dictationEntries ?? []) {
    const text = entry.text || entry.note || entry.summary;
    if (!text) continue;
    const when = formatClipTime(entry.atSeconds);
    lines.push(`Beat${when ? ` @ ${when}` : ''}: ${text}`);
  }
  for (const action of record.actions ?? []) {
    const verb = String(action.action || '').replace(/_/g, ' ');
    const room = String(action.room || '').trim();
    const body = [room, verb, action.description].filter(Boolean).join(' — ');
    if (!body) continue;
    const when = formatClipTime(action.atSeconds);
    lines.push(`Action${when ? ` @ ${when}` : ''}: ${body}`);
  }
  for (const window of record.timeline ?? []) {
    if (!window.summary) continue;
    const when = formatClipTime(window.startSeconds);
    lines.push(`Window${when ? ` @ ${when}` : ''}: ${window.summary}`);
  }
  lines.push(...overview);
  if ((record.changes ?? []).length) lines.push(`Changes: ${record.changes!.join('; ')}`);
  for (const line of record.scope ?? []) {
    if (!line.title) continue;
    lines.push(
      `Scope: ${line.title} — ${String(line.verdict || '').replace(/_/g, ' ')}${line.because ? ` (${line.because})` : ''}`,
    );
  }
  if ((record.couldNotTell ?? []).length) lines.push(`Could not tell: ${record.couldNotTell!.join('; ')}`);
  if ((record.concerns ?? []).length) lines.push(`Concerns: ${record.concerns!.join('; ')}`);
  const summaryLabel = 'AI summary of the conversation (may be stale; if it disagrees with the raw transcript, the transcript is right)';
  if (record.conversationExecutiveSummary) {
    lines.push(`${summaryLabel}: ${record.conversationExecutiveSummary}`);
  } else if (record.conversationSummary) {
    lines.push(`${summaryLabel}: ${record.conversationSummary}`);
  }
  for (const moment of record.conversationKeyMoments ?? []) {
    if (!moment?.text) continue;
    const when = moment.tSec != null && Number.isFinite(moment.tSec) ? ` @ ${formatClipTime(moment.tSec)}` : '';
    lines.push(`Key moment${when} (${moment.label || 'moment'}): ${moment.text}`);
  }
  const people = peopleFromRecord(record);
  for (const turn of record.conversationTurns ?? []) {
    const label =
      resolveSpeakerDisplayName(turn.speakerLabel, people) ||
      turn.speakerLabel ||
      'Speaker';
    const when = turn.tSec != null && Number.isFinite(turn.tSec) ? ` @ ${formatClipTime(turn.tSec)}` : '';
    if (turn.text) lines.push(`${label}${when}: ${turn.text}`);
  }
  for (const line of record.conversationDetails ?? []) lines.push(`Said: ${line}`);
  for (const line of record.conversationAgreements ?? []) lines.push(`Agreement: ${line}`);
  for (const line of record.conversationConcerns ?? []) lines.push(`Spoken concern: ${line}`);
  for (const item of record.conversationCommitments ?? []) {
    const text = typeof item === 'string' ? item : item?.text;
    const owner = typeof item === 'object' && item && 'owner' in item ? item.owner : null;
    if (text) lines.push(`Commitment${owner ? ` (${owner})` : ''}: ${text}`);
  }
  for (const item of record.conversationRefusals ?? []) {
    const text = typeof item === 'string' ? item : item?.text;
    if (text) lines.push(`Refusal: ${text}`);
  }
  for (const item of record.conversationMoneyTalk ?? []) {
    const text = typeof item === 'string' ? item : item?.text;
    if (text) lines.push(`Money: ${text}`);
  }
  for (const item of record.conversationInsurance ?? []) {
    const text = typeof item === 'string' ? item : item?.text;
    if (text) lines.push(`Insurance: ${text}`);
  }
  for (const item of record.conversationActionItems ?? []) {
    const text = typeof item === 'string' ? item : item?.text;
    if (text) lines.push(`Action item: ${text}`);
  }
  if ((record.conversationRooms ?? []).length) {
    lines.push(`Rooms mentioned on the mic: ${record.conversationRooms!.join(', ')}`);
  }
  if (hasPeople(people)) {
    lines.push('People present:');
    for (const person of people.people) {
      const when =
        person.firstSeenSec != null ? ` first ~${formatClipTime(person.firstSeenSec)}` : '';
      const appearance = person.appearance ? `; appearance: ${person.appearance}` : '';
      const name = (person.displayName && person.displayName.trim()) || person.label;
      const speaker =
        person.speakerLabel && name !== person.speakerLabel
          ? `; was ${person.speakerLabel}`
          : person.speakerLabel
            ? `; speaks as ${person.speakerLabel}`
            : '';
      const via =
        person.identityMethod && person.identityMethod !== 'unknown'
          ? `; identity via ${person.identityMethod}`
          : '';
      lines.push(`- ${name} [${person.role}]${appearance}${speaker}${via}${when}`);
    }
    for (const sp of people.speakers) {
      const name = (sp.displayName && sp.displayName.trim()) || sp.speakerLabel;
      lines.push(`${name}: ${sp.turnCount} turns`);
    }
  }
  return lines.join('\n');
}

/**
 * Prefer the grounded reading when it already answers well — skips the model
 * round-trip for exact speech recall, who-is-present, depth digs, and strong
 * yes/no hits with a spoken timestamp. Broad what-happened / topic asks go to
 * the model for conversational prose when a key is configured.
 */
function isTopicExplainQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return (
    /\btopic\b|about what|what are they talking|what is (the |this )?conversation|explain (the |this )?(talk|conversation)/.test(
      q,
    )
  );
}

export function preferClipGroundedFastPath(question: string, grounded: string, record: ClipAskRecord): boolean {
  if (/still being read|reading of this clip failed|could not be read/i.test(grounded)) return false;
  if (/still hearing the mic/i.test(grounded)) return true;
  // A line count is exact from the transcript; no model needed.
  if (isSpeechCountQuestion(question) && /lines? in the raw transcript/.test(grounded)) return true;
  // Exact speech recall is instant from the transcript. Topic/explain questions
  // still use the fast Ask model (with talkHint) so they can summarize.
  if (
    isWhatWasSaid(question) &&
    hasUsableSpeech(record) &&
    !isTopicExplainQuestion(question) &&
    !/does not (show that|include usable speech)/i.test(grounded)
  ) {
    return true;
  }
  if (isWhoQuestion(question) && hasPeople(peopleFromRecord(record)) && !/does not identify who/i.test(grounded)) {
    return true;
  }
  // Broad what-happened / topic asks go to the model for conversational prose.
  // Depth digs still use the grounded transcript path for instant exact quotes.
  if (
    wantsAskDepth(question) &&
    hasUsableSpeech(record) &&
    (isWhatWasSaid(question) || /\b(quote|quotes|verbatim|transcript|who said|full conversation)\b/i.test(question)) &&
    !/does not (show that|include usable speech)/i.test(grounded)
  ) {
    return true;
  }
  if (
    isYesNoQuestion(question) &&
    /^(Yes|No)\./.test(grounded) &&
    /into the recording/.test(grounded) &&
    !/does not show that/i.test(grounded)
  ) {
    return true;
  }
  return false;
}

/**
 * Retrieval first: the transcript lines and timed events that share words
 * with the question, with their times. The model sees these before the rest.
 */
export function relevantClipEvidence(question: string, record: ClipAskRecord, limit = 8): string[] {
  const asked = tokens(question).filter((token) => !QUESTION_FRAME.has(token) && !TALK_FRAME.has(token));
  if (!asked.length) return [];
  const rows = clipCorpus(record).filter((row) => row.kind === 'heard' || row.at != null);
  return rows
    .map((row) => {
      const hay = tokens(row.text);
      return { row, score: asked.filter((token) => hay.some((h) => tokensOverlap(token, h))).length };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || (a.row.at ?? 1e9) - (b.row.at ?? 1e9))
    .slice(0, limit)
    .sort((a, b) => (a.row.at ?? 1e9) - (b.row.at ?? 1e9))
    .map(({ row }) => {
      const seek = formatClipTime(row.at);
      const source = row.kind === 'heard' ? 'transcript' : 'event';
      return `- ${seek ? `[${seek}] ` : '[untimed] '}(${source}) ${row.text.length > 300 ? `${row.text.slice(0, 297)}…` : row.text}`;
    });
}

export async function answerFromClip(input: {
  question: string;
  record: ClipAskRecord;
  history?: ClipAskTurn[];
  onToken?: (text: string) => void;
  /** Org-scoped dossier for people @mentioned in the question. */
  supplement?: string | null;
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null }> {
  input = { ...input, record: withAuthoritativeTranscript(speechSafeClipRecord(input.record)) };
  const grounded = groundedAnswerFromClip(input.question, input.record);
  const supplement = String(input.supplement ?? '').trim();
  if (!supplement && /still hearing the mic/i.test(grounded)) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  const talkQuestion = isWhatWasSaid(input.question) && hasUsableSpeech(input.record);
  if (!supplement && preferClipGroundedFastPath(input.question, grounded, input.record)) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  // Topic/explain talk questions: without a model, serve the grounded transcript.
  if (!supplement && talkQuestion && !isAskModelConfigured() && !/does not (show that|include usable speech)/i.test(grounded)) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  if (!isAskModelConfigured()) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }

  const reading = formatClipRecordForModel(input.record).trim();
  if (!reading && !supplement) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }

  const history = (input.history ?? [])
    .filter((turn) => turn.text.trim())
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text.trim()}`)
    .join('\n');

  const completed = await completeAskText({
    system:
      CLIP_QA_SYSTEM +
      (supplement
        ? activitySystemAddendum(supplement) ??
          `\n\nThe question may @mention a coworker. When it does, answer from MENTIONED PEOPLE using their full name. That list is their complete set of clips, not a sample. Cite jobs and videos with ⟦sources: job/<jobId>/<slug>, video/<jobId>/<proofId>/<slug>⟧. If the asked detail is not on file, say so in a natural sentence and list what is on file. Never write [[web:…]].`
        : ''),
    user:
      (() => {
        const hits = relevantClipEvidence(input.question, input.record);
        return hits.length
          ? `Evidence matching the question (use this first; quote it with its time):\n${hits.join('\n')}\n\n`
          : `Evidence matching the question: nothing in the transcript or timed events shares its key words. If the question assumes something, say it is not shown.\n\n`;
      })() +
      `Reading of this clip:\n\n${reading}` +
      (supplement ? `\n\n${supplement}` : '') +
      (history ? `\n\nEarlier questions on this clip:\n${history}` : '') +
      `\n\nQuestion: ${input.question}`,
    mode: 'interactive',
    onToken: input.onToken,
  });
  if (!completed) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  // If the model wrongly denies on-file speech, keep the grounded transcript answer.
  if (
    !supplement &&
    hasUsableSpeech(input.record) &&
    /does not (show that|include usable speech)/i.test(completed.text) &&
    !/does not (show that|include usable speech)/i.test(grounded)
  ) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  // A model answer that states a different amount of speech than the raw
  // transcript ("only one fragment" over five lines) is not shown.
  const lineCount = transcriptLineCount(input.record.transcript);
  if (lineCount && speechCountContradictions(completed.text, [lineCount]).length) {
    // Only a count question gets the full count listing; a narrow question
    // gets the evidence-first answer instead of a transcript dump.
    const fixed = isSpeechCountQuestion(input.question) ? speechCountAnswer(input.record) : grounded;
    input.onToken?.(`\n\n${fixed}`);
    return { answer: fixed, model: completed.model, usage: completed.usage };
  }
  // Post-generation shape and support checks. A model answer that contradicts
  // itself, skips the number or the time, dumps the whole transcript, or claims
  // work / prices / commitments the reading does not support is replaced by the
  // grounded answer when that one checks out better.
  if (!supplement) {
    const evidenceNorm = normalizeForMatch(reading);
    const transcripts = [transcriptLines(input.record.transcript)];
    const modelIssues = answerQualityFailures({ question: input.question, answer: completed.text, transcripts, evidenceNorm });
    if (modelIssues.length) {
      const groundedIssues = answerQualityFailures({ question: input.question, answer: grounded, transcripts, evidenceNorm });
      if (groundedIssues.length < modelIssues.length) {
        input.onToken?.(`\n\n${grounded}`);
        return { answer: grounded, model: completed.model, usage: completed.usage };
      }
    }
  }
  const answer = normalizeAskProse(completed.text);
  return { answer, model: completed.model, usage: completed.usage };
}
