import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = join(here, '../supabase/migrations/20260828220000_drop_old_product_tables.sql');
const sql = readFileSync(sqlPath, 'utf8');

const dropped = [...sql.matchAll(/drop table if exists (?:public|private)\.([a-z_]+)/gi)].map(
  (m) => m[1],
);

const keep = [
  'crm_jobs',
  'crm_properties',
  'crm_counters',
  'org_billing',
  'billing_plans',
  'credit_lots',
  'credit_ledger',
  'credit_packs',
  'credit_purchases',
  'payments',
  'stripe_events',
  'org_metering',
  'metering_plans',
  'job_proofs',
  'job_parties',
  'job_intake',
  'field_identities',
  'verification_videos',
  'work_episodes',
  'pm_projects',
  'pm_automation_settings',
  'homeowner_portal_shares',
  'network_erasures',
  'orgs',
  'org_members',
  'org_invites',
  'profiles',
];

describe('drop old product tables migration', () => {
  it('drops leftover CRM/sales/finance tables', () => {
    assert.ok(dropped.includes('crm_accounts'));
    assert.ok(dropped.includes('sales_campaigns'));
    assert.ok(dropped.includes('finance_accounts'));
    assert.ok(dropped.includes('estimator_jobs'));
    assert.ok(dropped.includes('web_connections'));
    assert.ok(dropped.includes('em_storms'));
  });

  it('does not drop live Work Verification or Stripe tables', () => {
    for (const table of keep) {
      assert.ok(!dropped.includes(table), `must not drop ${table}`);
    }
  });
});
