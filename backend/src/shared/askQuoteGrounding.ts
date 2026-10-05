/**
 * Quote grounding for job-level Ask, run on the final answer before it is
 * rendered or stored.
 *
 * - Every quoted line must be an exact substring of a retrieved transcript
 *   chunk (one chunk, or two adjacent chunks of the same clip). Case, curly
 *   quotes, dashes, spacing and a trailing period the model added are
 *   tolerated; the quote is then rewritten to the chunk's exact text.
 * - A quote that cannot be verified is removed with its sentence (or bullet)
 *   and nothing is said about it. Nothing paraphrased stays inside quotation
 *   marks.
 * - Every verified quote carries "(Clip name, m:ss)" and a quote card whose
 *   link opens the clip at that exact second (never 0:00 unless the line
 *   starts there).
 * - Fabricated speaker labels are replaced; see askSpeakers.ts.
 */
import { formatAskClock, parseAskClock, parseMomentSource, type AskMomentQuote } from './askMoments.js';
import { joinWebResultsSection, splitWebResultsSection } from './askWebSearch.js';
import { UNIDENTIFIED_SPEAKER, sanitizeSpeakerProse, speakerLabelOrUnidentified } from './askSpeakers.js';
import type { TranscriptChunk } from './askTranscriptIndex.js';

export type QuoteGroundingInput = {
  /** Chunks this Ask retrieved (tool results, retrieval hits, and the context the model was shown). */
  chunks: TranscriptChunk[];
  question: string;
};

export type QuoteGroundingReport = {
  checked: number;
  verified: number;
  dropped: number;
  rewritten: number;
};

type Match = { chunk: TranscriptChunk; text: string };

/** Same length as the input: only character-for-character substitutions. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-');
}

function squash(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function stripEdges(text: string): string {
  return text.replace(/^[\s"'“”‘’([…-]+/, '').replace(/[\s"'“”‘’)\]…,;:.!?-]+$/, '');
}

function adjacentPairs(chunks: TranscriptChunk[]): Array<{ first: TranscriptChunk; text: string }> {
  const out: Array<{ first: TranscriptChunk; text: string }> = [];
  const byClip = new Map<string, TranscriptChunk[]>();
  for (const chunk of chunks) {
    const list = byClip.get(chunk.proofId) ?? [];
    list.push(chunk);
    byClip.set(chunk.proofId, list);
  }
  for (const list of byClip.values()) {
    list.sort((a, b) => a.seq - b.seq);
    for (let i = 0; i + 1 < list.length; i += 1) {
      if (list[i + 1]!.seq !== list[i]!.seq + 1) continue;
      out.push({ first: list[i]!, text: `${list[i]!.text} ${list[i + 1]!.text}` });
    }
  }
  return out;
}

/** Find the exact chunk text a quote came from. Null when it is not verbatim. */
export function verifyQuote(quote: string, chunks: TranscriptChunk[]): Match | null {
  const parts = quote
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((part) => stripEdges(squash(part)))
    .filter(Boolean);
  if (!parts.length) return null;
  const pools: Array<{ chunk: TranscriptChunk; text: string }> = [
    ...chunks.map((chunk) => ({ chunk, text: chunk.text })),
    ...adjacentPairs(chunks).map((pair) => ({ chunk: pair.first, text: pair.text })),
  ];
  for (const pool of pools) {
    const hay = fold(pool.text);
    let from = 0;
    const exact: string[] = [];
    let ok = true;
    for (const part of parts) {
      const needle = fold(part);
      if (needle.length < 2) {
        ok = false;
        break;
      }
      const at = hay.indexOf(needle, from);
      if (at < 0) {
        ok = false;
        break;
      }
      exact.push(pool.text.slice(at, at + needle.length));
      from = at + needle.length;
    }
    if (!ok) continue;
    let text = exact.join(' … ');
    // Keep the chunk's own closing punctuation when the quote ran to its end.
    if (parts.length === 1) {
      const end = hay.indexOf(fold(parts[0]!)) + parts[0]!.length;
      const tail = pool.text.slice(end).match(/^[.!?]+/);
      if (tail) text += tail[0];
    }
    return { chunk: pool.chunk, text };
  }
  return null;
}

const QUOTE_SPAN = /“([^”\n]{2,400})”|"([^"\n]{2,400})"/g;

function isQuestionEcho(span: string, question: string): boolean {
  const s = fold(stripEdges(squash(span)));
  return s.length > 0 && fold(question).includes(s);
}

/** A quoted single word or short name ("LedgerPro") is a term, not a quote of speech. */
function isTermMention(span: string): boolean {
  const words = stripEdges(span).split(/\s+/).filter(Boolean);
  return words.length <= 2 && !/[.!?]$/.test(span.trim());
}

function attachment(chunk: TranscriptChunk): string {
  const when = chunk.startSec == null ? '' : `, ${formatAskClock(chunk.startSec)}`;
  return `(${chunk.clipTitle}${when})`;
}

/** Sentence bounds around an index, ignoring terminators inside quotes. */
function sentenceBounds(line: string, index: number): [number, number] {
  let start = 0;
  let inQuote = false;
  const ends: number[] = [];
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '“') inQuote = true;
    else if (ch === '”') inQuote = false;
    else if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && /[.!?]/.test(ch) && (i + 1 === line.length || /\s/.test(line[i + 1]!))) ends.push(i + 1);
  }
  for (const end of ends) {
    if (end <= index) start = end;
    else return [start, end];
  }
  return [start, line.length];
}

function groundLine(
  line: string,
  input: QuoteGroundingInput,
  report: QuoteGroundingReport,
  used: Match[],
): string | null {
  let out = line;
  let guard = 0;
  let cursor = 0;
  while (guard++ < 40) {
    QUOTE_SPAN.lastIndex = cursor;
    const m = QUOTE_SPAN.exec(out);
    if (!m) break;
    const span = (m[1] ?? m[2] ?? '').trim();
    const start = m.index;
    const end = start + m[0].length;
    if (isQuestionEcho(span, input.question) || isTermMention(span)) {
      cursor = end;
      continue;
    }
    report.checked += 1;
    const match = verifyQuote(span, input.chunks);
    if (!match) {
      report.dropped += 1;
      if (/^\s*(?:[-*•]|\d+\.)\s+/.test(out)) return null;
      const [a, b] = sentenceBounds(out, start);
      out = `${out.slice(0, a)}${out.slice(b)}`.replace(/\s{2,}/g, ' ').trim();
      if (!out || /^(?:[-*•]|\d+\.)?\s*$/.test(out)) return null;
      cursor = Math.min(a, out.length);
      continue;
    }
    report.verified += 1;
    if (match.text !== span) report.rewritten += 1;
    used.push(match);
    const quoted = `“${match.text}”`;
    let rest = out.slice(end);
    const wanted = attachment(match.chunk);
    // Replace an existing "(…)" right after the quote when it names the clip or a time.
    const existing = rest.match(/^\s*\(([^()\n]{0,160})\)/);
    if (existing && (/\b\d+:\d{2}\b/.test(existing[1]!) || existing[1]!.includes(match.chunk.clipTitle.slice(0, 12)))) {
      rest = rest.slice(existing[0].length);
    }
    // Drop a stray time right after the quote ("” at 0:12") that disagrees with the chunk.
    const stray = rest.match(/^\s*(?:at|@)\s*(\d+:\d{2})\b/);
    if (stray && match.chunk.startSec != null && Math.abs((parseAskClock(stray[1]!) ?? -9) - match.chunk.startSec) > 1) {
      rest = rest.slice(stray[0].length);
    }
    const insert = `${quoted} ${wanted}`;
    out = `${out.slice(0, start)}${insert}${rest.startsWith(' ') || !rest || /^[.,;:!?]/.test(rest) ? '' : ' '}${rest}`;
    cursor = start + insert.length;
  }
  return out;
}

const TRAILER_RE = /\s*⟦(sources|quotes|followups|actions|artifact|\/artifact)(?::([^⟧]*))?⟧/gi;

function parseQuotes(raw: string): AskMomentQuote[] {
  const out: AskMomentQuote[] = [];
  for (const part of raw.split(/\s*;;\s*/)) {
    const [sourceId, speaker, ...rest] = part.split('|');
    const clipField = rest.length > 1 && /^clip=/.test(rest[rest.length - 1] ?? '') ? rest.pop()! : '';
    const text = rest.join('|').trim();
    const id = String(sourceId ?? '').trim();
    if (!id || !text) continue;
    out.push({
      sourceId: id,
      speaker: String(speaker ?? '').trim(),
      text,
      atSeconds: parseMomentSource(id)?.atSeconds ?? null,
      clipTitle: clipField.replace(/^clip=/, '').trim() || null,
    });
  }
  return out;
}

function trailerText(value: string, cap: number): string {
  const clean = value.replace(/[|⟧⟦]/g, ' ').replace(/;;/g, ' ').replace(/\s+/g, ' ').trim();
  if (clean.length <= cap) return clean;
  const cut = clean.slice(0, cap).replace(/\s+\S*$/, '').trim();
  return cut || clean.slice(0, cap).trim();
}

/** An uploaded-document excerpt (doc:<id>#<location>) has no speaker. */
function isDocumentSource(sourceId: string): boolean {
  return sourceId.startsWith('doc:');
}

function formatQuotes(quotes: AskMomentQuote[]): string {
  const parts = quotes.slice(0, 6).map((quote) => {
    const clip = trailerText(String(quote.clipTitle ?? ''), 80);
    const speaker = isDocumentSource(quote.sourceId) ? '' : trailerText(speakerLabelOrUnidentified(quote.speaker), 40);
    return `${quote.sourceId}|${speaker}|${trailerText(quote.text, 180)}${clip ? `|clip=${clip}` : ''}`;
  });
  return parts.length ? `⟦quotes: ${parts.join(' ;; ')}⟧` : '';
}

function quoteFor(match: Match): AskMomentQuote {
  return {
    sourceId: match.chunk.cite,
    speaker: isDocumentSource(match.chunk.cite) ? '' : speakerLabelOrUnidentified(match.chunk.speaker ?? UNIDENTIFIED_SPEAKER),
    text: match.text,
    atSeconds: match.chunk.startSec,
    clipTitle: match.chunk.clipTitle,
  };
}

/**
 * Enforce quote grounding on a finished answer. Returns the answer with every
 * quote verified, attached to its clip and time, and backed by a quote card.
 */
export function enforceQuoteGrounding(
  answer: string,
  input: QuoteGroundingInput,
): { answer: string; report: QuoteGroundingReport } {
  const report: QuoteGroundingReport = { checked: 0, verified: 0, dropped: 0, rewritten: 0 };
  const raw = String(answer ?? '');
  const trailers: Array<{ kind: string; body: string; full: string }> = [];
  let body = raw.replace(TRAILER_RE, (full, kind: string, value: string | undefined) => {
    const k = kind.toLowerCase();
    if (k === 'artifact' || k === '/artifact') return full;
    trailers.push({ kind: k, body: value ?? '', full: full.trim() });
    return '';
  });
  const used: Match[] = [];
  const webSplit = splitWebResultsSection(body);
  const lines = webSplit.body.split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    const grounded = groundLine(line, input, report, used);
    if (grounded != null) kept.push(grounded);
  }
  body = sanitizeSpeakerProse(kept.join('\n'), { protect: input.chunks.map((chunk) => chunk.clipTitle) })
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Quote cards: keep verified ones (fixed to the chunk's second), add one per verified prose quote.
  const cards: AskMomentQuote[] = [];
  const pushCard = (quote: AskMomentQuote) => {
    if (cards.some((card) => card.sourceId === quote.sourceId && fold(card.text) === fold(quote.text))) return;
    cards.push(quote);
  };
  for (const match of used) pushCard(quoteFor(match));
  const quoteTrailer = trailers.find((t) => t.kind === 'quotes');
  for (const quote of quoteTrailer ? parseQuotes(quoteTrailer.body) : []) {
    const match = verifyQuote(quote.text, input.chunks);
    if (!match) {
      report.dropped += 1;
      continue;
    }
    pushCard(quoteFor(match));
  }
  const clipOrder = [...new Set(cards.map((card) => parseMomentSource(card.sourceId)?.proofId ?? ''))];
  cards.sort((a, b) => {
    const pa = clipOrder.indexOf(parseMomentSource(a.sourceId)?.proofId ?? '');
    const pb = clipOrder.indexOf(parseMomentSource(b.sourceId)?.proofId ?? '');
    return pa - pb || (a.atSeconds ?? 0) - (b.atSeconds ?? 0);
  });
  const cites = new Set<string>(cards.map((card) => card.sourceId));
  const quotedClips = new Set(cards.map((card) => parseMomentSource(card.sourceId)?.proofId).filter(Boolean));
  const out: string[] = [joinWebResultsSection(body, webSplit.section)];
  const sourceTrailer = trailers.find((t) => t.kind === 'sources');
  // On a clip that has quote cards, a moment link at a different spoken line
  // (often 0:00) opens the wrong moment; drop it. Other links are kept.
  const sourceIds = (sourceTrailer ? sourceTrailer.body.split(',').map((id) => id.trim()).filter(Boolean) : []).filter(
    (id) => {
      const moment = parseMomentSource(id);
      if (!moment || moment.atSeconds == null || !quotedClips.has(moment.proofId)) return true;
      if (cites.has(id)) return true;
      // Another spoken line on a quoted clip that was not quoted: a link to the wrong moment.
      return !input.chunks.some(
        (chunk) => chunk.proofId === moment.proofId && chunk.startSec != null && Math.abs(chunk.startSec - moment.atSeconds!) < 1,
      );
    },
  );
  for (const cite of cites) {
    const moment = parseMomentSource(cite);
    const already = sourceIds.some((id) => {
      const parsed = parseMomentSource(id);
      return id === cite || (moment && parsed?.proofId === moment.proofId && parsed.atSeconds === moment.atSeconds);
    });
    if (!already) sourceIds.push(cite);
  }
  const quotesLine = formatQuotes(cards);
  if (quotesLine) out.push(quotesLine);
  if (sourceIds.length) out.push(`⟦sources: ${sourceIds.join(', ')}⟧`);
  for (const t of trailers) {
    if (t.kind === 'quotes' || t.kind === 'sources') continue;
    out.push(t.full);
  }
  return { answer: out.filter(Boolean).join('\n\n'), report };
}
