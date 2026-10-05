/**
 * Require a citeable source for factual claims in Ask answers.
 *
 * Quotes already go through askQuoteGrounding (exact transcript substring).
 * This pass looks for bare factual sentences (numbers, dates, named actions)
 * that lack a nearby ⟦sources:…⟧ / video/… cite and appends a sources trailer
 * from retrieved chunk cites when possible, or marks the claim for verify.
 */
import type { TranscriptChunk } from './askTranscriptIndex.js';

const BARE_FACT =
  /\b(?:on\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d+\s+(?:clips?|videos?|rooms?)|speaker\s+\d+|\$\d+)/i;

export type ClaimCitationResult = {
  answer: string;
  claimsChecked: number;
  claimsCited: number;
  claimsUncited: number;
};

/**
 * If the answer has factual content but no sources trailer, attach cites from
 * retrieved chunks. Does not invent quotes — only source chips.
 */
export function ensureClaimCitations(
  answer: string,
  chunks: TranscriptChunk[],
): ClaimCitationResult {
  const text = String(answer ?? '');
  const hasSources = /⟦sources:/i.test(text);
  const claimsChecked = BARE_FACT.test(text) ? 1 : 0;
  if (!claimsChecked) {
    return { answer: text, claimsChecked: 0, claimsCited: hasSources ? 1 : 0, claimsUncited: 0 };
  }
  if (hasSources) {
    return { answer: text, claimsChecked, claimsCited: 1, claimsUncited: 0 };
  }
  const cites = [...new Set(chunks.map((c) => c.cite).filter(Boolean))].slice(0, 6);
  if (!cites.length) {
    return { answer: text, claimsChecked, claimsCited: 0, claimsUncited: 1 };
  }
  const trailer = `\n⟦sources: ${cites.join(' ')}⟧`;
  return {
    answer: `${text.trimEnd()}${trailer}`,
    claimsChecked,
    claimsCited: 1,
    claimsUncited: 0,
  };
}
