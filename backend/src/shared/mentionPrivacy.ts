/**
 * Privacy scrub for mention Ask. Same order as clip Ask: private-moment
 * ranges first, then child-presence ranges. Timed lines, segments, word
 * lists, quotes, and highlights are scrubbed before any length trim.
 */
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

type Speech = { ranges: PrivacyRedactionRange[]; childRanges: ChildPrivacyRange[] };
type Phrase = { phrase: string; label: string };

const SKIP_KEYS = new Set(['privacyRedactions', 'childPrivacyRedactions']);
const SPEECH_KEYS = new Set([
  'text',
  'quote',
  'highlight',
  'caption',
  'utterance',
  'word',
  'transcript',
  'note',
  'summary',
  'narration',
  'because',
  'heard',
]);

function speechFrom(findings: unknown): Speech {
  const root = findings && typeof findings === 'object' ? (findings as Record<string, unknown>) : {};
  return {
    ranges: privacyRedactionsFromStored(root.privacyRedactions),
    childRanges: childPrivacyRedactionsFromStored(root.childPrivacyRedactions),
  };
}

/** Private-moment replacement, then child-presence replacement, matching clip Ask. */
export function redactMentionSpeech(text: unknown, findings: unknown): string | null {
  const speech = speechFrom(findings);
  return redactBoth(text, speech);
}

function redactBoth(text: unknown, speech: Speech): string | null {
  const first = redactTranscriptForAsk(text == null ? null : String(text), speech.ranges);
  return redactTranscriptForChildPrivacy(first, speech.childRanges);
}

function labelAt(t: number, speech: Speech): string | null {
  let label: string | null = null;
  if (secondsInPrivacyRange(t, speech.ranges)) label = PRIVACY_REDACTED_LABEL;
  if (secondsInChildPrivacyRange(t, speech.childRanges)) label = CHILD_PRIVACY_REDACTED_LABEL;
  return label;
}

function clockSeconds(match: RegExpMatchArray): number {
  const hh = match[3] != null ? Number(match[1]) : 0;
  const mm = match[3] != null ? Number(match[2]) : Number(match[1]);
  const ss = match[3] != null ? Number(match[3]) : Number(match[2]);
  return hh * 3600 + mm * 60 + ss;
}

function timeOf(row: Record<string, unknown>): number | null {
  for (const key of ['atSeconds', 'tSec', 't_sec', 'startSeconds', 'startSec', 'start', 'timeSec']) {
    const raw = row[key];
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function stampClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

function addPhrase(out: Phrase[], phrase: string, label: string): void {
  const clean = phrase.replace(/\s+/g, ' ').trim();
  if (clean.length >= 8 && clean !== PRIVACY_REDACTED_LABEL && clean !== CHILD_PRIVACY_REDACTED_LABEL) {
    out.push({ phrase: clean, label });
  }
  for (const token of clean.split(' ')) {
    const word = token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
    if (word.length >= 8) out.push({ phrase: word, label });
  }
}

function replacePhrases(text: string, phrases: Phrase[]): string {
  let out = text;
  const ordered = [...phrases].sort((a, b) => b.phrase.length - a.phrase.length);
  for (const { phrase, label } of ordered) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'gi'), label);
  }
  return out;
}

function scrubProse(text: string, phrases: Phrase[], speech: Speech): string {
  return String(redactBoth(replacePhrases(text, phrases), speech) ?? '');
}

function addTimedRow(out: Phrase[], row: unknown, speech: Speech): void {
  if (!row || typeof row !== 'object') return;
  const rec = row as Record<string, unknown>;
  const t = timeOf(rec);
  if (t == null) return;
  const label = labelAt(t, speech);
  if (!label) return;
  addPhrase(out, String(rec.text ?? rec.word ?? rec.quote ?? ''), label);
}

function collectFromTree(node: unknown, speech: Speech, out: Phrase[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFromTree(item, speech, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const row = node as Record<string, unknown>;
  const t = timeOf(row);
  const label = t == null ? null : labelAt(t, speech);
  for (const [key, value] of Object.entries(row)) {
    if (SKIP_KEYS.has(key)) continue;
    if (typeof value === 'string') {
      if (label && SPEECH_KEYS.has(key)) addPhrase(out, value, label);
      continue;
    }
    collectFromTree(value, speech, out);
  }
}

function collectPhrases(proof: Record<string, unknown>, speech: Speech): Phrase[] {
  const out: Phrase[] = [];
  for (const line of String(proof.transcript_text ?? '').split('\n')) {
    const match = line.match(/^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/);
    if (!match) continue;
    const label = labelAt(clockSeconds(match), speech);
    if (!label) continue;
    const body = String(match[4] ?? '').replace(/^([^:]{1,40}:)\s*/, '');
    addPhrase(out, body, label);
  }
  if (Array.isArray(proof.transcript_segments)) {
    for (const row of proof.transcript_segments) addTimedRow(out, row, speech);
  }
  if (Array.isArray(proof.transcript_words)) {
    for (const row of proof.transcript_words) addTimedRow(out, row, speech);
  }
  collectFromTree(proof.ai_findings, speech, out);
  return out;
}

function scrubTimedRows(rows: unknown, speech: Speech): unknown {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== 'object') return row;
    const rec = { ...(row as Record<string, unknown>) };
    const t = timeOf(rec);
    const label = t == null ? null : labelAt(t, speech);
    if (!label) return rec;
    if ('text' in rec) rec.text = label;
    if ('word' in rec) rec.word = label;
    if ('quote' in rec) rec.quote = label;
    return rec;
  });
}

function scrubFindings(findings: unknown, phrases: Phrase[], speech: Speech): unknown {
  if (!findings || typeof findings !== 'object') return findings;
  const clone = structuredClone(findings);
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        const item = node[i];
        if (typeof item === 'string') node[i] = scrubProse(item, phrases, speech);
        else walk(item);
      }
      return;
    }
    if (!node || typeof node !== 'object') return;
    const row = node as Record<string, unknown>;
    const t = timeOf(row);
    const label = t == null ? null : labelAt(t, speech);
    for (const [key, value] of Object.entries(row)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof value === 'string') {
        row[key] = label && SPEECH_KEYS.has(key) ? label : scrubProse(value, phrases, speech);
        continue;
      }
      walk(value);
    }
  };
  walk(clone);
  return clone;
}

/**
 * Copy of a proof whose transcript, timed segments, word list, summary,
 * narration, quotes, and highlights are safe to put in a mention prompt
 * or the no-model fallback. Callers trim only after this returns.
 */
export function privacySafeMentionProof<T extends Record<string, unknown>>(proof: T): T {
  const speech = speechFrom(proof.ai_findings);
  if (!speech.ranges.length && !speech.childRanges.length) return proof;
  const phrases = collectPhrases(proof, speech);
  const next: Record<string, unknown> = { ...proof };
  if ('transcript_text' in proof) next.transcript_text = redactBoth(proof.transcript_text, speech);
  if (proof.transcript_segments != null) next.transcript_segments = scrubTimedRows(proof.transcript_segments, speech);
  if (proof.transcript_words != null) next.transcript_words = scrubTimedRows(proof.transcript_words, speech);
  if (typeof proof.ai_summary === 'string') next.ai_summary = scrubProse(proof.ai_summary, phrases, speech);
  if (typeof proof.narration_text === 'string') next.narration_text = scrubProse(proof.narration_text, phrases, speech);
  if (proof.ai_findings && typeof proof.ai_findings === 'object') {
    next.ai_findings = scrubFindings(proof.ai_findings, phrases, speech);
  }
  return next as T;
}

/** Timestamped lines for a stored segment or word list. Text is already scrubbed. */
export function mentionTimedLines(rows: unknown): string {
  if (!Array.isArray(rows)) return '';
  const lines: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const text = String(rec.text ?? rec.word ?? '').replace(/\s+/g, ' ').trim();
    const start = timeOf(rec);
    if (!text || start == null) continue;
    lines.push(`[${stampClock(start)}] ${text}`);
  }
  return lines.join('\n');
}
