import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const dropPath = join(here, '../supabase/migrations/20260901010000_drop_crm_audit_triggers.sql');
const repairPath = join(
  here,
  '../supabase/migrations/20260901140000_intake_create_job_without_invitees.sql',
);
const dropSql = readFileSync(dropPath, 'utf8');
const repairSql = readFileSync(repairPath, 'utf8');

describe('CRM audit trigger drop is safe when old-product tables are gone', () => {
  it('guards DROP TRIGGER so a missing crm_accounts does not abort preview', () => {
    assert.match(dropSql, /to_regclass\('public\.crm_accounts'\)/);
    assert.match(dropSql, /to_regclass\('public\.crm_jobs'\)/);
    assert.match(dropSql, /drop trigger if exists crm_jobs_audit on public\.crm_jobs/);
    assert.match(dropSql, /drop function if exists private\.crm_audit\(\)/);
    assert.doesNotMatch(
      dropSql,
      /^drop trigger if exists crm_accounts_audit on public\.crm_accounts;/m,
    );
  });

  it('guards the repair RPC the intake migration calls at apply time', () => {
    assert.match(repairSql, /to_regclass\('public\.crm_accounts'\)/);
    assert.match(repairSql, /select public\.repair_crm_audit_triggers\(\)/);
  });
});
