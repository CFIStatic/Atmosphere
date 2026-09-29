/**
 * Build the Ask transcript chunk index (ask_transcript_chunks) for clips
 * whose chunks are missing or stale. Dry run by default: counts clips and
 * chunks and changes nothing. No model or embedding calls.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRANSCRIPT_CHUNK_TABLE, transcriptChunkRows, transcriptSha256, writeTranscriptChunks } from '../shared/askTranscriptChunkStore.js';

export type ChunkBackfillRow = { id: string; chunks: number; reason: 'missing' | 'stale' | 'fresh' };

export async function backfillTranscriptChunks(
  admin: any,
  opts: { apply: boolean; orgId?: string | null; jobId?: string | null; pageSize?: number; onRow?: (row: ChunkBackfillRow) => void },
): Promise<{ scanned: number; toWrite: number; chunks: number; written: number; failed: number }> {
  const pageSize = opts.pageSize ?? 50;
  let scanned = 0;
  let toWrite = 0;
  let chunks = 0;
  let written = 0;
  let failed = 0;
  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from('job_proofs')
      .select('id, org_id, job_id, title, transcript_text, transcript_segments, transcript_words')
      .is('deleted_at', null)
      .or('transcript_text.not.is.null,transcript_segments.not.is.null,transcript_words.not.is.null')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (opts.orgId) query = query.eq('org_id', opts.orgId);
    if (opts.jobId) query = query.eq('job_id', opts.jobId);
    const { data, error } = await query;
    if (error) throw new Error(`job_proofs read failed: ${error.message ?? error}`);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (!rows.length) break;
    for (const row of rows) {
      scanned += 1;
      const id = String(row.id);
      const built = transcriptChunkRows(row);
      const sha = transcriptSha256(row);
      const { data: existing } = await admin
        .from(TRANSCRIPT_CHUNK_TABLE)
        .select('transcript_sha256')
        .eq('proof_id', id)
        .limit(1);
      const stored = Array.isArray(existing) && existing[0] ? String(existing[0].transcript_sha256 ?? '') : null;
      const reason: ChunkBackfillRow['reason'] = stored == null ? 'missing' : stored === sha ? 'fresh' : 'stale';
      if (reason === 'fresh' || (reason === 'missing' && !built.length)) continue;
      toWrite += 1;
      chunks += built.length;
      opts.onRow?.({ id, chunks: built.length, reason });
      if (!opts.apply) continue;
      const n = await writeTranscriptChunks(admin, id);
      if (n == null) failed += 1;
      else written += 1;
    }
    if (rows.length < pageSize) break;
  }
  return { scanned, toWrite, chunks, written, failed };
}
