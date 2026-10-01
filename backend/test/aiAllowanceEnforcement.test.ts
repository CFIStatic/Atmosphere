import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAiAllowance, settleUsageCost } from '../src/metering/aiBudgetService.js';

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/20261002130000_ai_allowance_enforcement.sql', import.meta.url)),
  'utf8',
);

const PERIOD_SPEND = 50_000_000_000_000;
const PAGE_CREDIT = 999_000_000_000_000;

function allowanceClient(opts?: {
  creditBalance?: number;
  settle?: (args: Record<string, unknown>) => { data: unknown; error: { message?: string; code?: string } | null };
}) {
  const creditBalance = opts?.creditBalance ?? 0;
  const inserts: Array<{ table: string; row: unknown }> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = {
    inserts,
    rpcCalls,
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === 'settle_ai_usage') return opts?.settle?.(args) ?? { data: null, error: { message: 'missing settle' } };
      if (name === 'ai_credit_balance') return { data: 0, error: null };
      if (name === 'ai_allowance_totals') {
        return {
          data: [{
            period_spend_nanos: PERIOD_SPEND,
            window_event_nanos: PERIOD_SPEND,
            window_allowance_nanos: 0,
            window_allocation_count: 0,
            credit_balance_nanos: creditBalance,
            by_feature: { ask: PERIOD_SPEND },
          }],
          error: null,
        };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      const query: { limitN: number | null; op: string; row: unknown } = { limitN: null, op: 'select', row: null };
      const self: Record<string, unknown> = {};
      const chain = () => self;
      self.select = chain;
      self.eq = chain;
      self.gte = chain;
      self.lt = chain;
      self.order = chain;
      self.is = chain;
      self.limit = (n: number) => {
        query.limitN = n;
        return self;
      };
      self.insert = (row: unknown) => {
        query.op = 'insert';
        query.row = row;
        inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      };
      self.maybeSingle = async () => {
        if (table === 'org_billing') {
          return {
            data: {
              status: 'active',
              period_start: '2026-10-01T00:00:00.000Z',
              period_end: '2026-11-01T00:00:00.000Z',
              atmosphere_plan_code: 'starter',
              extra_fc_seats: 0,
              billing_interval: 'month',
            },
            error: null,
          };
        }
        return { data: null, error: null };
      };
      self.then = (resolve: (value: unknown) => unknown, reject: (err: unknown) => unknown) => {
        let data: unknown[] = [];
        if (table === 'token_usage_events') data = [{ id: 'e1', feature: 'ask', cost_nanos: 1, created_at: '2026-10-02T00:00:00.000Z' }];
        if (table === 'ai_credit_ledger') {
          data = [{ id: 'c1', delta_nanos: PAGE_CREDIT, kind: 'purchase', note: null, created_at: '2026-10-02T00:00:00.000Z' }];
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      };
      return self;
    },
  };
  return client;
}

test('period usage comes from the database sum, not one page of events', async () => {
  const client = allowanceClient();
  const view = await loadAiAllowance(client as never, 'org-1', { now: new Date('2026-10-15T00:00:00.000Z') });
  assert.equal(view.evaluation.periodSpendNanos, PERIOD_SPEND);
  assert.equal(view.paused, true);
  assert.equal(view.state, 'limited');
  assert.ok(client.rpcCalls.some((call) => call.name === 'ai_allowance_totals'));
  assert.match(sql, /sum\(greatest\(coalesce\(cost_nanos, 0\), 0\)\)/);
  assert.match(sql, /grant execute on function public\.ai_allowance_totals/);
  assert.match(sql, /from public, anon, authenticated/);
});

test('credit balance comes from the database sum, not one page of the ledger', async () => {
  const client = allowanceClient();
  const view = await loadAiAllowance(client as never, 'org-1', { now: new Date('2026-10-15T00:00:00.000Z') });
  assert.equal(view.creditBalanceNanos, 0);
  assert.equal(view.state, 'limited');
  assert.match(sql, /select coalesce\(sum\(delta_nanos\), 0\)::bigint/);
  assert.match(sql, /grant execute on function public\.ai_credit_balance/);
});

test('a short credit balance does not count the call as paid by credits', async () => {
  const client = allowanceClient({
    creditBalance: 5_000_000_000,
    settle: (args) => {
      const requested = Number(args.p_credit_nanos ?? 0);
      const balance = 0;
      const credit = requested > 0 && balance < requested ? 0 : requested;
      return {
        data: [{
          applied: true,
          credit_applied: credit > 0,
          allowance_nanos: args.p_allowance_nanos,
          credit_nanos: credit,
        }],
        error: null,
      };
    },
  });
  await assert.rejects(
    () => settleUsageCost(client as never, { orgId: 'org-1', requestId: 'req-1', costNanos: 1_000_000 }),
    /insufficient_ai_credits/,
  );
  assert.equal(client.inserts.filter((row) => row.table === 'ai_credit_ledger').length, 0);
  assert.equal(client.inserts.filter((row) => row.table === 'ai_usage_allocations').length, 0);
  const settle = client.rpcCalls.find((call) => call.name === 'settle_ai_usage');
  assert.ok(settle);
  assert.ok(Number(settle.args.p_credit_nanos) > 0);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /v_balance < v_credit/);
  assert.match(sql, /v_credit := 0/);
});

test('the budget hold column is server-write-only', () => {
  assert.match(sql, /revoke update on table public\.job_proofs from public, anon, authenticated/);
  assert.match(sql, /column_name not in \('ai_budget_hold', 'ai_budget_hold_reason'\)/);
  assert.match(sql, /ai_budget_hold is server-write-only/);
  assert.match(sql, /current_user not in \('service_role', 'postgres', 'supabase_admin'\)/);
  assert.match(sql, /grant update on table public\.job_proofs to service_role/);
});
