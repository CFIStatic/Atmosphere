import test from 'node:test';
import assert from 'node:assert/strict';
import { executeAskTool, askModelActionTools } from '../src/shared/askTools.js';

const ORG = '0a000000-0000-4000-8000-000000000001';
const JOB = 'd7fe1a01-4483-42c5-abb8-eaaa4c6988df';

/** Records every filter call; resolves with the rows for its table. */
function fakeSupabase(rows: Record<string, unknown[]>, calls: string[]) {
  return {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'not', 'in', 'or', 'order', 'limit']) {
        builder[method] = (...args: unknown[]) => {
          calls.push(`${table}.${method}(${args.map((a) => JSON.stringify(a)).join(',')})`);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null });
      return builder;
    },
  };
}

test('list_company_jobs: open jobs with video counts, office only', async () => {
  assert.ok(askModelActionTools('org').some((t) => t.name === 'list_company_jobs'));
  assert.ok(!askModelActionTools('viewer').some((t) => t.name === 'list_company_jobs'));
  const calls: string[] = [];
  const supabase = fakeSupabase(
    {
      crm_jobs: [
        { id: JOB, title: 'Henderson basement', status: 'in_progress' },
        { id: 'j2', title: 'Lopez kitchen', status: 'scheduled' },
      ],
      job_proofs: [
        { job_id: JOB, work_date: '2026-10-08' },
        { job_id: JOB, work_date: '2026-10-10' },
      ],
    },
    calls,
  );
  const result = await executeAskTool('list_company_jobs', { query: 'base,ment)' }, {
    orgId: ORG,
    jobId: JOB,
    supabase,
    access: 'org',
    file: {} as never,
  });
  assert.equal(result.ok, true);
  assert.match(result.summary, /2 open job/);
  const jobs = (result.data as { jobs: Array<Record<string, unknown>> }).jobs;
  assert.equal(jobs[0]!.videoCount, 2);
  assert.equal(jobs[0]!.lastVideoDate, '2026-10-10');
  assert.equal(jobs[0]!.openHere, true);
  assert.equal(jobs[1]!.videoCount, 0);
  assert.ok(calls.some((c) => c.startsWith('crm_jobs.not("status","in"')));
  // Filter syntax characters never reach the or() filter.
  assert.ok(calls.includes('crm_jobs.or("title.ilike.%base ment%,claim_number.ilike.%base ment%")'));
  const viewer = await executeAskTool('list_company_jobs', {}, { orgId: ORG, jobId: JOB, supabase, access: 'viewer', file: {} as never });
  assert.equal(viewer.ok, false);
});
