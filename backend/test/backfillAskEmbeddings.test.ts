import test from 'node:test';
import assert from 'node:assert/strict';
import { backfillAskEmbeddings } from '../src/lib/backfillAskEmbeddings.js';

test('backfillAskEmbeddings dry-run skips when no OpenAI key', async () => {
  const prev = process.env.OPENAI_API_KEY;
  const prevAsk = process.env.ASK_EMBEDDINGS;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ASK_EMBEDDING_API_KEY;
  process.env.ASK_EMBEDDINGS = '1';
  try {
    const admin = {
      from() {
        throw new Error('should not hit the database when key is missing');
      },
    };
    const stats = await backfillAskEmbeddings(admin, { apply: false });
    assert.equal(stats.skippedNoKey, true);
    assert.equal(stats.transcriptUpdated, 0);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
    if (prevAsk === undefined) delete process.env.ASK_EMBEDDINGS;
    else process.env.ASK_EMBEDDINGS = prevAsk;
  }
});

test('backfillAskEmbeddings dry-run counts transcript rows missing embeddings', async () => {
  const prev = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'sk-test';
  process.env.ASK_EMBEDDINGS = '1';
  try {
    let transcriptCalls = 0;
    const admin = {
      from(table: string) {
        const api: Record<string, unknown> = {};
        const chain = () => api;
        for (const m of ['select', 'order', 'range', 'eq', 'is', 'update']) {
          api[m] = () => chain();
        }
        api.then = undefined;
        if (table === 'ask_transcript_chunks') {
          transcriptCalls += 1;
          api.range = () => ({
            // thenable-ish resolved by await query in code — we return { data, error } via then?
          });
          // The real code awaits the query builder; supabase returns a PromiseLike.
          return {
            select() {
              return this;
            },
            order() {
              return this;
            },
            eq() {
              return this;
            },
            range(from: number) {
              if (from > 0) return Promise.resolve({ data: [], error: null });
              return Promise.resolve({
                data: [
                  { id: 'c1', text: 'hello cabinets', embedding: null },
                  { id: 'c2', text: 'already', embedding: [0.1] },
                ],
                error: null,
              });
            },
          };
        }
        if (table === 'job_proofs') {
          return {
            select() {
              return this;
            },
            is() {
              return this;
            },
            order() {
              return this;
            },
            eq() {
              return this;
            },
            range() {
              return Promise.resolve({ data: [], error: null });
            },
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    };
    const stats = await backfillAskEmbeddings(admin, { apply: false, pageSize: 40 });
    assert.equal(stats.skippedNoKey, false);
    assert.equal(stats.transcriptScanned, 2);
    assert.equal(stats.transcriptMissing, 1);
    assert.equal(stats.transcriptUpdated, 0);
    assert.ok(transcriptCalls >= 1);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});
