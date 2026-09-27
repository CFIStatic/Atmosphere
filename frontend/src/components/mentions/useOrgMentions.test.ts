import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMembers = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    getMembers: (...args: unknown[]) => getMembers(...args),
  },
}));

describe('loadOrgMentions', () => {
  beforeEach(() => {
    vi.resetModules();
    getMembers.mockReset();
  });

  it('retries after a failed roster fetch instead of caching an empty list', async () => {
    getMembers.mockRejectedValueOnce(new Error('network'));
    getMembers.mockResolvedValueOnce({
      members: [
        {
          userId: '11111111-1111-4111-8111-111111111111',
          email: 'john.cyganiak@example.com',
          fullName: 'John Cyganiak',
          handle: 'johncyganiak',
        },
      ],
    });

    const { loadOrgMentions } = await import('./useOrgMentions');
    await expect(loadOrgMentions()).resolves.toEqual([]);
    const second = await loadOrgMentions();
    expect(second.map((member) => member.handle)).toEqual(['johncyganiak']);
    expect(getMembers).toHaveBeenCalledTimes(2);
  });
});
