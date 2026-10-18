/**
 * Stripe Tax and the chest-mount-per-seat rule, shared by every Checkout
 * session and subscription change.
 *
 * Tax: `automatic_tax` is on for every session. Stripe needs a customer
 * address to calculate, so Checkout requires a billing address and saves it
 * (and the name, for tax ids) back to the existing Customer. With no tax
 * registrations Stripe calculates $0, so this is safe before any state is
 * registered. `STRIPE_AUTOMATIC_TAX=off` is the kill switch.
 *
 * Chest mount: every Field Capture seat bought ships with one Field Capture
 * Chest Mount ($99.99, one-time). Platform seats and the Global Admin get
 * none. `STRIPE_CHEST_MOUNT_PER_SEAT=off` turns this off.
 */

import { config } from '../config.js';
import { LIVE_CHEST_MOUNT_PRICE_ID } from './stripeCatalog.js';

/** Where the Chest Mount ships (same as the website Payment Link). */
export const CHEST_MOUNT_SHIPPING_COUNTRIES = ['US', 'CA'] as const;

export function automaticTaxEnabled(): boolean {
  return config.stripe.automaticTax;
}

function isLiveSecretKey(key: string | null | undefined): boolean {
  return /^(sk|rk)_live_/.test(String(key ?? '').trim());
}

/**
 * Chest Mount price id, or null when none applies. The env var wins; the
 * pinned live id is used only with a live secret key, so a test-mode server
 * (staging) never sends a live price id.
 */
export function chestMountPriceId(
  opts: { envPriceId?: string; secretKey?: string; enabled?: boolean } = {},
): string | null {
  const enabled = opts.enabled ?? config.stripe.chestMountPerSeat;
  if (!enabled) return null;
  const fromEnv = (opts.envPriceId ?? config.stripe.chestMountPriceId ?? '').trim();
  if (/^price_[A-Za-z0-9]+$/.test(fromEnv)) return fromEnv;
  return isLiveSecretKey(opts.secretKey ?? config.stripe.secretKey) ? LIVE_CHEST_MOUNT_PRICE_ID : null;
}

/** One Chest Mount per Field Capture seat, as a one-time Checkout line. */
export function chestMountLineItems(
  fieldCaptureSeats: number,
  priceId: string | null = chestMountPriceId(),
): Array<{ price: string; quantity: number }> {
  const n = Number.isFinite(fieldCaptureSeats) ? Math.max(0, Math.floor(fieldCaptureSeats)) : 0;
  if (!priceId || n === 0) return [];
  return [{ price: priceId, quantity: n }];
}

/**
 * Checkout params that let Stripe Tax calculate, plus shipping collection
 * when the session sells a Chest Mount.
 */
export function checkoutTaxParams(opts: { shipsHardware?: boolean; taxEnabled?: boolean } = {}): Record<string, unknown> {
  const tax = opts.taxEnabled ?? automaticTaxEnabled();
  const params: Record<string, unknown> = {};
  if (tax) {
    params.automatic_tax = { enabled: true };
    params.billing_address_collection = 'required';
    params.tax_id_collection = { enabled: true };
  }
  const customerUpdate: Record<string, string> = {};
  if (tax) {
    customerUpdate.address = 'auto';
    customerUpdate.name = 'auto';
  }
  if (opts.shipsHardware) {
    params.shipping_address_collection = { allowed_countries: [...CHEST_MOUNT_SHIPPING_COUNTRIES] };
    customerUpdate.shipping = 'auto';
  }
  if (Object.keys(customerUpdate).length > 0) params.customer_update = customerUpdate;
  return params;
}

/**
 * Plan / seat Checkout line items with N Chest Mounts for N Field Capture
 * seats, plus the matching tax and shipping params.
 */
export function withChestMounts(
  lineItems: Array<{ price: string; quantity: number }>,
  fieldCaptureSeats: number,
  priceId: string | null = chestMountPriceId(),
): { line_items: Array<{ price: string; quantity: number }>; [key: string]: unknown } {
  const mounts = chestMountLineItems(fieldCaptureSeats, priceId);
  return {
    line_items: [...lineItems, ...mounts],
    ...checkoutTaxParams({ shipsHardware: mounts.length > 0 }),
  };
}

/** The slice of the Stripe client used to turn on tax for an existing subscription. */
export interface AutomaticTaxStripe {
  subscriptions: {
    update(id: string, params: Record<string, unknown>, opts?: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * Turn on Stripe Tax for a subscription created before automatic_tax. Best
 * effort: a customer with no address on file makes Stripe refuse; the seat
 * change still goes through untaxed and a warning is logged.
 */
export async function ensureSubscriptionAutomaticTax(
  stripe: AutomaticTaxStripe,
  subscriptionId: string,
  sub: { automatic_tax?: { enabled?: boolean | null } | null } | null | undefined,
  opts: { taxEnabled?: boolean } = {},
): Promise<'already' | 'enabled' | 'skipped' | 'failed'> {
  if (!(opts.taxEnabled ?? automaticTaxEnabled())) return 'skipped';
  if (sub?.automatic_tax?.enabled) return 'already';
  try {
    await stripe.subscriptions.update(subscriptionId, { automatic_tax: { enabled: true } });
    return 'enabled';
  } catch (err) {
    console.warn(
      `[stripe] automatic_tax not enabled on ${subscriptionId}:`,
      err instanceof Error ? err.message : err,
    );
    return 'failed';
  }
}
