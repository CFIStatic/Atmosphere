import { describe, expect, it, vi } from 'vitest';
import {
  getAskCrmRecord,
  searchAskCrm,
  summarizeAskCrmRecord,
} from '../src/shared/askCrm.js';

function mockSupabase(handlers: Record<string, (req: any) => any>) {
  return {
    from(table: string) {
      const state: any = { table, filters: [] };
      const api: any = {
        select() { return api; },
        eq(col: string, val: unknown) { state.filters.push(['eq', col, val]); return api; },
        or() { return api; },
        limit() { return api; },
        maybeSingle: async () => handlers[`${table}:maybeSingle`]?.(state) ?? { data: null, error: null },
        then: undefined as any,
      };
      // await supabase.from().select()... without maybeSingle resolves as query
      api.then = (resolve: any, reject: any) =>
        Promise.resolve(handlers[`${table}:list`]?.(state) ?? { data: [], error: null }).then(resolve, reject);
      return api;
    },
  };
}

describe('askCrm', () => {
  it('soft-fails getAskCrmRecord when no external CRM is connected but returns Atmosphere fields', async () => {
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

    expect(record.title).toBe('Roof tear-off');
    expect(record.claimNumber).toBe('CLM-9');
    expect(record.address).toBe('12 Main St');
    expect(record.softFail).toMatch(/No external CRM connected/i);
    expect(summarizeAskCrmRecord(record)).toMatch(/CLM-9/);
    expect(summarizeAskCrmRecord(record)).toMatch(/Connect CRM/i);
  });

  it('searchAskCrm soft-fails to Atmosphere-native search', async () => {
    const supabase = mockSupabase({
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

    expect(result.softFail).toMatch(/No external CRM connected/i);
    expect(result.hits.some((h) => h.claimNumber === 'CLM-9')).toBe(true);
  });
});
