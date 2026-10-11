import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const signIn = readFileSync(new URL('../src/auth/progressEmailSignIn.ts', import.meta.url), 'utf8');
const grants = readFileSync(new URL('../src/shared/jobProgressGrants.ts', import.meta.url), 'utf8');

test('share email sign-in never dead-ends a work account', () => {
  assert.doesNotMatch(signIn, /password_required/);
  assert.doesNotMatch(signIn, /work account\. Sign in with your password/);
  // Still only the invited address: the link goes to the share's recipient, verify checks it.
  assert.match(signIn, /email: recipient/);
  assert.match(signIn, /assertInvitedUser\(user, recipient\)/);
});

test('claim keeps a contractor’s role when they open a shared job', () => {
  const claim = grants.slice(grants.indexOf('export async function claimProgressShareForUser'));
  assert.match(claim, /recipient !== email/);
  assert.match(claim, /from\('org_members'\)/);
  assert.match(claim, /if \(!hasWorkAccount\) await admin\.from\('profiles'\)\.upsert/);
});

test('a contractor invited to another company’s job opens it as a viewer, not a 404', () => {
  const fn = grants.slice(grants.indexOf('export async function viewerGrantForForeignJob'));
  assert.match(fn, /jobOrg === callerOrgId\) return null/);
  assert.match(fn, /findJobProgressGrant\(admin, req\.user!\.id, jobId, req\.user!\.email\)/);
  const resolve = grants.slice(grants.indexOf('export async function resolveOrgOrViewerAccess'));
  assert.match(resolve, /viewerGrantForForeignJob\(req, ctx\.orgId, jobId\)/);
  const shared = readFileSync(new URL('../src/routes/sharedJobs.ts', import.meta.url), 'utf8');
  assert.match(shared, /viewerGrantForForeignJob\(req, ctx\.orgId, req\.params\.jobId\)/);
});
