/**
 * Backfill OpenAI embeddings onto ask_transcript_chunks and ask_analysis_chunks.
 * Dry-run by default (counts only). Never called from request handlers — run via
 * scripts/backfillAskEmbeddings.ts with --apply after sign-off.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import {
  ASK_EMBEDDING_DIMS,
  ASK_EMBEDDING_MODEL,
  askEmbeddingsEnabled,
  embedTexts,
  openaiEmbeddingsApiKey,
} from '../shared/askEmbeddings.js';
import { TRANSCRIPT_CHUNK_TABLE } from '../shared/askTranscriptChunkStore.js';

export const ANALYSIS_CHUNK_TABLE = 'ask_analysis_chunks';

export type EmbedBackfillStats = {
  transcriptScanned: number;
  transcriptMissing: number;
  transcriptUpdated: number;
  transcriptFailed: number;
  analysisScanned: number;
  analysisUpserted: number;
  analysisFailed: number;
  skippedNoKey: boolean;
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function analysisRowsFromProof(row: Record<string, unknown>): Array<{
  org_id: string;
  job_id: string;
  proof_id: string;
  seq: number;
  kind: 'summary' | 'findings' | 'dictation' | 'action';
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  source_sha256: string;
}> {
  const orgId = String(row.org_id ?? '');
  const jobId = String(row.job_id ?? '');
  const proofId = String(row.id ?? '');
  if (!orgId || !jobId || !proofId) return [];
  const out: Array<{
    org_id: string;
    job_id: string;
    proof_id: string;
    seq: number;
    kind: 'summary' | 'findings' | 'dictation' | 'action';
    start_sec: number | null;
    end_sec: number | null;
    text: string;
    source_sha256: string;
  }> = [];
  const push = (kind: 'summary' | 'findings' | 'dictation' | 'action', text: string, start: number | null = null) => {
    const body = text.replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (body.length < 8) return;
    out.push({
      org_id: orgId,
      job_id: jobId,
      proof_id: proofId,
      seq: out.filter((r) => r.kind === kind).length,
      kind,
      start_sec: start,
      end_sec: null,
      text: body,
      source_sha256: sha(`${kind}:${body}`),
    });
  };
  const summary = String(row.ai_summary ?? row.narration_text ?? '').trim();
  if (summary) push('summary', summary);
  const findings = row.ai_findings;
  if (findings != null) {
    const raw = typeof findings === 'string' ? findings : JSON.stringify(findings);
    push('findings', raw);
  }
  const narration = String(row.narration_text ?? '').trim();
  if (narration && narration !== summary) push('dictation', narration);
  return out;
}

/**
 * Embed rows missing embeddings. `apply:false` only counts. Does not call OpenAI
 * when the key is missing (skippedNoKey=true).
 */
export async function backfillAskEmbeddings(
  admin: any,
  opts: {
    apply: boolean;
    orgId?: string | null;
    jobId?: string | null;
    pageSize?: number;
    batchSize?: number;
    fetchFn?: typeof fetch;
    onProgress?: (line: string) => void;
  },
): Promise<EmbedBackfillStats> {
  const stats: EmbedBackfillStats = {
    transcriptScanned: 0,
    transcriptMissing: 0,
    transcriptUpdated: 0,
    transcriptFailed: 0,
    analysisScanned: 0,
    analysisUpserted: 0,
    analysisFailed: 0,
    skippedNoKey: false,
  };
  if (!openaiEmbeddingsApiKey() || !askEmbeddingsEnabled()) {
    stats.skippedNoKey = true;
    opts.onProgress?.('OPENAI_API_KEY missing or ASK_EMBEDDINGS=0 — nothing to do');
    return stats;
  }

  const pageSize = opts.pageSize ?? 40;
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 16, 32));

  // ---- Transcript chunks already in the index ----
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from(TRANSCRIPT_CHUNK_TABLE)
      .select('id, text, embedding')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (opts.orgId) query = query.eq('org_id', opts.orgId);
    if (opts.jobId) query = query.eq('job_id', opts.jobId);
    const { data, error } = await query;
    if (error) throw new Error(`ask_transcript_chunks read failed: ${error.message ?? error}`);
    const rows = (data ?? []) as Array<{ id: string; text: string; embedding: unknown }>;
    if (!rows.length) break;
    const missing = rows.filter((r) => r.embedding == null && String(r.text ?? '').trim());
    stats.transcriptScanned += rows.length;
    stats.transcriptMissing += missing.length;
    if (!opts.apply || !missing.length) {
      if (rows.length < pageSize) break;
      continue;
    }
    for (let i = 0; i < missing.length; i += batchSize) {
      const slice = missing.slice(i, i + batchSize);
      const vectors = await embedTexts(
        slice.map((r) => r.text),
        { fetchFn: opts.fetchFn },
      );
      if (!vectors) {
        stats.transcriptFailed += slice.length;
        opts.onProgress?.(`embed failed for transcript batch @${slice[0]?.id}`);
        continue;
      }
      for (let j = 0; j < slice.length; j += 1) {
        const row = slice[j]!;
        const vec = vectors[j];
        if (!vec || vec.length !== ASK_EMBEDDING_DIMS) {
          stats.transcriptFailed += 1;
          continue;
        }
        const { error: upErr } = await admin
          .from(TRANSCRIPT_CHUNK_TABLE)
          .update({
            embedding: vec,
            embedding_model: ASK_EMBEDDING_MODEL,
            embedding_at: new Date().toISOString(),
          })
          .eq('id', row.id);
        if (upErr) {
          stats.transcriptFailed += 1;
          opts.onProgress?.(`update failed ${row.id}: ${upErr.message ?? upErr}`);
        } else {
          stats.transcriptUpdated += 1;
        }
      }
    }
    if (rows.length < pageSize) break;
  }

  // ---- Analysis chunks from job_proofs ----
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from('job_proofs')
      .select('id, org_id, job_id, ai_summary, ai_findings, narration_text')
      .is('deleted_at', null)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (opts.orgId) query = query.eq('org_id', opts.orgId);
    if (opts.jobId) query = query.eq('job_id', opts.jobId);
    const { data, error } = await query;
    if (error) throw new Error(`job_proofs read failed: ${error.message ?? error}`);
    const proofs = (data ?? []) as Array<Record<string, unknown>>;
    if (!proofs.length) break;
    for (const proof of proofs) {
      const built = analysisRowsFromProof(proof);
      if (!built.length) continue;
      stats.analysisScanned += built.length;
      if (!opts.apply) continue;
      const vectors = await embedTexts(
        built.map((r) => r.text),
        { fetchFn: opts.fetchFn },
      );
      if (!vectors) {
        stats.analysisFailed += built.length;
        continue;
      }
      const payload = built.map((row, i) => ({
        ...row,
        embedding: vectors[i],
        embedding_model: ASK_EMBEDDING_MODEL,
        embedding_at: new Date().toISOString(),
      }));
      const { error: upErr } = await admin.from(ANALYSIS_CHUNK_TABLE).upsert(payload, {
        onConflict: 'proof_id,kind,seq',
      });
      if (upErr) {
        stats.analysisFailed += built.length;
        opts.onProgress?.(`analysis upsert failed ${proof.id}: ${upErr.message ?? upErr}`);
      } else {
        stats.analysisUpserted += built.length;
      }
    }
    if (proofs.length < pageSize) break;
  }

  return stats;
}
