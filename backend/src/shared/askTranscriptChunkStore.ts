/**
 * Persisted transcript chunk index (public.ask_transcript_chunks).
 *
 * Rows are cut from the raw job_proofs transcript, one per timed segment, and
 * rebuilt whenever the transcript is rewritten. Ask uses the table to find
 * which clips mention a phrase (including clips past the rows one Ask loads);
 * the text it quotes is always re-read from job_proofs and redacted then.
 *
 * Every function here is failure-tolerant: a missing table (migration not yet
 * applied) or a failed write never breaks a transcript save or an Ask.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto';
import { askTimed, type AskLookupClip } from './askLookup.js';
import { chunkClipTranscript, searchPhrases } from './askTranscriptIndex.js';
import { embedTranscriptChunksForProof } from './askChunkEmbeddings.js';

export const TRANSCRIPT_CHUNK_TABLE = 'ask_transcript_chunks';

export type TranscriptChunkRow = {
  org_id: string;
  job_id: string;
  proof_id: string;
  seq: number;
  start_sec: number | null;
  end_sec: number | null;
  text: string;
  speaker_label: string | null;
  transcript_sha256: string;
};

type ProofTranscriptRow = {
  id?: unknown;
  org_id?: unknown;
  job_id?: unknown;
  title?: unknown;
  transcript_text?: unknown;
  transcript_segments?: unknown;
  transcript_words?: unknown;
};

export function transcriptSha256(row: ProofTranscriptRow): string {
  const body = JSON.stringify([
    row.transcript_text ?? null,
    row.transcript_segments ?? null,
    row.transcript_words ?? null,
  ]);
  return createHash('sha256').update(body).digest('hex');
}

/** Raw (unredacted) chunks for one proof row, the same cut Ask ranks over. */
export function transcriptChunkRows(row: ProofTranscriptRow): TranscriptChunkRow[] {
  const proofId = String(row.id ?? '');
  const orgId = String(row.org_id ?? '');
  const jobId = String(row.job_id ?? '');
  if (!proofId || !orgId || !jobId) return [];
  const clip: AskLookupClip = {
    proofId,
    orgId,
    jobId,
    title: String(row.title ?? 'Clip'),
    transcript: row.transcript_text == null ? null : String(row.transcript_text),
    segments: askTimed(row.transcript_segments),
    words: askTimed(row.transcript_words),
  };
  const sha = transcriptSha256(row);
  return chunkClipTranscript(clip).map((chunk) => ({
    org_id: orgId,
    job_id: jobId,
    proof_id: proofId,
    seq: chunk.seq,
    start_sec: chunk.startSec,
    end_sec: chunk.endSec,
    text: chunk.text.slice(0, 4000),
    speaker_label: chunk.speaker,
    transcript_sha256: sha,
  }));
}

let warned = false;
function warnOnce(message: string): void {
  if (warned) return;
  warned = true;
  console.warn(`[ask-chunks] ${message}`);
}

/** Rebuild one clip's chunks. Returns the number written, or null when the index is unavailable. */
export async function writeTranscriptChunks(admin: any, proofId: string): Promise<number | null> {
  try {
    const { data, error } = await admin
      .from('job_proofs')
      .select('id, org_id, job_id, title, transcript_text, transcript_segments, transcript_words')
      .eq('id', proofId)
      .maybeSingle();
    if (error || !data) return null;
    const rows = transcriptChunkRows(data as ProofTranscriptRow);
    // Upsert first, then trim rows past the new end, so a failed write never
    // leaves the clip with no index rows.
    for (let i = 0; i < rows.length; i += 500) {
      const up = await admin
        .from(TRANSCRIPT_CHUNK_TABLE)
        .upsert(rows.slice(i, i + 500), { onConflict: 'proof_id,seq' });
      if (up?.error) {
        warnOnce(`chunk write failed: ${up.error.message ?? up.error}`);
        return null;
      }
    }
    const trim = await admin.from(TRANSCRIPT_CHUNK_TABLE).delete().eq('proof_id', proofId).gte('seq', rows.length);
    if (trim?.error) {
      warnOnce(`chunk trim failed: ${trim.error.message ?? trim.error}`);
      return null;
    }
    // Best-effort: keep HNSW columns warm for new segments. Never fail the write.
    void embedTranscriptChunksForProof(admin, proofId).catch(() => undefined);
    return rows.length;
  } catch (err) {
    warnOnce(`chunk write failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** websearch_to_tsquery text: quoted phrases OR'd, e.g. `"ledgerpro cloud" or ledgerpro`. */
export function chunkSearchQuery(question: string): string {
  const { phrases } = searchPhrases(question);
  const parts = phrases
    .slice(0, 6)
    .map((phrase) => phrase.toLowerCase().replace(/["']/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map((phrase) => (phrase.includes(' ') ? `"${phrase}"` : phrase));
  return [...new Set(parts)].join(' or ');
}

/**
 * Clips on this job whose transcript chunks match the question's phrases,
 * excluding clips already loaded. Empty when the index is unavailable.
 */
export async function proofIdsMatchingQuestion(
  db: any,
  input: { orgId: string; jobId: string; question: string; exclude?: Iterable<string>; limit?: number },
): Promise<string[]> {
  const query = chunkSearchQuery(input.question);
  if (!query) return [];
  try {
    const { data, error } = await db
      .from(TRANSCRIPT_CHUNK_TABLE)
      .select('proof_id')
      .eq('org_id', input.orgId)
      .eq('job_id', input.jobId)
      .textSearch('fts', query, { type: 'websearch', config: 'simple' })
      .limit(200);
    if (error || !Array.isArray(data)) return [];
    const skip = new Set(input.exclude ?? []);
    const ids: string[] = [];
    for (const row of data as Array<{ proof_id?: unknown }>) {
      const id = String(row.proof_id ?? '');
      if (!id || skip.has(id) || ids.includes(id)) continue;
      ids.push(id);
      if (ids.length >= (input.limit ?? 20)) break;
    }
    return ids;
  } catch {
    return [];
  }
}
