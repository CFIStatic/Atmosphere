import type { CrmAgentAdapter, CrmLoginCredentials } from '../../types.js';

/** ServiceTitan — app credentials differ from user login; agent session for UI login. */
export const servicetitanAdapter: CrmAgentAdapter = {
  system: 'servicetitan',
  label: 'ServiceTitan',

  async verifyLogin(creds: CrmLoginCredentials) {
    return {
      ok: true,
      mode: 'agent_session',
      accountLabel: creds.username,
      detail: 'Credentials saved for ServiceTitan agent browser login.',
    };
  },

  async search(_creds: CrmLoginCredentials, _query: string) {
    return {
      hits: [],
      softFail: 'ServiceTitan search via agent session is stubbed — Atmosphere-native search only for now.',
    };
  },
};
