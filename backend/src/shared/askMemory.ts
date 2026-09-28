/**
 * Long-horizon memory for one Ask thread.
 *
 * The recent turns stay verbatim. Everything older is folded into a bounded
 * summary, and a few preferences and decisions are kept as notes that name
 * the turn they came from. The summary is rebuilt as the thread grows so a
 * chat that runs for weeks still fits in the prompt.
 *
 * This module does not write to the database and does not touch
 * job_proof_questions. Callers redact before anything is stored.
 */

export type StoredAskPair = {
  id: string;
  question: string;
  answer?: string | null;
  createdAt: string;
};

export type ThreadMemoryTurn = {
  id?: string | null;
  role: 'user' | 'assistant';
  text: string;
  at?: string | null;
};

/** A preference or decision kept after the turn that produced it scrolls out of the verbatim window. */
export type DurableJobNote = {
  note: string;
  sourceQuestionId: string | null;
  at: string | null;
};

export type LongThreadMemory = {
  summary: string;
  notes: DurableJobNote[];
  /** ISO time the question is being answered. Relative phrases ("last week") use this. */
  now?: string | null;
};

export type ThreadMemoryFold = {
  summary: string;
  summaryThroughId: string | null;
  coveredCount: number;
  recent: ThreadMemoryTurn[];
  notes: DurableJobNote[];
  /** True when the stored summary does not yet cover the older turns. */
  regenerate: boolean;
};

/** Last four exchanges stay verbatim (eight messages). */
const RECENT_PAIRS = 4;
const NOTE_LIMIT = 12;
const SUMMARY_BUDGET = 1600;
const LINE_MAX = 220;

const NOTE_STOP = new Set([
  'last',
  'week',
  'weeks',
  'you',
  'your',
  'said',
  'say',
  'something',
  'what',
  'did',
  'does',
  'we',
  'about',
  'the',
  'and',
  'that',
  'this',
  'earlier',
  'remember',
  'recall',
  'decide',
  'decided',
  'decision',
  'told',
  'mentioned',
  'wanted',
  'asked',
  'noted',
  'from',
  'turn',
  'please',
  'just',
  'with',
  'have',
  'been',
  'were',
  'was',
  'ago',
  'there',
  'here',
  'when',
  'where',
  'which',
  'would',
  'could',
  'should',
  'into',
  'onto',
  'than',
  'then',
  'them',
  'they',
  'our',
  'for',
]);

function clean(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  const text = clean(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function noteKey(note: string): string {
  return clean(note).toLowerCase();
}

function zoneOrDefault(timeZone?: string | null): string {
  const zone = (timeZone ?? '').trim() || 'America/Chicago';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
    return zone;
  } catch {
    return 'UTC';
  }
}

export function memoryDayLabel(iso: string | null | undefined, timeZone?: string | null): string {
  const ms = Date.parse(String(iso ?? ''));
  if (!Number.isFinite(ms)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: zoneOrDefault(timeZone),
    month: 'short',
    day: 'numeric',
  }).format(new Date(ms));
}

function calendarDayIndex(iso: string, timeZone?: string | null): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: zoneOrDefault(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(parts);
  if (!match) return null;
  return Math.round(Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`) / 86_400_000);
}

/** How the day of a turn reads against "now": yesterday, last week, two weeks ago. */
export function relativeDayPhrase(at: string | null | undefined, now: Date, timeZone?: string | null): string {
  if (!at) return 'earlier';
  const then = calendarDayIndex(at, timeZone);
  const today = calendarDayIndex(now.toISOString(), timeZone);
  if (then == null || today == null) return 'earlier';
  const days = today - then;
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  if (days < 21) return 'two weeks ago';
  if (days < 45) return 'a few weeks ago';
  return 'earlier';
}

function clause(raw: string): string {
  return clean(raw).replace(/[.!?,;:]+$/g, '').replace(/^(?:to|that)\s+/i, '').trim();
}

/** Pull short durable notes out of one thing the user (or the answer) said. */
export function extractDurableNotes(text: string): string[] {
  const q = clean(text);
  if (!q) return [];
  const notes: string[] = [];
  if (/\bhomeowner summar(?:y|ies)\b/i.test(q) && /\b(?:brief|short|concise)\b/i.test(q)) {
    notes.push('user wants homeowner summaries brief');
  } else if (
    /\bsummar(?:y|ies)\b/i.test(q) &&
    /\b(?:brief|short|concise)\b/i.test(q) &&
    /\b(?:keep|want|wants|prefer|prefers|should)\b/i.test(q)
  ) {
    notes.push('user wants summaries brief');
  }
  const decided = q.match(/\bdecided to\s+([^?.!]{6,160})/i);
  if (decided?.[1]) notes.push(`decided to ${clause(decided[1])}`);
  const redo = q.match(/\b(?:let's|lets|we(?:'re| are) going to|i'm going to|going to)\s+(redo\s+[^?.!]{4,120})/i);
  if (redo?.[1]) notes.push(`decided to ${clause(redo[1])}`);
  const remember = q.match(/\bremember that\s+([^?.!]{8,160})/i);
  if (remember?.[1]) notes.push(clause(remember[1]));
  const want = q.match(/\b(?:i|we|the homeowner|homeowner)\s+want(?:s)?\s+([^?.!]{8,140})/i);
  if (want?.[1] && !/\bsummar/i.test(q)) notes.push(`user wants ${clause(want[1])}`);
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = noteKey(note);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function firstSentence(text: string): string {
  const cleanText = clean(text);
  if (!cleanText) return '';
  const sentence = cleanText.split(/(?<=[.!?])\s/)[0] ?? cleanText;
  return sentence;
}

function pairNotes(pair: StoredAskPair): DurableJobNote[] {
  const fromQuestion = extractDurableNotes(pair.question).map((note) => ({
    note,
    sourceQuestionId: pair.id,
    at: pair.createdAt || null,
  }));
  if (fromQuestion.length) return fromQuestion;
  return extractDurableNotes(pair.answer ?? '').map((note) => ({
    note,
    sourceQuestionId: pair.id,
    at: pair.createdAt || null,
  }));
}

export function capDurableNotes(notes: DurableJobNote[]): DurableJobNote[] {
  const ordered = [...notes].sort((a, b) => String(a.at ?? '').localeCompare(String(b.at ?? '')));
  const unique: DurableJobNote[] = [];
  const seen = new Set<string>();
  for (const note of ordered) {
    const key = noteKey(note.note);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push({ note: clip(note.note, 180), sourceQuestionId: note.sourceQuestionId, at: note.at });
  }
  if (unique.length <= NOTE_LIMIT) return unique;
  const early = unique.slice(0, 4);
  const late = unique.slice(-(NOTE_LIMIT - early.length));
  const merged = [...early];
  for (const note of late) {
    if (!merged.some((row) => noteKey(row.note) === noteKey(note.note))) merged.push(note);
  }
  return merged;
}

export function mergeDurableNotes(stored: DurableJobNote[], extracted: DurableJobNote[]): DurableJobNote[] {
  return capDurableNotes([...stored, ...extracted]);
}

function isNotable(question: string): boolean {
  return extractDurableNotes(question).length > 0;
}

function summaryLine(pair: StoredAskPair, timeZone?: string | null): string {
  const when = memoryDayLabel(pair.createdAt, timeZone) || 'Earlier';
  const user = clip(pair.question, 160);
  const answer = clip(firstSentence(pair.answer ?? ''), 120);
  return answer ? `${when}: ${user} — ${answer}` : `${when}: ${user}`;
}

function packSummary(pairs: StoredAskPair[], olderCount: number, timeZone?: string | null): string {
  if (!pairs.length) return '';
  const lines = pairs.map((pair, index) => ({
    text: clip(summaryLine(pair, timeZone), LINE_MAX),
    keep: index === 0 || index >= pairs.length - 3 || isNotable(pair.question),
  }));
  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number) => {
    const line = lines[index];
    if (!line || chosen.has(index)) return;
    const next = used + line.text.length + 1;
    if (chosen.size && next > SUMMARY_BUDGET && !line.keep) return;
    if (next > SUMMARY_BUDGET && chosen.size) {
      const room = SUMMARY_BUDGET - used - 1;
      if (room < 40) return;
      chosen.add(index);
      used += room + 1;
      lines[index] = { ...line, text: clip(line.text, room) };
      return;
    }
    chosen.add(index);
    used = next;
  };
  lines.forEach((line, index) => {
    if (line.keep) take(index);
  });
  for (let index = lines.length - 1; index >= 0; index -= 1) take(index);
  const packed = lines.filter((_, index) => chosen.has(index)).map((line) => line.text);
  const omitted = Math.max(0, olderCount - packed.length);
  const header =
    omitted > 0
      ? `Earlier turns (${olderCount} before the recent ones; ${omitted} routine exchanges folded):`
      : `Earlier turns (${olderCount} before the recent ones):`;
  return `${header}\n${packed.join('\n')}`.slice(0, SUMMARY_BUDGET + header.length + 1);
}

function pairToTurns(pair: StoredAskPair): ThreadMemoryTurn[] {
  const turns: ThreadMemoryTurn[] = [];
  const question = clean(pair.question);
  if (question) turns.push({ id: pair.id, role: 'user', text: question, at: pair.createdAt || null });
  const answer = clean(pair.answer);
  if (answer) turns.push({ id: pair.id, role: 'assistant', text: answer, at: pair.createdAt || null });
  return turns;
}

/**
 * Recent turns verbatim, a bounded summary of the older ones, and notes.
 * Pass the previous summary so a thread that has not grown keeps it.
 * A new older turn sets regenerate, and the summary is rebuilt from the
 * older turns rather than appended without a limit.
 */
export function foldThreadMemory(input: {
  pairs: StoredAskPair[];
  previousSummary?: string | null;
  summarizedThroughId?: string | null;
  timeZone?: string | null;
}): ThreadMemoryFold {
  const chronological = [...input.pairs].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const recentPairs = chronological.slice(-RECENT_PAIRS);
  const olderPairs = chronological.slice(0, Math.max(0, chronological.length - recentPairs.length));
  const summaryThroughId = olderPairs.length ? olderPairs[olderPairs.length - 1]!.id : null;
  const freshSummary = packSummary(olderPairs, olderPairs.length, input.timeZone);
  const previous = String(input.previousSummary ?? '').trim();
  const regenerate = Boolean(freshSummary) && (!previous || input.summarizedThroughId !== summaryThroughId);
  const notes = capDurableNotes(chronological.flatMap(pairNotes));
  return {
    summary: regenerate || !previous ? freshSummary : previous,
    summaryThroughId,
    coveredCount: olderPairs.length,
    recent: recentPairs.flatMap(pairToTurns),
    notes,
    regenerate,
  };
}

/** Replace redacted phrases, then drop a note that is only a redaction marker. */
export function scrubLongMemory(
  memory: { summary: string; notes: DurableJobNote[] },
  scrub: (text: string) => string,
): { summary: string; notes: DurableJobNote[] } {
  const summary = scrub(memory.summary);
  const notes = memory.notes.flatMap((note) => {
    const text = clean(scrub(note.note));
    if (!text || /\[privacy redacted\]/i.test(text)) return [];
    return [{ ...note, note: text }];
  });
  return { summary, notes };
}

/**
 * The user is asking about an earlier turn ("last week you said…",
 * "what did we decide"), not about a clip on the file.
 */
export function isLongMemoryQuestion(question: string): boolean {
  const q = clean(question);
  if (!q) return false;
  if (/\bwhat did (?:i|we|you) decide\b/i.test(q)) return true;
  if (
    /\b(?:last week|yesterday|the other day|weeks ago|a while ago|last month|two weeks ago)\b/i.test(q) &&
    /\b(?:said|say|told|decided|mentioned|wanted|asked|noted|decide)\b/i.test(q)
  ) {
    return true;
  }
  if (/\b(?:remember|recall)\b/i.test(q) && /\b(?:said|decided|wanted|asked|told|mentioned)\b/i.test(q)) return true;
  return false;
}

function contentWords(question: string): string[] {
  return clean(question)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !NOTE_STOP.has(word));
}

function timeCue(question: string): string | null {
  if (/\blast week\b/i.test(question)) return 'last week';
  if (/\byesterday\b/i.test(question)) return 'yesterday';
  if (/\btwo weeks ago\b/i.test(question)) return 'two weeks ago';
  if (/\ba few weeks ago\b/i.test(question)) return 'a few weeks ago';
  return null;
}

function capitalize(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function speakNote(note: string, when: string, day: string, cue: string | null): string {
  const timed = cue && when !== cue ? `That was ${when}, not ${cue}.` : capitalize(when);
  const from = day ? ` That came from the turn on ${day}.` : '';
  if (cue && when !== cue) {
    if (/^decided to\b/i.test(note)) return `${timed} You ${note}.${from}`;
    if (/^user wants\b/i.test(note)) return `${timed} You said you want ${note.replace(/^user wants\s+/i, '')}.${from}`;
    return `${timed} You said ${note}.${from}`;
  }
  if (/^decided to\b/i.test(note)) return `${capitalize(when)} you ${note}.${from}`;
  if (/^user wants\b/i.test(note)) {
    return `${capitalize(when)} you said you want ${note.replace(/^user wants\s+/i, '')}.${from}`;
  }
  return `${capitalize(when)} you said ${note}.${from}`;
}

/**
 * Answer from the summary and the notes. The early fact does not have to
 * still be in the verbatim window.
 */
export function recallLongMemory(
  question: string,
  memory: LongThreadMemory | null | undefined,
  opts?: { timeZone?: string | null },
): string {
  const notes = memory?.notes ?? [];
  const summary = clean(memory?.summary);
  const now = memory?.now ? new Date(memory.now) : new Date();
  const whenFor = (at: string | null) => relativeDayPhrase(at, Number.isNaN(now.getTime()) ? new Date() : now, opts?.timeZone);
  const words = contentWords(question);
  const cue = timeCue(question);
  const scored = notes
    .map((note) => {
      const hay = note.note.toLowerCase();
      const score = words.reduce((sum, word) => sum + (hay.includes(word) ? 1 : 0), 0);
      return { note, score, when: whenFor(note.at) };
    })
    .filter((row) => (words.length ? row.score > 0 : true))
    .sort((a, b) => b.score - a.score || String(a.note.at ?? '').localeCompare(String(b.note.at ?? '')));

  const pool = words.length ? scored : scored.filter((row) => !cue || row.when === cue);
  const hits = (pool.length ? pool : scored).slice(0, words.length ? 1 : 3);
  if (hits.length) {
    return hits
      .map((hit) => speakNote(hit.note.note, hit.when, memoryDayLabel(hit.note.at, opts?.timeZone), cue))
      .join(' ');
  }

  if (summary && words.length) {
    const line = summary
      .split('\n')
      .map((row) => row.trim())
      .filter((row) => row && !row.startsWith('Earlier turns'))
      .map((row) => ({ row, score: words.reduce((sum, word) => sum + (row.toLowerCase().includes(word) ? 1 : 0), 0) }))
      .sort((a, b) => b.score - a.score)[0];
    if (line && line.score > 0) {
      return `From earlier in this thread: ${line.row}`;
    }
  }

  if (notes.length) {
    const listed = notes
      .slice(0, 3)
      .map((note) => speakNote(note.note, whenFor(note.at), memoryDayLabel(note.at, opts?.timeZone), null))
      .join(' ');
    return `I do not have an earlier note that matches that. What this thread still carries: ${listed}`;
  }
  return 'This thread does not have an earlier decision about that yet. I can quote a visit or summarize the job if you want to start from the file.';
}

/** Prompt block: summary of older turns, then notes that name the day of the source turn. */
export function formatThreadMemoryForPrompt(
  memory: LongThreadMemory | null | undefined,
  timeZone?: string | null,
): string {
  if (!memory) return '';
  const summary = String(memory.summary ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const notes = (memory.notes ?? []).filter((note) => clean(note.note));
  if (!summary && !notes.length) return '';
  const noteLines = notes.map((note) => {
    const day = memoryDayLabel(note.at, timeZone);
    return `- ${note.note}${day ? ` (from the turn on ${day})` : ''}`;
  });
  return [
    summary ? `Earlier in this thread (summary of turns before the recent ones):\n${summary}` : '',
    noteLines.length ? `Durable notes from this job (kept across days):\n${noteLines.join('\n')}` : '',
    'The recent turns below are verbatim. Use the summary and these notes for anything older, including "last week you said".',
  ]
    .filter(Boolean)
    .join('\n\n');
}
