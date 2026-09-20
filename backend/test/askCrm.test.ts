import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getAskCrmRecord,
  searchAskCrm,
  summarizeAskCrmRecord,
} from '../src/shared/askCrm.js';

type Handler = (state: { table: string }) => { data: unknown; error: unknown };

function mockSupabase(handlers: Record<string, Handler>) {
  return {
    from(table: string) {
      const state = { table };
      const api: any = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        or() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () =>
          handlers[`${table}:maybeSingle`]?.(state) ?? { data: null, error: null },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          return Promise.resolve(
            handlers[`${table}:list`]?.(state) ?? { data: [], error: null },
          ).then(resolve, reject);
        },
      };
      return api;
    },
  };
}

test('getAskCrmRecord soft-fails when no external CRM is connected but returns Atmosphere fields', async () => {
  const supabase = mockSupabase({
    'crm_jobs:maybeSingle': () => ({
      data: {
        id: 'job-1',
        title: 'Roof tear-off',
        status: 'in_progress',
        job_number: 42,
        claim_number: 'CLM-9',
        policy_number: 'POL-1',
        contact_id: null,
        property_id: null,
      },
      error: null,
    }),
    'crm_agent_credentials:list': () => ({ data: [], error: null }),
    'crm_external_sources:list': () => ({ data: [], error: null }),
    'crm_sync_connections:list': () => ({ data: null, error: { message: 'missing' } }),
    'crm_oauth_grants:list': () => ({ data: null, error: { message: 'missing' } }),
    'crm_job_links:list': () => ({ data: [], error: null }),
    'crm_external_records:list': () => ({ data: [], error: null }),
  });

  const record = await getAskCrmRecord({
    supabase,
    orgId: 'org-1',
    jobId: 'job-1',
    addressHint: '12 Main St',
  });

  assert.equal(record.title, 'Roof tear-off');
  assert.equal(record.claimNumber, 'CLM-9');
  assert.equal(record.address, '12 Main St');
  assert.match(String(record.softFail), /No external CRM connected/i);
  assert.match(summarizeAskCrmRecord(record), /CLM-9/);
  assert.match(summarizeAskCrmRecord(record), /Connect CRM/i);
});

test('searchAskCrm soft-fails to Atmosphere-native search', async () => {
  const supabase = mockSupabase({
    'crm_agent_credentials:list': () => ({ data: [], error: null }),
    'crm_external_sources:list': () => ({ data: [], error: null }),
    'crm_sync_connections:list': () => ({ data: null, error: { message: 'missing' } }),
    'crm_oauth_grants:list': () => ({ data: null, error: { message: 'missing' } }),
    'crm_jobs:list': () => ({
      data: [{ id: 'job-1', title: 'Oak Ave', claim_number: 'CLM-9', status: 'open', job_number: 1 }],
      error: null,
    }),
    'crm_contacts:list': () => ({ data: [], error: null }),
  });

  const result = await searchAskCrm({
    supabase,
    orgId: 'org-1',
    query: 'CLM-9',
  });

  assert.match(String(result.softFail), /No external CRM connected/i);
  assert.ok(result.hits.some((h) => h.claimNumber === 'CLM-9'));
});
