/**
 * Seed (or remove) demonstration data for the growth dashboards.
 *
 *   npm run analytics:seed          # create demo customers, revenue and usage
 *   npm run analytics:seed -- --wipe   # remove everything this script created
 *
 * WHY THIS EXISTS: the dashboards are only as interesting as the data behind
 * them, and a brand-new project has none. This produces a plausible 18-month
 * history so the charts, growth rates and Excel exports can be reviewed before
 * real customers exist.
 *
 * Everything it creates is marked: organizations are named "Demo · …" and users
 * live on the reserved, undeliverable domain `atmosphere.invalid`, so `--wipe`
 * can find and remove all of it. Do not run this against a project that already
 * has real customers — the aggregates would mix demo and real revenue.
 */

import 'dotenv/config';
import { createAdminClient } from '../lib/supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const DEMO_PREFIX = 'Demo · ';
const DEMO_DOMAIN = 'atmosphere.invalid';
const MONTHS = 18;

type PlanCode = 'free' | 'pro';
type Interval = 'monthly' | 'annual';

interface DemoOrg {
  name: string;
  /** Months before today that this org signed up. */
  ageMonths: number;
  plan: PlanCode;
  interval: Interval;
  seats: number;
  members: number;
  /** Month offset at which they upgraded, if they did. */
  upgrade?: { atMonthsAgo: number; plan: PlanCode; seats: number };
  churnedMonthsAgo?: number;
}

/**
 * A deliberately mixed book of business: self-serve Pro seats at $199.99/user,
 * one upgrade in seat count, one churn, and a couple of free accounts that never
 * converted. Flat, uniform demo data makes every chart look fine and teaches
 * you nothing.
 */
const DEMO_ORGS: DemoOrg[] = [
  { name: 'Northwind Restoration', ageMonths: 17, plan: 'pro', interval: 'monthly', seats: 12, members: 9 },
  { name: 'Harbor Mitigation Co', ageMonths: 15, plan: 'pro', interval: 'monthly', seats: 8, members: 7 },
  { name: 'Cedar Ridge Builders', ageMonths: 13, plan: 'pro', interval: 'monthly', seats: 1, members: 3,
    upgrade: { atMonthsAgo: 5, plan: 'pro', seats: 6 } },
  { name: 'Gulf Coast Drying', ageMonths: 11, plan: 'pro', interval: 'monthly', seats: 4, members: 4 },
  { name: 'Summit Contracting', ageMonths: 9, plan: 'pro', interval: 'monthly', seats: 15, members: 12 },
  { name: 'Blue Line Water Damage', ageMonths: 8, plan: 'pro', interval: 'monthly', seats: 2, members: 2 },
  { name: 'Ironclad Construction', ageMonths: 7, plan: 'pro', interval: 'monthly', seats: 25, members: 21 },
  { name: 'Lakeshore Property Care', ageMonths: 6, plan: 'pro', interval: 'monthly', seats: 2, members: 2,
    churnedMonthsAgo: 1 },
  { name: 'Pinnacle Remediation', ageMonths: 5, plan: 'pro', interval: 'monthly', seats: 6, members: 6 },
  { name: 'Riverbend Services', ageMonths: 4, plan: 'pro', interval: 'monthly', seats: 9, members: 8 },
  { name: 'Stonegate Restoration', ageMonths: 3, plan: 'pro', interval: 'monthly', seats: 3, members: 3 },
  { name: 'Willow Creek Builders', ageMonths: 2, plan: 'free', interval: 'monthly', seats: 1, members: 2 },
  { name: 'Copper Peak Mitigation', ageMonths: 1, plan: 'pro', interval: 'monthly', seats: 5, members: 5 },
  { name: 'Foxglove Interiors', ageMonths: 1, plan: 'free', interval: 'monthly', seats: 1, members: 1 },
];

/**
 * Relative weight of time spent in each tool. The shape is the point: automation
 * dominates, back-office tools get a sliver, and two instrumented features get
 * nothing at all so the "least used" half of the dashboard has something true to
 * say.
 */
const FEATURE_WEIGHTS: Record<string, number> = {
  web_runs: 34,
  agent_console: 18,
  dashboard: 14,
  web_connections: 11,
  web_verification: 9,
  org_directory: 5,
  billing_console: 4,
  onboarding: 3,
  credits: 2,
  ai_assistant: 0,
  pin_signin: 0,
  growth_analytics: 0,
};

const PLAN_PRICES: Record<PlanCode, { monthly: number; annual: number; perSeat: boolean }> = {
  free: { monthly: 0, annual: 0, perSeat: false },
  pro: { monthly: 19999, annual: 19999, perSeat: true },
};

const MEMBER_ROLES = ['project_manager', 'field_technician', 'accountant', 'office_manager', 'sales'] as const;

/** Deterministic pseudo-randomness: reruns produce the same shape. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
const random = makeRandom(20260727);

function monthsAgo(n: number): Date {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

function mrrCents(plan: PlanCode, interval: Interval, seats: number): number {
  const price = PLAN_PRICES[plan];
  const base = interval === 'annual' ? price.annual : price.monthly;
  return base * (price.perSeat ? seats : 1);
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function wipe(admin: SupabaseClient): Promise<void> {
  console.log('Removing demo data…');

  const { data: orgs, error: orgErr } = await admin
    .from('orgs')
    .select('id, name')
    .like('name', `${DEMO_PREFIX}%`);
  if (orgErr) throw new Error(orgErr.message);

  const orgIds = (orgs ?? []).map((o) => o.id as string);

  if (orgIds.length > 0) {
    // Most child rows cascade from orgs; billing history and usage do not carry
    // ON DELETE CASCADE from every direction, so clear them explicitly first.
    for (const table of ['feature_usage_daily', 'feature_usage_sessions', 'org_billing_events', 'payments', 'org_billing', 'org_members']) {
      const { error } = await admin.from(table).delete().in('org_id', orgIds);
      if (error) console.warn(`  ! ${table}: ${error.message}`);
    }
    const { error } = await admin.from('orgs').delete().in('id', orgIds);
    if (error) throw new Error(error.message);
    console.log(`  removed ${orgIds.length} demo organizations`);
  }

  let removedUsers = 0;
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    if (data.users.length === 0) break;
    for (const user of data.users) {
      if (user.email?.endsWith(`@${DEMO_DOMAIN}`)) {
        await admin.auth.admin.deleteUser(user.id);
        removedUsers += 1;
      }
    }
    if (data.users.length < 200) break;
  }
  console.log(`  removed ${removedUsers} demo users`);
  console.log('✓ Demo data removed');
}

async function seed(admin: SupabaseClient): Promise<void> {
  const { count } = await admin.from('orgs').select('id', { count: 'exact', head: true });
  if ((count ?? 0) > 0) {
    const { count: demoCount } = await admin
      .from('orgs')
      .select('id', { count: 'exact', head: true })
      .like('name', `${DEMO_PREFIX}%`);
    if ((demoCount ?? 0) === 0) {
      fail(
        `This project already has ${count} organization(s) that this script did not create.\n` +
          'Seeding demo data would mix demonstration figures into real aggregates.\n' +
          'Refusing to continue.',
      );
    }
    console.log('Demo data already present — wiping it first for a clean reseed.');
    await wipe(admin);
  }

  console.log(`Seeding ${DEMO_ORGS.length} demo organizations over ${MONTHS} months…`);

  const features = Object.entries(FEATURE_WEIGHTS).filter(([, weight]) => weight > 0);
  const totalWeight = features.reduce((sum, [, weight]) => sum + weight, 0);

  for (const [index, org] of DEMO_ORGS.entries()) {
    const signup = monthsAgo(org.ageMonths);
    const orgName = `${DEMO_PREFIX}${org.name}`;
    const joinCode = `DEMO${String(index + 1).padStart(2, '0')}`;

    // --- users -------------------------------------------------------------
    const userIds: string[] = [];
    for (let m = 0; m < org.members; m += 1) {
      const email = `demo.${joinCode.toLowerCase()}.${m + 1}@${DEMO_DOMAIN}`;
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password: `demo-${joinCode}-${m}-${Math.floor(random() * 1e9)}`,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`createUser(${email}): ${error?.message}`);
      userIds.push(data.user.id);

      const { error: profileErr } = await admin
        .from('profiles')
        .upsert({ id: data.user.id, email }, { onConflict: 'id' });
      if (profileErr) throw new Error(profileErr.message);
    }

    // --- org + members -----------------------------------------------------
    const { data: orgRow, error: orgErr } = await admin
      .from('orgs')
      .insert({ name: orgName, join_code: joinCode, created_by: userIds[0], created_at: signup.toISOString() })
      .select('id')
      .single();
    if (orgErr || !orgRow) throw new Error(`insert org: ${orgErr?.message}`);
    const orgId = orgRow.id as string;

    const memberRows = userIds.map((userId, i) => {
      // Members trickle in after the org is created rather than all at once.
      const joined = new Date(signup.getTime() + i * 11 * 24 * 60 * 60 * 1000);
      return {
        org_id: orgId,
        user_id: userId,
        role: MEMBER_ROLES[i % MEMBER_ROLES.length],
        work_type: i % 3 === 0 ? 'construction' : 'mitigation',
        created_at: (joined < new Date() ? joined : new Date()).toISOString(),
      };
    });
    const { error: memberErr } = await admin.from('org_members').insert(memberRows);
    if (memberErr) throw new Error(`insert members: ${memberErr.message}`);

    // --- subscription + its history ---------------------------------------
    const finalPlan = org.upgrade?.plan ?? org.plan;
    const finalSeats = org.upgrade?.seats ?? org.seats;
    const status = org.churnedMonthsAgo !== undefined ? 'canceled' : 'active';

    const { error: billingErr } = await admin.from('org_billing').insert({
      org_id: orgId,
      plan_code: finalPlan,
      billing_interval: org.interval,
      seats: finalSeats,
      status,
      created_at: signup.toISOString(),
    });
    if (billingErr) throw new Error(`insert billing: ${billingErr.message}`);

    // The insert trigger stamps one event at now(); replace it with a real
    // timeline so the monthly MRR series has something to reconstruct.
    const { error: clearErr } = await admin.from('org_billing_events').delete().eq('org_id', orgId);
    if (clearErr) throw new Error(clearErr.message);

    const events: Record<string, unknown>[] = [
      {
        org_id: orgId,
        effective_at: signup.toISOString(),
        plan_code: org.plan,
        billing_interval: org.interval,
        seats: org.seats,
        status: 'active',
        mrr_cents: mrrCents(org.plan, org.interval, org.seats),
        source: 'signup',
      },
    ];
    if (org.upgrade) {
      events.push({
        org_id: orgId,
        effective_at: monthsAgo(org.upgrade.atMonthsAgo).toISOString(),
        plan_code: org.upgrade.plan,
        billing_interval: org.interval,
        seats: org.upgrade.seats,
        status: 'active',
        mrr_cents: mrrCents(org.upgrade.plan, org.interval, org.upgrade.seats),
        source: 'change',
      });
    }
    if (org.churnedMonthsAgo !== undefined) {
      events.push({
        org_id: orgId,
        effective_at: monthsAgo(org.churnedMonthsAgo).toISOString(),
        plan_code: finalPlan,
        billing_interval: org.interval,
        seats: finalSeats,
        status: 'canceled',
        mrr_cents: 0,
        source: 'change',
      });
    }
    const { error: eventErr } = await admin.from('org_billing_events').insert(events);
    if (eventErr) throw new Error(`insert billing events: ${eventErr.message}`);

    // --- payments ----------------------------------------------------------
    const payments: Record<string, unknown>[] = [];
    for (let m = org.ageMonths; m >= 0; m -= 1) {
      if (org.churnedMonthsAgo !== undefined && m < org.churnedMonthsAgo) break;

      const planNow = org.upgrade && m <= org.upgrade.atMonthsAgo ? org.upgrade.plan : org.plan;
      const seatsNow = org.upgrade && m <= org.upgrade.atMonthsAgo ? org.upgrade.seats : org.seats;
      const monthly = mrrCents(planNow, org.interval, seatsNow);
      if (monthly === 0) continue;

      const at = monthsAgo(m);
      if (at > new Date()) continue;

      // Annual subscriptions bill once a year, not monthly.
      const billsThisMonth = org.interval === 'monthly' || (org.ageMonths - m) % 12 === 0;
      if (billsThisMonth) {
        payments.push({
          org_id: orgId,
          kind: 'subscription',
          status: 'succeeded',
          amount_cents: org.interval === 'annual' ? monthly * 12 : monthly,
          description: org.interval === 'annual' ? 'Annual subscription' : 'Monthly subscription',
          created_at: at.toISOString(),
          period_start: at.toISOString(),
        });
      }

      // Usage-based credit top-ups, which not every account buys every month.
      if (random() > 0.55) {
        payments.push({
          org_id: orgId,
          kind: 'credits',
          status: 'succeeded',
          amount_cents: [2500, 5000, 10000, 25000][Math.floor(random() * 4)],
          description: 'Credit top-up',
          created_at: new Date(at.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }
    }
    if (payments.length > 0) {
      const { error: payErr } = await admin.from('payments').insert(payments);
      if (payErr) throw new Error(`insert payments: ${payErr.message}`);
    }

    // --- feature usage -----------------------------------------------------
    const sessions: Record<string, unknown>[] = [];
    const activeMonths = Math.min(org.ageMonths, 6); // last six months of detail
    for (let m = activeMonths; m >= 0; m -= 1) {
      if (org.churnedMonthsAgo !== undefined && m < org.churnedMonthsAgo) break;

      for (let day = 0; day < 28; day += 1) {
        // Weekday-shaped activity, and not every account works every day.
        if (random() > 0.55) continue;

        const when = new Date(monthsAgo(m).getTime() + day * 24 * 60 * 60 * 1000);
        if (when > new Date()) continue;

        const activeUsers = Math.max(1, Math.round(org.members * (0.4 + random() * 0.5)));
        for (let u = 0; u < activeUsers; u += 1) {
          const userId = userIds[u % userIds.length];
          const picks = 1 + Math.floor(random() * 3);
          for (let p = 0; p < picks; p += 1) {
            // Weighted pick, so the mix of tools looks like a real product.
            let roll = random() * totalWeight;
            let chosen = features[0][0];
            for (const [key, weight] of features) {
              roll -= weight;
              if (roll <= 0) {
                chosen = key;
                break;
              }
            }
            const startedAt = new Date(when.getTime() + (8 + Math.floor(random() * 9)) * 3600000);
            if (startedAt > new Date()) continue;
            const activeMs = Math.round((3 + random() * 47) * 60000);
            sessions.push({
              org_id: orgId,
              user_id: userId,
              feature_key: chosen,
              client: random() > 0.75 ? 'mobile' : 'web',
              started_at: startedAt.toISOString(),
              last_seen_at: new Date(startedAt.getTime() + activeMs).toISOString(),
              active_ms: activeMs,
              interactions: Math.round(activeMs / 45000),
            });
          }
        }
      }
    }

    for (let i = 0; i < sessions.length; i += 500) {
      const { error: sessionErr } = await admin
        .from('feature_usage_sessions')
        .insert(sessions.slice(i, i + 500));
      if (sessionErr) throw new Error(`insert sessions: ${sessionErr.message}`);
    }

    console.log(
      `  ✓ ${orgName} — ${org.members} users, ${payments.length} payments, ${sessions.length} sessions`,
    );
  }

  console.log('\n✓ Demo data seeded. Open /analytics to review it.');
  console.log('  Remove it again with:  npm run analytics:seed -- --wipe');
}

async function main(): Promise<void> {
  const admin = createAdminClient();
  if (!admin) {
    fail('SUPABASE_SERVICE_ROLE_KEY is not set — this script cannot run without it.');
  }

  if (process.argv.includes('--wipe')) {
    await wipe(admin);
    return;
  }
  await seed(admin);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
