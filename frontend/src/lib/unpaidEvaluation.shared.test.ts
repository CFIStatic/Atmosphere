import { describe, expect, it } from 'vitest';
import { sharedJobInsteadOfSetup } from './unpaidEvaluation';

describe('sharedJobInsteadOfSetup', () => {
  it('opens the job shared with this person instead of workspace setup', async () => {
    await expect(
      sharedJobInsteadOfSetup(async () => ({ grants: [{ path: '/job-progress?job=job-1' }] })),
    ).resolves.toBe('/job-progress?job=job-1');
  });

  it('leaves a real unpaid office on setup when nothing was shared or the lookup fails', async () => {
    await expect(sharedJobInsteadOfSetup(async () => ({ grants: [] }))).resolves.toBeNull();
    await expect(
      sharedJobInsteadOfSetup(async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeNull();
  });
});
