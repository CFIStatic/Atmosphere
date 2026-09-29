/**
 * How much was said on a clip, from the raw transcript, and whether a piece of
 * prose claims a different amount.
 *
 * The raw transcript is the authority on speech. An AI summary built from an
 * older transcript can say "the only speech is a single fragment" above five
 * transcript lines; Ask repeated that. These helpers let Ask count from the
 * transcript and let the checker flag a sentence that contradicts it.
 */

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, no: 0, one: 1, a: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

/** Non-empty transcript lines. Whisper writes one stamped line per segment. */
export function transcriptLines(transcript: string | null | undefined): string[] {
  return String(transcript ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function transcriptLineCount(transcript: string | null | undefined): number {
  return transcriptLines(transcript).length;
}

export type SpeechCountClaim = { count: number; text: string };

const UNIT =
  '(?:lines?|fragments?|utterances?|sentences?|phrases?|remarks?|quotes?|snippets?|spoken lines?|transcript lines?|lines? of (?:speech|dialogue)|things? (?:was |were )?said|bits? of speech|(?:speech|spoken) (?:events?|segments?|moments?|turns?)|segments? of speech)';
const FILLER = '(?:(?:short|brief|stray|spoken|audible|intelligible|understandable|clear|transcribed|captured|context[- ]free|out[- ]of[- ]context|isolated|lone|distinct|separate|single|verbal)[\\s,-]+){0,4}';
// "only one line about QuickBooks", "the only speech mentioning the table":
// a claim about one topic, not about how much was said on the clip.
const TOPIC_SCOPED =
  '(?!\\s+(?:about|on|regarding|concerning|mentioning|mentions?|refers?|referring|related to|relating to|involving|from|by)\\b)';
const NUMBER = '(\\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)';

const CLAIMS: Array<{ re: RegExp; count: (m: RegExpMatchArray) => number | null }> = [
  // "only one line", "just a single fragment", "only one stray spoken fragment"
  { re: new RegExp(`\\b(?:only|just)\\s+(?:one|1|a single|a lone|a)\\s+${FILLER}${UNIT}(?!\\w)${TOPIC_SCOPED}`, 'gi'), count: () => 1 },
  // "a single context-free fragment", "one single line"
  { re: new RegExp(`\\b(?:a|one)\\s+(?:single|lone)\\s+${FILLER}${UNIT}(?!\\w)${TOPIC_SCOPED}`, 'gi'), count: () => 1 },
  // "the only speech ... is one ..." / "the only thing said"
  {
    re: new RegExp(`\\bthe only (?:(?:audible|intelligible|understandable|clear) )?(?:speech|thing (?:that was |anyone )?said|spoken (?:words?|line))\\b${TOPIC_SCOPED}`, 'gi'),
    count: () => 1,
  },
  // "five transcript lines", "3 distinct utterances"
  {
    re: new RegExp(`(?<!\\bin )\\b${NUMBER}\\s+${FILLER}${UNIT}(?!\\w)${TOPIC_SCOPED}`, 'gi'),
    count: (m) => {
      const raw = (m[1] ?? '').toLowerCase();
      const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw];
      return n == null || !Number.isFinite(n) ? null : n;
    },
  },
  // "no speech", "nothing was said", "no one speaks", "the clip is silent"
  {
    re: /\b(?:no (?:usable |audible |recorded )?(?:speech|dialogue|talking)|nothing (?:is |was |gets )?(?:said|spoken)(?! about| of| on)|no one (?:speaks|says anything|talks)|(?:clip|recording|video|audio) (?:is|was) silent)\b/gi,
    count: () => 0,
  },
];

/** Every statement in `text` about how much speech there is, with the number it claims. */
export function speechCountClaims(text: string): SpeechCountClaim[] {
  const src = String(text ?? '');
  const out: SpeechCountClaim[] = [];
  const seen: Array<[number, number]> = [];
  for (const { re, count } of CLAIMS) {
    for (const match of src.matchAll(re)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (seen.some(([a, b]) => start < b && end > a)) continue;
      const n = count(match);
      if (n == null) continue;
      seen.push([start, end]);
      out.push({ count: n, text: match[0] });
    }
  }
  return out;
}

export type SpeechCountContradiction = { text: string; claimed: number; actual: number[] };

/**
 * Claims that match none of the given transcript line counts. `counts` is one
 * number per clip the text may be talking about. Nothing is flagged when no
 * transcript is known.
 */
export function speechCountContradictions(text: string, counts: number[]): SpeechCountContradiction[] {
  const known = counts.filter((n) => Number.isFinite(n) && n >= 0);
  if (!known.length) return [];
  return speechCountClaims(text)
    .filter((claim) => !known.includes(claim.count))
    .map((claim) => ({ text: claim.text, claimed: claim.count, actual: [...new Set(known)] }));
}

/** "how many lines…", "count the utterances…", "number of things said". */
export function isSpeechCountQuestion(question: string): boolean {
  const q = String(question ?? '').toLowerCase();
  // "How many times did she say X" is a search, not a line count; it is not matched here.
  const unit = /(lines?|utterances?|sentences?|quotes?|remarks?|phrases?|fragments?|things?\s+(?:were\s+|was\s+|got\s+)?said|spoken|transcri\w*)/;
  if (/\b(?:how many|number of)\s+(?:different\s+|distinct\s+)?(?:people|persons|speakers|voices|workers|men|women|kids|children|rooms|clips|videos)\b/.test(q)) return false;
  if (/\bhow many\b/.test(q) && new RegExp(`\\bhow many\\b.{0,60}${unit.source}`).test(q)) return true;
  if (/\b(count|number of)\b/.test(q) && new RegExp(`\\b(count|number of)\\b.{0,60}${unit.source}`).test(q)) return true;
  return false;
}
