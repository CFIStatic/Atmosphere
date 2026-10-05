/**
 * Honest "not found" wording for Ask.
 *
 * Retrieval runs first. When nothing supports an answer, reply "Not found"
 * and say what was searched (clips, transcripts, notes, documents) — never
 * the empty-job Field Capture boilerplate when clips already exist.
 */
import type { AskLookupCatalog } from './askLookup.js';
import { clipsInScope } from './askLookup.js';
import { takeAskSearchMeta } from './askRetrievalContext.js';

export type SearchMeta = {
  phrases: string[];
  terms: string[];
  clipCount: number;
  hitCount: number;
  noteCount?: number;
  documentCount?: number;
  transcriptChunkCount?: number;
};

const HEDGE =
  /\b(i don't know|i do not know|not sure|nothing (?:in|on) (?:the |this )?file|not (?:in|on) (?:the |this )?file|no (?:information|mention|record)|does not (?:show|mention|say)|can't find|cannot find|not found)\b/i;

const EMPTY_JOB_BOILERPLATE =
  /no work description yet\.?\s*field capture can still film/i;

export function looksLikeNotFound(answer: string): boolean {
  return HEDGE.test(String(answer ?? ''));
}

export function hasEmptyJobBoilerplate(answer: string): boolean {
  return EMPTY_JOB_BOILERPLATE.test(String(answer ?? ''));
}

export function catalogSearchCounts(catalog: AskLookupCatalog): {
  noteCount: number;
  documentCount: number;
  transcriptChunkCount: number;
  clipCount: number;
} {
  const clips = clipsInScope(catalog);
  const transcriptChunkCount = clips.reduce((n, clip) => {
    const text = String(clip.transcript ?? '').trim();
    return n + (text ? Math.max(1, Math.ceil(text.length / 400)) : 0);
  }, 0);
  const noteCount = Array.isArray((catalog as unknown as { notes?: unknown[] }).notes)
    ? ((catalog as unknown as { notes?: unknown[] }).notes?.length ?? 0)
    : Array.isArray(catalog.history)
      ? catalog.history.length
      : 0;
  const documentCount = Array.isArray((catalog as unknown as { documents?: unknown[] }).documents)
    ? ((catalog as unknown as { documents?: unknown[] }).documents?.length ?? 0)
    : 0;
  return {
    noteCount,
    documentCount,
    transcriptChunkCount,
    clipCount: clips.length,
  };
}

/** Drop empty-job boilerplate when the job already has analyzed clips. */
export function stripEmptyJobBoilerplate(answer: string, catalog: AskLookupCatalog): string {
  const clips = clipsInScope(catalog);
  if (!clips.length) return answer;
  if (!hasEmptyJobBoilerplate(answer) && !/\bwork type:\s*/i.test(answer)) return answer;
  return answer
    .replace(/work type:\s*[^.?\n]*[.?\n]?/gi, '')
    .replace(EMPTY_JOB_BOILERPLATE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function formatHonestNotFound(input: {
  question: string;
  catalog: AskLookupCatalog;
  searched?: SearchMeta | null;
  answer?: string | null;
}): string {
  const counts = catalogSearchCounts(input.catalog);
  const searched = {
    ...counts,
    ...(input.searched ?? takeAskSearchMeta(input.catalog.jobId) ?? {}),
  };
  const clips = clipsInScope(input.catalog);
  const needles = [
    ...(searched?.phrases ?? []),
    ...(searched?.terms ?? []).slice(0, 6),
  ].filter(Boolean);
  const needleText = needles.length
    ? needles.slice(0, 8).map((n) => `“${n}”`).join(', ')
    : 'the words in your question';
  const searchedWhat = [
    `${searched.clipCount ?? counts.clipCount} clip${(searched.clipCount ?? counts.clipCount) === 1 ? '' : 's'}`,
    `${searched.transcriptChunkCount ?? counts.transcriptChunkCount} transcript section${(searched.transcriptChunkCount ?? counts.transcriptChunkCount) === 1 ? '' : 's'}`,
    `${searched.noteCount ?? counts.noteCount} note${(searched.noteCount ?? counts.noteCount) === 1 ? '' : 's'}`,
    `${searched.documentCount ?? counts.documentCount} document${(searched.documentCount ?? counts.documentCount) === 1 ? '' : 's'}`,
  ].join(', ');

  return [
    'Not found.',
    `I searched ${searchedWhat} for ${needleText}. Nothing supports an answer.`,
    clips.length
      ? `Clips on file: ${clips.map((c) => c.title).slice(0, 8).join('; ')}.`
      : 'This job has no clips yet.',
  ].join(' ');
}

/**
 * If the model hedged / abstained, or echoed empty-job boilerplate on a job
 * that already has clips, rewrite into an honest not-found that names the search.
 */
export function applyHonestNotFound(
  answer: string,
  catalog: AskLookupCatalog,
  question: string,
): string {
  const cleaned = stripEmptyJobBoilerplate(answer, catalog);
  const clips = clipsInScope(catalog);
  const shouldRewrite =
    looksLikeNotFound(cleaned) ||
    (clips.length > 0 && (hasEmptyJobBoilerplate(answer) || !cleaned.trim()));
  if (!shouldRewrite) return cleaned;
  if (/⟦artifact⟧[\s\S]*?\S[\s\S]*?⟦\/artifact⟧/.test(answer)) return cleaned;
  const trailers = answer.match(/\n⟦[^⟧]*⟧/g)?.join('') ?? '';
  const body = formatHonestNotFound({ question, catalog, answer: cleaned });
  return `${body}${trailers}`;
}
