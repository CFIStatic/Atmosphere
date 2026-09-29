/**
 * Transcript chunk index for job-level Ask.
 *
 * Every raw transcript is split into chunks keyed by clip id + start/end
 * second (one per transcriber segment, or per short word run when a clip only
 * has word timings). Retrieval runs over those chunks AND the clip summaries,
 * merges them, and ranks with a lexical score (exact phrase pins + BM25) fused
 * with a semantic score (reciprocal rank fusion).
 *
 * Contract: when a question names a searchable phrase that appears verbatim
 * in a transcript, that chunk is always returned. Chunk text is the exact
 * redacted transcript text, never truncated, so a quoted line can be checked
 * as a plain substring of what was retrieved.
 *
 * The semantic score is a local vector (hashed word stems + character
 * trigrams, the same no-model approach as similarPastJobs.textEmbedding), so
 * retrieval adds no model or API calls.
 */
import {
  CHILD_PRIVACY_REDACTED_LABEL,
} from '../audio/childPrivacyRedactions.js';
import { PRIVACY_REDACTED_LABEL } from '../audio/privacyRedactions.js';
import {
  askClipCite,
  askSpanRedactionLabel,
  askTimed,
  clipsInScope,
  redactAskLine,
  redactClipTranscriptForAsk,
  redactedClipSummary,
  redactedLines,
  type AskLookupCatalog,
  type AskLookupClip,
} from './askLookup.js';
import { clipMatchesAskDate, formatAskClock, parseAskDate, type AskCalendarDate } from './askMoments.js';
import { cleanMentionTitle } from './mentions.js';
import { diarizationLabel, speakerLabelOrUnidentified, UNIDENTIFIED_SPEAKER } from './askSpeakers.js';

export type TranscriptChunk = {
  /** `${proofId}#${seq}`: stable for one transcript version. */
  key: string;
  proofId: string;
  jobId: string;
  orgId: string;
  clipTitle: string;
  workDate: string | null;
  seq: number;
  startSec: number | null;
  endSec: number | null;
  /** Exact redacted transcript text for this span. Never truncated. */
  text: string;
  /** Diarization label ("Speaker 1"), from the segment or a "SPEAKER_00:" prefix. Null when unknown. */
  speaker: string | null;
  /** Moment source id that opens the clip at startSec. */
  cite: string;
};

export type SummaryDoc = {
  key: string;
  proofId: string;
  jobId: string;
  clipTitle: string;
  workDate: string | null;
  text: string;
  cite: string;
};

export type EvidenceReason = 'phrase' | 'lexical' | 'semantic' | 'commitment';

export type EvidenceHit = {
  kind: 'transcript' | 'summary';
  key: string;
  proofId: string;
  jobId: string;
  clipTitle: string;
  workDate: string | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
  speaker: string | null;
  cite: string;
  score: number;
  lexical: number;
  semantic: number;
  pinned: boolean;
  reason: EvidenceReason;
  /** Question phrases found verbatim in this chunk. */
  matched: string[];
};

export type EvidenceRetrieval = {
  question: string;
  /** Searchable phrases pulled from the question, longest first. */
  phrases: string[];
  terms: string[];
  asked: AskCalendarDate | null;
  /** Clips in scope after the date filter. */
  clipCount: number;
  /** Clips in scope before the date filter. */
  allClipCount: number;
  /** Relevant transcript chunks, best first, pinned phrase hits always included. */
  transcript: EvidenceHit[];
  /** Relevant summaries (supplementary context, never quoted). */
  summaries: EvidenceHit[];
  /** Transcript and summary hits merged into one ranked list. */
  merged: EvidenceHit[];
  /** Topic hits on other days when the asked day had none. */
  otherDays: EvidenceHit[];
  /** Every chunk in scope (all dates). The quote checker verifies against these. */
  chunks: TranscriptChunk[];
  /** The question asks who committed / owns / will do something. */
  asksOwner: boolean;
};

/* ------------------------------------------------------------ chunking -- */

function isRedactedText(text: string): boolean {
  return text.includes(PRIVACY_REDACTED_LABEL) || text.includes(CHILD_PRIVACY_REDACTED_LABEL);
}

/** A diarization prefix ("SPEAKER_01: …", "Speaker 2: …"). Any other "Words: …" is speech and stays in the text. */
function explicitPrefix(text: string): { speaker: string | null; body: string } {
  const match = text.match(/^((?:SPEAKER_\d{1,3}|(?:speaker|spk)[\s_-]*(?:\d{1,3}|[a-z]))):\s+(\S[\s\S]*)$/i);
  if (!match || !diarizationLabel(match[1]!)) return { speaker: null, body: text };
  return { speaker: match[1]!.trim(), body: match[2]!.trim() };
}

function wordRuns(
  clip: AskLookupClip,
): Array<{ start: number; end: number; text: string; speaker: string | null }> {
  const words = askTimed(clip.words);
  const runs: Array<{ start: number; end: number; text: string; speaker: string | null; redacted: boolean }> = [];
  let cur: (typeof runs)[number] | null = null;
  for (const word of words) {
    const label = askSpanRedactionLabel(clip, word.start, word.end);
    const redacted = label != null;
    const sentenceEnd = cur != null && /[.!?]$/.test(cur.text);
    const gap = cur != null && word.start - cur.end > 1.2;
    const speakerChange = cur != null && (word.speaker ?? null) !== cur.speaker;
    if (!cur || redacted !== cur.redacted || gap || speakerChange || (sentenceEnd && cur.text.length > 20) || cur.text.length > 160) {
      if (cur) runs.push(cur);
      cur = { start: word.start, end: word.end, text: redacted ? '' : word.text, speaker: word.speaker ?? null, redacted };
    } else {
      cur.end = word.end;
      if (!redacted) cur.text = `${cur.text} ${word.text}`.trim();
    }
  }
  if (cur) runs.push(cur);
  return runs.filter((run) => !run.redacted && run.text);
}

/** A diarization label ("Speaker 1") or an explicit name; never a visual guess. */
function chunkSpeaker(raw: string | null): string | null {
  if (!raw) return null;
  const label = speakerLabelOrUnidentified(raw);
  return label === UNIDENTIFIED_SPEAKER ? null : label;
}

/** Split one clip's raw transcript into timed chunks. Redacted speech is skipped, never returned. */
export function chunkClipTranscript(clip: AskLookupClip): TranscriptChunk[] {
  const clipTitle = cleanMentionTitle(clip.title) || clip.title || 'Clip';
  const base = { proofId: clip.proofId, jobId: clip.jobId, orgId: clip.orgId, clipTitle, workDate: clip.workDate ?? null };
  const out: TranscriptChunk[] = [];
  const push = (start: number | null, end: number | null, raw: string, speaker: string | null) => {
    let text = raw.replace(/\s+/g, ' ').trim();
    if (!text || isRedactedText(text)) return;
    const prefix = explicitPrefix(text);
    text = prefix.body;
    if (!text) return;
    const seq = out.length;
    out.push({
      ...base,
      key: `${clip.proofId}#${seq}`,
      seq,
      startSec: start,
      endSec: end,
      text,
      speaker: chunkSpeaker(speaker ?? prefix.speaker),
      cite: askClipCite(clip, start),
    });
  };
  const segments = askTimed(clip.segments);
  if (segments.length) {
    for (const row of segments) {
      if (askSpanRedactionLabel(clip, row.start, row.end)) continue;
      // Run both text redactors on the line with its own clock so a named
      // redaction inside clear speech is replaced exactly as the tools show it.
      const rendered = redactAskLine(`[${formatAskClock(row.start)}] ${row.text}`, clip);
      push(row.start, row.end, rendered.replace(/^\[[^\]]*\]\s*/, ''), row.speaker ?? null);
    }
    return out;
  }
  const words = askTimed(clip.words);
  if (words.length) {
    for (const run of wordRuns(clip)) {
      const rendered = redactAskLine(`[${formatAskClock(run.start)}] ${run.text}`, clip);
      push(run.start, run.end, rendered.replace(/^\[[^\]]*\]\s*/, ''), run.speaker);
    }
    return out;
  }
  const lines = redactedLines(redactClipTranscriptForAsk(clip));
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const next = lines.slice(i + 1).find((row) => row.atSeconds != null);
    push(line.atSeconds, next?.atSeconds ?? null, line.text, null);
  }
  return out;
}

export function summaryDoc(clip: AskLookupClip): SummaryDoc | null {
  const text = redactedClipSummary(clip).trim();
  if (!text) return null;
  return {
    key: `${clip.proofId}#summary`,
    proofId: clip.proofId,
    jobId: clip.jobId,
    clipTitle: cleanMentionTitle(clip.title) || clip.title || 'Clip',
    workDate: clip.workDate ?? null,
    text,
    cite: askClipCite(clip, null),
  };
}

/* ------------------------------------------------------- query analysis -- */

const STOP = new Set(
  (
    'a an the and or but if then than so to of in on at by for from with without into onto about above below over under ' +
    'is are was were be been being am do does did doing done have has had having will would shall should can could may might must ' +
    'i me my mine we us our ours you your yours he him his she her hers it its they them their theirs this that these those there here ' +
    'what which who whom whose when where why how whether any anything anyone anybody some something someone somebody every everything everyone ' +
    'all each both either neither no not nor only just also very too more most much many few lot lots such same other another own ' +
    'up down out off again once ever yet still already even really please tell show give find list let lets get got gets ' +
    'yes yeah okay ok oh um uh like well'
  ).split(/\s+/),
);

/** Words about the question itself, never the topic. */
const META = new Set(
  (
    'said say says saying told tell talk talked talking talks mention mentioned mentions mentioning discuss discussed discussing discussion ' +
    'spoke speak speaking spoken speaker speakers line lines word words quote quotes quoted verbatim exact exactly ' +
    'timestamp timestamps time times moment moments minute minutes second seconds clip clips video videos recording recordings transcript transcripts ' +
    'job project file footage audio visit day days date dates week today yesterday tomorrow morning afternoon evening ' +
    'commit committed commits committing commitment agreed agree agrees promise promised promising volunteer volunteered ' +
    'responsible owner owns own handle handled handling charge assigned take took taking go going gonna goes went ' +
    'happen happened happening come came make made thing things stuff part ' +
    'january february march april may june july august september sept october november december ' +
    'jan feb mar apr jun jul aug sep oct nov dec monday tuesday wednesday thursday friday saturday sunday ' +
    'first last next previous latest earlier later count number ' +
    'homeowner homeowners crew contractor contractors adjuster client customer worker workers tech technician ' +
    'guy guys man men woman women lady person people somebody anyone someone everybody'
  ).split(/\s+/),
);

function normalizeText(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—]/g, '-')
    .toLowerCase();
}

function stem(word: string): string {
  let w = word.replace(/'s$/, '').replace(/'/g, '');
  if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  return w;
}

function wordsOf(text: string): string[] {
  return normalizeText(text).match(/[a-z0-9]+(?:'[a-z]+)?/g) ?? [];
}

function contentTokens(text: string): string[] {
  return wordsOf(text)
    .filter((w) => !STOP.has(w) && !/^\d+(?:st|nd|rd|th)?$/.test(w))
    .map(stem)
    .filter((w) => w.length > 1);
}

/**
 * Searchable phrases in a question: quoted spans, then runs of consecutive
 * topic words ("LedgerPro cloud"), then their sub-phrases and single topic
 * words. Longest first.
 */
export function searchPhrases(question: string): { phrases: string[]; terms: string[] } {
  const text = String(question ?? '');
  const phrases: string[] = [];
  const add = (value: string) => {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean.length < 3) return;
    if (!phrases.some((existing) => existing.toLowerCase() === clean.toLowerCase())) phrases.push(clean);
  };
  for (const match of text.matchAll(/["“]([^"”]{3,120})["”]/g)) add(match[1]!);
  const withoutDates = text
    .replace(/\b20\d{2}-\d{1,2}-\d{1,2}\b/g, ' , ')
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/20\d{2})?\b/g, ' , ');
  const runs: string[][] = [];
  for (const clause of withoutDates.split(/[.,;:!?()[\]{}"“”\n]+|\s[-–—]\s/)) {
    let run: string[] = [];
    for (const raw of clause.split(/\s+/)) {
      const word = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      const lower = normalizeText(word);
      const skip = !word || STOP.has(lower) || META.has(lower) || /^\d+(?:st|nd|rd|th)?$/.test(lower) || lower.length < 2;
      if (skip) {
        if (run.length) runs.push(run);
        run = [];
      } else {
        run.push(word);
      }
    }
    if (run.length) runs.push(run);
  }
  const subs: string[] = [];
  const singles: string[] = [];
  for (const run of runs) {
    add(run.join(' '));
    for (let size = run.length - 1; size >= 2; size -= 1) {
      for (let i = 0; i + size <= run.length; i += 1) subs.push(run.slice(i, i + size).join(' '));
    }
    if (run.length > 1) for (const word of run) singles.push(word);
  }
  for (const sub of subs) add(sub);
  for (const word of singles) if (word.length >= 4) add(word);
  phrases.sort((a, b) => b.split(' ').length - a.split(' ').length || b.length - a.length);
  const terms = [...new Set(runs.flat().map((w) => stem(normalizeText(w))).filter((w) => w.length > 1))];
  return { phrases, terms };
}

const OWNER_Q =
  /\bwho\b[^?]{0,80}\b(?:commit|committed|agree|agreed|promis\w*|volunteer\w*|will|'ll|going to|gonna|responsib\w*|owns?|owner|handl\w*|take care|taking care|doing|do it|in charge|took|assigned|said (?:they|he|she) would)\b|\b(?:who(?:'s| is| was)? (?:the )?owner|who owns)\b/i;

export function asksWhoCommitted(question: string): boolean {
  return OWNER_Q.test(String(question ?? ''));
}

const COMMIT_LINE =
  /\b(?:i'?m going to|i am going to|i'?m gonna|i'?ll|i will|we'?ll|we will|we'?re going to|let me|i can do|i got it|i'?ve got it|on it)\b/i;

/* --------------------------------------------------------------- scoring -- */

function phraseRegex(phrase: string): RegExp {
  const words = wordsOf(phrase);
  const body = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "'?")).join("[\\s\\-']+");
  return new RegExp(`(?:^|[^a-z0-9])${body}(?=$|[^a-z0-9])`, 'i');
}

function hashIndex(value: string, dims: number): number {
  let h = 2166136261;
  for (let k = 0; k < value.length; k += 1) {
    h ^= value.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % dims;
}

/** Local semantic vector: hashed word stems (weight 2) plus character trigrams. No model call. */
function trigramVector(text: string, dims = 1024): Map<number, number> {
  const vec = new Map<number, number>();
  for (const token of contentTokens(text)) {
    const w = hashIndex(`w:${token}`, dims);
    vec.set(w, (vec.get(w) ?? 0) + 2);
    const padded = ` ${token} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      const idx = hashIndex(padded.slice(i, i + 3), dims);
      vec.set(idx, (vec.get(idx) ?? 0) + 1);
    }
  }
  return vec;
}

function sparseCosine(a: Map<number, number>, b: Map<number, number>): number {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  for (const [k, v] of a) dot += v * (b.get(k) ?? 0);
  let na = 0;
  let nb = 0;
  for (const v of a.values()) na += v * v;
  for (const v of b.values()) nb += v * v;
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

type Doc = {
  kind: 'transcript' | 'summary';
  key: string;
  proofId: string;
  jobId: string;
  clipTitle: string;
  workDate: string | null;
  startSec: number | null;
  endSec: number | null;
  text: string;
  speaker: string | null;
  cite: string;
};

function bm25(docs: Doc[], terms: string[]): number[] {
  const tokenized = docs.map((doc) => contentTokens(doc.text));
  const n = docs.length || 1;
  const avg = tokenized.reduce((sum, t) => sum + t.length, 0) / n || 1;
  const df = new Map<string, number>();
  for (const toks of tokenized) for (const term of new Set(toks)) df.set(term, (df.get(term) ?? 0) + 1);
  const k1 = 1.2;
  const b = 0.75;
  return tokenized.map((toks) => {
    let score = 0;
    for (const term of terms) {
      const tf = toks.filter((t) => t === term).length;
      if (!tf) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += (idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * toks.length) / avg));
    }
    return score;
  });
}

function rankOf(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => b[0] - a[0]);
  const ranks = new Array<number>(values.length).fill(Number.POSITIVE_INFINITY);
  order.forEach(([v, i], r) => {
    if (v > 0) ranks[i] = r + 1;
  });
  return ranks;
}

/* ------------------------------------------------------------- retrieval -- */

export type RetrieveOptions = {
  /** Restrict to the day the question names. Default true. */
  useDate?: boolean;
  limit?: number;
};

function hitFrom(doc: Doc, extra: Partial<EvidenceHit>): EvidenceHit {
  return {
    ...doc,
    score: 0,
    lexical: 0,
    semantic: 0,
    pinned: false,
    reason: 'lexical',
    matched: [],
    ...extra,
  };
}

function byClipTime(a: EvidenceHit, b: EvidenceHit): number {
  if (a.proofId !== b.proofId) {
    const da = a.workDate ?? '';
    const db = b.workDate ?? '';
    if (da !== db) return da < db ? -1 : 1;
    return a.proofId < b.proofId ? -1 : 1;
  }
  return (a.startSec ?? 0) - (b.startSec ?? 0);
}

/** All transcript chunks for the clips this Ask may read. */
export function chunksInScope(catalog: AskLookupCatalog): TranscriptChunk[] {
  return clipsInScope(catalog).flatMap((clip) => chunkClipTranscript(clip));
}

export function retrieveAskEvidence(
  catalog: AskLookupCatalog,
  question: string,
  opts?: RetrieveOptions,
): EvidenceRetrieval {
  const clips = clipsInScope(catalog);
  const asked = opts?.useDate === false ? null : parseAskDate(question);
  const onDay = asked ? clips.filter((clip) => clipMatchesAskDate(clip.workDate, asked, catalog.timeZone)) : clips;
  const allChunks = clips.flatMap((clip) => chunkClipTranscript(clip));
  // A person's name (an @mention or someone on the job) is who, not what.
  const nameWords = new Set(
    (catalog.people ?? []).flatMap((person) => wordsOf(person.name ?? '')).filter((w) => w.length > 1),
  );
  const found = searchPhrases(String(question ?? '').replace(/@[\p{L}\p{N}_.-]+/gu, ' , '));
  const phrases = found.phrases.filter((phrase) => wordsOf(phrase).some((w) => !nameWords.has(w)));
  const terms = found.terms.filter((term) => !nameWords.has(term));
  const asksOwner = asksWhoCommitted(question);
  const empty: EvidenceRetrieval = {
    question,
    phrases,
    terms,
    asked,
    clipCount: onDay.length,
    allClipCount: clips.length,
    transcript: [],
    summaries: [],
    merged: [],
    otherDays: [],
    chunks: allChunks,
    asksOwner,
  };
  if (!phrases.length && !terms.length) return empty;

  const rank = (pool: AskLookupClip[]) => {
    const ids = new Set(pool.map((clip) => clip.proofId));
    const docs: Doc[] = [
      ...allChunks.filter((chunk) => ids.has(chunk.proofId)).map((chunk) => ({ ...chunk, kind: 'transcript' as const })),
      ...pool
        .map((clip) => summaryDoc(clip))
        .filter((doc): doc is SummaryDoc => doc != null)
        .map((doc) => ({ ...doc, kind: 'summary' as const, startSec: null, endSec: null, speaker: null })),
    ];
    if (!docs.length) return { transcript: [] as EvidenceHit[], summaries: [] as EvidenceHit[], merged: [] as EvidenceHit[] };
    const lexical = bm25(docs, terms);
    const queryVec = trigramVector(phrases.join(' ') || question);
    const semantic = docs.map((doc) => sparseCosine(queryVec, trigramVector(doc.text)));
    const matched = docs.map((doc) => {
      const hay = normalizeText(doc.text);
      return phrases.filter((phrase) => phraseRegex(phrase).test(hay));
    });
    const lexRank = rankOf(lexical);
    const semRank = rankOf(semantic);
    // A semantic-only hit (no shared stem) must be a close match: near-spellings, not topic drift.
    const minSemantic = 0.45;
    const hits: EvidenceHit[] = [];
    docs.forEach((doc, i) => {
      const pinned = doc.kind === 'transcript' && matched[i]!.length > 0;
      const relevant = pinned || matched[i]!.length > 0 || lexical[i]! > 0 || semantic[i]! >= minSemantic;
      if (!relevant) return;
      const longest = matched[i]!.reduce((best, phrase) => Math.max(best, phrase.split(' ').length), 0);
      const rrf = 1 / (60 + lexRank[i]!) + 1 / (60 + semRank[i]!);
      const score = (pinned ? 10 + longest : 0) + rrf * (doc.kind === 'summary' ? 0.5 : 1);
      hits.push(
        hitFrom(doc, {
          score,
          lexical: lexical[i]!,
          semantic: semantic[i]!,
          pinned,
          matched: matched[i]!,
          reason: pinned ? 'phrase' : lexical[i]! > 0 ? 'lexical' : 'semantic',
        }),
      );
    });
    hits.sort((a, b) => b.score - a.score || byClipTime(a, b));
    let transcript = hits.filter((hit) => hit.kind === 'transcript');
    const topLongest = transcript[0]?.pinned ? Math.max(...transcript[0].matched.map((p) => p.split(' ').length)) : 0;
    // When the full phrase is present, single-word overlaps elsewhere are noise.
    if (topLongest >= 2) {
      transcript = transcript.filter(
        (hit) => hit.pinned && Math.max(...hit.matched.map((p) => p.split(' ').length)) >= Math.min(2, topLongest),
      );
    }
    if (asksOwner) {
      const extra: EvidenceHit[] = [];
      for (const hit of transcript.filter((row) => row.pinned)) {
        const next = allChunks.find(
          (chunk) =>
            chunk.proofId === hit.proofId &&
            chunk.startSec != null &&
            hit.startSec != null &&
            chunk.startSec > hit.startSec &&
            chunk.startSec - (hit.endSec ?? hit.startSec) <= 8 &&
            COMMIT_LINE.test(normalizeText(chunk.text)),
        );
        if (next && !transcript.some((row) => row.key === next.key) && !extra.some((row) => row.key === next.key)) {
          extra.push(hitFrom({ ...next, kind: 'transcript' }, { score: hit.score - 0.001, reason: 'commitment' }));
        }
      }
      transcript = [...transcript, ...extra];
    }
    const limit = opts?.limit ?? 8;
    const pinnedHits = transcript.filter((hit) => hit.pinned || hit.reason === 'commitment');
    const rest = transcript.filter((hit) => !(hit.pinned || hit.reason === 'commitment'));
    transcript = [...pinnedHits.slice(0, Math.max(limit, 12)), ...rest.slice(0, Math.max(0, limit - pinnedHits.length))];
    const summaries = hits.filter((hit) => hit.kind === 'summary').slice(0, 3);
    const merged = [...transcript, ...summaries].sort((a, b) => b.score - a.score || byClipTime(a, b));
    return { transcript, summaries, merged };
  };

  const main = rank(onDay);
  let otherDays: EvidenceHit[] = [];
  if (asked && !main.transcript.length) {
    const others = clips.filter((clip) => !onDay.includes(clip));
    otherDays = rank(others).transcript;
  }
  return { ...empty, transcript: main.transcript, summaries: main.summaries, merged: main.merged, otherDays };
}

/** Transcript hits in the order they were spoken (clip, then time). */
export function spokenOrder(hits: EvidenceHit[]): EvidenceHit[] {
  return [...hits].sort(byClipTime);
}
