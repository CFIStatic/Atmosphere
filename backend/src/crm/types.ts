export const CRM_AGENT_SYSTEMS = [
  'jobnimbus',
  'acculynx',
  'salesforce',
  'servicetitan',
] as const;

export type CrmAgentSystem = (typeof CRM_AGENT_SYSTEMS)[number];

export type CrmCredentialStatus = 'connected' | 'pending_verify' | 'error';

export type CrmCredentialPublic = {
  system: CrmAgentSystem;
  connected: boolean;
  username: string | null;
  notes: string | null;
  status: CrmCredentialStatus | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  connectedAt: string | null;
};

export type CrmAgentJobKind = 'verify_login' | 'pull' | 'push_update' | 'search';

export type CrmLoginCredentials = {
  username: string;
  password: string;
  notes?: string | null;
};

export type CrmAdapterVerifyResult = {
  ok: boolean;
  mode: 'api' | 'agent_session' | 'stub';
  accountLabel?: string | null;
  detail?: string | null;
};

export type CrmAdapterSearchHit = {
  externalId: string;
  title: string;
  claimNumber?: string | null;
  raw?: Record<string, unknown>;
};

export type CrmAgentAdapter = {
  system: CrmAgentSystem;
  label: string;
  /** Attempt login or API auth. Must never throw secrets. */
  verifyLogin: (creds: CrmLoginCredentials) => Promise<CrmAdapterVerifyResult>;
  search?: (
    creds: CrmLoginCredentials,
    query: string,
  ) => Promise<{ hits: CrmAdapterSearchHit[]; softFail?: string | null }>;
  pullSample?: (
    creds: CrmLoginCredentials,
  ) => Promise<{ count: number; softFail?: string | null }>;
};
