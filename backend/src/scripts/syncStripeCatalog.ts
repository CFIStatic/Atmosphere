#!/usr/bin/env tsx
/**
 * Create (or reuse) Stripe Products + Prices for every paid Atmosphere plan,
 * then print the SQL that links those price ids into `billing_plans`.
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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Set it and re-run.`);
    process.exit(1);
  }
  return value;
}

async function findProduct(stripe: Stripe, planCode: string): Promise<Stripe.Product | null> {
  const listed = await stripe.products.search({
    query: `metadata["atmosphere_plan_code"]:"${planCode}"`,
    limit: 1,
  });
  return listed.data[0] ?? null;
}

async function findPrice(
  stripe: Stripe,
  planCode: string,
  interval: 'month' | 'year',
): Promise<Stripe.Price | null> {
  const listed = await stripe.prices.search({
    query: `metadata["atmosphere_plan_code"]:"${planCode}" AND metadata["atmosphere_interval"]:"${interval}" AND active:"true"`,
    limit: 1,
  });
  return listed.data[0] ?? null;
}

async function ensureRecurringPrice(
  stripe: Stripe,
  productId: string,
  plan: PlanRow,
  interval: 'month' | 'year',
  unitAmount: number,
): Promise<Stripe.Price> {
  const existing = await findPrice(stripe, plan.code, interval);
  if (existing) {
    if (existing.unit_amount === unitAmount && existing.product === productId) {
      return existing;
    }
    // Amount changed: archive the old price and create a replacement. Stripe
    // prices are immutable on amount.
    await stripe.prices.update(existing.id, { active: false });
  }

  return stripe.prices.create({
    product: productId,
    currency: 'usd',
    unit_amount: unitAmount,
    recurring: { interval },
    nickname: `${plan.name} (${interval === 'month' ? 'monthly' : 'annual'})`,
    metadata: {
      atmosphere_plan_code: plan.code,
      atmosphere_interval: interval,
    },
  });
}

async function main() {
  const secretKey = requireEnv('STRIPE_SECRET_KEY');
  const supabaseUrl = process.env.SUPABASE_URL ?? 'https://ccxatzfsvzetciiwsjlj.supabase.co';
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? '';

  if (!supabaseKey) {
    console.error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) to read billing_plans.');
    process.exit(1);
  }

  const stripe = new Stripe(secretKey);
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
  const updates: string[] = [];

  console.log(`Syncing ${plans.length} plans to Stripe…\n`);

  for (const plan of plans) {
    if (plan.is_contact_sales || plan.monthly_price_cents <= 0) {
      console.log(`· ${plan.code}: skipped (free / contact sales)`);
      continue;
    }

    let product = await findProduct(stripe, plan.code);
    if (!product) {
      product = await stripe.products.create({
        name: `Atmosphere ${plan.name}`,
        description: plan.tagline ?? undefined,
        metadata: {
          atmosphere_plan_code: plan.code,
          per_seat: plan.per_seat ? 'true' : 'false',
        },
      });
      console.log(`· ${plan.code}: created product ${product.id}`);
    } else {
      console.log(`· ${plan.code}: reusing product ${product.id}`);
    }

    const monthly = await ensureRecurringPrice(
      stripe,
      product.id,
      plan,
      'month',
      plan.monthly_price_cents,
    );
    console.log(`    monthly → ${monthly.id} ($${(plan.monthly_price_cents / 100).toFixed(2)})`);

    let annualId: string | null = null;
    if (plan.annual_price_cents && plan.annual_price_cents > 0) {
      // annual_price_cents is the per-month rate billed yearly (see README).
      const annual = await ensureRecurringPrice(
        stripe,
        product.id,
        plan,
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

  console.log('\n-- Apply these in the Supabase SQL editor (or via migration):\n');
  if (updates.length === 0) {
    console.log('-- (nothing to update)');
  } else {
    console.log(updates.join('\n\n'));
  }

  console.log(`
Next:
  1. Apply the SQL above so checkout can resolve plan → price.
  2. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the server.
  3. Point a webhook at POST /api/webhooks/stripe for:
       checkout.session.completed
       invoice.paid
       invoice.payment_failed
       customer.subscription.created
       customer.subscription.updated
       customer.subscription.deleted
       charge.refunded
  Locally: stripe listen --forward-to localhost:4000/api/webhooks/stripe
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
