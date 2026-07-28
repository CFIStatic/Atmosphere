import type { Connector, ExternalRecord, FetchContext, FetchResult } from '../../lib/integrations/types.js';

/**
 * QuickBooks Online / Intuit connector.
 *
 * Read-only observation of company financials. Credentials are OAuth access
 * tokens resolved from the environment via `credential_ref` — never stored in
 * Postgres. The agent can see accounts, invoices, and payments; it does not
 * post, void, or pay.
 *
 * Source `config` shape (also stored on finance_connections.config):
 *
 * ```jsonc
 * {
 *   "realmId": "1234567890",
 *   "baseUrl": "https://quickbooks.api.intuit.com", // or sandbox
 *   "minorVersion": "65",
 *   "entities": ["Account", "Invoice", "Payment", "Bill", "Vendor", "Customer"]
 * }
 * ```
 *
 * The credential env value is the bearer access token (or a JSON blob with
 * `{ "access_token": "..." }`). Refresh-token rotation is out of band — the
 * connection surfaces as `error` when Intuit rejects the token so an accountant
 * can re-authorize.
 */

const DEFAULT_BASE = 'https://quickbooks.api.intuit.com';
const DEFAULT_ENTITIES = ['Account', 'Invoice', 'Payment', 'Customer', 'Bill'] as const;

function resolveAccessToken(credential: string | null): string {
  if (!credential) {
    throw new Error('QuickBooks connection is missing a credential reference.');
  }
  const trimmed = credential.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { access_token?: string; accessToken?: string };
      const token = parsed.access_token ?? parsed.accessToken;
      if (token) return token;
    } catch {
      // fall through — treat as raw token
    }
  }
  return trimmed;
}

function assertSafeBase(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:') {
    throw new Error('QuickBooks baseUrl must be https.');
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'quickbooks.api.intuit.com' ||
    host === 'sandbox-quickbooks.api.intuit.com';
  if (!allowed) {
    throw new Error(`Refusing QuickBooks host: ${host}`);
  }
  return url;
}

function asRecords(entityType: string, rows: unknown[]): ExternalRecord[] {
  return rows.map((row, index) => {
    const obj = (row && typeof row === 'object' ? row : { value: row }) as Record<
      string,
      unknown
    >;
    const id =
      (typeof obj.Id === 'string' && obj.Id) ||
      (typeof obj.id === 'string' && obj.id) ||
      `${entityType}-${index}`;
    const updated =
      (typeof obj.MetaData === 'object' &&
        obj.MetaData &&
        typeof (obj.MetaData as { LastUpdatedTime?: string }).LastUpdatedTime === 'string' &&
        (obj.MetaData as { LastUpdatedTime: string }).LastUpdatedTime) ||
      null;
    return {
      entityType: entityType.toLowerCase(),
      externalId: String(id),
      payload: obj,
      sourceUpdatedAt: updated,
    };
  });
}

export class QuickBooksConnector implements Connector {
  readonly kind = 'quickbooks';

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const realmId = String(ctx.config.realmId ?? '');
    if (!/^\d{1,20}$/.test(realmId)) {
      throw new Error('QuickBooks config.realmId must be a numeric company id.');
    }

    const base = assertSafeBase(String(ctx.config.baseUrl ?? DEFAULT_BASE));
    const minorVersion = String(ctx.config.minorVersion ?? '65');
    const entities = Array.isArray(ctx.config.entities)
      ? (ctx.config.entities as string[])
      : [...DEFAULT_ENTITIES];
    const token = resolveAccessToken(ctx.credential);

    const records: ExternalRecord[] = [];
    let truncated = false;

    for (const entity of entities) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(entity)) {
        throw new Error(`Invalid QuickBooks entity: ${entity}`);
      }
      if (records.length >= ctx.maxRecords) {
        truncated = true;
        break;
      }

      const remaining = ctx.maxRecords - records.length;
      const query = encodeURIComponent(`select * from ${entity} maxresults ${Math.min(100, remaining)}`);
      const url = new URL(
        `/v3/company/${realmId}/query?query=${query}&minorversion=${encodeURIComponent(minorVersion)}`,
        base,
      );

      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        signal: ctx.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `QuickBooks ${entity} fetch failed (${res.status}): ${body.slice(0, 400)}`,
        );
      }

      const json = (await res.json()) as {
        QueryResponse?: Record<string, unknown>;
      };
      const qr = json.QueryResponse ?? {};
      const rows = (qr[entity] as unknown[]) ?? [];
      if (!Array.isArray(rows)) continue;
      records.push(...asRecords(entity, rows));
    }

    return {
      records: records.slice(0, ctx.maxRecords),
      nextCursor: null,
      truncated: truncated || records.length > ctx.maxRecords,
    };
  }
}

export const quickBooksConnector = new QuickBooksConnector();

/**
 * Map a QuickBooks Account payload into our finance_accounts vocabulary.
 * Used by the sync path after a successful fetch.
 */
export function mapQuickBooksAccount(payload: Record<string, unknown>): {
  externalId: string;
  name: string;
  accountType: string;
  balanceCents: number;
} | null {
  const id = payload.Id ?? payload.id;
  const name = payload.Name ?? payload.name;
  if (id == null || name == null) return null;

  const accountTypeRaw = String(payload.AccountType ?? payload.Classification ?? 'Other');
  const lower = accountTypeRaw.toLowerCase();
  let accountType = 'other';
  if (lower.includes('bank') || lower === 'checking') accountType = 'checking';
  else if (lower.includes('saving')) accountType = 'savings';
  else if (lower.includes('credit')) accountType = 'credit_card';
  else if (lower.includes('receivable')) accountType = 'accounts_receivable';
  else if (lower.includes('payable')) accountType = 'accounts_payable';
  else if (lower.includes('income') || lower.includes('revenue')) accountType = 'income';
  else if (lower.includes('expense') || lower.includes('cost')) accountType = 'expense';
  else if (lower.includes('equity')) accountType = 'equity';

  const balance = Number(payload.CurrentBalance ?? payload.CurrentBalanceWithSubAccounts ?? 0);
  return {
    externalId: String(id),
    name: String(name).slice(0, 160),
    accountType,
    balanceCents: Math.round(balance * 100),
  };
}
