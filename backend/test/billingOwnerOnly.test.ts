/**
 * Billing and Usage belong to the organization's owner (orgs.created_by).
 * Other Global Admins, employees, homeowners and subcontractors get 403 on
 * every Billing, Usage, Metering and AI-allowance endpoint. The paywall status
 * (GET /api/billing/onboarding) stays readable by members, without prices.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_OPEN_TO_MEMBERS,
  BILLING_OWNER_ONLY,
  isOrgOwnerRow,
  requireOrgOwner,
  requireOrgOwnerExcept,
  setOrgOwnerLoaderForTests,
} from '../src/middleware/requireOrgOwner.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { forbidden } from '../src/lib/errors.js';

const ORG = '0a000000-0000-4000-8000-0000000000b1';
const SUB_ORG = '0a000000-0000-4000-8000-0000000000b2';
const OWNER = '0c000000-0000-4000-8000-0000000000b1'; // created the org, Global Admin
const OTHER_ADMIN = '0c000000-0000-4000-8000-0000000000b2'; // second Global Admin
const MEMBER = '0c000000-0000-4000-8000-0000000000b3'; // employee
const HOMEOWNER = '0c000000-0000-4000-8000-0000000000b4'; // no org membership
const SUB = '0c000000-0000-4000-8000-0000000000b5'; // subcontractor on a shared job
const PLATFORM_SEAT = '0c000000-0000-4000-8000-0000000000b6'; // paid Platform-only seat (Global Admin access)

const OWNERS: Record<string, string> = { [ORG]: OWNER, [SUB_ORG]: '0c000000-0000-4000-8000-0000000000b9' };
/** The org requireOrg would resolve for each caller (homeowner: none). */
const ORG_OF: Record<string, string | undefined> = {
  [OWNER]: ORG,
  [OTHER_ADMIN]: ORG,
  [MEMBER]: ORG,
  [HOMEOWNER]: undefined,
  [PLATFORM_SEAT]: ORG,
  [SUB]: ORG, // a sub that reaches the GC's org context is still not its owner
};

const BILLING = [
  ['GET', '/overview'], ['PUT', '/plan'], ['PUT', '/settings'], ['GET', '/ledger'], ['GET', '/purchases'],
  ['POST', '/purchases'], ['POST', '/checkout/subscription'], ['POST', '/portal'], ['GET', '/payments'],
  ['GET', '/invoices'], ['GET', '/workspace'], ['GET', '/token-usage'], ['POST', '/checkout/onboarding'],
  ['POST', '/checkout/extra-seats'], ['POST', '/purchases/p1/confirm'],
] as const;
const USAGE = [['GET', '/quote'], ['POST', '/record'], ['GET', '/events'], ['GET', '/daily']] as const;
const METERING = [['GET', '/summary'], ['GET', '/period'], ['GET', '/jobs'], ['GET', '/events'], ['POST', '/period/close'], ['GET', '/plans']] as const;
const AI = [['GET', '/ai-allowance'], ['POST', '/credits/checkout'], ['POST', '/plan/checkout'], ['GET', '/auto-recharge'], ['PUT', '/auto-recharge']] as const;

let base = '';
let server: ReturnType<express.Express['listen']>;

function fakeAuthAndOrg(req: Request, _res: Response, next: NextFunction) {
  const user = req.get('x-test-user')!;
  (req as unknown as { user: { id: string } }).user = { id: user };
  req.accessToken = 'test';
  const orgId = ORG_OF[user];
  if (!orgId) return next(forbidden('Finish onboarding into an organization first.', 'not_onboarded'));
  req.orgId = orgId;
  next();
}

function mount(app: express.Express, prefix: string, gate: express.RequestHandler, routes: ReadonlyArray<readonly [string, string]>) {
  const r = express.Router();
  r.use(fakeAuthAndOrg, gate);
  for (const [method, path] of routes) {
    const p = path.replace('/p1/', '/:id/');
    (r as unknown as Record<string, (p: string, h: express.RequestHandler) => void>)[method.toLowerCase()](p, (_q, s) => {
      s.json({ ok: true });
    });
  }
  r.get('/onboarding', (_q, s) => s.json({ ok: true, onboarding: true }));
  app.use(prefix, r);
}

before(async () => {
  setOrgOwnerLoaderForTests(async (_req, orgId) => OWNERS[orgId] ?? null);
  const app = express();
  app.use(express.json());
  mount(app, '/api/billing', requireOrgOwnerExcept(BILLING_OPEN_TO_MEMBERS), BILLING);
  mount(app, '/api/usage', requireOrgOwner, USAGE);
  mount(app, '/api/metering', requireOrgOwner, METERING);
  mount(app, '/api/billing', requireOrgOwner, AI);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  setOrgOwnerLoaderForTests(null);
  server.close();
});

async function call(user: string, method: string, path: string) {
  const res = await fetch(base + path, { method, headers: { 'x-test-user': user, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

const ALL: Array<[string, string]> = [
  ...BILLING.map(([m, p]) => [m, '/api/billing' + p] as [string, string]),
  ...USAGE.map(([m, p]) => [m, '/api/usage' + p] as [string, string]),
  ...METERING.map(([m, p]) => [m, '/api/metering' + p] as [string, string]),
  ...AI.map(([m, p]) => [m, '/api/billing' + p] as [string, string]),
];

test('the owner can open every Billing and Usage endpoint', async () => {
  for (const [m, p] of ALL) {
    const r = await call(OWNER, m, p);
    assert.equal(r.status, 200, `${m} ${p}`);
  }
});

for (const [label, user] of [
  ['another Global Admin', OTHER_ADMIN],
  ['a Platform-only seat', PLATFORM_SEAT],
  ['an employee', MEMBER],
  ['a homeowner', HOMEOWNER],
  ['a subcontractor', SUB],
] as const) {
  test(`${label} gets 403 on every Billing and Usage endpoint`, async () => {
    for (const [m, p] of ALL) {
      const r = await call(user, m, p);
      assert.equal(r.status, 403, `${m} ${p}`);
      if (user !== HOMEOWNER) {
        assert.equal(r.body?.code ?? (r.body?.error as { code?: string } | undefined)?.code, 'billing_owner_only', `${m} ${p}`);
      }
    }
  });
}

test('members still read the paywall status; homeowners without an org do not', async () => {
  for (const user of [OWNER, OTHER_ADMIN, MEMBER, SUB]) {
    assert.equal((await call(user, 'GET', '/api/billing/onboarding')).status, 200);
  }
  assert.equal((await call(HOMEOWNER, 'GET', '/api/billing/onboarding')).status, 403);
  assert.equal((await call(MEMBER, 'POST', '/api/billing/onboarding')).status, 403);
});

test('ownership is created_by, never a role', () => {
  assert.equal(isOrgOwnerRow({ created_by: OWNER }, OWNER), true);
  assert.equal(isOrgOwnerRow({ created_by: OWNER }, OTHER_ADMIN), false);
  assert.equal(isOrgOwnerRow({ created_by: null }, OWNER), false);
  assert.equal(isOrgOwnerRow(null, OWNER), false);
  assert.equal(isOrgOwnerRow({ created_by: OWNER }, null), false);
  assert.match(BILLING_OWNER_ONLY, /owner/i);
});

const src = (f: string) => readFileSync(new URL(`../src/routes/${f}`, import.meta.url), 'utf8');

test('every billing router puts the owner gate before its first route', () => {
  const cases: Array<[string, string, string]> = [
    ['billing.ts', 'billingRouter', 'billingRouter.use(requireOrgOwnerExcept(BILLING_OPEN_TO_MEMBERS));'],
    ['usage.ts', 'usageRouter', 'requireOrgOwner)'],
    ['metering.ts', 'meteringRouter', 'requireOrgOwner)'],
    ['aiAllowance.ts', 'aiAllowanceRouter', 'requireOrgOwner)'],
  ];
  for (const [file, name, gate] of cases) {
    const s = src(file);
    const gateAt = s.indexOf(gate);
    assert.ok(gateAt > 0, `${file} has the owner gate`);
    const authAt = s.indexOf(`${name}.use(requireAuth`);
    const routes = [...s.matchAll(new RegExp(`${name}\\.(get|post|put|patch|delete)\\('([^']+)'`, 'g'))];
    assert.ok(routes.length > 0, file);
    for (const r of routes) {
      if (r.index! < authAt) {
        assert.ok(['/self-serve', '/catalog'].includes(r[2]), `${file} ${r[2]} is before auth`);
        continue;
      }
      assert.ok(r.index! > gateAt, `${file} ${r[1]} ${r[2]} is after the owner gate`);
    }
  }
});

test('the onboarding status gives non-owners no prices, plans or Stripe data', () => {
  const s = src('billing.ts');
  const i = s.indexOf('if (!workspace.isCreator) {');
  assert.ok(i > s.indexOf("billingRouter.get('/onboarding'"));
  const block = s.slice(s.indexOf('res.json(', i), s.indexOf('return;', i));
  const keys = [...block.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ['paymentProvider', 'required', 'complete', 'isCreator', 'hasSubscription', 'fieldCaptureSeats', 'platformSeats']);
  assert.doesNotMatch(block, /price|catalog|usage|invoice|customer/i);
});

test('the migration makes billing owner-only in the database too', () => {
  const name = '20261018190000_billing_owner_only.sql';
  const a = readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
  const b = readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
  assert.equal(a, b, 'mirrored');
  const can = a.slice(a.indexOf('function private.can_manage_billing'), a.indexOf('$$;', a.indexOf('function private.can_manage_billing')));
  assert.match(can, /o\.created_by = auth\.uid\(\)/);
  assert.doesNotMatch(can, /global_admin|office_manager|role/);
  assert.match(a, /if not private\.can_manage_billing\(p_org\) then\s+return jsonb_build_object\('can_manage', false\);/);
  for (const t of ['payments', 'ai_credit_ledger', 'billing_period_statements', 'feature_usage_daily', 'org_metering']) {
    assert.match(a, new RegExp(`create policy ${t}_select_owner on public\\.${t} for select to authenticated using \\(private\\.can_manage_billing\\(org_id\\)\\)`));
  }
});

test('an admin who is not the owner cannot buy a Field Capture seat by inviting past the limit', () => {
  const seats = readFileSync(new URL('../src/lib/fieldCaptureInviteSeats.ts', import.meta.url), 'utf8');
  const guard = seats.indexOf('if (opts.actorIsOwner === false)');
  assert.ok(guard > 0);
  assert.ok(guard > seats.indexOf("decision.action === 'grant_comped'"), 'free seats still work for any admin');
  assert.ok(guard < seats.indexOf('ensureCustomer(supabase'), 'before any Stripe customer');
  assert.ok(guard < seats.indexOf('addExtraFieldCaptureSeats(supabase'), 'before any Stripe change');
  assert.match(seats.slice(guard, guard + 200), /fc_seat_owner_only/);
  assert.match(src('org.ts'), /actorIsOwner: isOrgOwnerRow\(\{ created_by: await loadOrgOwnerId\(req, orgId\) \}, req\.user!\.id\)/);
});
