import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJobProofPayload } from '../src/routes/proofOfWork.js';

const FUTURE = new Date(Date.now() + 60_000).toISOString();

function jobFileAdmin(proofs: Array<Record<string, unknown>>) {
  const tables: Record<string, unknown> = {
    job_proofs: proofs,
    job_parties: [
      { id: 'party-1', company: 'Delgado Roofing', trade: 'roofing', contact_name: 'Ana' },
    ],
    job_scope_items: [],
    crm_jobs: { id: 'job-1', title: 'Roof', job_number: 12, property_id: null },
    job_tasks: [],
  };
  return {
    from(table: string) {
      const result = { data: tables[table] ?? null, error: null as null };
      const builder: {
        select: () => typeof builder;
        eq: () => typeof builder;
        is: () => typeof builder;
        order: () => typeof builder;
        limit: () => typeof builder;
        range: () => Promise<typeof result>;
        maybeSingle: () => Promise<typeof result>;
        then: (
          resolve: (value: typeof result) => void,
          reject: (error: unknown) => void,
        ) => Promise<unknown>;
      } = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        range: async () => result,
        maybeSingle: async () => result,
        then(resolve, reject) {
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

test('job videos carry summaryState when there is no conversation to hang it on', async () => {
  const silent = {
    id: 'proof-silent',
    party_id: 'party-1',
    work_date: '2026-09-21',
    phase: 'before',
    state: 'analysed',
    checks: [],
    duration_seconds: 12,
    analysis_status: 'done',
    narration_status: 'done',
    transcript_status: 'skipped',
    transcript_error: 'No usable audio track on this clip.',
    transcript_text: null,
    summary_status: 'running',
    summary_lease_until: FUTURE,
    ai_summary: null,
    ai_findings: {},
  };
  const failed = {
    ...silent,
    id: 'proof-failed',
    summary_status: 'failed',
    summary_lease_until: null,
  };
  const payload = await buildJobProofPayload(jobFileAdmin([silent, failed]), 'org-1', 'job-1');
  const byId = new Map(payload.videos.map((video) => [video.id, video]));

  const updating = byId.get('proof-silent');
  assert.equal(updating?.conversation, null);
  assert.equal(updating?.summaryState, 'updating');
  assert.equal(updating?.summaryActive, true);
  assert.equal(updating?.hasSummary, false);

  const unavailable = byId.get('proof-failed');
  assert.equal(unavailable?.conversation, null);
  assert.equal(unavailable?.summaryState, 'failed');
  assert.equal(unavailable?.summaryActive, false);
});
