/**
 * Answer a question about one clip.
 *
 * Three answers, in descending order of what the caller gave us:
 *
 *   1. Frames in hand — the model looks at the footage again, with the
 *      clip's reading beside it. "Is there a ladder against the north wall?"
 *      is a question about pixels, and the dictation was never written to
 *      answer it. This is the Ask tab's normal path.
 *   2. No frames, model configured — the model writes prose from the reading.
 *   3. No model — a grounded lookup over the same reading, so the tab still
 *      works in demo and on a server without a provider key.
 *
 * All three inherit one discipline from the reading itself: describe what is
 * visible, and say so plainly when the footage does not show it. An answer
 * that guesses is worse than no answer here, because these answers get quoted
 * into payment disputes.
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

const CLIP_QA_VISION_SYSTEM = `You answer questions about one proof-of-work video by looking at stills taken from it.

Rules:
1. Answer from the stills first. They are frames of the clip being asked about, given in order with their timestamps.
2. The written reading of the clip is given as well; use it for context and for anything between the stills.
3. If neither the stills nor the reading shows the answer, say "The footage on file does not show that" and stop. Never infer what was probably true off camera.
4. Quote the timestamp of the still you are answering from, so the answer can be checked against the playhead.
5. Two or three sentences. This is read next to the player.
6. Never estimate cost, hours, or whether work was worth paying for.`;

/** A still from the clip, ready to hand to the model. */
export type ClipAskFrame = { atSeconds: number; base64: string };

/** One block of the turn a question makes: a line of text, or a still. */
export type ClipVisionBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } };

type CorpusRow = { at: number | null; text: string; kind: string };

export function clipRecordFromEvidenceItem(item: {
  workDate?: string | null;
  phase?: string | null;
  company?: string | null;
  durationSeconds?: number | null;
  analysisState?: ClipAskAnalysisState;
  analysis?: ClipAskRecord | null;
  /** This clip's own reading — present even when the day's verdict is not. */
  clipReading?: {
    dictation?: string | null;
    summary?: string | null;
    entries?: ClipAskRecord['dictationEntries'];
    actions?: ClipAskRecord['actions'];
    status?: string | null;
  } | null;
}): ClipAskRecord {
  const analysis = item.analysis ?? null;
  const own = item.clipReading ?? null;
  // A before clip carries no day verdict by design. Its own reading is still
  // the answer to "what is happening in this video", so it wins where the
  // day comparison has nothing to say.
  const ownEntries = Array.isArray(own?.entries) ? own.entries : [];
  const ownActions = Array.isArray(own?.actions) ? own.actions : [];
  const readable = Boolean(own?.dictation || own?.summary || ownEntries.length || ownActions.length);
  return {
    workDate: item.workDate ?? null,
    phase: item.phase ?? null,
    company: item.company ?? null,
    durationSeconds: item.durationSeconds ?? null,
    analysisState:
      readable && item.analysisState !== 'done'
        ? 'done'
        : (item.analysisState ?? analysis?.analysisState ?? null),
    dictation: analysis?.dictation ?? own?.dictation ?? null,
    summary: analysis?.summary ?? own?.summary ?? null,
    materialChange: analysis?.materialChange ?? null,
    materialBecause: analysis?.materialBecause ?? null,
    changes: Array.isArray(analysis?.changes) ? analysis.changes : [],
    concerns: Array.isArray(analysis?.concerns) ? analysis.concerns : [],
    couldNotTell: Array.isArray(analysis?.couldNotTell) ? analysis.couldNotTell : [],
    actions: Array.isArray(analysis?.actions) && analysis.actions.length ? analysis.actions : ownActions,
    dictationEntries:
      Array.isArray(analysis?.dictationEntries) && analysis.dictationEntries.length
        ? analysis.dictationEntries
        : ownEntries,
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

function unreadAnswer(state: ClipAskAnalysisState): string | null {
  if (!state || state === 'done') return null;
  if (state === 'paired' || state === 'waiting_on_after') {
    return 'This is the before half of the day. Open the after clip — that is where the reading of what changed lives.';
  }
  if (state === 'queued') {
    return 'This clip is still being read. Ask again once the dictation lands.';
  }
  if (state === 'failed') {
    return 'The reading of this clip failed. The footage itself is unaffected; re-run the analysis from the platform.';
  }
  if (state === 'skipped') {
    return 'There is no after video on file for this day, so there is nothing to compare against.';
  }
  return 'This clip has not been read yet, so there is nothing to answer from.';
}

/**
 * Deterministic answer from the clip's reading. Used when no model is
 * configured, and as a fallback if the model call fails.
 */
export function groundedAnswerFromClip(question: string, record: ClipAskRecord): string {
  const unread = unreadAnswer(record.analysisState);
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

/** Evenly spaced stills, so a long clip still answers from end to end. */
export function spaceAskFrames(frames: ClipAskFrame[], max: number): ClipAskFrame[] {
  if (frames.length <= max) return frames.slice();
  if (max <= 1) return frames.slice(0, 1);
  const out: ClipAskFrame[] = [];
  for (let i = 0; i < max; i += 1) {
    out.push(frames[Math.round((i * (frames.length - 1)) / (max - 1))]!);
  }
  return out;
}

/**
 * Build the model turn for a question asked against the footage itself.
 *
 * Exported so a test can assert the stills arrive in order, each labelled
 * with the timestamp the answer is expected to cite.
 */
export function clipVisionContent(input: {
  question: string;
  reading: string;
  frames: ClipAskFrame[];
  history?: string;
}): ClipVisionBlock[] {
  return [
    {
      type: 'text',
      text: [
        `Stills from this clip: ${input.frames.length}, in order.`,
        input.reading ? `Reading of this clip:\n${input.reading}` : 'Reading of this clip: (none on file)',
        input.history ? `Earlier questions on this clip:\n${input.history}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    },
    ...input.frames.flatMap((frame): ClipVisionBlock[] => [
      { type: 'text', text: `frame at ${formatClipTime(frame.atSeconds) ?? '0:00'}:` },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 },
      },
    ]),
    { type: 'text', text: `Question: ${input.question}` },
  ];
}

/**
 * Answer from the clip reading — looking at the footage when stills are given,
 * and with a model when one is configured.
 */
export async function answerFromClip(input: {
  question: string;
  record: ClipAskRecord;
  history?: ClipAskTurn[];
  /** Stills from this clip. When present the model looks before it answers. */
  frames?: ClipAskFrame[];
  /** Cap on stills sent to the model. */
  maxFrames?: number;
}): Promise<{ answer: string; model: string | null }> {
  const grounded = groundedAnswerFromClip(input.question, input.record);
  if (!isModelProviderConfigured()) return { answer: grounded, model: null };

  const reading = formatClipRecordForModel(input.record).trim();
  const frames = spaceAskFrames(input.frames ?? [], Math.max(1, input.maxFrames ?? 12));
  if (!reading && !frames.length) return { answer: grounded, model: null };

  const history = (input.history ?? [])
    .filter((turn) => turn.text.trim())
    .slice(-12)
    .map((turn) => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.text.trim()}`)
    .join('\n');

  try {
    const response = await anthropicClient().messages.create({
      model: config.technician.assistant.model,
      max_tokens: 500,
      system: frames.length ? CLIP_QA_VISION_SYSTEM : CLIP_QA_SYSTEM,
      messages: [
        {
          role: 'user',
          content: frames.length
            ? clipVisionContent({
                question: input.question,
                reading,
                frames,
                history,
              })
            : `Reading of this clip:\n\n${reading}` +
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
