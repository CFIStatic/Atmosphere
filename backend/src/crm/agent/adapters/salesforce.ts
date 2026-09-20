import type { CrmAgentAdapter, CrmLoginCredentials } from '../../types.js';

/** Salesforce — password grant is discouraged; agent session login is the path. */
export const salesforceAdapter: CrmAgentAdapter = {
  system: 'salesforce',
  label: 'Salesforce',

  async verifyLogin(creds: CrmLoginCredentials) {
    return {
      ok: true,
      mode: 'agent_session',
      accountLabel: creds.username,
      detail: 'Credentials saved. Salesforce agent session login queued (no OAuth on this page).',
    };
  },

  async search(_creds: CrmLoginCredentials, _query: string) {
    return {
      hits: [],
      softFail: 'Salesforce search via agent session is stubbed — Atmosphere-native search only for now.',
    };
  },
};
