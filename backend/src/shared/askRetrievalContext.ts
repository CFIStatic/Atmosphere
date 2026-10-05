/**
 * Hybrid Ask context: retrieval block + stuffed job card.
 *
 * Always loads a short job summary + structured facts + top-k
 * transcript/analysis chunks (OpenAI embeddings when the key is set, else
 * lexical/local RRF). ASK_STUFF_JOB_CONTEXT defaults to on (append the full
 * job card). Set =0 for retrieval-only — synthetic gold matched, but multi-turn
 * chat lost day labels, so keep stuffing on until live Sample Job eval proves
 * retrieval-only equal or better.
 */
import { createHash } from 'node:crypto';
import {
  clipsInScope,
  formatAskJobContext,
  ASK_CONTEXT_BUDGET,
  type AskLookupCatalog,
  type AskLookupClip,
} from './askLookup.js';
import { embedText, embedTexts, cosineSimilarity, askEmbeddingsEnabled } from './askEmbeddings.js';
import {
  chunkClipTranscript,
  retrieveAskEvidence,
  type EvidenceHit,
  type EvidenceRetrieval,
} from './askTranscriptIndex.js';
import { redactedClipSummary } from './askLookup.js';
import { resolveAskJobSummary } from './askJobCache.js';

/** When "1" (default), append the stuffed job card after the retrieval block. */
export function askStuffJobContextEnabled(): boolean {
  return (process.env.ASK_STUFF_JOB_CONTEXT ?? '1').trim() !== '0';
}

export const ASK_RETRIEVAL_TOP_K = 12;

export type AnalysisChunk = {
  key: string;
  proofId: string;
  jobId: string;
  clipTitle: string;
  workDate: string | null;
  kind: 'summary' | 'findings' | 'dictation' | 'action';
  startSec: number | null;
  endSec: number | null;
  text: string;
  cite: string;
};

/** Cut video-analysis prose into retrieval chunks (summary / findings / dictation). */
export function chunkClipAnalysis(clip: AskLookupClip): AnalysisChunk[] {
  const out: AnalysisChunk[] = [];
  const push = (kind: AnalysisChunk['kind'], text: string, startSec: number | null = null) => {
    const body = text.replace(/\s+/g, ' ').trim();
    if (body.length < 8) return;
    out.push({
      key: `${clip.proofId}#${kind}:${out.length}`,
      proofId: clip.proofId,
      jobId: clip.jobId,
      clipTitle: clip.title,
      workDate: clip.workDate ?? null,
      kind,
      startSec,
      endSec: null,
      text: body.slice(0, 4000),
      cite: `video/${clip.jobId}/${clip.proofId}`,
    });
  };
  const summary = redactedClipSummary(clip);
  if (summary) push('summary', summary);
  if (clip.findings) {
    const raw =
      typeof clip.findings === 'string'
        ? clip.findings
        : JSON.stringify(clip.findings);
    push('findings', raw);
  }
  return out;
}

export function analysisChunksInScope(catalog: AskLookupCatalog): AnalysisChunk[] {
  return clipsInScope(catalog).flatMap((clip) => chunkClipAnalysis(clip));
}

/** Compact always-on card: project, people, clip titles/dates — no transcripts. */
export function formatAskJobSummary(catalog: AskLookupCatalog): string {
  return formatAskJobContext(catalog, { budget: 6_000, includeTranscripts: false });
}

function formatHit(hit: EvidenceHit): string {
  const when = hit.workDate ?? 'Undated';
  const clock =
    hit.startSec != null && Number.isFinite(hit.startSec)
      ? `@${Math.max(0, Math.floor(hit.startSec))}s`
      : '';
  const speaker = hit.speaker ? ` ${hit.speaker}:` : '';
  return `- ${when} — ${hit.clipTitle}${clock}${speaker} ${hit.text}`;
}

function formatAnalysis(chunk: AnalysisChunk): string {
  const when = chunk.workDate ?? 'Undated';
  return `- ${when} — ${chunk.clipTitle} [${chunk.kind}] ${chunk.text}`;
}

/**
 * Rank analysis chunks against the question (embeddings when available).
 */
export async function retrieveAnalysisChunks(
  catalog: AskLookupCatalog,
  question: string,
  limit = 4,
  opts?: { fetchFn?: typeof fetch },
): Promise<AnalysisChunk[]> {
  const chunks = analysisChunksInScope(catalog);
  if (!chunks.length) return [];
  if (askEmbeddingsEnabled()) {
    const qVec = await embedText(question, { fetchFn: opts?.fetchFn });
    const docVecs = qVec ? await embedTexts(chunks.map((c) => c.text), { fetchFn: opts?.fetchFn }) : null;
    if (qVec && docVecs) {
      return chunks
        .map((chunk, i) => ({ chunk, score: cosineSimilarity(qVec, docVecs[i]!) }))
        .filter((row) => row.score >= 0.25)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((row) => row.chunk);
    }
  }
  const terms = question.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  return chunks
    .map((chunk) => {
      const hay = chunk.text.toLowerCase();
      const score = terms.reduce((n, term) => n + (hay.includes(term) ? 1 : 0), 0);
      return { chunk, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => row.chunk);
}

/**
 * Boost lexical retrieval with OpenAI embedding similarity when possible.
 */
export async function retrieveAskEvidenceEmbedded(
  catalog: AskLookupCatalog,
  question: string,
  opts?: { limit?: number; fetchFn?: typeof fetch; useDate?: boolean },
): Promise<EvidenceRetrieval> {
  const base = retrieveAskEvidence(catalog, question, {
    limit: Math.max(opts?.limit ?? ASK_RETRIEVAL_TOP_K, 8),
    useDate: opts?.useDate,
  });
  if (!askEmbeddingsEnabled()) return base;
  const pool = [
    ...chunkClipTranscript(clipsInScope(catalog)[0] ?? ({ proofId: '', jobId: '', orgId: '', title: '' } as AskLookupClip)),
  ];
  void pool;
  const allChunks = clipsInScope(catalog).flatMap((clip) => chunkClipTranscript(clip));
  if (!allChunks.length) return base;
  const qVec = await embedText(question, { fetchFn: opts?.fetchFn });
  if (!qVec) return base;
  // Cap embed batch for cost: prefer chunks that lexical already likes, else first N.
  const preferKeys = new Set(base.merged.map((h) => h.key));
  const ordered = [
    ...allChunks.filter((c) => preferKeys.has(c.key)),
    ...allChunks.filter((c) => !preferKeys.has(c.key)),
  ].slice(0, 48);
  const vectors = await embedTexts(
    ordered.map((c) => c.text),
    { fetchFn: opts?.fetchFn },
  );
  if (!vectors) return base;
  const scored = ordered
    .map((chunk, i) => ({
      chunk,
      score: cosineSimilarity(qVec, vectors[i]!),
    }))
    .filter((row) => row.score >= 0.28)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts?.limit ?? ASK_RETRIEVAL_TOP_K);

  const byKey = new Map(base.merged.map((h) => [h.key, h]));
  for (const row of scored) {
    const existing = byKey.get(row.chunk.key);
    if (existing) {
      existing.score = Math.max(existing.score, 5 + row.score);
      existing.semantic = Math.max(existing.semantic, row.score);
      continue;
    }
    byKey.set(row.chunk.key, {
      kind: 'transcript',
      key: row.chunk.key,
      proofId: row.chunk.proofId,
      jobId: row.chunk.jobId,
      clipTitle: row.chunk.clipTitle,
      workDate: row.chunk.workDate,
      startSec: row.chunk.startSec,
      endSec: row.chunk.endSec,
      text: row.chunk.text,
      speaker: row.chunk.speaker,
      cite: row.chunk.cite,
      score: 5 + row.score,
      lexical: 0,
      semantic: row.score,
      pinned: false,
      matched: [],
      reason: 'semantic',
    });
  }
  const merged = [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, opts?.limit ?? ASK_RETRIEVAL_TOP_K);
  const transcript = merged.filter((h) => h.kind === 'transcript');
  const summaries = merged.filter((h) => h.kind === 'summary');
  return { ...base, transcript, summaries, merged };
}

export type RetrievalContextParts = {
  summary: string;
  evidence: string;
  analysis: string;
  stuffed: string;
  stable: string;
  searched: {
    phrases: string[];
    terms: string[];
    clipCount: number;
    hitCount: number;
    noteCount?: number;
    documentCount?: number;
    transcriptChunkCount?: number;
  };
};

/**
 * Build the stable Ask prefix: summary + top-k evidence (+ optional stuffed file).
 */
export async function buildRetrievalAskContext(input: {
  catalog: AskLookupCatalog;
  question: string;
  jobFileRecord?: string | null;
  fetchFn?: typeof fetch;
}): Promise<RetrievalContextParts> {
  const cached = resolveAskJobSummary(input.catalog, input.jobFileRecord);
  const summary = cached.summary.startsWith('Job summary:') ? cached.summary : `Job summary:\n${cached.summary}`;
  const evidence = await retrieveAskEvidenceEmbedded(input.catalog, input.question, {
    limit: ASK_RETRIEVAL_TOP_K,
    fetchFn: input.fetchFn,
  });
  const analysis = await retrieveAnalysisChunks(input.catalog, input.question, 4, {
    fetchFn: input.fetchFn,
  });
  const evidenceBlock = evidence.merged.length
    ? `Retrieved evidence (top ${evidence.merged.length}):\n${evidence.merged.map(formatHit).join('\n')}`
    : 'Retrieved evidence: none matched this question.';
  const analysisBlock = analysis.length
    ? `Video analysis hits:\n${analysis.map(formatAnalysis).join('\n')}`
    : '';
  const stuffed = askStuffJobContextEnabled()
    ? `Full job file (stuffed fallback):\n${formatAskJobContext(input.catalog)}${
        input.jobFileRecord?.trim() ? `\n\n${input.jobFileRecord.trim().slice(0, ASK_CONTEXT_BUDGET)}` : ''
      }`
    : '';
  // Keep the historical "Job context:" marker so prompt-cache tests and ops greps still match.
  const body = [summary, evidenceBlock, analysisBlock, stuffed].filter(Boolean).join('\n\n');
  const stable = body ? `Job context:\n${body}` : '';
  return {
    summary,
    evidence: evidenceBlock,
    analysis: analysisBlock,
    stuffed,
    stable,
    searched: {
      phrases: evidence.phrases,
      terms: evidence.terms,
      clipCount: evidence.allClipCount,
      hitCount: evidence.merged.length,
    },
  };
}

export function retrievalFingerprint(catalog: AskLookupCatalog): string {
  const parts = clipsInScope(catalog).map(
    (clip) =>
      `${clip.proofId}:${(clip.transcript ?? '').length}:${(redactedClipSummary(clip) ?? '').length}`,
  );
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

const lastSearchByJob = new Map<string, RetrievalContextParts['searched']>();

export function rememberAskSearchMeta(jobId: string | null | undefined, searched: RetrievalContextParts['searched']): void {
  if (!jobId) return;
  lastSearchByJob.set(jobId, searched);
}

export function takeAskSearchMeta(jobId: string | null | undefined): RetrievalContextParts['searched'] | null {
  if (!jobId) return null;
  return lastSearchByJob.get(jobId) ?? null;
}
