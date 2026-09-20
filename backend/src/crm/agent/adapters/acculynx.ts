import type { CrmAgentAdapter, CrmLoginCredentials } from '../../types.js';

/**
 * AccuLynx — API is key-based; browser username/password needs the agent session.
 * Verify attempts a lightweight API probe when the password looks like a key;
 * otherwise queues agent_session.
 */
export const acculynxAdapter: CrmAgentAdapter = {
  system: 'acculynx',
  label: 'AccuLynx',

  async verifyLogin(creds: CrmLoginCredentials) {
    const key = creds.password.trim();
    const base = process.env.ACCULYNX_API_BASE?.trim() || 'https://api.acculynx.com/api/v2';
    if (key.length >= 20) {
      try {
        const res = await fetch(`${base}/jobs?pageSize=1`, {
          headers: {
            Authorization: `Bearer ${key}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          return {
            ok: true,
            mode: 'api',
            accountLabel: creds.username,
            detail: 'Verified via AccuLynx API bearer token.',
          };
        }
      } catch {
        /* fall through to agent session */
      }
    }
    return {
      ok: true,
      mode: 'agent_session',
      accountLabel: creds.username,
      detail: 'Credentials saved for AccuLynx agent browser login.',
    };
  },

  async search(_creds: CrmLoginCredentials, _query: string) {
    return {
      hits: [],
      softFail: 'AccuLynx vendor search runs via agent session (queued). Using Atmosphere-native results.',
    };
  },
};
