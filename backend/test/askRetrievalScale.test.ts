import test from 'node:test';
import assert from 'node:assert/strict';
import { askStuffJobContextEnabled, buildRetrievalAskContext } from '../src/shared/askRetrievalContext.js';
import type { AskLookupCatalog } from '../src/shared/askLookup.js';

function catalog(): AskLookupCatalog {
  return {
    orgId: '00000000-0000-4000-8000-000000000001',
    jobId: '00000000-0000-4000-8000-000000000002',
    access: 'org',
    timeZone: 'America/Chicago',
    jobTitle: 'Cedar Ridge roof',
    clips: [
      {
        proofId: '00000000-0000-4000-8000-000000000003',
        jobId: '00000000-0000-4000-8000-000000000002',
        orgId: '00000000-0000-4000-8000-000000000001',
        title: 'South Slope',
        workDate: '2026-09-12',
        transcript: 'Speaker 1: We still need the ridge cap delivered Friday. '.repeat(80),
        summary: 'Crew removing damaged shingles.',
      } as any,
    ],
  } as AskLookupCatalog;
}

test('item 6: stuffing default stays on despite equal retrieval-alone eval', () => {
  delete process.env.ASK_STUFF_JOB_CONTEXT;
  assert.equal(askStuffJobContextEnabled(), true);
});

test('item 6: with stuffing off, context uses summary + top chunks, not the stuffed full file', async () => {
  const prev = process.env.ASK_STUFF_JOB_CONTEXT;
  process.env.ASK_STUFF_JOB_CONTEXT = '0';
  try {
    assert.equal(askStuffJobContextEnabled(), false);
    const parts = await buildRetrievalAskContext({
      catalog: catalog(),
      question: 'Did anyone mention the ridge cap?',
      jobFileRecord: 'FULL_FILE_MARKER ' + 'x'.repeat(2000),
    });
    assert.ok(parts.summary.length > 0);
    assert.equal(parts.stuffed, '');
    assert.equal(parts.stable.includes('FULL_FILE_MARKER'), false);
    assert.equal(parts.stable.includes('Full job file (stuffed fallback)'), false);
    assert.match(parts.stable, /Job context:|Job summary:|Retrieved evidence/i);
  } finally {
    if (prev === undefined) delete process.env.ASK_STUFF_JOB_CONTEXT;
    else process.env.ASK_STUFF_JOB_CONTEXT = prev;
  }
});
