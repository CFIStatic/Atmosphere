/**
 * "Show me how we did this last time" — retrieve similar past jobs for training.
 *
 * Scores candidates by work type, party trades, rooms mentioned in analysis,
 * and text/embedding similarity over job + analysis prose. Pure so the ranking
 * is unit-testable without a database.
 */

export type JobSimilaritySeed = {
  jobId: string;
  title?: string | null;
  jobNumber?: string | number | null;
  workType?: string | null;
  status?: string | null;
  description?: string | null;
  trades?: string[];
  rooms?: string[];
  /** Concatenated analysis / summaries / transcripts used for text similarity. */
  analysisText?: string | null;
};

export type SimilarJobMatch = {
  jobId: string;
  title: string;
  jobNumber: string | number | null;
  workType: string | null;
  status: string | null;
  score: number;
  reasons: string[];
  trades: string[];
  rooms: string[];
  sharedTrades: string[];
  sharedRooms: string[];
  textSimilarity: number;
};

const STOP = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'this',
  'that',
  'it',
  'as',
  'by',
  'we',
  'they',
  'you',
  'our',
  'their',
]);

/** Normalize free-text trade / room labels for set compares. */
export function normalizeLabel(raw: string | null | undefined): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export function uniqueLabels(values: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const n = normalizeLabel(value);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter += 1;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function shared(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return a.filter((x) => setB.has(x));
}

/** Tokenize prose into lowercase terms for bag-of-words embedding. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s$]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !STOP.has(t));
}

/**
 * Sparse hashed bag-of-words embedding (local, no model call). Stable enough
 * for cosine ranking of analysis text within an org's job history.
 */
export function textEmbedding(text: string | null | undefined, dims = 256): Float64Array {
  const vec = new Float64Array(dims);
  const tokens = tokenize(text);
  if (tokens.length === 0) return vec;
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i += 1) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % dims;
    const sign = (h & 0x1000000) === 0 ? 1 : -1;
    vec[idx] += sign;
  }
  // L2 normalize for cosine.
  let norm = 0;
  for (let i = 0; i < dims; i += 1) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i += 1) vec[i]! /= norm;
  }
  return vec;
}

export function cosineSimilarity(a: Float64Array, b: Float64Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < n; i += 1) dot += a[i]! * b[i]!;
  if (!Number.isFinite(dot)) return 0;
  return Math.max(0, Math.min(1, dot));
}

function analysisBlob(seed: JobSimilaritySeed): string {
  return [seed.title, seed.description, seed.analysisText, ...(seed.rooms ?? []), ...(seed.trades ?? [])]
    .filter(Boolean)
    .join('\n');
}

export function scoreSimilarJob(
  source: JobSimilaritySeed,
  candidate: JobSimilaritySeed,
): SimilarJobMatch {
  const sourceTrades = uniqueLabels(source.trades ?? []);
  const candidateTrades = uniqueLabels(candidate.trades ?? []);
  const sourceRooms = uniqueLabels(source.rooms ?? []);
  const candidateRooms = uniqueLabels(candidate.rooms ?? []);

  const workTypeMatch =
    Boolean(source.workType) &&
    normalizeLabel(source.workType) === normalizeLabel(candidate.workType);

  const tradeScore = jaccard(sourceTrades, candidateTrades);
  const roomScore = jaccard(sourceRooms, candidateRooms);
  const textSim = cosineSimilarity(
    textEmbedding(analysisBlob(source)),
    textEmbedding(analysisBlob(candidate)),
  );

  // Weighted blend — structured filters first, text/embedding fills gaps.
  const score =
    (workTypeMatch ? 0.28 : 0) + tradeScore * 0.24 + roomScore * 0.24 + textSim * 0.24;

  const reasons: string[] = [];
  if (workTypeMatch && source.workType) {
    reasons.push(`Same work type (${normalizeLabel(source.workType)})`);
  }
  const sharedTrades = shared(sourceTrades, candidateTrades);
  if (sharedTrades.length) {
    reasons.push(`Trade: ${sharedTrades.slice(0, 3).join(', ')}`);
  }
  const sharedRooms = shared(sourceRooms, candidateRooms);
  if (sharedRooms.length) {
    reasons.push(`Rooms: ${sharedRooms.slice(0, 4).join(', ')}`);
  }
  if (textSim >= 0.35) {
    reasons.push('Similar analysis');
  } else if (textSim >= 0.18 && reasons.length === 0) {
    reasons.push('Related job notes');
  }

  return {
    jobId: candidate.jobId,
    title: String(candidate.title ?? 'Job').trim() || 'Job',
    jobNumber: candidate.jobNumber ?? null,
    workType: candidate.workType ?? null,
    status: candidate.status ?? null,
    score: Math.round(score * 1000) / 1000,
    reasons,
    trades: candidateTrades,
    rooms: candidateRooms,
    sharedTrades,
    sharedRooms,
    textSimilarity: Math.round(textSim * 1000) / 1000,
  };
}

/**
 * Rank candidate jobs against a source. Excludes the source id and anything
 * below `minScore`. Default limit 8 for the job-file panel.
 */
export function rankSimilarPastJobs(
  source: JobSimilaritySeed,
  candidates: JobSimilaritySeed[],
  opts?: { limit?: number; minScore?: number },
): SimilarJobMatch[] {
  const limit = opts?.limit ?? 8;
  const minScore = opts?.minScore ?? 0.12;
  const ranked = candidates
    .filter((c) => c.jobId && c.jobId !== source.jobId)
    .map((c) => scoreSimilarJob(source, c))
    .filter((m) => m.score >= minScore)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return ranked.slice(0, limit);
}

/** Pull room labels from stored analysis findings + free text. */
export function roomsFromAnalysis(
  text: string | null | undefined,
  findings: unknown,
  roomsMentionedIn: (raw: string) => string[],
): string[] {
  const rooms: string[] = [];
  if (findings && typeof findings === 'object') {
    const f = findings as Record<string, unknown>;
    const conversation = f.conversation;
    if (conversation && typeof conversation === 'object') {
      const c = conversation as Record<string, unknown>;
      for (const key of ['roomsMentioned', 'rooms'] as const) {
        const list = c[key];
        if (Array.isArray(list)) {
          for (const item of list) if (typeof item === 'string') rooms.push(item);
        }
      }
    }
    for (const key of ['roomsMentioned', 'rooms', 'conversationRooms'] as const) {
      const list = f[key];
      if (Array.isArray(list)) {
        for (const item of list) if (typeof item === 'string') rooms.push(item);
      }
    }
  }
  if (text) rooms.push(...roomsMentionedIn(text));
  return uniqueLabels(rooms);
}
