/**
 * JobNimbus adapter.
 *
 * JobNimbus's public REST API authenticates with a Bearer API key, not a
 * browser password. When the stored "password" works as an API key we treat
 * verify/search as real. Otherwise we mark the credential for the agent
 * session runner (browser login with username/password) — stubbed here.
 */

import type { CrmAgentAdapter, CrmAdapterSearchHit, CrmLoginCredentials } from '../../types.js';

const API_BASE = process.env.JOBNIMBUS_API_BASE?.trim() || 'https://app.jobnimbus.com/api1';

async function jnFetch(apiKey: string, path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });
}

export const jobnimbusAdapter: CrmAgentAdapter = {
  system: 'jobnimbus',
  label: 'JobNimbus',

  async verifyLogin(creds: CrmLoginCredentials) {
    const key = creds.password.trim();
    if (!key) {
      return { ok: false, mode: 'stub', detail: 'Missing password.' };
    }
    try {
      const res = await jnFetch(key, '/jobs?size=1');
      if (res.ok) {
        return {
          ok: true,
          mode: 'api',
          accountLabel: creds.username,
          detail: 'Verified via JobNimbus API key (password field).',
        };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          ok: true,
          mode: 'agent_session',
          accountLabel: creds.username,
          detail:
            'Credentials saved. JobNimbus API key auth failed; agent browser login queued.',
        };
      }
      return {
        ok: true,
        mode: 'agent_session',
        accountLabel: creds.username,
        detail: `JobNimbus API returned ${res.status}; agent session queued.`,
      };
    } catch {
      return {
        ok: true,
        mode: 'agent_session',
        accountLabel: creds.username,
        detail: 'Could not reach JobNimbus API; credentials saved for agent login.',
      };
    }
  },

  async search(creds: CrmLoginCredentials, query: string) {
    const key = creds.password.trim();
    const q = query.trim().slice(0, 80);
    if (!q) return { hits: [], softFail: 'Missing search query.' };
    try {
      const res = await jnFetch(key, `/jobs?size=25`);
      if (!res.ok) {
        return {
          hits: [],
          softFail:
            res.status === 401 || res.status === 403
              ? 'JobNimbus API key rejected — agent browser search not yet available.'
              : `JobNimbus search failed (${res.status}).`,
        };
      }
      const body = (await res.json()) as { results?: Array<Record<string, unknown>> };
      const needle = q.toLowerCase();
      const hits: CrmAdapterSearchHit[] = (body.results ?? [])
        .filter((row) => {
          const blob = JSON.stringify(row).toLowerCase();
          return blob.includes(needle);
        })
        .slice(0, 8)
        .map((row) => ({
          externalId: String(row.jnid ?? row.id ?? ''),
          title: String(row.name ?? row.display_name ?? 'JobNimbus job'),
          claimNumber: row.number != null ? String(row.number) : null,
          raw: row,
        }));
      return { hits };
    } catch {
      return {
        hits: [],
        softFail: 'JobNimbus search unreachable; try again or use Atmosphere-native search.',
      };
    }
  },

  async pullSample(creds: CrmLoginCredentials) {
    const key = creds.password.trim();
    try {
      const res = await jnFetch(key, '/jobs?size=5');
      if (!res.ok) {
        return {
          count: 0,
          softFail: 'JobNimbus pull needs a working API key or agent browser session.',
        };
      }
      const body = (await res.json()) as { results?: unknown[]; count?: number };
      return { count: Array.isArray(body.results) ? body.results.length : Number(body.count) || 0 };
    } catch {
      return { count: 0, softFail: 'JobNimbus pull unreachable.' };
    }
  },
};
