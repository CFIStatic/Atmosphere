import type { SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { connectorFor, mapQuickBooksAccount } from './connectors/index.js';
import { finishRun, startRun, step } from './ledger.js';
import * as store from './store.js';
import type { FinanceConnection, FinanceProvider } from './types.js';

/**
 * Pull a finance connection (read-only) and refresh observed account balances.
 *
 * Secrets resolve from the environment the same way CRM integrations do —
 * `ATM_INTEGRATION_<REF>` first, then a bare env name for local dev.
 */

function resolveCredential(credentialRef: string | null): string | null {
  if (!credentialRef) return null;
  if (!/^[A-Z0-9_]{1,64}$/.test(credentialRef)) {
    throw new HttpError(400, 'Invalid credential reference.', 'finance_bad_credential_ref');
  }
  return (
    process.env[`${config.integrations.credentialEnvPrefix}${credentialRef}`] ??
    process.env[credentialRef] ??
    null
  );
}

export async function syncConnection(
  supabase: SupabaseClient,
  orgId: string,
  connection: FinanceConnection,
  userId: string,
): Promise<{
  connection: FinanceConnection;
  records: number;
  accountsUpdated: number;
}> {
  if (connection.accessMode !== 'read_only' && connection.accessMode !== 'draft_writes') {
    throw new HttpError(400, 'Unsupported access mode.', 'finance_bad_access_mode');
  }

  if (connection.accessPath === 'web_access' || connection.accessPath === 'computer_use') {
    throw new HttpError(
      400,
      'This connection uses Web Access or Computer Use. Run the sync from those surfaces; the Financial Agent will read the observed balances afterward.',
      'finance_external_path',
    );
  }

  if (connection.accessPath === 'manual' || connection.provider === 'manual') {
    const updated = await store.updateConnection(supabase, connection.id, orgId, {
      status: 'connected',
      statusDetail: 'Manual connection — update balances on accounts directly.',
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    });
    return { connection: updated, records: 0, accountsUpdated: 0 };
  }

  const connector = connectorFor(connection.provider as FinanceProvider);
  if (!connector) {
    throw new HttpError(
      400,
      `No connector registered for provider ${connection.provider}.`,
      'finance_no_connector',
    );
  }

  const run = await startRun(supabase, {
    orgId,
    title: `Sync ${connection.label}`,
    actorType: 'user',
    actorUserId: userId,
    sourceTable: 'finance_connections',
    sourceId: connection.id,
    input: { provider: connection.provider, accessMode: connection.accessMode },
  });
  const startedAt = Date.now();

  try {
    const credential = resolveCredential(connection.credentialRef);
    if (connection.credentialRef && !credential) {
      throw new HttpError(
        400,
        `Credential ${connection.credentialRef} is not configured on the server.`,
        'finance_credential_missing',
      );
    }

    await step(supabase, run, {
      type: 'tool_call',
      action: 'fetch',
      detail: `Fetching read-only data from ${connection.provider}.`,
      target: connection.label,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.integrations.requestTimeoutMs);
    let result;
    try {
      result = await connector.fetch({
        config: connection.config,
        credential,
        cursor: null,
        maxRecords: Math.min(5_000, config.integrations.maxRecordsPerRun),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    await step(supabase, run, {
      type: 'tool_result',
      action: 'fetch',
      detail: `${result.records.length} record(s) observed${result.truncated ? ' (truncated)' : ''}.`,
      payload: { count: result.records.length, truncated: result.truncated },
    });

    let accountsUpdated = 0;
    if (connection.provider === 'quickbooks') {
      for (const rec of result.records) {
        if (rec.entityType !== 'account') continue;
        const mapped = mapQuickBooksAccount(rec.payload);
        if (!mapped) continue;
        await store.upsertAccountBalance(
          supabase,
          orgId,
          connection.id,
          mapped.externalId,
          mapped.name,
          mapped.accountType,
          mapped.balanceCents,
        );
        accountsUpdated += 1;
      }
    } else {
      // Generic: look for account-shaped payloads with id/name/balance.
      for (const rec of result.records) {
        if (!['account', 'accounts', 'bank_account', 'Account'].includes(rec.entityType)) {
          continue;
        }
        const p = rec.payload;
        const name = String(p.name ?? p.Name ?? p.account_name ?? '');
        if (!name) continue;
        const balance = Number(p.balance ?? p.Balance ?? p.current_balance ?? 0);
        await store.upsertAccountBalance(
          supabase,
          orgId,
          connection.id,
          rec.externalId,
          name.slice(0, 160),
          'checking',
          Math.round(balance * (Math.abs(balance) < 1_000_000 ? 100 : 1)),
        );
        accountsUpdated += 1;
      }
    }

    const updated = await store.updateConnection(supabase, connection.id, orgId, {
      status: 'connected',
      statusDetail: `Last sync observed ${result.records.length} record(s), updated ${accountsUpdated} account(s).`,
      lastSyncAt: new Date().toISOString(),
      lastError: null,
    });

    await finishRun(supabase, run, {
      status: 'succeeded',
      summary: `Synced ${connection.label}: ${result.records.length} records, ${accountsUpdated} accounts.`,
      result: { records: result.records.length, accountsUpdated },
      startedAt,
    });

    return { connection: updated, records: result.records.length, accountsUpdated };
  } catch (err) {
    const message = (err as Error).message;
    await store.updateConnection(supabase, connection.id, orgId, {
      status: 'error',
      lastError: message.slice(0, 4000),
      statusDetail: 'Sync failed. The agent can only report what it can see.',
    }).catch(() => undefined);

    await finishRun(supabase, run, {
      status: 'failed',
      error: message,
      startedAt,
    });

    if (err instanceof HttpError) throw err;
    throw new HttpError(502, message, 'finance_sync_failed');
  }
}
