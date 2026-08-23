/**
 * Answer a question about one clip from the reading already on file.
 *
 * The office product is video + dictation. Re-reading the bytes for every
 * "did anything happen?" is slow and invites a second, looser inference pass.
 * The dictation, actions, timeline and scope verdicts were produced under
 * "describe only what is visible", so an answer built from them inherits that
 * discipline.
 *
 * When a model is configured it writes the prose; when it is not, a grounded
 * lookup still answers from the same record so the Ask tab works in demo and
 * in environments without a provider.
 */
import { anthropicClient, isModelProviderConfigured } from '../lib/anthropic.js';
import { config } from '../config.js';

export type ClipAskAnalysisState =
  | 'done'
  | 'queued'
  | 'failed'
  | 'skipped'
  | 'paired'
  | 'waiting_on_after'
  | 'none'
  | string
  | null
  | undefined;

export type ClipAskRecord = {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
  /** Why there is no reading, as the pipeline recorded it. */
  analysisReason?: string | null;
  dictation?: string | null;
  summary?: string | null;
  materialChange?: string | null;
  materialBecause?: string | null;
  changes?: string[];
  concerns?: string[];
  couldNotTell?: string[];
  actions?: Array<{ atSeconds?: number | null; action?: string | null; description?: string | null }>;
  dictationEntries?: Array<{ atSeconds?: number | null; text?: string | null; note?: string | null; summary?: string | null }>;
  timeline?: Array<{ startSeconds?: number | null; summary?: string | null }> | null;
  scope?: Array<{ title?: string | null; verdict?: string | null; because?: string | null }>;
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
]);

const CLIP_QA_SYSTEM = `You answer questions about one proof-of-work video, using only the reading of that clip.

Rules:
1. Answer only from the reading given. It is a description of video frames somebody already looked at.
2. If the reading does not contain the answer, say "The footage on file does not show that" and stop. Do not reason about what was probably true.
3. Quote a timestamp when the reading has one, so the answer can be checked against the playhead.
4. Two or three sentences. This is read next to the player.
5. Never estimate cost, hours, or whether work was worth paying for.`;

type CorpusRow = { at: number | null; text: string; kind: string };

export function clipRecordFromEvidenceItem(item: {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
  analysisReason?: string | null;
  analysis?: ClipAskRecord | null;
}): ClipAskRecord {
  const analysis = item.analysis ?? null;
  return {
    workDate: item.workDate ?? null,
    phase: item.phase ?? null,
    company: item.company ?? null,
    durationSeconds: item.durationSeconds ?? null,
    analysisState: item.analysisState ?? analysis?.analysisState ?? null,
    analysisReason: item.analysisReason ?? null,
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

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP.has(token));
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

  for (const entry of record.dictationEntries ?? []) {
    push(entry.atSeconds, entry.text || entry.note || entry.summary, 'beat');
  }
  for (const action of record.actions ?? []) {
    const verb = String(action.action || '').replace(/_/g, ' ').trim();
    const body = [verb, action.description].filter(Boolean).join(' — ');
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
  return /what (happened|did|work)|did anything|anything happen|what('s| is) (visible|going on)|any work/.test(
    question.toLowerCase(),
  );
}

function unreadAnswer(record: ClipAskRecord): string | null {
  const state = record.analysisState;
  if (!state || state === 'done') return null;
  if (state === 'paired' || state === 'waiting_on_after') {
    return 'This is the before half of the day. Open the after clip — that is where the reading of what changed lives.';
  }
  // The pipeline records why it stopped. Prefer it over a guess: "skipped" is
  // not a synonym for "no after video", and telling a reviewer their existing
  // clip does not exist is worse than saying nothing.
  const recorded = endSentence(record.analysisReason ?? '');
  if (state === 'queued') {
    return recorded
      ? `This clip has not been read yet — ${lowerFirst(recorded)}`
      : 'This clip is still being read. Ask again once the dictation lands.';
  }
  if (state === 'failed') {
    return recorded
      ? `The reading of this clip failed — ${lowerFirst(recorded)} The footage itself is unaffected.`
      : 'The reading of this clip failed. The footage itself is unaffected; re-run the analysis from the platform.';
  }
  if (state === 'skipped') {
    return recorded
      ? `The assistant has not read this clip — ${lowerFirst(recorded)}`
      : 'The assistant has not read this clip, and no reason was recorded. Re-run the analysis from the platform.';
  }
  return recorded
    ? `This clip has not been read yet — ${lowerFirst(recorded)}`
    : 'This clip has not been read yet, so there is nothing to answer from.';
}

/** Terminate a reason that arrived without punctuation, so clauses do not run on. */
function endSentence(value: string): string {
  const text = value.trim();
  if (!text || /[.!?]$/.test(text)) return text;
  return `${text}.`;
}

/** Join a recorded sentence onto a clause without a capital letter mid-line. */
function lowerFirst(value: string): string {
  const text = value.trim();
  if (!text) return text;
  // Leave an acronym or a proper noun alone: only a plain capitalised word is
  // being folded into the middle of a sentence.
  if (/^[A-Z][A-Z]/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Deterministic answer from the clip's reading. Used when no model is
 * configured, and as a fallback if the model call fails.
 */
export function groundedAnswerFromClip(question: string, record: ClipAskRecord): string {
  const unread = unreadAnswer(record);
  if (unread && !hasReading(record)) return unread;

  const rows = clipCorpus(record);
  if (!rows.length) {
    return unread ?? 'Nothing has been read from this clip yet, so there is nothing to answer from.';
  }

  const q = question.trim();
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
    const summary = (record.dictation || record.summary || '').trim();
    if (summary) return `The reading of this clip${date}: ${summary}`;
    return 'The footage on file does not show work happening.';
  }

  const qTokens = tokens(q);
  if (!qTokens.length) {
    return (record.dictation || record.summary || 'The footage on file does not show that.').trim();
  }

  const need = Math.min(2, qTokens.length);
  const scored = rows
    .map((row) => {
      const hay = tokens(row.text);
      const hits = qTokens.filter((token) => hay.some((h) => h.includes(token) || token.includes(h)));
      return { row, score: hits.length };
    })
    .filter((entry) => entry.score >= need)
    .sort((a, b) => b.score - a.score || (a.row.at ?? 0) - (b.row.at ?? 0));

  if (!scored.length) return 'The footage on file does not show that.';

  const best = scored[0];
  const timed = scored.find((entry) => entry.row.at != null);
  const top = timed && timed !== best ? [best, timed] : scored.slice(0, 2);
  return (
    top
      .map(({ row }) => {
        const when = formatClipTime(row.at);
        const text = row.text.replace(/\.$/, '');
        return when ? `At ${when}, ${text[0].toLowerCase()}${text.slice(1)}` : text;
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
    const body = [verb, action.description].filter(Boolean).join(' — ');
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
  return lines.join('\n');
}

/**
 * Answer from the clip reading, with a model when one is configured.
 */
export async function answerFromClip(input: {
  question: string;
  record: ClipAskRecord;
  history?: ClipAskTurn[];
}): Promise<{ answer: string; model: string | null }> {
  const grounded = groundedAnswerFromClip(input.question, input.record);
  if (!isModelProviderConfigured()) return { answer: grounded, model: null };
  // Nothing was read from this clip. The record still carries a work date and
  // a crew name, which is enough for the model to write a confident-sounding
  // paragraph about footage nobody looked at. The grounded sentence says why
  // there is no reading, which is the honest answer.
  if (!hasReading(input.record)) return { answer: grounded, model: null };

  const reading = formatClipRecordForModel(input.record).trim();
  if (!reading) return { answer: grounded, model: null };

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
            `Reading of this clip:\n\n${reading}` +
            (history ? `\n\nEarlier questions on this clip:\n${history}` : '') +
            `\n\nQuestion: ${input.question}`,
        },
      ],
    });
    const answer = response.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { type: string; text?: string }) => block.text ?? '')
      .join('\n')
      .trim();
    return answer ? { answer, model: response.model } : { answer: grounded, model: null };
  } catch {
    return { answer: grounded, model: null };
  }
}
