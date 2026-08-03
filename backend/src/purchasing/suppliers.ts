import { seal, open, type SealedGrant } from '../lib/integrations/oauthVault.js';
import { createAdminClient } from '../lib/supabase.js';

/**
 * The supplier port.
 *
 * Ordering goes through a store's API when one is connected, and the shape of
 * that API is not ours to invent — Home Depot's and Lowe's contracts are
 * pending from the customer, and until they arrive the adapters refuse
 * loudly rather than pretend. What is settled now, and does not depend on any
 * vendor's documentation, is the seam: an approved order goes in, an order
 * reference comes out, and nothing is ever placed through this interface
 * without the approval trigger having already run in the database.
 *
 * 'manual' is deliberately not an adapter. Ordering by phone, at the pro
 * desk, or on a store account outside the API is the common case on day one,
 * and it needs a *recording* path, not a placement path — the route handles
 * it by stamping the reference the person brings back.
 */

export type SupplierId = 'home_depot' | 'lowes';

export const SUPPLIERS: Array<{ id: SupplierId; label: string }> = [
  { id: 'home_depot', label: 'The Home Depot' },
  { id: 'lowes', label: "Lowe's" },
];

export interface PlacedOrder {
  /** The supplier's own order number. */
  externalRef: string;
}

export interface OrderToPlace {
  poId: string;
  lines: Array<{ description: string; detail: string | null; quantity: number; unit: string }>;
  /** Free-text delivery note; job-site addresses live in the job record. */
  note: string | null;
}

export interface SupplierAdapter {
  id: SupplierId;
  label: string;
  place(credential: Record<string, string>, order: OrderToPlace): Promise<PlacedOrder>;
}

/**
 * Both adapters share one honest failure until the real API contracts arrive.
 * The error text names the fix (connect / await integration), because this
 * message is what the person placing the order actually reads.
 */
const pendingIntegration = (label: string): SupplierAdapter['place'] => {
  return async () => {
    throw new SupplierError(
      `${label} ordering is not live yet — the API integration is pending. ` +
        `Place the order on your ${label} Pro account and record the order number here instead.`,
    );
  };
};

export class SupplierError extends Error {}

export const ADAPTERS: Record<SupplierId, SupplierAdapter> = {
  home_depot: {
    id: 'home_depot',
    label: 'The Home Depot',
    place: pendingIntegration('The Home Depot'),
  },
  lowes: {
    id: 'lowes',
    label: "Lowe's",
    place: pendingIntegration("Lowe's"),
  },
};

/* ------------------------------------------------------------------ *
 * Connections
 *
 * Sealed with the same vault the CRM grants use — one environment key,
 * one discipline. The payload is an opaque bag of fields because each
 * supplier's API will demand its own set, and the schema should not have
 * to change when Home Depot's documentation arrives.
 * ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) throw new Error('Supplier connections need SUPABASE_SERVICE_ROLE_KEY.');
  return admin;
}

export async function saveSupplierConnection(input: {
  orgId: string;
  userId: string;
  supplier: SupplierId;
  fields: Record<string, string>;
  accountLabel: string | null;
}): Promise<void> {
  const sealed = seal(JSON.stringify(input.fields));
  const admin = adminOrThrow();
  const { error } = await admin.from('supplier_connections').upsert(
    {
      org_id: input.orgId,
      supplier: input.supplier,
      iv: sealed.iv,
      tag: sealed.tag,
      ciphertext: sealed.ciphertext,
      account_label: input.accountLabel,
      connected_by: input.userId,
      connected_at: new Date().toISOString(),
    },
    { onConflict: 'org_id,supplier' },
  );
  if (error) throw new Error(error.message);
}

export async function loadSupplierConnection(
  orgId: string,
  supplier: SupplierId,
): Promise<Record<string, string> | null> {
  const admin = adminOrThrow();
  const { data, error } = await admin
    .from('supplier_connections')
    .select('iv, tag, ciphertext')
    .eq('org_id', orgId)
    .eq('supplier', supplier)
    .maybeSingle();
  if (error || !data) return null;
  try {
    return JSON.parse(open(data as SealedGrant));
  } catch {
    // Undecryptable is disconnected — the same rule as the CRM vault.
    return null;
  }
}

/** What the UI may know: which stores are connected, as whom, since when. */
export async function listSupplierConnections(orgId: string): Promise<
  Array<{ supplier: SupplierId; accountLabel: string | null; connectedAt: string }>
> {
  const admin = adminOrThrow();
  const { data } = await admin
    .from('supplier_connections')
    .select('supplier, account_label, connected_at')
    .eq('org_id', orgId);
  return (data ?? []).map((row: any) => ({
    supplier: row.supplier,
    accountLabel: row.account_label,
    connectedAt: row.connected_at,
  }));
}

export async function deleteSupplierConnection(orgId: string, supplier: SupplierId): Promise<void> {
  const admin = adminOrThrow();
  await admin.from('supplier_connections').delete().eq('org_id', orgId).eq('supplier', supplier);
}
