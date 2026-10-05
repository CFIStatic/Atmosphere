import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cosineSimilarity,
  embedTexts,
  resetAskEmbeddingCacheForTests,
} from '../src/shared/askEmbeddings.js';
import {
  askStuffJobContextEnabled,
  buildRetrievalAskContext,
  chunkClipAnalysis,
} from '../src/shared/askRetrievalContext.js';
import type { AskLookupCatalog, AskLookupClip } from '../src/shared/askLookup.js';

test('cosine similarity is 1 for identical vectors', () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.ok(cosineSimilarity([1, 0], [0, 1]) < 0.01);
});

test('embedTexts returns null without a key', async () => {
  resetAskEmbeddingCacheForTests();
  const prev = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  process.env.ASK_EMBEDDINGS = '1';
  try {
    assert.equal(await embedTexts(['hello']), null);
  } finally {
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
  }
});

test('analysis chunks come from clip summaries', () => {
  const clip: AskLookupClip = {
    proofId: 'p1',
    jobId: 'j1',
    orgId: 'o1',
    title: 'Kitchen',
    summary: 'Handheld walkthrough of a kitchen with water stains on the ceiling.',
  };
  const chunks = chunkClipAnalysis(clip);
  assert.ok(chunks.some((c) => c.kind === 'summary' && /kitchen/i.test(c.text)));
});

test('retrieval context includes summary and respects stuff flag', async () => {
  const catalog: AskLookupCatalog = {
    orgId: 'o1',
    jobId: 'j1',
    access: 'org',
    jobTitle: 'Sample',
    clips: [
      {
        proofId: 'p1',
        jobId: 'j1',
        orgId: 'o1',
        title: 'Office',
        workDate: '2026-09-21',
        summary: 'Office clip about LedgerPro.',
        transcript: 'Speaker 1: We just have to switch to LedgerPro cloud.',
        segments: [{ start: 14.6, end: 16, text: 'We just have to switch to LedgerPro cloud.' }],
      },
    ],
    people: [],
    history: [],
  };
  process.env.ASK_STUFF_JOB_CONTEXT = '0';
  process.env.ASK_EMBEDDINGS = '0';
  try {
    assert.equal(askStuffJobContextEnabled(), false);
    const parts = await buildRetrievalAskContext({
      catalog,
      question: 'What was said about LedgerPro?',
    });
    assert.match(parts.summary, /Sample/);
    assert.match(parts.stable, /Retrieved evidence|Job summary/);
    assert.doesNotMatch(parts.stable, /Full job file \(stuffed fallback\)/);
  } finally {
    delete process.env.ASK_STUFF_JOB_CONTEXT;
    delete process.env.ASK_EMBEDDINGS;
  }
});
