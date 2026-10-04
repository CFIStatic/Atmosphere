import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deleteOwnAccount,
  planAccountDeletion,
  type AccountDeletionStore,
  type AccountMembership,
  type OrgMemberRow,
} from '../src/account/deleteAccount.js';
import { HttpError } from '../src/lib/errors.js';
import { isTermsExemptPath } from '../src/legal/terms.js';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function membership(role: string, orgId = ORG, orgName = 'Acme Roofing'): AccountMembership {
  return { orgId, orgName, role, status: 'active' };
}

function member(userId: string, role: string, status = 'active'): OrgMemberRow {
  return { userId, role, status };
}

type Calls = string[];

function fakeStore(opts: {
  memberships: AccountMembership[];
  members: Record<string, OrgMemberRow[]>;
  profileDeletable?: boolean;
  authDeletable?: boolean;
}): { store: AccountDeletionStore; calls: Calls } {
  const calls: Calls = [];
  const store: AccountDeletionStore = {
    async listMemberships(userId) {
      calls.push(`listMemberships:${userId}`);
      return opts.memberships;
    },
    async listOrgMembers(orgId) {
      calls.push(`listOrgMembers:${orgId}`);
      return opts.members[orgId] ?? [];
    },
    async deleteMemberships(userId) {
      calls.push(`deleteMemberships:${userId}`);
    },
    async deletePersonalRows(userId) {
      calls.push(`deletePersonalRows:${userId}`);
    },
    async deleteProfile(userId) {
      calls.push(`deleteProfile:${userId}`);
      return opts.profileDeletable ?? true;
    },
    async scrubProfile(userId) {
      calls.push(`scrubProfile:${userId}`);
    },
    async deleteAuthUser(userId) {
      calls.push(`deleteAuthUser:${userId}`);
      return opts.authDeletable ?? true;
    },
    async softDeleteAuthUser(userId) {
      calls.push(`softDeleteAuthUser:${userId}`);
    },
  };
  return { store, calls };
}

test('plan blocks the only active admin of an org with other active members', () => {
  const plan = planAccountDeletion(
    ME,
    [membership('global_admin')],
    new Map([[ORG, [member(ME, 'global_admin'), member(OTHER, 'field_technician')]]]),
  );
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.deepEqual(plan.blocked, [{ orgId: ORG, orgName: 'Acme Roofing' }]);
});

test('plan treats office_manager as an admin on both sides', () => {
  const blocked = planAccountDeletion(
    ME,
    [membership('office_manager')],
    new Map([[ORG, [member(ME, 'office_manager'), member(OTHER, 'employee')]]]),
  );
  assert.equal(blocked.ok, false);

  const allowed = planAccountDeletion(
    ME,
    [membership('global_admin')],
    new Map([[ORG, [member(ME, 'global_admin'), member(OTHER, 'office_manager')]]]),
  );
  assert.equal(allowed.ok, true);
});

test('plan allows an admin when another active admin exists', () => {
  const plan = planAccountDeletion(
    ME,
    [membership('global_admin')],
    new Map([
      [ORG, [member(ME, 'global_admin'), member(OTHER, 'global_admin'), member(THIRD, 'employee')]],
    ]),
  );
  assert.equal(plan.ok, true);
  if (plan.ok) assert.deepEqual(plan.orgs, [{ orgId: ORG, orgName: 'Acme Roofing', soleMember: false }]);
});

test('plan ignores inactive members and inactive admins', () => {
  // Only inactive others: the caller is effectively the sole member.
  const sole = planAccountDeletion(
    ME,
    [membership('global_admin')],
    new Map([[ORG, [member(ME, 'global_admin'), member(OTHER, 'employee', 'pending')]]]),
  );
  assert.equal(sole.ok, true);
  if (sole.ok) assert.equal(sole.orgs[0]?.soleMember, true);

  // An inactive second admin does not count as a replacement.
  const blocked = planAccountDeletion(
    ME,
    [membership('global_admin')],
    new Map([
      [
        ORG,
        [member(ME, 'global_admin'), member(OTHER, 'global_admin', 'removed'), member(THIRD, 'employee')],
      ],
    ]),
  );
  assert.equal(blocked.ok, false);
});

test('plan never blocks a non-admin member', () => {
  const plan = planAccountDeletion(
    ME,
    [membership('field_technician')],
    new Map([[ORG, [member(ME, 'field_technician'), member(OTHER, 'employee')]]]),
  );
  assert.equal(plan.ok, true);
  if (plan.ok) assert.equal(plan.orgs[0]?.soleMember, false);
});

test('plan reports every blocking org across several memberships', () => {
  const plan = planAccountDeletion(
    ME,
    [membership('global_admin', ORG, 'Acme'), membership('global_admin', ORG2, 'Beta')],
    new Map([
      [ORG, [member(ME, 'global_admin'), member(OTHER, 'employee')]],
      [ORG2, [member(ME, 'global_admin')]],
    ]),
  );
  assert.equal(plan.ok, false);
  if (!plan.ok) assert.deepEqual(plan.blocked.map((b) => b.orgName), ['Acme']);
});

test('deleteOwnAccount refuses with 409 last_admin and touches nothing', async () => {
  const { store, calls } = fakeStore({
    memberships: [membership('global_admin')],
    members: { [ORG]: [member(ME, 'global_admin'), member(OTHER, 'employee')] },
  });
  await assert.rejects(deleteOwnAccount(store, ME), (err: unknown) => {
    assert.ok(err instanceof HttpError);
    assert.equal(err.status, 409);
    assert.equal(err.code, 'last_admin');
    assert.match(err.message, /only admin of Acme Roofing/);
    assert.match(err.message, /Make someone else an admin first/);
    return true;
  });
  assert.ok(!calls.some((c) => c.startsWith('delete') || c.startsWith('scrub') || c.startsWith('soft')));
});

test('deleteOwnAccount hard-deletes membership, profile, and login when nothing blocks it', async () => {
  const { store, calls } = fakeStore({
    memberships: [membership('field_technician')],
    members: { [ORG]: [member(ME, 'field_technician'), member(OTHER, 'global_admin')] },
  });
  const result = await deleteOwnAccount(store, ME);
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'hard');
  assert.match(result.message, /Jobs, files, and videos stay with the company/);
  assert.deepEqual(calls, [
    `listMemberships:${ME}`,
    `listOrgMembers:${ORG}`,
    `deleteMemberships:${ME}`,
    `deletePersonalRows:${ME}`,
    `deleteProfile:${ME}`,
    `deleteAuthUser:${ME}`,
  ]);
});

test('sole member: membership goes, company data stays, and the message says so', async () => {
  const { store, calls } = fakeStore({
    memberships: [membership('global_admin')],
    members: { [ORG]: [member(ME, 'global_admin')] },
  });
  const result = await deleteOwnAccount(store, ME);
  assert.equal(result.orgs[0]?.soleMember, true);
  assert.match(result.message, /only member of Acme Roofing/);
  assert.match(result.message, /was not deleted/);
  assert.ok(calls.includes(`deleteMemberships:${ME}`));
});

test('falls back to a soft auth delete when company rows still point at the login', async () => {
  const { store, calls } = fakeStore({
    memberships: [],
    members: {},
    authDeletable: false,
  });
  const result = await deleteOwnAccount(store, ME);
  assert.equal(result.mode, 'soft');
  assert.ok(calls.includes(`deleteProfile:${ME}`));
  assert.ok(!calls.includes(`scrubProfile:${ME}`));
  assert.deepEqual(calls.slice(-2), [`deleteAuthUser:${ME}`, `softDeleteAuthUser:${ME}`]);
});

test('scrubs the profile and soft-deletes the login when the profile row is referenced', async () => {
  const { store, calls } = fakeStore({
    memberships: [],
    members: {},
    profileDeletable: false,
  });
  const result = await deleteOwnAccount(store, ME);
  assert.equal(result.mode, 'soft');
  assert.deepEqual(calls.slice(-3), [
    `deleteProfile:${ME}`,
    `scrubProfile:${ME}`,
    `softDeleteAuthUser:${ME}`,
  ]);
});

test('account deletion works before the terms are accepted', () => {
  assert.equal(isTermsExemptPath('/api/auth/account'), true);
});

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Records every query so we can check each one is pinned to the caller. */
function recordingAdmin(rows: Record<string, any[]>, failDeleteOn: string[] = []) {
  const log: { table: string; op: string; filters: [string, string][]; values?: any }[] = [];
  const authCalls: [string, boolean | undefined][] = [];
  function builder(table: string, op: string, values?: any) {
    const entry = { table, op, filters: [] as [string, string][], values };
    log.push(entry);
    const result = () => {
      if (op === 'delete' && failDeleteOn.includes(table)) {
        return { data: null, error: { message: 'violates foreign key constraint', code: '23503' } };
      }
      return { data: op === 'select' ? rows[table] ?? [] : null, error: null };
    };
    const chain: any = {
      eq(column: string, value: string) {
        entry.filters.push([column, value]);
        return chain;
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };
    return chain;
  }
  const admin: any = {
    from(table: string) {
      return {
        select: () => builder(table, 'select'),
        delete: () => builder(table, 'delete'),
        update: (values: any) => builder(table, 'update', values),
      };
    },
    storage: {
      from: () => ({
        list: async () => ({ data: [{ name: 'avatar.png' }], error: null }),
        remove: async (paths: string[]) => {
          log.push({ table: 'storage:avatars', op: 'remove', filters: paths.map((p) => ['path', p]) });
          return { data: null, error: null };
        },
      }),
    },
    auth: {
      admin: {
        deleteUser: async (id: string, soft?: boolean) => {
          authCalls.push([id, soft]);
          return { data: {}, error: soft ? null : { message: 'Database error deleting user' } };
        },
      },
    },
  };
  return { admin, log, authCalls };
}

test('Supabase store pins every write to the caller and soft-deletes a referenced login', async () => {
  const { supabaseAccountDeletionStore } = await import('../src/account/deleteAccount.js');
  const { admin, log, authCalls } = recordingAdmin(
    {
      org_members: [{ org_id: ORG, role: 'field_technician', status: 'active', orgs: { name: 'Acme Roofing' }, user_id: ME }],
    },
    ['profiles'],
  );
  const store = supabaseAccountDeletionStore(admin);
  const memberships = await store.listMemberships(ME);
  assert.deepEqual(memberships, [
    { orgId: ORG, orgName: 'Acme Roofing', role: 'field_technician', status: 'active' },
  ]);

  const result = await deleteOwnAccount(
    {
      ...store,
      // The org still has an admin, so the caller may leave.
      listOrgMembers: async () => [member(ME, 'field_technician'), member(OTHER, 'global_admin')],
    },
    ME,
  );
  assert.equal(result.mode, 'soft');

  const writes = log.filter((e) => e.op === 'delete' || e.op === 'update');
  assert.deepEqual(
    writes.map((e) => `${e.op}:${e.table}`),
    [
      'delete:org_members',
      'delete:voiceprints',
      'delete:device_credentials',
      'delete:profiles',
      'update:profiles',
    ],
  );
  for (const write of writes) {
    assert.equal(write.filters.length, 1, `${write.table} must have exactly one filter`);
    const [column, value] = write.filters[0]!;
    assert.ok(['user_id', 'id'].includes(column));
    assert.equal(value, ME);
  }
  const scrub = writes.find((e) => e.op === 'update')!;
  assert.equal(scrub.values.email, null);
  assert.equal(scrub.values.full_name, null);
  assert.equal(scrub.values.avatar_url, null);

  const removed = log.find((e) => e.table === 'storage:avatars');
  assert.deepEqual(removed?.filters, [['path', `${ME}/avatar.png`]]);

  // Profile was referenced, so no hard auth delete is attempted.
  assert.deepEqual(authCalls, [[ME, true]]);
});

test('DELETE /api/auth/account is registered behind requireAuth', async () => {
  const { authRouter } = await import('../src/routes/auth.js');
  const { requireAuth } = await import('../src/middleware/requireAuth.js');
  const layer = (authRouter as any).stack.find(
    (l: any) => l.route?.path === '/account' && l.route?.methods?.delete,
  );
  assert.ok(layer, 'DELETE /account route exists');
  const handlers = layer.route.stack.map((s: any) => s.handle);
  assert.equal(handlers[0], requireAuth);
});
