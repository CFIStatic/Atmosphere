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
import { completeAskText, isAskModelConfigured } from '../lib/askModel.js';
import { type MeasuredUsage } from '../lib/anthropic.js';
import {
  extractPeoplePresent,
  formatPeopleAnswer,
  hasPeople,
  type PeoplePresent,
  type PersonPresent,
  type SpeakerIndex,
} from '../audio/peoplePresent.js';

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

const CLIP_QA_SYSTEM = `You answer questions about one filed video, using only the reading of that clip.

Rules:
1. Answer only from the reading given. It is a description of video frames somebody already looked at, and when present, the VERBATIM Whisper transcript.
2. If the reading does not contain the answer, say "The footage on file does not show that" and stop. Do not reason about what was probably true. EXCEPTION: when a "Heard on the mic" / Whisper transcript is present and the question is about talk, conversation, what people said, or what they are talking about, you MUST answer from that transcript with exact quotes and seek times — never claim the footage does not show speech that was transcribed (including TV/laptop audio in the room).
3. When asked what is happening / what this video is, describe the scene: setting, people, screens, logos, news, text on screen, furniture, tools. A desk, a TV, a YouTube/news clip, or a conversation is a valid answer — not every film is construction.
4. Each video is standalone. Do not mention before/after pairing or ask for another clip.
5. For yes/no questions, start with Yes or No. If yes, say what was visible or said and when, using a spoken timestamp such as "1 hour and 52 minutes into the recording" when the reading has one.
6. Quote a timestamp when the reading has one, so the answer can be checked against the playhead.
7. EXACT SPEECH RECALL: When asked what was said, quote the EXACT words from the "Heard on the mic" / transcript section. Never invent, paraphrase, or clean up dialogue. Cite the seek time from [m:ss] stamps when present.
8. Structured agreements/concerns may summarize, but any claim about speech must still include an exact transcript quote.
9. When asked who is in the video / who is talking / who is present, answer ONLY from the People present / speakers section. Use labels like "Person 1 (crew-like)" — never invent a legal name that is not in the reading.
10. Two to eight sentences when the question needs depth (who/what/why/decided/next). This is read next to the player.
11. Never estimate cost, hours, or whether work was worth paying for.
12. CONVERSATION / TOPIC: When asked what people are talking about, what the conversation is, what they discussed, or what they decided — write 3–6 sentences explaining the SUBJECT of the talk (topics, agreements, refusals, next steps). Ground every claim in an exact transcript quote with a seek time. Do not answer with a room-layout / screen / furniture description when a transcript is present. If there is no "Heard on the mic" section, say the mic has not been read yet.
13. ACCURACY: Never invent detail that is not in the reading. If the reading marks uncertainty ("unclear", "cannot confirm", low confidence), preserve that uncertainty in your answer — do not upgrade it into a firm claim. Prefer "the footage does not show that" over a plausible guess.`;

type CorpusRow = { at: number | null; text: string; kind: string };

export function clipRecordFromEvidenceItem(item: {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
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
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function parseClock(stamp: string): number | null {
  const parts = stamp.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return null;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return null;
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

/** Topic + exact quotes with seek times from the Whisper log (turns as fallback). */
function exactSpeechAnswer(record: ClipAskRecord, opts?: { topic?: boolean }): string | null {
  const heard = splitTranscript(record.transcript).filter((row) => row.text.trim());
  const lines: string[] = [];
  if (heard.length) {
    const cap = opts?.topic ? 8 : 40;
    for (const row of heard.slice(0, cap)) {
      const when = formatClipTimeSpoken(row.at) || formatClipTime(row.at);
      const clock = when ? ` (${when})` : '';
      lines.push(`“${row.text}”${clock}`);
    }
  } else {
    for (const turn of record.conversationTurns ?? []) {
      const text = String(turn?.text || '').trim();
      if (!text) continue;
      const when = formatClipTimeSpoken(turn.tSec) || formatClipTime(turn.tSec);
      const clock = when ? ` (${when})` : '';
      const who = turn.speakerLabel ? `${turn.speakerLabel}: ` : '';
      lines.push(`“${who}${text}”${clock}`);
    }
    for (const detail of record.conversationDetails ?? []) {
      const text = String(detail || '').trim();
      if (text) lines.push(`“${text}”`);
    }
  }
  if (!lines.length) return null;
  const brief =
    String(record.conversationExecutiveSummary || record.conversationSummary || '').trim() || null;
  if (opts?.topic) {
    const head = brief
      ? `They are talking about this: ${brief}`
      : 'They are talking about this (exact words from the recording):';
    return `${head} Exact words from the recording: ${lines.join(' ')}`;
  }
  const head = brief
    ? `Yes — they are talking about this: ${brief} Exact words from the recording:`
    : 'Yes — exact words from the recording:';
  return `${head} ${lines.join(' ')}`;
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
  const unread = unreadAnswer(record.analysisState, question);
  if (unread && !hasReading(record)) return unread;

  const rows = clipCorpus(record);
  if (!rows.length) {
    return unread ?? 'This clip is still being read. Ask again once the dictation lands.';
  }

  const q = question.trim();
  if (isWhoQuestion(q)) {
    const people = peopleFromRecord(record);
    const answer = formatPeopleAnswer(people);
    if (answer) return answer;
    return 'The footage on file does not identify who is present.';
  }
  if (isWhatWasSaid(q)) {
    const speech = exactSpeechAnswer(record, { topic: isConversationTopic(q) });
    if (speech) return speech;
    return 'The footage on file does not include usable speech.';
  }

  if (isWhatHappened(q)) {
    const changes = (record.changes ?? []).map((c) => c.trim()).filter(Boolean);
    const actions = (record.actions ?? [])
      .map((a) => String(a.description || '').trim())
      .filter(Boolean);
    const date = record.workDate ? ` on ${record.workDate}` : '';
    if (changes.length) {
      return `Yes — the footage${date} shows: ${changes.slice(0, 4).join('; ')}.`;
    }
    if (actions.length) {
      return `Yes — the footage${date} shows: ${actions.slice(0, 4).join('; ')}.`;
    }
    const speech = exactSpeechAnswer(record);
    if (speech) return speech;
    const summary = (record.dictation || record.summary || '').trim();
    if (summary) return `The reading of this clip${date}: ${summary}`;
    return 'The footage on file does not show that.';
  }

  const qTokens = tokens(q);
  if (!qTokens.length) {
    const speech = exactSpeechAnswer(record);
    if (speech) return speech;
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

  if (!scored.length) {
    // Never deny on-file speech for talk-ish questions when Whisper heard it.
    if (hasUsableSpeech(record)) {
      const speech = exactSpeechAnswer(record);
      if (speech) return speech;
    }
    return yesNo
      ? 'No. The footage on file does not show that.'
      : 'The footage on file does not show that.';
  }

  if (yesNo) {
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
        const text = row.text.replace(/\.$/, '');
        if (spoken) return `At ${clock}, ${text[0].toLowerCase()}${text.slice(1)}. That was ${spoken}`;
        return text;
      })
      .join('. ') + '.'
  );
}

export function formatClipRecordForModel(record: ClipAskRecord): string {
  const lines: string[] = [];
  if (record.workDate) lines.push(`Work date: ${record.workDate}`);
  if (record.phase) lines.push(`Phase: ${record.phase}`);
  if (record.company) lines.push(`Crew: ${record.company}`);
  if (record.durationSeconds != null) lines.push(`Duration: ${formatClipTime(record.durationSeconds) ?? record.durationSeconds}s`);
  if (record.dictation) lines.push(`Dictation: ${record.dictation}`);
  if (record.summary && record.summary !== record.dictation) lines.push(`Summary: ${record.summary}`);
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
  if ((record.changes ?? []).length) lines.push(`Changes: ${record.changes!.join('; ')}`);
  for (const line of record.scope ?? []) {
    if (!line.title) continue;
    lines.push(
      `Scope: ${line.title} — ${String(line.verdict || '').replace(/_/g, ' ')}${line.because ? ` (${line.because})` : ''}`,
    );
  }
  if ((record.couldNotTell ?? []).length) lines.push(`Could not tell: ${record.couldNotTell!.join('; ')}`);
  if ((record.concerns ?? []).length) lines.push(`Concerns: ${record.concerns!.join('; ')}`);
  if (record.transcript) lines.push(`Heard on the mic (verbatim Whisper; quote exactly; never invent dialogue):\n${record.transcript}`);
  if (record.conversationExecutiveSummary) {
    lines.push(`Conversation brief: ${record.conversationExecutiveSummary}`);
  } else if (record.conversationSummary) {
    lines.push(`Conversation summary: ${record.conversationSummary}`);
  }
  for (const moment of record.conversationKeyMoments ?? []) {
    if (!moment?.text) continue;
    const when = moment.tSec != null && Number.isFinite(moment.tSec) ? ` @ ${formatClipTime(moment.tSec)}` : '';
    lines.push(`Key moment${when} (${moment.label || 'moment'}): ${moment.text}`);
  }
  for (const turn of record.conversationTurns ?? []) {
    const label = turn.speakerLabel || 'Speaker';
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
  const people = peopleFromRecord(record);
  if (hasPeople(people)) {
    lines.push('People present:');
    for (const person of people.people) {
      const when =
        person.firstSeenSec != null ? ` first ~${formatClipTime(person.firstSeenSec)}` : '';
      const appearance = person.appearance ? `; appearance: ${person.appearance}` : '';
      const speaker = person.speakerLabel ? `; speaks as ${person.speakerLabel}` : '';
      lines.push(
        `- ${person.label} [${person.role}]${appearance}${speaker}${when}`,
      );
    }
    for (const sp of people.speakers) {
      lines.push(`Speaker ${sp.speakerLabel}: ${sp.turnCount} turns`);
    }
  }
  return lines.join('\n');
}

/**
 * Prefer the grounded reading when it already answers well — skips the model
 * round-trip for speech recall, who-is-present, what-happened, and strong
 * yes/no hits with a spoken timestamp.
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
  if (isWhatHappened(question) && hasReading(record) && !/does not show that/i.test(grounded)) {
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

export async function answerFromClip(input: {
  question: string;
  record: ClipAskRecord;
  history?: ClipAskTurn[];
  onToken?: (text: string) => void;
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null }> {
  const grounded = groundedAnswerFromClip(input.question, input.record);
  const talkQuestion = isWhatWasSaid(input.question) && hasUsableSpeech(input.record);
  if (preferClipGroundedFastPath(input.question, grounded, input.record)) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  // Topic/explain talk questions: without a model, serve the grounded transcript.
  if (talkQuestion && !isAskModelConfigured() && !/does not (show that|include usable speech)/i.test(grounded)) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  if (!isAskModelConfigured()) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }

  const reading = formatClipRecordForModel(input.record).trim();
  if (!reading) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }

  const history = (input.history ?? [])
    .filter((turn) => turn.text.trim())
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text.trim()}`)
    .join('\n');

  const talkHint = talkQuestion
    ? '\n\nThis question is about the conversation. Explain what people are talking about using the Heard on the mic / transcript section. Quote exact words with seek times. Do not describe only the room, screens, or furniture.'
    : '';
  const completed = await completeAskText({
    system: CLIP_QA_SYSTEM,
    user:
      `Reading of this clip:\n\n${reading}` +
      (history ? `\n\nEarlier questions on this clip:\n${history}` : '') +
      talkHint +
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
    hasUsableSpeech(input.record) &&
    /does not (show that|include usable speech)/i.test(completed.text) &&
    !/does not (show that|include usable speech)/i.test(grounded)
  ) {
    input.onToken?.(grounded);
    return { answer: grounded, model: null, usage: null };
  }
  return { answer: completed.text, model: completed.model, usage: completed.usage };
}
