/**
 * Server side of 20261018230000_lock_down_direct_writes.sql: the RPCs that a
 * user token can no longer call are only ever called by the server (service
 * role) — directly, or through the *_as wrappers that still run the
 * database's owner/member checks as the signed-in user.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { bearerSubject } from '../src/metering/tokenUsage.js';
import { joinOrgAsInvitee } from '../src/lib/orgInviteGate.js';

const srcDir = fileURLToPath(new URL('../src/', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

function jwt(claims: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.sig`;
}

function clientWithBearer(token: string): SupabaseClient {
  return { rest: { headers: new Headers({ Authorization: `Bearer ${token}` }) } } as unknown as SupabaseClient;
}

test('no route calls a server-only RPC by its user-token name', () => {
  const serverOnly = ['set_billing_plan', 'set_billing_settings', 'record_usage', 'join_org', 'preview_org_by_join_code'];
  for (const file of sourceFiles(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const fn of serverOnly) {
      const direct = new RegExp(`\\.rpc\\(\\s*['"]${fn}['"]`, 'g');
      const hits = text.match(direct) ?? [];
      // join_org keeps one keyless fallback inside joinOrgAsInvitee.
      const allowed = fn === 'join_org' && file.endsWith(join('lib', 'orgInviteGate.ts')) ? 1 : 0;
      assert.ok(hits.length <= allowed, `${file} calls ${fn} directly`);
    }
  }
});

test('bearerSubject reads the signed-in user from a user-token client', () => {
  const sub = '18000000-0000-4000-8000-00000000000e';
  assert.equal(bearerSubject(clientWithBearer(jwt({ sub, role: 'authenticated' }))), sub);
});

test('bearerSubject is null for the service role, anon, junk and mocks', () => {
  assert.equal(bearerSubject(clientWithBearer(jwt({ role: 'service_role' }))), null);
  assert.equal(bearerSubject(clientWithBearer(jwt({ role: 'anon' }))), null);
  assert.equal(bearerSubject(clientWithBearer('not-a-jwt')), null);
  assert.equal(bearerSubject(clientWithBearer(jwt({ sub: "x' or 1=1", role: 'authenticated' }))), null);
  assert.equal(bearerSubject({ rpc: () => null } as unknown as SupabaseClient), null);
});

test('joinOrgAsInvitee falls back to the caller client only without a service role key', async () => {
  const calls: Array<[string, unknown]> = [];
  const userClient = {
    rpc: async (fn: string, params: unknown) => {
      calls.push([fn, params]);
      return { data: { id: 'org' }, error: null };
    },
  } as unknown as SupabaseClient;
  const prev = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const { config } = await import('../src/config.js');
    if (config.supabase.serviceRoleKey) return; // keyed environment: the admin path is covered by the DB test
    const out = await joinOrgAsInvitee(userClient, 'user-1', { p_code: 'C', p_role: 'employee', p_work_type: 'mitigation' });
    assert.deepEqual(out, { data: { id: 'org' }, error: null });
    assert.deepEqual(calls, [['join_org', { p_code: 'C', p_role: 'employee', p_work_type: 'mitigation' }]]);
  } finally {
    if (prev !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prev;
  }
});
