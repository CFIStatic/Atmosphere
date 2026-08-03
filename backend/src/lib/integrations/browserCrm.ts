import { config } from '../../config.js';
import { createAdminClient } from '../supabase.js';
import type { Connector, ExternalRecord, FetchContext, FetchResult } from './types.js';

/**
 * CRMs with no API, read through a signed-in browser.
 *
 * Some of the software a restoration company actually runs on has no API at
 * all — the smaller vertical CRMs especially. Telling a customer their own
 * data is unreachable because their vendor never shipped an endpoint is not an
 * answer they can use, so this is the fallback: sign in the way a person does,
 * read the pages they would read.
 *
 * It is a fallback and not a default, and the difference matters:
 *
 *   Where a CRM offers OAuth, we use it. A password is the customer's whole
 *   account, it defeats their MFA, and holding one makes us a target. An OAuth
 *   grant is scoped, revocable from their own admin screen, and never tells us
 *   what they typed. Salesforce gets OAuth for exactly that reason.
 *
 *   Where a CRM offers nothing, this holds a credential the customer knowingly
 *   supplied, sealed in the web vault, used only to sign in to the one site
 *   they named. That is a real risk they are accepting deliberately, which is
 *   why the UI says so in those words rather than calling it "connecting".
 *
 * The reading itself runs on the existing Web Access machinery — the same
 * browser, vault and audit trail that already drives carrier portals — so this
 * connector does not open a second way of holding people's passwords. It reads
 * what those runs captured and hands it to the mirror.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

interface BrowserCrmConfig {
  /** The org whose Web Access connection this reads. */
  orgId?: string;
  /** Which stored Web Access connection to use. */
  connectionId?: string;
  /**
   * What kind of record the captured pages hold — 'customer', 'job', 'lead'.
   * The vendor's vocabulary, not ours: the mirror stores verbatim.
   */
  entityType?: string;
}

export class BrowserCrmConnector implements Connector {
  readonly kind = 'browser_crm';

  async fetch(ctx: FetchContext): Promise<FetchResult> {
    const cfg = ctx.config as BrowserCrmConfig;
    if (!cfg.orgId) throw new Error('Browser CRM source config needs the owning orgId.');
    if (!cfg.connectionId) {
      throw new Error(
        'Browser CRM source config needs a connectionId — set up the sign-in under Web access first.',
      );
    }

    const admin = createAdminClient();
    if (!admin) throw new Error('Reading a browser CRM needs SUPABASE_SERVICE_ROLE_KEY.');

    // Runs are performed by Web Access on its own schedule; this connector
    // reads what they captured rather than driving a browser itself. Keeping
    // the two apart means a sync cannot start an unbounded browser session,
    // and every page that produced a record is already in the run's audit
    // trail where somebody can see what was visited.
    const since = ctx.cursor;
    let query = admin
      .from('web_run_records')
      .select('id, external_id, entity_type, payload, captured_at')
      .eq('org_id', cfg.orgId)
      .eq('connection_id', cfg.connectionId)
      .order('captured_at', { ascending: true })
      .limit(Math.min(ctx.maxRecords, 2000));

    if (since) query = query.gt('captured_at', since);

    const { data, error } = await query;
    if (error) {
      throw new Error(`Could not read captured records: ${error.message}`);
    }

    const rows = data ?? [];
    const records: ExternalRecord[] = rows
      .filter((row: any) => row.external_id)
      .map((row: any) => ({
        entityType: String(row.entity_type ?? cfg.entityType ?? 'record'),
        externalId: String(row.external_id),
        payload: (row.payload ?? {}) as Record<string, unknown>,
        sourceUpdatedAt: row.captured_at ?? null,
      }));

    const last = rows.length ? rows[rows.length - 1] : null;

    return {
      records,
      nextCursor: last?.captured_at ?? since ?? null,
      truncated: rows.length >= Math.min(ctx.maxRecords, 2000),
    };
  }
}

/**
 * Which CRMs we know how to reach, and how.
 *
 * Listed so the UI can be specific instead of offering a generic "connect
 * anything" box that works for one vendor and fails silently for the rest.
 * `browser` here is an honest statement that the vendor publishes no API we
 * can use, not a preference.
 */
export const KNOWN_CRMS: Array<{
  id: string;
  name: string;
  method: 'oauth' | 'browser' | 'rest';
  note: string;
}> = [
  {
    id: 'salesforce',
    name: 'Salesforce',
    method: 'oauth',
    note: 'Authorise in Salesforce. We never see your password, MFA keeps working, and you can revoke us from your own admin screen.',
  },
  {
    id: 'luxor',
    name: 'Luxor CRM',
    method: 'browser',
    note: 'No public API we can use, so this signs in the way you do. Your password is encrypted and only ever sent to Luxor.',
  },
  {
    id: 'dash',
    name: 'Dash',
    method: 'browser',
    note: 'Signs in through the browser and reads the pages you would read.',
  },
  {
    id: 'custom_rest',
    name: 'Anything with an API',
    method: 'rest',
    note: 'If your CRM publishes a REST API, point us at it — no browser, no stored password.',
  },
];

export function crmMethod(id: string): 'oauth' | 'browser' | 'rest' | null {
  return KNOWN_CRMS.find((c) => c.id === id)?.method ?? null;
}

export function browserCrmEnabled(): boolean {
  return config.integrations.browserCrmEnabled;
}
