import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analysisRowsFromProof,
  embedTranscriptChunksForProof,
  writeAskAnalysisChunksForProof,
} from '../src/shared/askChunkEmbeddings.js';
import { ASK_EMBEDDING_DIMS } from '../src/shared/askEmbeddings.js';

test('analysisRowsFromProof cuts summary and findings', () => {
  const rows = analysisRowsFromProof({
    id: 'p1',
    org_id: 'o1',
    job_id: 'j1',
    ai_summary: 'Crew dried the basement and staged equipment.',
    ai_findings: { concerns: ['wet drywall'] },
    narration_text: 'Crew dried the basement and staged equipment.',
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.kind, 'summary');
  assert.equal(rows[1]?.kind, 'findings');
  assert.ok(rows[0]?.source_sha256);
});

test('embedTranscriptChunksForProof updates rows missing embeddings', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevAsk = process.env.ASK_EMBEDDINGS;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ASK_EMBEDDINGS = '1';
  const updates: Array<{ id: string; embedding: number[] }> = [];
  const admin = {
    from(table: string) {
      assert.equal(table, 'ask_transcript_chunks');
      return {
        select() {
          return this;
        },
        eq() {
          return Promise.resolve({
            data: [
              { id: 'c1', text: 'hello cabinets', embedding: null },
              { id: 'c2', text: 'already', embedding: [0.1] },
            ],
            error: null,
          });
        },
        update(patch: { embedding: number[] }) {
          return {
            eq(col: string, id: string) {
              assert.equal(col, 'id');
              updates.push({ id, embedding: patch.embedding });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  const fakeVec = Array.from({ length: ASK_EMBEDDING_DIMS }, (_, i) => i * 0.001);
  const fetchFn = async () =>
    new Response(JSON.stringify({ data: [{ embedding: fakeVec, index: 0 }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  try {
    const n = await embedTranscriptChunksForProof(admin, 'proof-1', { fetchFn: fetchFn as typeof fetch });
    assert.equal(n, 1);
    assert.equal(updates.length, 1);
    assert.equal(updates[0]?.id, 'c1');
    assert.equal(updates[0]?.embedding.length, ASK_EMBEDDING_DIMS);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
    if (prevAsk === undefined) delete process.env.ASK_EMBEDDINGS;
    else process.env.ASK_EMBEDDINGS = prevAsk;
  }
});

test('writeAskAnalysisChunksForProof upserts embedded analysis rows', async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ASK_EMBEDDINGS = '1';
  let upserted: unknown = null;
  const admin = {
    from(table: string) {
      if (table === 'job_proofs') {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: 'p1',
                org_id: 'o1',
                job_id: 'j1',
                ai_summary: 'Crew tore off the old shingles today.',
                ai_findings: { ok: true },
                narration_text: null,
              },
              error: null,
            });
          },
        };
      }
      if (table === 'ask_analysis_chunks') {
        return {
          upsert(payload: unknown) {
            upserted = payload;
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected ${table}`);
    },
  };
  const fakeVec = Array.from({ length: ASK_EMBEDDING_DIMS }, () => 0.01);
  const fetchFn = async () =>
    new Response(
      JSON.stringify({
        data: [
          { embedding: fakeVec, index: 0 },
          { embedding: fakeVec, index: 1 },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  try {
    const n = await writeAskAnalysisChunksForProof(admin, 'p1', { fetchFn: fetchFn as typeof fetch });
    assert.equal(n, 2);
    assert.ok(Array.isArray(upserted));
    assert.equal((upserted as any[])[0].embedding_model, 'text-embedding-3-small');
    assert.ok((upserted as any[])[0].embedding);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});
