/**
 * Procurement: dumpster bids via web search, material orders via Atmosphere
 * referral links (Home Depot, Lowe's, ABC Supply, …).
 *
 * Nothing here places an order. Bids are collected; referral URLs are minted;
 * irreversible steps become pm_approvals for the human PM.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '../../lib/errors.js';
import * as orch from './store.js';
import type { ProcurementBid, ProcurementRequest, VendorReferral } from './types.js';

/** Prefer an org override of a vendor; fall back to the Atmosphere catalogue. */
export function pickReferral(
  referrals: VendorReferral[],
  vendorKey: string,
  orgId: string,
): VendorReferral | null {
  const orgHit = referrals.find((r) => r.vendorKey === vendorKey && r.orgId === orgId);
  if (orgHit) return orgHit;
  return referrals.find((r) => r.vendorKey === vendorKey && r.orgId === null) ?? null;
}

/**
 * Build an Atmosphere referral deep link.
 *
 * `{q}` `{sku}` `{zip}` `{ref}` are substituted. The referral code is what
 * earns Atmosphere its cut at the vendor.
 */
export function buildReferralUrl(
  vendor: VendorReferral,
  opts: { query?: string; sku?: string; zip?: string; orgSlug?: string },
): string {
  const ref = opts.orgSlug
    ? `${vendor.atmosphereRefCode}-${opts.orgSlug}`
    : vendor.atmosphereRefCode;
  return vendor.linkTemplate
    .replaceAll('{q}', encodeURIComponent(opts.query ?? ''))
    .replaceAll('{sku}', encodeURIComponent(opts.sku ?? ''))
    .replaceAll('{zip}', encodeURIComponent(opts.zip ?? ''))
    .replaceAll('{ref}', encodeURIComponent(ref));
}

export interface DumpsterBidCandidate {
  vendorName: string;
  vendorUrl?: string | null;
  vendorPhone?: string | null;
  amountCents?: number | null;
  leadDays?: number | null;
  notes?: string | null;
  source?: 'web_search' | 'manual' | 'referral' | 'api';
  raw?: Record<string, unknown>;
}

/**
 * Search the web for dumpster / roll-off bids near a job.
 *
 * Without an external search key we return a structured shortlist the PM can
 * edit — better a transparent placeholder than a silent failure. When
 * `PM_WEB_SEARCH_URL` is configured the same shape is filled from the response.
 */
export async function searchDumpsterBids(input: {
  postal?: string | null;
  address?: string | null;
  sizeHint?: string | null;
  searchUrl?: string;
}): Promise<DumpsterBidCandidate[]> {
  const where = input.postal || input.address || 'local';
  const size = input.sizeHint || '20 yard';
  const query = `${size} dumpster rental ${where}`;

  if (input.searchUrl) {
    try {
      const url = input.searchUrl
        .replaceAll('{q}', encodeURIComponent(query))
        .replaceAll('{zip}', encodeURIComponent(input.postal ?? ''));
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { results?: DumpsterBidCandidate[] };
        if (Array.isArray(body.results) && body.results.length) {
          return body.results.slice(0, 8).map((r) => ({
            vendorName: r.vendorName,
            vendorUrl: r.vendorUrl ?? null,
            vendorPhone: r.vendorPhone ?? null,
            amountCents: r.amountCents ?? null,
            leadDays: r.leadDays ?? null,
            notes: r.notes ?? null,
            source: 'web_search' as const,
            raw: (r.raw ?? r) as Record<string, unknown>,
          }));
        }
      }
    } catch {
      // Fall through to the deterministic shortlist.
    }
  }

  // Deterministic local shortlist so the feature works offline / without a key.
  // Amounts are illustrative nulls — the PM confirms real quotes before approval.
  return [
    {
      vendorName: `Local roll-off near ${where}`,
      vendorUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
      amountCents: null,
      leadDays: 1,
      notes: `Search: ${query}. Confirm price and availability before approving.`,
      source: 'web_search',
      raw: { query, placeholder: true },
    },
    {
      vendorName: 'Waste Management',
      vendorUrl: 'https://www.wm.com/us/en/home/order-dumpster',
      amountCents: null,
      leadDays: 2,
      notes: `${size} dumpster — request a quote for ${where}.`,
      source: 'web_search',
      raw: { query, national: true },
    },
    {
      vendorName: 'Dumpsters.com marketplace',
      vendorUrl: `https://www.dumpsters.com/dumpster-rentals?q=${encodeURIComponent(where)}`,
      amountCents: null,
      leadDays: 1,
      notes: 'Marketplace — compare multiple haulers, then file the chosen bid here.',
      source: 'web_search',
      raw: { query, marketplace: true },
    },
  ];
}

export async function openDumpsterProcurement(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    projectId: string;
    planItemId?: string | null;
    title?: string;
    description?: string | null;
    postal?: string | null;
    address?: string | null;
    sizeHint?: string | null;
    searchUrl?: string;
  },
): Promise<{ request: ProcurementRequest; bids: ProcurementBid[] }> {
  const request = await orch.createProcurementRequest(supabase, orgId, {
    project_id: input.projectId,
    plan_item_id: input.planItemId ?? null,
    kind: 'dumpster',
    title: input.title ?? 'Dumpster / roll-off',
    description: input.description ?? input.sizeHint ?? null,
    quantity: 1,
    unit: 'ea',
    ship_to_postal: input.postal ?? null,
    ship_to_address: input.address ?? null,
    status: 'bidding',
    created_by: userId,
  });

  const candidates = await searchDumpsterBids({
    postal: input.postal,
    address: input.address,
    sizeHint: input.sizeHint,
    searchUrl: input.searchUrl,
  });

  const bids = await orch.insertBids(
    supabase,
    orgId,
    candidates.map((c) => ({
      request_id: request.id,
      project_id: input.projectId,
      vendor_name: c.vendorName,
      vendor_url: c.vendorUrl ?? null,
      vendor_phone: c.vendorPhone ?? null,
      amount_cents: c.amountCents ?? null,
      lead_days: c.leadDays ?? null,
      notes: c.notes ?? null,
      source: c.source ?? 'web_search',
      status: 'collected',
      raw: c.raw ?? {},
    })),
  );

  return { request, bids };
}

export async function openMaterialReferralOrder(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: {
    projectId: string;
    planItemId?: string | null;
    vendorKey: string;
    title: string;
    query: string;
    postal?: string | null;
    address?: string | null;
    orgSlug?: string;
  },
): Promise<{ request: ProcurementRequest; approvalId: string }> {
  const referrals = await orch.listReferrals(supabase, orgId);
  const vendor = pickReferral(referrals, input.vendorKey, orgId);
  if (!vendor) {
    throw new HttpError(404, `Unknown referral vendor: ${input.vendorKey}`, 'pm_referral_unknown');
  }

  const referralUrl = buildReferralUrl(vendor, {
    query: input.query,
    zip: input.postal ?? undefined,
    orgSlug: input.orgSlug,
  });

  const approval = await orch.createApproval(supabase, orgId, {
    project_id: input.projectId,
    kind: 'material_referral_order',
    title: `Order materials via ${vendor.name}`,
    detail: `${input.title}\n\nReferral link (Atmosphere cut ${vendor.commissionBps / 100}%):\n${referralUrl}`,
    proposed_action: {
      type: 'open_referral',
      vendorKey: vendor.vendorKey,
      referralUrl,
      commissionBps: vendor.commissionBps,
      query: input.query,
    },
    platform: 'referral',
    priority: 'normal',
    requested_by: userId,
    source_ref: input.planItemId ?? null,
  });

  const request = await orch.createProcurementRequest(supabase, orgId, {
    project_id: input.projectId,
    plan_item_id: input.planItemId ?? null,
    kind: 'material',
    title: input.title,
    description: `Order via ${vendor.name} referral`,
    ship_to_postal: input.postal ?? null,
    ship_to_address: input.address ?? null,
    status: 'awaiting_approval',
    referral_vendor_key: vendor.vendorKey,
    referral_url: referralUrl,
    approval_id: approval.id,
    created_by: userId,
  });

  return { request, approvalId: approval.id };
}

export async function selectBidForApproval(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  input: { requestId: string; bidId: string },
): Promise<{ request: ProcurementRequest; approvalId: string }> {
  const bids = await orch.listBids(supabase, input.requestId);
  const bid = bids.find((b) => b.id === input.bidId);
  if (!bid) throw new HttpError(404, 'Bid not found.', 'pm_bid_not_found');

  const requests = await orch.listProcurement(supabase, orgId, { limit: 500 });
  const request = requests.find((r) => r.id === input.requestId);
  if (!request) throw new HttpError(404, 'Procurement request not found.', 'pm_procurement_not_found');

  await orch.updateBid(supabase, bid.id, { status: 'shortlisted' });

  const amount =
    bid.amountCents != null ? `$${(bid.amountCents / 100).toFixed(2)}` : 'price TBD';
  const approval = await orch.createApproval(supabase, orgId, {
    project_id: request.projectId,
    kind: 'accept_procurement_bid',
    title: `Accept bid from ${bid.vendorName}`,
    detail: `${request.title} — ${amount}${bid.leadDays != null ? `, ${bid.leadDays} day lead` : ''}.\n${bid.notes ?? ''}`,
    proposed_action: {
      type: 'accept_bid',
      requestId: request.id,
      bidId: bid.id,
      vendorName: bid.vendorName,
      amountCents: bid.amountCents,
    },
    platform: 'web',
    priority: 'high',
    requested_by: userId,
    source_ref: request.id,
  });

  const updated = await orch.updateProcurementRequest(supabase, request.id, {
    status: 'awaiting_approval',
    selected_bid_id: bid.id,
    approval_id: approval.id,
  });

  return { request: updated, approvalId: approval.id };
}
