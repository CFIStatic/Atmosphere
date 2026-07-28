/**
 * Push data into a connected CRM.
 *
 * Supports notes / activities / tasks / contacts. Named systems get tailored
 * payloads; the generic REST path POSTs JSON to a configured write path.
 * Sandbox mode records a successful push without calling a vendor.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntegrationSecret } from './credentials.js';

export interface PushInput {
  operation: 'create_note' | 'create_task' | 'create_contact' | 'update_contact';
  entityType?: string;
  externalId?: string;
  /** Atmosphere-side ids for context. */
  contactId?: string;
  subject?: string;
  body?: string;
  /** Extra fields for create_contact / update_contact. */
  fields?: Record<string, unknown>;
}

export interface PushResult {
  status: 'succeeded' | 'failed' | 'sandbox';
  externalId?: string;
  response?: unknown;
  error?: string;
  runId: string;
}

function assertSafeUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error(`Refusing to call a private address: ${host}`);
  return url;
}

async function httpJson(
  url: string,
  options: {
    method: string;
    token?: string | null;
    authHeader?: string;
    body?: unknown;
    basic?: string | null;
  },
): Promise<{ ok: boolean; status: number; json: unknown }> {
  assertSafeUrl(url);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (options.token) {
    const header = options.authHeader || 'Authorization';
    headers[header] = options.token.startsWith('Bearer ')
      ? options.token
      : `Bearer ${options.token}`;
  } else if (options.basic) {
    headers.Authorization = `Basic ${options.basic}`;
  }

  const res = await fetch(url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export async function pushToCrm(params: {
  admin: SupabaseClient;
  orgId: string;
  sourceId: string;
  userId: string;
  system: string;
  config: Record<string, unknown>;
  secret: IntegrationSecret | null;
  token: string | null;
  input: PushInput;
}): Promise<PushResult> {
  const { data: run, error: runErr } = await params.admin
    .from('crm_push_runs')
    .insert({
      org_id: params.orgId,
      source_id: params.sourceId,
      status: 'running',
      operation: params.input.operation,
      entity_type: params.input.entityType ?? null,
      external_id: params.input.externalId ?? null,
      request_summary: {
        operation: params.input.operation,
        subject: params.input.subject,
        hasBody: Boolean(params.input.body),
        fields: params.input.fields ? Object.keys(params.input.fields) : [],
      },
      started_by: params.userId,
    })
    .select('id')
    .single();

  if (runErr || !run) throw new Error(`Could not open push run: ${runErr?.message ?? 'unknown'}`);
  const runId = run.id as string;

  try {
    const sandbox = Boolean(params.config.sandbox) || (!params.secret && !params.token);

    if (sandbox) {
      const externalId =
        params.input.externalId ||
        `sandbox-${params.input.operation}-${Date.now().toString(36)}`;

      await params.admin
        .from('crm_push_runs')
        .update({
          status: 'succeeded',
          finished_at: new Date().toISOString(),
          external_id: externalId,
          response_summary: { sandbox: true, externalId },
        })
        .eq('id', runId);

      return { status: 'sandbox', externalId, runId, response: { sandbox: true } };
    }

    const baseUrl = String(
      params.secret?.instanceUrl ||
        params.secret?.baseUrl ||
        params.config.baseUrl ||
        '',
    ).replace(/\/$/, '');

    if (!baseUrl) throw new Error('No base URL configured for this CRM connection.');

    let result: { ok: boolean; status: number; json: unknown };

    if (params.system === 'salesforce') {
      result = await pushSalesforce(baseUrl, params.token, params.input);
    } else if (params.system === 'hubspot') {
      result = await pushHubspot(baseUrl, params.token, params.input);
    } else if (params.system === 'jobnimbus') {
      result = await pushJobNimbus(baseUrl, params.token, params.input);
    } else {
      // Dash, Luxor, Encircle, generic REST — POST to configured write paths.
      result = await pushGenericRest(baseUrl, params.token, params.config, params.input);
    }

    if (!result.ok) {
      const message =
        (result.json as { message?: string; error?: string })?.message ||
        (result.json as { error?: string })?.error ||
        `Push failed (${result.status})`;

      await params.admin
        .from('crm_push_runs')
        .update({
          status: 'failed',
          finished_at: new Date().toISOString(),
          error: message,
          response_summary: result.json as object,
        })
        .eq('id', runId);

      return { status: 'failed', error: message, runId, response: result.json };
    }

    const externalId =
      (result.json as { id?: string; Id?: string; jnid?: string })?.id ||
      (result.json as { Id?: string })?.Id ||
      (result.json as { jnid?: string })?.jnid ||
      params.input.externalId ||
      undefined;

    await params.admin
      .from('crm_push_runs')
      .update({
        status: 'succeeded',
        finished_at: new Date().toISOString(),
        external_id: externalId ?? null,
        response_summary: result.json as object,
      })
      .eq('id', runId);

    return { status: 'succeeded', externalId, runId, response: result.json };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await params.admin
      .from('crm_push_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: message,
      })
      .eq('id', runId);
    return { status: 'failed', error: message, runId };
  }
}

async function pushSalesforce(baseUrl: string, token: string | null, input: PushInput) {
  if (input.operation === 'create_note' || input.operation === 'create_task') {
    return httpJson(`${baseUrl}/services/data/v59.0/sobjects/Task`, {
      method: 'POST',
      token,
      body: {
        Subject: input.subject || 'Atmosphere follow-up',
        Description: input.body || '',
        Status: 'Completed',
        WhoId: input.externalId || undefined,
      },
    });
  }

  if (input.operation === 'create_contact') {
    return httpJson(`${baseUrl}/services/data/v59.0/sobjects/Contact`, {
      method: 'POST',
      token,
      body: {
        FirstName: input.fields?.firstName,
        LastName: input.fields?.lastName || 'Unknown',
        Email: input.fields?.email,
        Phone: input.fields?.phone,
      },
    });
  }

  if (input.operation === 'update_contact' && input.externalId) {
    return httpJson(`${baseUrl}/services/data/v59.0/sobjects/Contact/${input.externalId}`, {
      method: 'PATCH',
      token,
      body: input.fields ?? {},
    });
  }

  throw new Error(`Unsupported Salesforce operation: ${input.operation}`);
}

async function pushHubspot(baseUrl: string, token: string | null, input: PushInput) {
  if (input.operation === 'create_note') {
    return httpJson(`${baseUrl}/crm/v3/objects/notes`, {
      method: 'POST',
      token,
      body: {
        properties: {
          hs_note_body: input.body || input.subject || '',
          hs_timestamp: Date.now().toString(),
        },
        associations: input.externalId
          ? [
              {
                to: { id: input.externalId },
                types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
              },
            ]
          : [],
      },
    });
  }

  if (input.operation === 'create_contact') {
    return httpJson(`${baseUrl}/crm/v3/objects/contacts`, {
      method: 'POST',
      token,
      body: {
        properties: {
          firstname: input.fields?.firstName,
          lastname: input.fields?.lastName,
          email: input.fields?.email,
          phone: input.fields?.phone,
        },
      },
    });
  }

  throw new Error(`Unsupported HubSpot operation: ${input.operation}`);
}

async function pushJobNimbus(baseUrl: string, token: string | null, input: PushInput) {
  const authToken = token?.startsWith('Bearer ') ? token : `Bearer ${token}`;

  if (input.operation === 'create_note') {
    return httpJson(`${baseUrl}/activities`, {
      method: 'POST',
      token: authToken,
      authHeader: 'Authorization',
      body: {
        record_type: 3,
        primary: { id: input.externalId },
        note: input.body || input.subject || '',
      },
    });
  }

  if (input.operation === 'create_contact') {
    return httpJson(`${baseUrl}/contacts`, {
      method: 'POST',
      token: authToken,
      authHeader: 'Authorization',
      body: {
        first_name: input.fields?.firstName,
        last_name: input.fields?.lastName,
        email: input.fields?.email,
        home_phone: input.fields?.phone,
      },
    });
  }

  throw new Error(`Unsupported JobNimbus operation: ${input.operation}`);
}

async function pushGenericRest(
  baseUrl: string,
  token: string | null,
  config: Record<string, unknown>,
  input: PushInput,
) {
  const writePaths = (config.writePaths as Record<string, string> | undefined) ?? {
    create_note: '/notes',
    create_task: '/tasks',
    create_contact: '/contacts',
    update_contact: '/contacts',
  };

  const path = writePaths[input.operation];
  if (!path) throw new Error(`No write path configured for ${input.operation}`);

  if (input.operation === 'update_contact') {
    if (!input.externalId) throw new Error('update_contact needs an externalId');
    return httpJson(`${baseUrl}${path}/${encodeURIComponent(input.externalId)}`, {
      method: 'PATCH',
      token,
      body: input.fields ?? { subject: input.subject, body: input.body },
    });
  }

  return httpJson(`${baseUrl}${path}`, {
    method: 'POST',
    token,
    body: {
      externalId: input.externalId,
      subject: input.subject,
      body: input.body,
      ...(input.fields ?? {}),
    },
  });
}
