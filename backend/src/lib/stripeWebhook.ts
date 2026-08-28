/**
 * Stripe webhook helpers that must stay honest about failure.
 *
 * Claiming an event id before the handler runs is correct for concurrency.
 * Returning 200 after a silent skip is not: Stripe will not retry, and a
 * later `stripe_event_seen` replay treats the lost payment as done.
 */

export function requireAttributedOrg(
  orgId: string | null | undefined,
  what: string,
): string {
  if (!orgId) {
    throw new Error(`[stripe] ${what} could not be attributed to an org`);
  }
  return orgId;
}

/** Credit Checkout (`mode=payment`) must carry the purchase we opened. */
export function requireCreditPurchaseId(
  mode: string | null | undefined,
  purchaseId: string | null | undefined,
): string | null {
  if (mode !== 'payment') return purchaseId ?? null;
  if (!purchaseId) {
    throw new Error('[stripe] credit checkout is missing purchase_id');
  }
  return purchaseId;
}

export async function claimStripeEvent(
  admin: { rpc: (name: string, args: Record<string, unknown>) => any },
  event: { id: string; type: string },
): Promise<boolean> {
  const { data: isFirst, error } = await admin.rpc('stripe_event_seen', {
    p_event_id: event.id,
    p_type: event.type,
  });
  if (error) throw new Error(`event dedupe failed: ${error.message}`);
  return Boolean(isFirst);
}

/** Undo `stripe_event_seen` so Stripe's 500 retry can apply the event. */
export async function releaseStripeEventClaim(
  admin: { rpc: (name: string, args: Record<string, unknown>) => any },
  eventId: string,
): Promise<void> {
  const { error } = await admin.rpc('stripe_event_forget', { p_event_id: eventId });
  if (error) {
    console.error(`[stripe] could not release claim for ${eventId}:`, error.message);
  }
}
