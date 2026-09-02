/**
 * Answer a question about one clip from the reading already on file.
 *
 * The office product is one video + one reading. Re-reading the bytes for every
 * "did anything happen?" is slow and invites a second, looser inference pass.
 * The dictation, actions, timeline and scope verdicts were produced under
 * "describe only what is visible", so an answer built from them inherits that
 * discipline.
 *
 * When a model is configured it writes the prose; when it is not, a grounded
 * lookup still answers from the same record so the Ask tab works in demo and
 * in environments without a provider.
 */
import {
  anthropicClient,
  isModelProviderConfigured,
  tryExtractUsage,
  type MeasuredUsage,
} from '../lib/anthropic.js';
import { config } from '../config.js';

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

const CLIP_QA_SYSTEM = `You answer questions about one video clip. Someone already watched the frames, and when present, listened to the microphone. You only use that reading.

Voice:
- Sound like a calm colleague who watched the clip and is briefing someone. Complete sentences. Direct, professional, easy to read aloud.
- Do not dump labels, field names, room prefixes, or raw lists ("office:", "Action @ 0:12", "Changes:", semicolon-separated fragments). Fold the facts into ordinary prose.
- Do not start with "Yes —" or "the footage shows:" on open questions such as "what happened" or "what is this." Lead with what you saw.
- For yes/no questions, start with Yes or No, then one or two sentences of what was visible or said.
- Two or three sentences. This is read next to the player.
- When the reading has a timestamp, say it the way a person would: "about 1 hour and 52 minutes in."
- Quote speech when that is what was asked.

Grounding:
- Answer only from the reading given. If it does not contain the answer, say "I don't see that in this clip" and stop. Do not guess or reason about what was probably true.
- A desk, a TV, a news clip, or a conversation is a valid answer. Not every film is construction.
- Each video is standalone. Do not mention before/after pairing or ask for another clip.
- Never estimate cost, hours, or whether work was worth paying for.`;

const NOT_IN_CLIP = "I don't see that in this clip.";
const NOT_IN_CLIP_NO = "No. I don't see that in this clip.";
const NO_SPEECH = "I don't hear usable speech on this clip.";

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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "August 25, 2026" — dates people say, not ISO stamps. */
export function formatWorkDateSpoken(iso: string | null | undefined): string | null {
  const match = String(iso || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return iso ? String(iso).trim() : null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return String(iso).trim();
  return `${month} ${Number(match[3])}, ${match[1]}`;
}

function ensureSentence(text: string): string {
  const trimmed = text.trim().replace(/[.]+$/g, '');
  if (!trimmed) return '';
  return `${trimmed}.`;
}

function uncapitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function stripSceneLabel(text: string): string {
  return text.replace(/^[A-Za-z][A-Za-z0-9 /&-]{0,28}:\s+/, '').trim();
}

function uniqueObservations(items: string[]): string[] {
  const cleaned = items
    .map((item) => stripSceneLabel(item).replace(/[.;]+$/g, '').replace(/\s+/g, ' ').trim())
    .filter((item) => item.length > 2);
  const out: string[] = [];
  for (const item of cleaned) {
    const lower = item.toLowerCase();
    const idx = out.findIndex((existing) => {
      const hay = existing.toLowerCase();
      return hay === lower || hay.includes(lower) || lower.includes(hay);
    });
    if (idx >= 0) {
      if (item.length > out[idx]!.length) out[idx] = item;
      continue;
    }
    out.push(item);
  }
  return out;
}

function startsWithGerund(text: string): boolean {
  return /^[A-Za-z]+ing\b/.test(text);
}

function asSceneClause(items: string[]): string {
  const parts = uniqueObservations(items).slice(0, 4);
  if (!parts.length) return '';
  const [first, ...rest] = parts;
  let head = first!;
  head = startsWithGerund(head) ? `someone ${uncapitalize(head)}` : uncapitalize(head);
  if (!rest.length) return head;
  if (rest.length === 1) return `${head}, then ${uncapitalize(rest[0]!)}`;
  const last = rest[rest.length - 1]!;
  const mid = rest.slice(0, -1).map(uncapitalize);
  return `${head}, ${mid.join(', ')}, and ${uncapitalize(last)}`;
}

function sceneFromFragments(fragments: string[], dateSpoken: string | null): string {
  const clause = asSceneClause(fragments);
  if (!clause) return '';
  const prefix = dateSpoken ? `On ${dateSpoken}, this clip shows ` : 'This clip shows ';
  return ensureSentence(prefix + clause);
}

function withYes(yesNo: boolean, text: string): string {
  const body = text.trim();
  if (!body) return yesNo ? NOT_IN_CLIP_NO : NOT_IN_CLIP;
  if (!yesNo) return body;
  if (/^(yes|no)\b/i.test(body)) return body;
  return `Yes. ${body}`;
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
  return /what (did|was) (the )?(homeowner|owner|contractor|they|he|she|worker).*(say|ask|tell|agree|mention)|did (the )?(homeowner|owner|contractor|they).*(say|mention|agree)|what was said|anything said|heard on the mic|conversation|what did they agree/.test(
    question.toLowerCase(),
  );
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
  const text = ensureSentence(row.text);
  const spoken = formatClipTimeSpoken(row.at);
  if (rowDeniesWork(row)) {
    if (!spoken) return `No. ${text}`;
    return `No. At ${spoken}, ${uncapitalize(text)}`;
  }
  if (spoken) return `Yes. At ${spoken}, ${uncapitalize(text)}`;
  return `Yes. ${text}`;
}

function unreadAnswer(state: ClipAskAnalysisState, _question?: string): string | null {
  if (!state || state === 'done') return null;
  if (state === 'failed') {
    return 'This clip could not be read. The video itself is unaffected; re-run the analysis from the platform.';
  }
  if (state === 'skipped') {
    return 'This clip could not be read. The video itself is unaffected.';
  }
  return 'This clip is still being read. Ask again in a moment.';
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
    return unread ?? 'This clip is still being read. Ask again in a moment.';
  }

  const q = question.trim();
  const yesNo = isYesNoQuestion(q);
  if (isWhatWasSaid(q)) {
    const spoken = [
      ...(record.conversationDetails ?? []),
      ...(record.conversationAgreements ?? []),
      ...(record.conversationConcerns ?? []),
    ]
      .map((line) => line.trim())
      .filter(Boolean);
    const heard = splitTranscript(record.transcript)
      .map((row) => row.text)
      .filter(Boolean);
    const lines = spoken.length ? spoken : heard;
    if (!lines.length) return NO_SPEECH;
    const qTokens = tokens(q);
    const picked =
      yesNo && qTokens.length
        ? lines.find((line) => {
            const hay = tokens(line);
            return qTokens.some((token) => hay.some((h) => tokensOverlap(token, h)));
          }) || lines[0]
        : null;
    const body = (picked ? [picked] : lines.slice(0, 3)).map(ensureSentence).join('\n\n');
    return withYes(yesNo, body);
  }

  if (isWhatHappened(q)) {
    const dictation = (record.dictation || '').trim();
    const summary = (record.summary || '').trim();
    const changes = (record.changes ?? []).map((c) => c.trim()).filter(Boolean);
    const actions = (record.actions ?? [])
      .map((a) => String(a.description || '').trim())
      .filter(Boolean);
    const dateSpoken = formatWorkDateSpoken(record.workDate);
    if (dictation) return withYes(yesNo, ensureSentence(dictation));
    if (summary) return withYes(yesNo, ensureSentence(summary));
    if (changes.length) return withYes(yesNo, sceneFromFragments(changes, dateSpoken));
    if (actions.length) return withYes(yesNo, sceneFromFragments(actions, dateSpoken));
    return yesNo ? NOT_IN_CLIP_NO : NOT_IN_CLIP;
  }

  const qTokens = tokens(q);
  if (!qTokens.length) {
    const fallback = (record.dictation || record.summary || '').trim();
    return fallback ? ensureSentence(fallback) : NOT_IN_CLIP;
  }

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
    return yesNo ? NOT_IN_CLIP_NO : NOT_IN_CLIP;
  }

  if (yesNo) {
    const timed = scored.find((entry) => entry.row.at != null) ?? scored[0];
    return yesFromRow(timed!.row);
  }

  const best = scored[0]!;
  const timed = scored.find((entry) => entry.row.at != null);
  const top = timed && timed !== best ? [best, timed] : scored.slice(0, 2);
  return top
    .map(({ row }) => {
      const spoken = formatClipTimeSpoken(row.at);
      const text = ensureSentence(row.text);
      if (spoken) return `At ${spoken}, ${uncapitalize(text)}`;
      return text;
    })
    .join(' ');
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
  if (record.transcript) lines.push(`Heard on the mic:\n${record.transcript.slice(0, 6000)}`);
  for (const line of record.conversationDetails ?? []) lines.push(`Said: ${line}`);
  for (const line of record.conversationAgreements ?? []) lines.push(`Agreement: ${line}`);
  for (const line of record.conversationConcerns ?? []) lines.push(`Spoken concern: ${line}`);
  if ((record.conversationRooms ?? []).length) {
    lines.push(`Rooms mentioned on the mic: ${record.conversationRooms!.join(', ')}`);
  }
  return lines.join('\n');
}

/**
 * Answer from the clip reading, with a model when one is configured.
 */
export async function answerFromClip(input: {
  question: string;
  record: ClipAskRecord;
  history?: ClipAskTurn[];
}): Promise<{ answer: string; model: string | null; usage: MeasuredUsage | null }> {
  const grounded = groundedAnswerFromClip(input.question, input.record);
  if (!isModelProviderConfigured()) return { answer: grounded, model: null, usage: null };

  const reading = formatClipRecordForModel(input.record).trim();
  if (!reading) return { answer: grounded, model: null, usage: null };

  const history = (input.history ?? [])
    .filter((turn) => turn.text.trim())
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text.trim()}`)
    .join('\n');

  try {
    const response = await anthropicClient().messages.create({
      model: config.technician.assistant.model,
      max_tokens: 500,
      system: CLIP_QA_SYSTEM,
      messages: [
        {
          role: 'user',
          content:
            `Notes from watching this clip:\n\n${reading}` +
            (history ? `\n\nEarlier questions on this clip:\n${history}` : '') +
            `\n\nQuestion: ${input.question}` +
            `\n\nAnswer in natural spoken prose a colleague would say out loud. Do not paste field labels or semicolon lists.`,
        },
      ],
    });
    const answer = response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text ?? '')
      .join('\n')
      .trim();
    const usage = tryExtractUsage(response.usage);
    return answer
      ? { answer, model: response.model, usage }
      : { answer: grounded, model: null, usage };
  } catch {
    return { answer: grounded, model: null, usage: null };
  }
}
