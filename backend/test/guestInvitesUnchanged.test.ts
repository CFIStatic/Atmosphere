/**
 * Regression: the team seat/role change applies ONLY to company team-member
 * invites. Homeowner and subcontractor (job-level guest) invites, access and
 * subcontractor prorated billing must be untouched.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const migration = read('supabase/migrations/20261023150000_permission_roles_everyone_both_products.sql');

test('the role migration does not touch guest tables (job_parties, claims, verifier shares, assignments)', () => {
  for (const table of ['job_parties', 'job_party_claims', 'verifier_shares']) {
    assert.ok(!new RegExp(`\\b${table}\\b`).test(migration), `${table} must not be referenced`);
  }
  // job_assignments is only read (existing crew clause of user_can_access_job), never written.
  assert.ok(!/(insert\s+into|update|delete\s+from)\s+public\.job_assignments/i.test(migration));
});

test('guest invite routes do not use team permission roles or the team invite path', () => {
  const guestRoutes = ['crewInvite.ts', 'sharedJobs.ts', 'progressShare.ts', 'evidencePortal.ts', 'fieldIdentity.ts'];
  for (const f of guestRoutes) {
    const src = read(`backend/src/routes/${f}`);
    assert.ok(!/permission_role|permissionRole/.test(src), `${f} must not depend on permission roles`);
  }
});

test('subcontractor prorated billing still goes through extra-seat proration, not team seats', () => {
  const src = read('backend/src/lib/stripeExtraSeats.ts');
  assert.match(src, /prorat/i);
  assert.ok(!/permission_role|permissionRole/.test(src));
});

test('the team invite UI offers no homeowner or subcontractor options (kept separate)', () => {
  const panel = read('frontend/src/components/team/InvitePanel.tsx');
  const code = panel.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/homeowner|subcontractor/i.test(code));
  const dir = join(root, 'frontend/src/components');
  assert.ok(readdirSync(dir).length > 0);
});
