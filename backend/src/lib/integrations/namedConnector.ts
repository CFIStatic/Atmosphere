/**
 * Named CRM pull connectors.
 *
 * Each wraps the generic RestConnector with system-specific auth (and optional
 * Salesforce token login). When config.sandbox is true, or when no credential
 * is available and the catalog entry supports it, the sandbox feed is used.
 */

import { RestConnector } from './restConnector.js';
import { SandboxCrmConnector } from './sandboxConnector.js';
import type { IntegrationSecret } from './credentials.js';
import type { Connector, FetchContext, FetchResult } from './types.js';

async function salesforceAccessToken(
  secret: IntegrationSecret,
  signal: AbortSignal,
): Promise<{ token: string; instanceUrl: string }> {
  if (secret.accessToken && (secret.instanceUrl || secret.baseUrl)) {
    return {
      token: secret.accessToken,
      instanceUrl: secret.instanceUrl || secret.baseUrl!,
    };
  }

  if (!secret.username || !secret.password) {
    throw new Error(
      'Salesforce needs either an access token + instance URL, or username/password + security token.',
    );
  }

  const password = `${secret.password}${secret.securityToken ?? ''}`;
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: secret.apiKey || '3MVG9placeholder',
    client_secret: secret.accountId || '',
    username: secret.username,
    password,
  });

  // When only username/password are provided without a connected-app client id,
  // prefer the legacy token endpoint with the org's session — callers should
  // supply a connected-app client id as apiKey for production.
  const loginHost = (secret.instanceUrl || secret.baseUrl || 'https://login.salesforce.com').replace(
    /\/$/,
    '',
  );

  const res = await fetch(`${loginHost}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal,
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    instance_url?: string;
    error_description?: string;
    error?: string;
  };

  if (!res.ok || !json.access_token || !json.instance_url) {
    throw new Error(
      json.error_description ||
        json.error ||
        `Salesforce login failed (${res.status}). Provide a Connected App client id as the API key.`,
    );
  }

  return { token: json.access_token, instanceUrl: json.instance_url };
}

function withSecretConfig(ctx: FetchContext, secret: IntegrationSecret | null): FetchContext {
  if (!secret) return ctx;
  const config = { ...ctx.config };
  if (secret.baseUrl) config.baseUrl = secret.baseUrl;
  if (secret.instanceUrl) config.baseUrl = secret.instanceUrl;
  if (secret.accountId) config.accountId = secret.accountId;
  return { ...ctx, config, credential: ctx.credential };
}

export class NamedCrmConnector implements Connector {
  readonly kind: string;
  private readonly rest = new RestConnector();
  private readonly sandbox: SandboxCrmConnector;

  constructor(
    private readonly system: string,
    private readonly secret: IntegrationSecret | null,
  ) {
    this.kind = system;
    this.sandbox = new SandboxCrmConnector(system);
  }

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const sandbox = Boolean(ctx.config.sandbox) || (!this.secret && !ctx.credential);
    if (sandbox) {
      return this.sandbox.fetch(ctx);
    }

    if (this.system === 'salesforce') {
      return this.fetchSalesforce(ctx);
    }

    // JobNimbus wants "Bearer <token>" in a custom Authorization header value.
    if (this.system === 'jobnimbus' && this.secret?.apiKey) {
      return this.rest.fetch({
        ...withSecretConfig(ctx, this.secret),
        credential: `Bearer ${this.secret.apiKey}`,
        config: {
          ...ctx.config,
          ...(this.secret.baseUrl ? { baseUrl: this.secret.baseUrl } : {}),
          auth: 'header',
          authHeader: 'Authorization',
        },
      });
    }

    const credential =
      this.secret?.accessToken ||
      this.secret?.apiKey ||
      ctx.credential;

    return this.rest.fetch({
      ...withSecretConfig(ctx, this.secret),
      credential,
    });
  }

  private async fetchSalesforce(ctx: FetchContext): Promise<FetchResult> {
    const secret = this.secret ?? (ctx.credential ? { apiKey: ctx.credential } : null);
    if (!secret) return this.sandbox.fetch(ctx);

    const { token, instanceUrl } = await salesforceAccessToken(secret, ctx.signal);
    const config = {
      ...ctx.config,
      baseUrl: instanceUrl,
      auth: 'bearer',
    };

    return this.rest.fetch({
      ...ctx,
      config,
      credential: token,
    });
  }
}
