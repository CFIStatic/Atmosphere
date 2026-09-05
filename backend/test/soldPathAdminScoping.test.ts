import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Sold-path request handlers must not call createAdminClient() directly.
 * Tenant writes go through writerForOrg / writerForJob / adminForPartyToken.
 * Platform-wide RPCs / storage / Auth use unscopedAdmin(OrNull).
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const SOLD_PATH_FILES = [
  'src/routes/sharedJobs.ts',
  'src/routes/evidencePortal.ts',
  'src/routes/proofOfWork.ts',
  'src/routes/jobs.ts',
  'src/routes/jobIntake.ts',
  'src/routes/fieldApp.ts',
  'src/routes/progressShare.ts',
  'src/routes/scopeDocs.ts',
  'src/routes/org.ts',
  'src/routes/fieldIdentity.ts',
  'src/routes/unsubscribe.ts',
  'src/routes/auth.ts',
  'src/routes/profile.ts',
  'src/lib/stripe.ts',
  'src/lib/jobFileDelete.ts',
  'src/lib/orgInviteGate.ts',
  'src/auth/passwordAccount.ts',
  'src/auth/sendPasswordReset.ts',
  'src/field/crewJoin.ts',
  'src/field/officeLink.ts',
  'src/verifier/deliverPartyInvite.ts',
  'src/audio/proofTranscript.ts',
  'src/shared/proofAnalysisSweep.ts',
  'src/media/driver.ts',
];

test('sold-path handlers do not call createAdminClient() directly', () => {
  for (const rel of SOLD_PATH_FILES) {
    const src = readFileSync(join(root, rel), 'utf8');
    assert.doesNotMatch(
      src,
      /createAdminClient\s*\(/,
      `${rel} still calls createAdminClient() — use scopedAdmin helpers`,
    );
  }
});

test('Railway example graph is not imported by deploy or Keys sync', () => {
  const production = readFileSync(
    new URL('../../.github/workflows/deploy-production.yml', import.meta.url),
    'utf8',
  );
  const sync = readFileSync(
    new URL('../scripts/syncGithubEnvToRailway.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(production, /graph\.example/);
  assert.doesNotMatch(sync, /graph\.example/);
});
