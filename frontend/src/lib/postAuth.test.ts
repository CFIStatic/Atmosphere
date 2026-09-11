import { afterEach, describe, expect, it } from 'vitest';
import { HOMEOWNER_HUB_PATH } from './homeownerHub';
import { postAuthDestination, resolveNoOrgDestination } from './postAuth';

describe('postAuthDestination', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fieldEmbed;
  });

  it('returns the fallback when the user has an org', () => {
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/usage')).toBe('/usage');
  });

  it('preserves the intended destination through signup setup', () => {
    expect(postAuthDestination(null, '/usage')).toBe('/signup?next=%2Fusage');
  });

  it('opens a claimed job or progress link without forcing workspace setup', () => {
    expect(postAuthDestination(null, '/job-progress?job=abc')).toBe('/job-progress?job=abc');
    expect(postAuthDestination(null, '/progress/tok123')).toBe('/progress/tok123');
    expect(postAuthDestination(null, HOMEOWNER_HUB_PATH)).toBe(HOMEOWNER_HUB_PATH);
  });

  it('keeps the Field Capture phone embed after sign-in', () => {
    document.documentElement.dataset.fieldEmbed = '1';
    expect(postAuthDestination({ orgId: 'org-1' } as never, '/verifier-library')).toBe(
      '/verifier-library?embed=field',
    );
  });

  it('does not send a Field Capture session to workspace setup', () => {
    document.documentElement.dataset.fieldEmbed = '1';
    expect(postAuthDestination(null, '/verifier-library')).toBe('/verifier-library?embed=field');
  });
});

describe('resolveNoOrgDestination', () => {
  afterEach(() => {
    delete document.documentElement.dataset.fieldEmbed;
  });

  it('lands grant-only accounts on the homeowner hub', async () => {
    await expect(
      resolveNoOrgDestination('/verifier-library', {
        lookupGrants: async () => ({ grants: [{ jobId: 'job-1' }] }),
      }),
    ).resolves.toBe(HOMEOWNER_HUB_PATH);
  });

  it('keeps a progress deep link even when grants exist', async () => {
    await expect(
      resolveNoOrgDestination('/progress/tok123', {
        lookupGrants: async () => ({ grants: [{ jobId: 'job-1' }] }),
      }),
    ).resolves.toBe('/progress/tok123');
  });

  it('sends homeowner intent to the hub when there is no job link', async () => {
    await expect(
      resolveNoOrgDestination('/verifier-library', {
        intent: 'homeowner',
        lookupGrants: async () => ({ grants: [] }),
      }),
    ).resolves.toBe(HOMEOWNER_HUB_PATH);
  });

  it('still sends contractors without grants to workspace setup', async () => {
    await expect(
      resolveNoOrgDestination('/verifier-library', {
        lookupGrants: async () => ({ grants: [] }),
      }),
    ).resolves.toBe('/signup?next=%2Fverifier-library');
  });
});
