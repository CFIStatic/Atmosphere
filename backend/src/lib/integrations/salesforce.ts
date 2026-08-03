import { config } from '../../config.js';
import { loadGrant } from './oauthVault.js';
import type { Connector, ExternalRecord, FetchContext, FetchResult } from './types.js';

/**
 * Salesforce, over OAuth and its REST API.
 *
 * Worth stating plainly why this is an API connector and not a browser one,
 * because the request that prompted it offered either:
 *
 *   Driving Salesforce through a logged-in Chrome session means holding a
 *   customer's Salesforce password. That password is the customer's whole
 *   Salesforce org — every object, every user's data, admin if they are one —
 *   it defeats their MFA, it breaks the moment they rotate it, and storing it
 *   makes us a far more attractive target than we have any business being.
 *
 *   OAuth gives a scoped, revocable grant instead. The customer authorises us
 *   in Salesforce's own UI, sees exactly what we are asking for, and can cut it
 *   off from their own admin screen without telling us. We never learn the
 *   password, and MFA keeps working.
 *
 * So browser automation is the fallback for CRMs that offer nothing better,
 * not the approach for one that does. Salesforce does.
 *
 * The records land in the mirror verbatim — Account, Contact, Lead,
 * Opportunity as Salesforce returns them, not reshaped into our CRM's
 * vocabulary. Mapping happens later and reversibly; a connector that
 * "helpfully" normalises on the way in destroys the thing being copied.
 */

/** The objects a restoration company actually needs out of Salesforce. */
const DEFAULT_OBJECTS = ['Account', 'Contact', 'Lead', 'Opportunity'] as const;

/** Per-object field lists. `FIELDS` is not valid in the REST query API. */
const OBJECT_FIELDS: Record<string, string[]> = {
  Account: [
    'Id', 'Name', 'Type', 'Industry', 'Phone', 'Website', 'BillingStreet', 'BillingCity',
    'BillingState', 'BillingPostalCode', 'OwnerId', 'CreatedDate', 'LastModifiedDate',
    'SystemModstamp',
  ],
  Contact: [
    'Id', 'AccountId', 'FirstName', 'LastName', 'Title', 'Email', 'Phone', 'MobilePhone',
    'MailingCity', 'MailingState', 'OwnerId', 'CreatedDate', 'LastModifiedDate', 'SystemModstamp',
  ],
  Lead: [
    'Id', 'FirstName', 'LastName', 'Company', 'Title', 'Email', 'Phone', 'MobilePhone', 'Status',
    'LeadSource', 'City', 'State', 'PostalCode', 'OwnerId', 'IsConverted', 'CreatedDate',
    'LastModifiedDate', 'SystemModstamp',
  ],
  Opportunity: [
    'Id', 'AccountId', 'Name', 'StageName', 'Amount', 'CloseDate', 'Probability', 'Type',
    'LeadSource', 'IsClosed', 'IsWon', 'OwnerId', 'CreatedDate', 'LastModifiedDate',
    'SystemModstamp',
  ],
};

interface TokenResponse {
  access_token?: string;
  instance_url?: string;
  refresh_token?: string;
  id?: string;
  error?: string;
  error_description?: string;
}

interface QueryResponse {
  totalSize?: number;
  done?: boolean;
  nextRecordsUrl?: string;
  records?: Array<Record<string, unknown> & { Id?: string; attributes?: { type?: string } }>;
}

/**
 * Exchange a refresh token for an access token.
 *
 * Access tokens are short-lived and deliberately never stored: one is fetched
 * per sync run and discarded with it. The refresh token is the thing worth
 * protecting, and it stays sealed in the vault.
 */
export async function accessTokenFor(
  refreshToken: string,
): Promise<{ accessToken: string; instanceUrl: string | null }> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.integrations.salesforce.clientId,
    client_secret: config.integrations.salesforce.clientSecret,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${config.integrations.salesforce.loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || !json.access_token) {
    // A revoked grant is the common case and it is not a bug: the customer
    // turned us off in their own admin screen, which is exactly what OAuth is
    // for. Say so rather than reporting a generic failure.
    const reason = json.error === 'invalid_grant'
      ? 'The Salesforce connection was revoked or expired. Reconnect it in Settings.'
      : (json.error_description ?? `Salesforce returned ${res.status}.`);
    throw new Error(reason);
  }
  return { accessToken: json.access_token, instanceUrl: json.instance_url ?? null };
}

/** SOQL for one object, incremental when we have a cursor to resume from. */
function soqlFor(objectName: string, since: string | null, limit: number): string {
  const fields = OBJECT_FIELDS[objectName] ?? ['Id', 'Name', 'SystemModstamp'];
  const where = since ? ` WHERE SystemModstamp > ${since}` : '';
  // Ordering by SystemModstamp is what makes the cursor meaningful: the last
  // row's stamp is a safe place to resume, which it would not be under an
  // arbitrary order.
  return `SELECT ${fields.join(', ')} FROM ${objectName}${where} ORDER BY SystemModstamp ASC LIMIT ${limit}`;
}

export class SalesforceConnector implements Connector {
  readonly kind = 'salesforce';

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const cfg = ctx.config as { orgId?: string; objects?: string[] };
    if (!cfg.orgId) throw new Error('Salesforce source config needs the owning orgId.');

    if (!config.integrations.salesforce.clientId) {
      throw new Error(
        'Salesforce is not configured on this deployment. Set SALESFORCE_CLIENT_ID and ' +
          'SALESFORCE_CLIENT_SECRET, then reconnect.',
      );
    }

    const grant = await loadGrant(cfg.orgId, 'salesforce');
    if (!grant) {
      throw new Error('No Salesforce connection for this organization. Connect it in Settings.');
    }

    const { accessToken, instanceUrl } = await accessTokenFor(grant.refreshToken);
    const host = instanceUrl ?? grant.instanceUrl;
    const version = config.integrations.salesforce.apiVersion;

    const objects = cfg.objects?.length ? cfg.objects : [...DEFAULT_OBJECTS];
    const records: ExternalRecord[] = [];
    let truncated = false;

    // The cursor is per object, because Account and Contact do not move in
    // step and one shared high-water mark would silently skip whichever object
    // lags behind.
    let cursors: Record<string, string> = {};
    if (ctx.cursor) {
      try {
        cursors = JSON.parse(ctx.cursor);
      } catch {
        cursors = {};
      }
    }
    const nextCursors: Record<string, string> = { ...cursors };

    for (const objectName of objects) {
      if (records.length >= ctx.maxRecords) {
        truncated = true;
        break;
      }
      const room = Math.min(ctx.maxRecords - records.length, 2000);
      const soql = soqlFor(objectName, cursors[objectName] ?? null, room);

      const res = await fetch(
        `${host}/services/data/${version}/query?q=${encodeURIComponent(soql)}`,
        {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
          signal: ctx.signal,
        },
      );

      if (!res.ok) {
        // One object failing — a permission the connected user lacks, most
        // often — must not lose the objects that did come back.
        continue;
      }

      const body = (await res.json()) as QueryResponse;
      for (const row of body.records ?? []) {
        const id = typeof row.Id === 'string' ? row.Id : null;
        if (!id) continue;
        const stamp = typeof row.SystemModstamp === 'string' ? row.SystemModstamp : null;

        records.push({
          entityType: objectName.toLowerCase(),
          externalId: id,
          // Verbatim, minus Salesforce's own routing metadata.
          payload: { ...row, attributes: undefined },
          sourceUpdatedAt: stamp,
        });
        if (stamp) nextCursors[objectName] = stamp;
      }

      if (body.done === false) truncated = true;
    }

    return {
      records,
      nextCursor: Object.keys(nextCursors).length ? JSON.stringify(nextCursors) : null,
      truncated,
    };
  }
}

/**
 * Where to send somebody to authorise us.
 *
 * `state` is not decoration — it ties the callback to the org that started the
 * flow. Without it, anyone who could reach the callback could attach their own
 * Salesforce to somebody else's organization.
 */
export function authorizeUrl(state: string, redirectUri: string): string {
  const url = new URL(`${config.integrations.salesforce.loginUrl}/services/oauth2/authorize`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.integrations.salesforce.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  // refresh_token is what lets a nightly sync work without a human present;
  // 'api' is read access to the objects above. Nothing wider is requested.
  url.searchParams.set('scope', 'api refresh_token');
  url.searchParams.set('state', state);
  return url.toString();
}

/** Complete the flow: authorisation code in, refresh token out. */
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; instanceUrl: string; accountLabel: string | null }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: config.integrations.salesforce.clientId,
    client_secret: config.integrations.salesforce.clientSecret,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${config.integrations.salesforce.loginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;

  if (!res.ok || !json.refresh_token || !json.instance_url) {
    throw new Error(json.error_description ?? 'Salesforce declined the authorization.');
  }

  // The identity URL ends in the user id; the instance host is a far more
  // useful label for "which Salesforce is this?" than an opaque id would be.
  let accountLabel: string | null = null;
  try {
    accountLabel = new URL(json.instance_url).hostname;
  } catch {
    accountLabel = null;
  }

  return {
    refreshToken: json.refresh_token,
    instanceUrl: json.instance_url,
    accountLabel,
  };
}

/**
 * Revoke at Salesforce, not just locally.
 *
 * Deleting our copy stops us using it; only revocation stops it working. A
 * disconnect that skipped this would leave a live grant sitting in the
 * customer's Salesforce with our name on it.
 */
export async function revoke(refreshToken: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${config.integrations.salesforce.loginUrl}/services/oauth2/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refreshToken }),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
