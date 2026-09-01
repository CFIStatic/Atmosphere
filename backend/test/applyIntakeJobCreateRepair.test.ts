import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = readFileSync(join(here, '../scripts/applyIntakeJobCreateRepair.mjs'), 'utf8');
const sql = readFileSync(
  join(here, '../supabase/migrations/20260901140000_intake_create_job_without_invitees.sql'),
  'utf8',
);

describe('intake job-create repair apply script', () => {
  it('applies the optional-invitees migration', () => {
    assert.match(script, /20260901140000_intake_create_job_without_invitees\.sql/);
    assert.match(sql, /repair_crm_audit_triggers/);
    assert.match(sql, /to_regclass\('public\.crm_accounts'\)/);
    assert.doesNotMatch(sql, /raise exception 'invitees_required'/);
  });
});
