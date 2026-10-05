/**
 * Honest "not found" wording for Ask.
 *
 * Retrieval runs first. When nothing supports an answer, reply "Not found"
 * and say what was searched (clips, transcripts, notes, documents) — never
 * the empty-job Field Capture boilerplate when clips already exist.
 *
 * Applied deterministically after the model answers so live unanswerable turns
 * always lead with exactly "Not found." even when the model soft-denies.
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

/** Classic hedges / abstentions. */
const HEDGE =
  /\b(i don't know|i do not know|not sure|nothing (?:in|on) (?:the |this )?(?:file|transcripts?|recording|video|job)|not (?:in|on) (?:the |this )?(?:file|transcripts?|recording|video|job)|no (?:information|mention|record|one)|does not (?:show|mention|say|name)|doesn't (?:show|mention|say|name)|never mentions|can't find|cannot find|not found|no one (?:on the recording )?commits)\b/i;

/**
 * Clear denials of file contents — the model answered "no / empty / not on
 * this job" without the honest Not found lead-in.
 */
const DENIAL =
  /\b(?:there(?:'s| is) no|no,\s+there(?:'s| is)|no\b[^.!?\n]{0,60}\b(?:on (?:this|the) (?:job|file)|on file|in (?:the |this )?file)|(?:file|job|transcript) (?:doesn't|does not|never|has no|have no)\b|(?:claim(?:\s*#| number)?|quote|estimate|tarp|punch)\b[^.!?\n]{0,40}\b(?:empty|blank|missing|not (?:on|in))|(?:is empty|are blank|are empty)|not (?:in|on) (?:the |this )?(?:file|job|transcript|video))\b/i;

const EMPTY_JOB_BOILERPLATE =
  /no work description yet\.?\s*field capture can still film/i;

export function looksLikeNotFound(answer: string): boolean {
  const text = String(answer ?? '');
  if (!text.trim()) return true;
  if (HEDGE.test(text)) return true;
  if (DENIAL.test(text)) return true;
  return false;
}

export function hasEmptyJobBoilerplate(answer: string): boolean {
  return EMPTY_JOB_BOILERPLATE.test(String(answer ?? ''));
}

export function answerHasJobCitation(answer: string): boolean {
  const text = String(answer ?? '');
  // Real quote chips count.
  if (/⟦quotes:[^⟧]*\S/i.test(text)) return true;
  // Generic "⟦sources: videos⟧" is a UI placeholder, not a grounded claim.
  const sources = text.match(/⟦sources:([^⟧]*)⟧/gi) ?? [];
  for (const chip of sources) {
    const body = chip.replace(/^⟦sources:/i, '').replace(/⟧$/, '').trim();
    if (!body) continue;
    if (/^videos?$/i.test(body)) continue;
    // A concrete clip/path/id counts as grounded.
    if (/\S/.test(body)) return true;
  }
  return false;
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
  // Plain list — never curly quotes (those look like transcript citations to the scorer/UI).
  const needleText = needles.length
    ? needles
        .slice(0, 8)
        .map((n) => String(n).replace(/[“”"']/g, '').trim())
        .filter(Boolean)
        .join('; ')
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

export type ApplyHonestNotFoundOptions = {
  /**
   * True when the answer has no job citation chips (⟦quotes:⟧ / ⟦sources:⟧).
   * Soft denials and ungrounded absences then get the Not found. lead-in.
   */
  noGroundedClaim?: boolean;
};

/**
 * If the model hedged / denied / abstained, or echoed empty-job boilerplate on
 * a job that already has clips, rewrite into an honest not-found that names
 * the search. Always leads with exactly "Not found."
 */
export function applyHonestNotFound(
  answer: string,
  catalog: AskLookupCatalog,
  question: string,
  opts?: ApplyHonestNotFoundOptions,
): string {
  const cleaned = stripEmptyJobBoilerplate(answer, catalog);
  const clips = clipsInScope(catalog);
  const denied = looksLikeNotFound(cleaned);
  // Never wipe a grounded answer that already carries job citation chips —
  // phrases like "does not establish completion" are denial-shaped but answerable.
  const hasCite = answerHasJobCitation(answer) || answerHasJobCitation(cleaned);
  const ungrounded = Boolean(opts?.noGroundedClaim) || !hasCite;
  const shouldRewrite =
    (denied && ungrounded && !hasCite) ||
    (clips.length > 0 && (hasEmptyJobBoilerplate(answer) || !cleaned.trim()));
  if (!shouldRewrite) {
    // Already honest — ensure exact lead-in if it opens with a soft "not found".
    if (/^\s*not found\b/i.test(cleaned) && !/^Not found\./.test(cleaned.trim())) {
      const trailers = answer.match(/\n⟦[^⟧]*⟧/g)?.join('') ?? '';
      const body = formatHonestNotFound({ question, catalog, answer: cleaned });
      return `${body}${trailers}`;
    }
    return cleaned;
  }
  if (/⟦artifact⟧[\s\S]*?\S[\s\S]*?⟦\/artifact⟧/.test(answer)) return cleaned;
  const trailers = answer.match(/\n⟦[^⟧]*⟧/g)?.join('') ?? '';
  const body = formatHonestNotFound({ question, catalog, answer: cleaned });
  return `${body}${trailers}`;
}
