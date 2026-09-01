import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  intakeApproveCompatFields,
  parseIntakeApprove,
} from '../src/routes/jobIntake.js';

const NAME_ONLY = {
  title: 'East Racine Avenue',
  workType: 'construction' as const,
  briefNote: 'Extract standing water in the living room.',
  facts: { Work: 'Extract standing water in the living room.' },
  scope: [{ title: 'Extract standing water in the living room.', state: 'included' as const }],
  invitees: [],
};

test('parseIntakeApprove accepts a filled job with no address and no invitees', () => {
  const parsed = parseIntakeApprove(NAME_ONLY);
  assert.equal(parsed.title, 'East Racine Avenue');
  assert.equal(parsed.address, '');
  assert.deepEqual(parsed.invitees, []);
  assert.equal(parsed.scope.length, 1);
});

test('parseIntakeApprove treats a blank teammate email as missing, not invalid', () => {
  const parsed = parseIntakeApprove({
    ...NAME_ONLY,
    invitees: [
      {
        userId: 'u-marcus',
        fullName: 'Marcus Webb',
        email: '   ',
        trade: 'field_capture',
        external: false,
      },
    ],
  });
  assert.equal(parsed.invitees[0]?.email ?? null, null);
});

test('parseIntakeApprove still requires email for an outside worker', () => {
  assert.throws(
    () =>
      parseIntakeApprove({
        ...NAME_ONLY,
        invitees: [{ fullName: 'Alex Rivera', company: 'Rio Grande', external: true }],
      }),
    /Email is required/,
  );
});

test('intakeApproveCompatFields does not throw when nobody was invited', () => {
  const job = { id: 'job-1', title: 'East Racine Avenue' };
  const empty = intakeApproveCompatFields([], job);
  assert.deepEqual(empty, {
    party: { id: 'job-1', company: 'East Racine Avenue' },
    sharePath: '',
    fieldCapturePath: '',
  });

  const withInvite = intakeApproveCompatFields(
    [
      {
        id: 'pty-1',
        name: 'Marcus Webb',
        sharePath: '/shared/tok',
        fieldCapturePath: '/fieldcapture/?token=tok',
      },
    ],
    job,
  );
  assert.deepEqual(withInvite, {
    party: { id: 'pty-1', company: 'Marcus Webb' },
    sharePath: '/shared/tok',
    fieldCapturePath: '/fieldcapture/?token=tok',
  });
});

test('intake RPC creates a job file without invitees and always attempts the function', () => {
  const src = readFileSync(new URL('../src/routes/jobIntake.ts', import.meta.url), 'utf8');
  assert.match(src, /await supabase\.rpc\('intake_create_job_file'/);
  assert.doesNotMatch(src, /invitees\.length > 0\s*\n\s*\? await supabase\.rpc/);
  assert.match(src, /intakeApproveCompatFields/);
  assert.doesNotMatch(src, /invites\[0\]!/);
});

test('latest intake SQL allows an empty invite list', () => {
  const sql = readFileSync(
    new URL('../supabase/migrations/20260901140000_intake_create_job_without_invitees.sql', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(sql, /raise exception 'invitees_required'/);
  assert.match(sql, /invitees_invalid/);
  assert.match(sql, /repair_crm_audit_triggers/);
  assert.match(sql, /to_regclass\('public\.crm_accounts'\)/);
  assert.match(sql, /jsonb_typeof\(coalesce\(p_invitees/);
});
