import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ProcessingOrchestrator } from './pipeline/orchestrator.js';

describe('ProcessingOrchestrator.reclaimPending', () => {
  it('re-enqueues pending and running jobs from Postgres', async () => {
    const ran: string[] = [];
    const orch = new ProcessingOrchestrator({
      handlers: {},
      delaysMs: [],
      sleep: async () => undefined,
    });
    // Replace run by enqueueing against a stub supabase that records keys.
    const supabase = {
      from(table: string) {
        if (table === 'video_processing_jobs') {
          return {
            select() {
              return this;
            },
            in() {
              return this;
            },
            order() {
              return this;
            },
            limit() {
              return Promise.resolve({
                data: [
                  { id: 'job-a', org_id: 'org-1', video_id: 'vid-1', status: 'pending' },
                  { id: 'job-b', org_id: 'org-1', video_id: 'vid-2', status: 'running' },
                ],
                error: null,
              });
            },
          };
        }
        return {
          select: () => this,
          eq: () => this,
          maybeSingle: async () => ({ data: null, error: null }),
          update: () => this,
        };
      },
    };

    const n = await orch.reclaimPending(supabase);
    assert.equal(n, 2);
    assert.equal(orch.pending, 2);
    void ran;
  });
});
