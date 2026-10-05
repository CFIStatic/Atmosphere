/**
 * Persist OpenAI embeddings onto Ask chunk tables when new transcript /
 * analysis text lands. Best-effort: missing keys or API failures never break
 * transcript saves or analysis completion. The backfill script covers rows
 * that were written before this path existed.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import {
  ASK_EMBEDDING_DIMS,
  ASK_EMBEDDING_MODEL,
  askEmbeddingsEnabled,
  embedTexts,
  openaiEmbeddingsApiKey,
} from './askEmbeddings.js';
import { TRANSCRIPT_CHUNK_TABLE } from './askTranscriptChunkStore.js';

export const ANALYSIS_CHUNK_TABLE = 'ask_analysis_chunks';

export type AnalysisChunkKind = 'summary' | 'findings' | 'dictation' | 'action';

export type AnalysisChunkInsert = {
  org_id: string;
  job_id: string;
  proof_id: string;
  seq: number;
  kind: AnalysisChunkKind;
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  source_sha256: string;
};

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Build analysis index rows from a job_proofs row (same cut as the backfill). */
export function analysisRowsFromProof(row: Record<string, unknown>): AnalysisChunkInsert[] {
  const orgId = String(row.org_id ?? '');
  const jobId = String(row.job_id ?? '');
  const proofId = String(row.id ?? '');
  if (!orgId || !jobId || !proofId) return [];
  const out: AnalysisChunkInsert[] = [];
  const push = (kind: AnalysisChunkKind, text: string, start: number | null = null) => {
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

function canEmbed(): boolean {
  return Boolean(openaiEmbeddingsApiKey()) && askEmbeddingsEnabled();
}

/**
 * Embed transcript chunk rows for one proof that still lack vectors.
 * Returns how many rows were updated (0 when skipped / nothing to do).
 */
export async function embedTranscriptChunksForProof(
  admin: any,
  proofId: string,
  opts?: { fetchFn?: typeof fetch },
): Promise<number> {
  if (!canEmbed() || !proofId) return 0;
  try {
    const { data, error } = await admin
      .from(TRANSCRIPT_CHUNK_TABLE)
      .select('id, text, embedding')
      .eq('proof_id', proofId);
    if (error || !Array.isArray(data)) return 0;
    const missing = (data as Array<{ id: string; text: string; embedding: unknown }>).filter(
      (r) => r.embedding == null && String(r.text ?? '').trim(),
    );
    if (!missing.length) return 0;
    const vectors = await embedTexts(
      missing.map((r) => r.text),
      { fetchFn: opts?.fetchFn },
    );
    if (!vectors) return 0;
    let updated = 0;
    const now = new Date().toISOString();
    for (let i = 0; i < missing.length; i += 1) {
      const row = missing[i]!;
      const vec = vectors[i];
      if (!vec || vec.length !== ASK_EMBEDDING_DIMS) continue;
      const { error: upErr } = await admin
        .from(TRANSCRIPT_CHUNK_TABLE)
        .update({
          embedding: vec,
          embedding_model: ASK_EMBEDDING_MODEL,
          embedding_at: now,
        })
        .eq('id', row.id);
      if (!upErr) updated += 1;
    }
    return updated;
  } catch {
    return 0;
  }
}

/**
 * Upsert analysis chunks for one proof (with embeddings when the key is set).
 * Returns how many rows were upserted, or 0 on skip/failure.
 */
export async function writeAskAnalysisChunksForProof(
  admin: any,
  proofId: string,
  opts?: { fetchFn?: typeof fetch },
): Promise<number> {
  if (!proofId) return 0;
  try {
    const { data, error } = await admin
      .from('job_proofs')
      .select('id, org_id, job_id, ai_summary, ai_findings, narration_text')
      .eq('id', proofId)
      .maybeSingle();
    if (error || !data) return 0;
    const built = analysisRowsFromProof(data as Record<string, unknown>);
    if (!built.length) return 0;

    let payload: Array<AnalysisChunkInsert & {
      embedding?: number[];
      embedding_model?: string;
      embedding_at?: string;
    }> = built;

    if (canEmbed()) {
      const vectors = await embedTexts(
        built.map((r) => r.text),
        { fetchFn: opts?.fetchFn },
      );
      if (vectors) {
        const now = new Date().toISOString();
        payload = built.map((row, i) => {
          const vec = vectors[i];
          if (!vec || vec.length !== ASK_EMBEDDING_DIMS) return row;
          return {
            ...row,
            embedding: vec,
            embedding_model: ASK_EMBEDDING_MODEL,
            embedding_at: now,
          };
        });
      }
    }

    const { error: upErr } = await admin.from(ANALYSIS_CHUNK_TABLE).upsert(payload, {
      onConflict: 'proof_id,kind,seq',
    });
    if (upErr) return 0;
    return payload.length;
  } catch {
    return 0;
  }
}
