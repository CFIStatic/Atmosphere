import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAccess, translateAnalyticsRpcError } from './analytics.js';
import { ANALYTICS_ACTOR_HEADER } from './supabase.js';

describe('analytics RPC errors', () => {
  it('keeps the report sentence for a staff-scope rejection', () => {
    const err = translateAnalyticsRpcError(
      { code: '42501', message: 'analytics_forbidden' },
      'analytics_summary_failed',
    );
    assert.equal(err.status, 403);
    assert.equal(err.message, 'You do not have access to this report.');
  });

  it('does not call a missing EXECUTE grant a report denial', () => {
    const err = translateAnalyticsRpcError(
      { code: '42501', message: 'permission denied for function analytics_whoami' },
      'analytics_access_failed',
    );
    assert.equal(err.status, 403);
    assert.equal(err.message, 'You do not have access to Atmosphere analytics.');
    assert.equal(err.message.includes('this report'), false);
  });
});

describe('analytics access probe', () => {
  it('reads the caller staff row and does not call a report RPC', async () => {
    let rpcCalled = false;
    const supabase = {
      from(table: string) {
        assert.equal(table, 'analytics_staff');
        return {
          select(columns: string) {
            assert.equal(columns, 'scope, display_name');
            return {
              maybeSingle: async () => ({
                data: { scope: 'internal', display_name: 'Jack Cyganiak' },
                error: null,
              }),
            };
          },
        };
      },
      rpc() {
        rpcCalled = true;
        throw new Error('access probe must not call analytics_whoami');
      },
    };

    const access = await getAccess(supabase as unknown as SupabaseClient);
    assert.equal(rpcCalled, false);
    assert.equal(access.scope, 'internal');
    assert.equal(access.displayName, 'Jack Cyganiak');
  });

  it('treats a missing staff row as no access without an error', async () => {
    const supabase = {
      from() {
        return {
          select() {
            return { maybeSingle: async () => ({ data: null, error: null }) };
          },
        };
      },
    };
    const access = await getAccess(supabase as unknown as SupabaseClient);
    assert.equal(access.scope, null);
    assert.equal(access.displayName, null);
  });
});

describe('staff report actor header', () => {
  it('matches the header private.analytics_actor() reads', () => {
    const sql = readFileSync(
      new URL(
        '../../../supabase/migrations/20261002193000_internal_analytics_actor.sql',
        import.meta.url,
      ),
      'utf8',
    );
    assert.match(sql, new RegExp(`'${ANALYTICS_ACTOR_HEADER}'`));
    assert.equal(ANALYTICS_ACTOR_HEADER, 'x-analytics-user-id');
  });
});
