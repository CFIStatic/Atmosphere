import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setJobOrgResolverForTests, vaultMedia } from './vault.js';
import type { VaultMediaInput } from './types.js';

function input(over: Partial<VaultMediaInput>): VaultMediaInput {
  return {
    orgId: '',
    sourceKind: 'job_proof',
    sourceId: `proof-${Math.random().toString(36).slice(2)}`,
    jobId: null,
    actorUserId: null,
    storageBackend: 'supabase',
    storageBucket: 'job-proofs',
    storageKey: 'k.mp4',
    contentHash: null,
    byteSize: null,
    durationSeconds: null,
    contentType: 'video/mp4',
    ...over,
  } as VaultMediaInput;
}

describe('legal vault org resolution', () => {
  afterEach(() => setJobOrgResolverForTests(null));

  it('resolves org from the job when the source lacks one', async () => {
    setJobOrgResolverForTests(async (jobId) => (jobId === 'job-1' ? 'org-1' : null));
    const entry = await vaultMedia(input({ jobId: 'job-1' }));
    assert.equal(entry.orgId, 'org-1');
  });

  it('keeps an org that is already set without a lookup', async () => {
    let called = false;
    setJobOrgResolverForTests(async () => { called = true; return 'other'; });
    const entry = await vaultMedia(input({ orgId: 'org-2', jobId: 'job-1' }));
    assert.equal(entry.orgId, 'org-2');
    assert.equal(called, false);
  });

  it('upload route passes the party org to the vault (PROOF_SELECT has no org_id)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../routes/proofOfWork.ts'), 'utf8');
    assert.match(src, /vaultFromProof\(\{ \.\.\.vaultProof, org_id: party\.org_id/);
  });
});
