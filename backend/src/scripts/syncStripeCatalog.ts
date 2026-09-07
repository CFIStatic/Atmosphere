#!/usr/bin/env tsx
/**
 * Create (or reuse) Stripe Products + Prices for every paid Atmosphere plan
 * and the Work Verification metering subscription, then print the SQL / env
 * that links those price ids into the catalogs.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npm run stripe:sync
 *
 * Safe to re-run: products are looked up by metadata `atmosphere_plan_code`,
 * and prices by `atmosphere_plan_code` + `atmosphere_interval`. Existing price
 * ids are reused rather than creating duplicates.
 *
 * Does not write to Supabase itself — apply the printed UPDATE statements
 * (or paste them into the SQL editor) after reviewing.
 */

import 'dotenv/config';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import {
  EXTRA_FC_SEAT_DESCRIPTION,
  EXTRA_FC_SEAT_MONTHLY_CENTS,
  FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE,
  LIVE_CHEST_MOUNT_PAYMENT_LINK,
  LIVE_CHEST_MOUNT_PRICE_ID,
  LIVE_EXTRA_FC_SEAT_PRICE_ID,
  LIVE_EXTRA_FC_SEAT_PRODUCT_ID,
  LIVE_WORK_VERIFICATION_PRICE_ID,
  LIVE_WORK_VERIFICATION_PRODUCT_ID,
  WORK_VERIFICATION_DESCRIPTION,
  WORK_VERIFICATION_MONTHLY_CENTS,
  WORK_VERIFICATION_PLAN_CODE,
} from '../lib/stripeCatalog.js';

type PlanRow = {
  code: string;
  name: string;
  tagline: string | null;
  monthly_price_cents: number;
  annual_price_cents: number | null;
  per_seat: boolean;
  is_contact_sales: boolean;
  stripe_price_id_monthly: string | null;
  stripe_price_id_annual: string | null;
};

/** Seeded Work Verification metering plan — $599/mo, 3 included Field Capture seats. */
const WORK_VERIFICATION = {
  code: WORK_VERIFICATION_PLAN_CODE,
  name: 'Work Verification',
  description: WORK_VERIFICATION_DESCRIPTION,
  monthlyPriceCents: WORK_VERIFICATION_MONTHLY_CENTS,
  knownProductId: LIVE_WORK_VERIFICATION_PRODUCT_ID,
  knownPriceId: LIVE_WORK_VERIFICATION_PRICE_ID,
} as const;

const EXTRA_FC_SEAT = {
  code: FIELD_CAPTURE_EXTRA_SEAT_PLAN_CODE,
  name: 'Field Capture extra seat',
  description: EXTRA_FC_SEAT_DESCRIPTION,
  monthlyPriceCents: EXTRA_FC_SEAT_MONTHLY_CENTS,
  knownProductId: LIVE_EXTRA_FC_SEAT_PRODUCT_ID,
  knownPriceId: LIVE_EXTRA_FC_SEAT_PRICE_ID,
} as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set it and re-run.`);
    process.exit(1);
  }
  return value;
}

async function findProduct(
  stripe: Stripe,
  planCode: string,
  knownId?: string,
): Promise<Stripe.Product | null> {
  const listed = await stripe.products.search({
    query: `metadata["atmosphere_plan_code"]:"${planCode}"`,
    limit: 1,
  });
  if (listed.data[0]) return listed.data[0];
  if (!knownId) return null;
  try {
    return await stripe.products.retrieve(knownId);
  } catch {
    return null;
  }
}

async function findPrice(
  stripe: Stripe,
  planCode: string,
  interval: 'month' | 'year',
  knownId?: string,
): Promise<Stripe.Price | null> {
  const listed = await stripe.prices.search({
    query: `metadata["atmosphere_plan_code"]:"${planCode}" AND metadata["atmosphere_interval"]:"${interval}" AND active:"true"`,
    limit: 1,
  });
  if (listed.data[0]) return listed.data[0];
  if (!knownId) return null;
  try {
    return await stripe.prices.retrieve(knownId);
  } catch {
    return null;
  }
}

async function ensureRecurringPrice(
  stripe: Stripe,
  productId: string,
  planCode: string,
  planName: string,
  interval: 'month' | 'year',
  unitAmount: number,
  knownPriceId?: string,
): Promise<Stripe.Price> {
  const existing = await findPrice(stripe, planCode, interval, knownPriceId);
  if (existing) {
    if (existing.unit_amount === unitAmount && existing.product === productId) {
      const meta = existing.metadata ?? {};
      if (meta.atmosphere_plan_code !== planCode || meta.atmosphere_interval !== interval) {
        await stripe.prices.update(existing.id, {
          metadata: {
            ...meta,
            atmosphere_plan_code: planCode,
            atmosphere_interval: interval,
          },
        });
      }
      return existing;
    }
    // Amount changed: archive the old price and create a replacement. Stripe
    // prices are immutable on amount. Never archive a pinned live catalog id.
    if (existing.id !== knownPriceId) {
      await stripe.prices.update(existing.id, { active: false });
    } else {
      console.warn(
        `    ${planCode}: known price ${existing.id} amount/product differs; leaving it in place.`,
      );
      return existing;
    }
  }

  return stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval },
    nickname: `${planName} (${interval === 'month' ? 'monthly' : 'annual'})`,
    metadata: {
      atmosphere_plan_code: planCode,
      atmosphere_interval: interval,
    },
  });
}

async function ensureProduct(
  stripe: Stripe,
  opts: {
    code: string;
    name: string;
    description?: string | null;
    metadata?: Record<string, string>;
    knownProductId?: string;
  },
): Promise<Stripe.Product> {
  const existing = await findProduct(stripe, opts.code, opts.knownProductId);
  if (existing) {
    if (opts.description && existing.description !== opts.description) {
      await stripe.products.update(existing.id, {
        description: opts.description,
        metadata: {
          ...(existing.metadata ?? {}),
          atmosphere_plan_code: opts.code,
          ...(opts.metadata ?? {}),
        },
      });
    }
    console.log(`· ${opts.code}: reusing product ${existing.id}`);
    return existing;
  }
  const product = await stripe.products.create({
    name: opts.name,
    description: opts.description ?? undefined,
    metadata: {
      atmosphere_plan_code: opts.code,
      ...(opts.metadata ?? {}),
    },
  });
  console.log(`· ${opts.code}: created product ${product.id}`);
  return product;
}

async function main() {
  const secretKey = requireEnv('STRIPE_SECRET_KEY');
  if (secretKey.startsWith('pk_')) {
    console.error('STRIPE_SECRET_KEY must be a secret or restricted key (sk_… / rk_…), not pk_…');
    process.exit(1);
  }
  if (secretKey.startsWith('sk_live_') || secretKey.startsWith('rk_live_')) {
    console.warn('Warning: using a LIVE Stripe key. Prefer sk_test_… until go-live.\n');
  }

  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

  const stripe = new Stripe(secretKey);
  const updates: string[] = [];
  let onboardingPriceId: string | null = null;

  // --- Work Verification metering (signup onboarding) --------------------
  console.log('Syncing Work Verification metering plan…\n');
  {
    const product = await ensureProduct(stripe, {
      code: WORK_VERIFICATION.code,
      name: `Atmosphere ${WORK_VERIFICATION.name}`,
      description: WORK_VERIFICATION.description,
      metadata: { catalog: 'metering', atmosphere_included_fc_seats: '3' },
      knownProductId: WORK_VERIFICATION.knownProductId,
    });
    const monthly = await ensureRecurringPrice(
      stripe,
      product.id,
      WORK_VERIFICATION.code,
      WORK_VERIFICATION.name,
      'month',
      WORK_VERIFICATION.monthlyPriceCents,
      WORK_VERIFICATION.knownPriceId,
    );
    onboardingPriceId = monthly.id;
    console.log(
      `    monthly → ${monthly.id} ($${(WORK_VERIFICATION.monthlyPriceCents / 100).toFixed(2)})`,
    );

    updates.push(
      `-- Work Verification onboarding / metering\n` +
        `update public.metering_plan_versions\n` +
        `   set stripe_price_id = '${monthly.id}'\n` +
        ` where id = (\n` +
        `   select pv.id\n` +
        `     from public.metering_plan_versions pv\n` +
        `     join public.metering_plans p on p.id = pv.plan_id\n` +
        `    where p.code = 'work_verification' and pv.effective_to is null\n` +
        `    order by pv.version desc\n` +
        `    limit 1\n` +
        ` );`,
    );
  }

  // --- Extra Field Capture seats ($100/mo each beyond the 3 included) ----
  console.log('\nSyncing extra Field Capture seats…\n');
  {
    const product = await ensureProduct(stripe, {
      code: EXTRA_FC_SEAT.code,
      name: `Atmosphere ${EXTRA_FC_SEAT.name}`,
      description: EXTRA_FC_SEAT.description,
      metadata: { catalog: 'metering' },
      knownProductId: EXTRA_FC_SEAT.knownProductId,
    });
    const monthly = await ensureRecurringPrice(
      stripe,
      product.id,
      EXTRA_FC_SEAT.code,
      EXTRA_FC_SEAT.name,
      'month',
      EXTRA_FC_SEAT.monthlyPriceCents,
      EXTRA_FC_SEAT.knownPriceId,
    );
    console.log(
      `    monthly → ${monthly.id} ($${(EXTRA_FC_SEAT.monthlyPriceCents / 100).toFixed(2)} / extra seat)`,
    );
  }

  console.log(
    `\nChest Mount hardware is one-time ${LIVE_CHEST_MOUNT_PRICE_ID} ($49.99).\n` +
      `Payment Link: ${LIVE_CHEST_MOUNT_PAYMENT_LINK}\n`,
  );

  // --- Seat / credit billing_plans ---------------------------------------
  if (!supabaseUrl || !supabaseKey) {
    console.warn(
      '\nSkipping billing_plans sync — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) to read the catalog.\n',
    );
  } else {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data, error } = await supabase
      .from('billing_plans')
      .select(
        'code, name, tagline, monthly_price_cents, annual_price_cents, per_seat, is_contact_sales, stripe_price_id_monthly, stripe_price_id_annual',
      )
      .eq('is_active', true)
      .order('sort_order');
    if (error) {
      console.error('Failed to load billing_plans:', error.message);
      process.exit(1);
    }

    const plans = (data ?? []) as PlanRow[];
    console.log(`\nSyncing ${plans.length} billing_plans to Stripe…\n`);

    for (const plan of plans) {
      if (plan.is_contact_sales || plan.monthly_price_cents <= 0) {
        console.log(`· ${plan.code}: skipped (free / contact sales)`);
        continue;
      }

      const product = await ensureProduct(stripe, {
        code: plan.code,
        name: `Atmosphere ${plan.name}`,
        description: plan.tagline,
        metadata: {
          catalog: 'billing_plans',
          per_seat: plan.per_seat ? 'true' : 'false',
        },
      });

      const monthly = await ensureRecurringPrice(
        stripe,
        product.id,
        plan.code,
        plan.name,
        'month',
        plan.monthly_price_cents,
      );
      console.log(`    monthly → ${monthly.id} ($${(plan.monthly_price_cents / 100).toFixed(2)})`);

      let annualId: string | null = null;
      if (plan.annual_price_cents && plan.annual_price_cents > 0) {
        // annual_price_cents is the per-month rate billed yearly.
        const annual = await ensureRecurringPrice(
          stripe,
          product.id,
          plan.code,
          plan.name,
          'year',
          plan.annual_price_cents * 12,
        );
        annualId = annual.id;
        console.log(
          `    annual  → ${annual.id} ($${(plan.annual_price_cents / 100).toFixed(2)}/mo billed yearly)`,
        );
      }

      updates.push(
        `update public.billing_plans\n` +
          `   set stripe_price_id_monthly = '${monthly.id}'` +
          (annualId ? `,\n       stripe_price_id_annual  = '${annualId}'` : '') +
          `\n where code = '${plan.code}';`,
      );
    }
  }

  // Best-effort: make sure a Customer Portal configuration exists.
  try {
    const portals = await stripe.billingPortal.configurations.list({ limit: 1 });
    if (portals.data.length === 0) {
      await stripe.billingPortal.configurations.create({
        business_profile: { headline: 'Atmosphere billing' },
        features: {
          customer_update: { enabled: true, allowed_updates: ['email', 'address'] },
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true },
        },
      });
      console.log('\nCreated a default Stripe Customer Portal configuration.');
    } else {
      console.log('\nStripe Customer Portal already configured.');
    }
  } catch (err) {
    console.warn(
      `\nCould not ensure Customer Portal config: ${(err as Error).message}\n` +
        'Enable it in Stripe Dashboard → Settings → Billing → Customer portal.',
    );
  }

  console.log('\n-- Apply these in the Supabase SQL editor (or via migration):\n');
  if (updates.length === 0) {
    console.log('-- (nothing to update)');
  } else {
    console.log(updates.join('\n\n'));
  }

  console.log(`
-- Also set on the BFF (backend/.env or host secrets):
STRIPE_SECRET_KEY=${secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_') ? 'sk_test_…' : 'sk_live_…'}
STRIPE_WEBHOOK_SECRET=whsec_…
${onboardingPriceId ? `STRIPE_ONBOARDING_PRICE_ID=${onboardingPriceId}` : ''}
# Live Jettx Work Verification is price_1UD4Sq1b5twUY3Ly6nqfRaGC — Railway is set by the human.
# Optional override for extra Field Capture seats ($100/mo):
# STRIPE_EXTRA_SEAT_PRICE_ID=${LIVE_EXTRA_FC_SEAT_PRICE_ID}
SUPABASE_SERVICE_ROLE_KEY=…   # required — webhooks mint credits under service role

Next:
  1. Apply the SQL above so checkout can resolve plan → price.
  2. Point a webhook at POST /api/webhooks/stripe for:
       checkout.session.completed
       invoice.paid
       invoice.payment_failed
       customer.subscription.created
       customer.subscription.updated
       customer.subscription.deleted
       charge.refunded
  Locally: stripe listen --forward-to localhost:4000/api/webhooks/stripe
  See docs/stripe.md for the full checklist.
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
