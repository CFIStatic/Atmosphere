import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repairSql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260901030000_repair_crm_audit_for_job_delete.sql'),
  'utf8',
);
const dropTriggersSql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260901010000_drop_crm_audit_triggers.sql'),
  'utf8',
);
const dropOldProductSql = readFileSync(
  resolve(here, '../../../../supabase/migrations/20260828220000_drop_old_product_tables.sql'),
  'utf8',
);
const applyScript = readFileSync(
  resolve(here, '../../../../backend/scripts/applyCrmAuditTriggerDrop.mjs'),
  'utf8',
);

describe('CRM audit trigger cleanup for job-file delete', () => {
  it('ships a service-role repair RPC the BFF can call before soft-delete', () => {
    expect(repairSql).toContain('create or replace function public.repair_crm_audit_triggers()');
    expect(repairSql).toContain('drop trigger if exists crm_jobs_audit on public.crm_jobs');
    expect(repairSql).toContain('drop function if exists private.crm_audit()');
    expect(repairSql).toContain('grant execute on function public.repair_crm_audit_triggers() to service_role');
    expect(repairSql).toMatch(/crm_audit_log/);
  });

  it('keeps the one-shot drop SQL and old-product cleanup for redeploys', () => {
    expect(dropTriggersSql).toContain('drop trigger if exists crm_jobs_audit on public.crm_jobs');
    expect(dropTriggersSql).toContain('drop function if exists private.crm_audit()');
    expect(dropOldProductSql).toContain('drop table if exists public.crm_audit_log cascade');
    expect(dropOldProductSql).toContain('drop trigger if exists crm_jobs_audit on public.crm_jobs');
    expect(dropOldProductSql).toContain('drop function if exists private.crm_audit()');
  });

  it('applies the repair migration from deploy / the repair workflow', () => {
    expect(applyScript).toContain('20260901030000_repair_crm_audit_for_job_delete.sql');
  });
});
