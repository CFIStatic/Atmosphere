/**
 * Seed anonymized Home Depot site playbook for supply ordering.
 *
 * Cross-company, PII-scrubbed (PR #662 rules): no passwords, tokens, customer
 * or job data, emails, estimate figures, or typed field values.
 */
import type { AnonymizedPlaybook } from './sitePlaybooks.js';
import { assertNoPii } from './sitePlaybooks.js';

export const HOME_DEPOT_SITE = 'homedepot.com';
export const HOME_DEPOT_ORDER_TASK_TYPE = 'supply_order';

/** Step patterns Computer may load via loadSharedPlaybook. */
export function homeDepotSupplyOrderPlaybook(): AnonymizedPlaybook {
  const playbook: AnonymizedPlaybook = {
    screens: [
      'home',
      'search_results',
      'product_detail',
      'cart',
      'sign_in',
      'fulfillment_delivery_or_pickup',
      'checkout_review',
      'order_confirmation',
    ],
    selectors: [
      'input[type="search"]',
      'button[type="submit"]',
      '[data-testid="product-pod"]',
      'button:has-text("Add to Cart")',
      'a[href*="/cart"]',
      'button:has-text("Checkout")',
      'button:has-text("Place Order")',
      'button:has-text("Place Your Order")',
    ],
    working_path: [
      'https://www.homedepot.com',
      'https://www.homedepot.com/s/:query',
      'https://www.homedepot.com/p/:slug/:id',
      'https://www.homedepot.com/cart',
      'https://www.homedepot.com/checkout',
    ],
    known_errors: [
      'sign_in_required',
      'two_step_verification',
      'item_out_of_stock',
      'quantity_unavailable',
      'delivery_not_available_to_address',
      'captcha_challenge',
    ],
    recoveries: [
      'call_sign_in_saved_for_homedepot_host',
      'pause_needs_you_for_two_step_or_captcha',
      'flag_out_of_stock_and_offer_substitution_on_approval_card',
      'request_approval_before_place_order_never_skip',
      'reuse_order_fingerprint_to_block_double_approve',
    ],
  };
  assertNoPii(playbook);
  return playbook;
}

/** Compact step list injected into Computer instructions (no PII). */
export function homeDepotOrderStepsForInstructions(): string {
  return [
    'HOME DEPOT PATH (reuse cross-company playbook patterns when available):',
    '1. Open Home Depot home or search.',
    '2. For each material: search, open the best product match, confirm SKU/color, set quantity, Add to Cart.',
    '3. Open cart. Review every line against the materials list.',
    '4. Choose delivery to the job address or store pickup; check stock.',
    '5. Proceed to checkout review. Call request_approval with button_label matching Place Order (or Place Your Order) BEFORE clicking it.',
    '6. Payment uses the card already saved on the account only. Never type, view, or relay card numbers.',
    '7. After an approved Place Order, confirm the confirmation page; call finish with submitted=true. Do not request Place Order approval again for the same cart (server fingerprint blocks double Approve).',
  ].join('\n');
}
