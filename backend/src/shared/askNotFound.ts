/**
 * Honest "not found" wording for Ask.
 *
 * When the file does not answer the question, say what was searched (phrases,
 * clip count) and what *is* on the file — never a soft refuse that hides the
 * search, and never invent a hit.
 */
import type { AskLookupCatalog } from './askLookup.js';
import { clipsInScope } from './askLookup.js';
import { takeAskSearchMeta } from './askRetrievalContext.js';

export type SearchMeta = {
  phrases: string[];
  terms: string[];
  clipCount: number;
  hitCount: number;
};

const HEDGE =
  /\b(i don't know|i do not know|not sure|nothing (?:in|on) (?:the |this )?file|not (?:in|on) (?:the |this )?file|no (?:information|mention|record)|does not (?:show|mention|say)|can't find|cannot find)\b/i;

export function looksLikeNotFound(answer: string): boolean {
  return HEDGE.test(String(answer ?? ''));
}

export function formatHonestNotFound(input: {
  question: string;
  catalog: AskLookupCatalog;
  searched?: SearchMeta | null;
  answer?: string | null;
}): string {
  const searched = input.searched ?? takeAskSearchMeta(input.catalog.jobId);
  const clips = clipsInScope(input.catalog);
  const needles = [
    ...(searched?.phrases ?? []),
    ...(searched?.terms ?? []).slice(0, 6),
  ].filter(Boolean);
  const needleText = needles.length
    ? needles.slice(0, 8).map((n) => `“${n}”`).join(', ')
    : 'the words in your question';
  const clipText =
    clips.length === 0
      ? 'This job has no clips yet.'
      : `I looked through ${searched?.clipCount ?? clips.length} clip${(searched?.clipCount ?? clips.length) === 1 ? '' : 's'} on this job.`;
  const onFile = [
    input.catalog.jobTitle ? `Project: ${input.catalog.jobTitle}` : null,
    clips.length ? `Clips on file: ${clips.map((c) => c.title).slice(0, 8).join('; ')}` : null,
  ]
    .filter(Boolean)
    .join(' ');

  const prior = (input.answer ?? '').replace(/⟦[^⟧]*⟧/g, '').trim();
  const lead =
    prior && looksLikeNotFound(prior)
      ? prior.split(/\n/)[0]!.slice(0, 240)
      : 'Nothing on this file answers that.';

  return [
    lead,
    `${clipText} Searched for ${needleText}. No matching transcript or analysis line turned up.`,
    onFile ? `What is on file: ${onFile}` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * If the model hedged / abstained, rewrite into an honest not-found that names
 * the search. Leave grounded answers alone.
 */
export function applyHonestNotFound(
  answer: string,
  catalog: AskLookupCatalog,
  question: string,
): string {
  if (!looksLikeNotFound(answer)) return answer;
  // Task drafts (scope note, punch list, email, …) already lead with an honest
  // gap line and wrap a real artifact. Rewriting would drop the document.
  if (/⟦artifact⟧[\s\S]*?\S[\s\S]*?⟦\/artifact⟧/.test(answer)) return answer;
  // Keep quote/source trailers if present.
  const trailers = answer.match(/\n⟦[^⟧]*⟧/g)?.join('') ?? '';
  const body = formatHonestNotFound({ question, catalog, answer });
  return `${body}${trailers}`;
}
