/**
 * Live Ask preview.
 *
 * Model deltas arrive token by token. The reader sees them as soon as a whole
 * sentence is safe to show, so a turn starts reading in about a second instead
 * of waiting for the full, checked answer. The `done` event still carries the
 * final answer and replaces the preview.
 *
 * What is never previewed:
 * - machine lines (⟦sources:…⟧, ⟦quotes:…⟧, ⟦followups:…⟧, ⟦actions:…⟧) — the
 *   preview stops at the first one;
 * - any sentence with a quotation, a clip cite, a link, or raw markers — quotes
 *   are only shown after the exact-substring grounding check on the final;
 * - any sentence the caller's check rejects (job answers run the same
 *   grounding verifier the final answer runs: names, dates, times, refs);
 * - anything after the first held-back sentence, so the preview is always a
 *   clean prefix of what the model wrote.
 *
 * A tool call after streamed text (a "let me look that up" preface) or an
 * escalation to another model resets the preview.
 */

export type AskPreviewCheck = (sentence: string) => boolean;

export type AskPreviewSink = {
  /** Visible preview text to append. */
  emit: (text: string) => void;
  /** Clear whatever preview the reader has. */
  reset: () => void;
};

export type AskPreviewGate = {
  push: (delta: string) => void;
  reset: () => void;
  setCheck: (check: AskPreviewCheck | null) => void;
  /** Characters the reader has seen since the last reset. */
  shown: () => number;
};

const MACHINE_LINE = /⟦\s*(?:sources|quotes|followups|actions)\s*:/i;
const ARTIFACT_MARK = /⟦\/?artifact⟧/gi;
const UNSAFE =
  /[“”"]|⟦|⟧|\[\[|\]\]|\bvideo\/[0-9a-f-]{8,}|https?:\/\/|\bwww\.|<\/?[a-z][^>]*>/i;
/** Long enough to read as a real lead, short enough to start fast. */
const MIN_FIRST_CHARS = 2;

/** A sentence is done at . ! ? or a line break followed by whitespace (or a list line). */
function nextBoundary(text: string, from: number): number {
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch === '\n') return i + 1;
    if (ch === '.' || ch === '!' || ch === '?' || ch === ':') {
      const next = text[i + 1];
      if (next === undefined) return -1;
      // 3.5, $1.25, e.g. — not a sentence end.
      if (/\d/.test(text[i - 1] ?? '') && /\d/.test(next)) continue;
      if (next === ' ' || next === '\n') return i + 1;
    }
  }
  return -1;
}

export function previewSentenceSafe(sentence: string): boolean {
  if (!sentence.trim()) return true;
  return !UNSAFE.test(sentence);
}

export function createAskPreviewGate(sink: AskPreviewSink): AskPreviewGate {
  let raw = '';
  let consumed = 0;
  let emitted = 0;
  let closed = false;
  let check: AskPreviewCheck | null = null;

  const pump = () => {
    if (closed) return;
    // Stop for good at the first machine line.
    const machine = raw.slice(consumed).search(MACHINE_LINE);
    const limit = machine >= 0 ? consumed + machine : raw.length;
    while (!closed) {
      const end = nextBoundary(raw.slice(0, limit), consumed);
      if (end < 0 || end > limit) break;
      const piece = raw.slice(consumed, end).replace(ARTIFACT_MARK, '');
      const safe = previewSentenceSafe(piece) && (!check || !piece.trim() || check(piece));
      if (!safe) {
        // Hold this sentence and everything after it for the checked final.
        closed = true;
        break;
      }
      consumed = end;
      if (piece && (emitted > 0 || piece.trim().length >= MIN_FIRST_CHARS)) {
        const text = emitted === 0 ? piece.replace(/^\s+/, '') : piece;
        if (text) {
          emitted += text.length;
          sink.emit(text);
        }
      }
    }
    if (machine >= 0 && consumed >= limit) closed = true;
  };

  return {
    push(delta: string) {
      if (!delta || closed) return;
      raw += delta;
      pump();
    },
    reset() {
      const had = emitted > 0;
      raw = '';
      consumed = 0;
      emitted = 0;
      closed = false;
      if (had) sink.reset();
    },
    setCheck(next: AskPreviewCheck | null) {
      check = next;
    },
    shown: () => emitted,
  };
}
