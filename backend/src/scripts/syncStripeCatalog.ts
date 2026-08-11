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

/** Seeded Work Verification metering plan — $599/mo, 50 included jobs. */
const WORK_VERIFICATION = {
  code: 'work_verification',
  name: 'Work Verification',
  description:
    'Field Capture + Evidence Platform — base fee plus processed jobs and exceptional compute',
  monthlyPriceCents: 59900,
} as const;

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
  planCode: string,
  planName: string,
  interval: 'month' | 'year',
  unitAmount: number,
): Promise<Stripe.Price> {
  const existing = await findPrice(stripe, planCode, interval);
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
  },
): Promise<Stripe.Product> {
  const existing = await findProduct(stripe, opts.code);
  if (existing) {
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

  const supabaseUrl = process.env.SUPABASE_URL ?? 'https://ccxatzfsvzetciiwsjlj.supabase.co';
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
      metadata: { catalog: 'metering' },
    });
    const monthly = await ensureRecurringPrice(
      stripe,
      product.id,
      WORK_VERIFICATION.code,
      WORK_VERIFICATION.name,
      'month',
      WORK_VERIFICATION.monthlyPriceCents,
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

  // --- Seat / credit billing_plans ---------------------------------------
  if (!supabaseKey) {
    console.warn(
      '\nSkipping billing_plans sync — set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY to read the catalog.\n',
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
