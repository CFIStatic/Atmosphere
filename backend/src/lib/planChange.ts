import { badRequest } from './errors.js';
import {
  isExtraSeatLineItem,
  recurringIntervalFromSubscription,
  type AtmosphereBillingInterval,
} from './stripe.js';

type PlanPrice = {
  id?: string;
  recurring?: { interval?: string | null } | null;
  metadata?: { atmosphere_plan_code?: string } | null;
};

export type PlanSubscriptionItem = {
  id: string;
  price?: PlanPrice | string | null;
  quantity?: number | null;
};

export type PlanSubscription = {
  metadata?: { billing_interval?: string; atmosphere_interval?: string } | null;
  items?: { data?: PlanSubscriptionItem[] };
};

/** Keep the subscription's current term. A yearly plan stays yearly. */
export function planChangeInterval(sub: PlanSubscription): AtmosphereBillingInterval {
  return recurringIntervalFromSubscription(sub);
}

/**
 * Replace only the plan price on an existing subscription. Seat items are
 * omitted, so Stripe leaves them and their quantities in place. Proration
 * invoices the difference on the current period.
 */
export function planItemUpdateParams(
  items: PlanSubscriptionItem[],
  nextPriceId: string,
): { items: Array<{ id: string; price: string }>; proration_behavior: 'create_prorations' } {
  const plan = items.find((item) => item.id && !isExtraSeatLineItem(item));
  if (!plan?.id) {
    throw badRequest('This subscription has no plan item to change.', 'plan_item_missing');
  }
  return {
    items: [{ id: plan.id, price: nextPriceId }],
    proration_behavior: 'create_prorations',
  };
}
