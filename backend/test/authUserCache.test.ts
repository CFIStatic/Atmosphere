import test from 'node:test';
import type { User } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AUTH_CACHE_TTL_MS,
  cachedGetUser,
  clearAuthUserCache,
  forgetCachedToken,
  forgetCachedUser,
} from '../src/lib/authUserCache.js';

function jwt(expSeconds: number): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'HS256' })}.${part({ exp: expSeconds, sub: 'u1' })}.sig`;
}

function fakeLookup(userId = 'u1') {
  let calls = 0;
  const lookup = async () => {
    calls += 1;
    return { data: { user: { id: userId } as User }, error: null };
  };
  return { lookup, calls: () => calls };
}

test('a verified token is reused, and concurrent requests share one lookup', async () => {
  clearAuthUserCache();
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  const { lookup, calls } = fakeLookup();
  const results = await Promise.all([1, 2, 3, 4].map(() => cachedGetUser(token, lookup)));
  assert.equal(calls(), 1);
  assert.ok(results.every((r) => r.data.user?.id === 'u1'));
  await cachedGetUser(token, lookup);
  assert.equal(calls(), 1);
});

test('the cache never outlives its TTL or the token', async () => {
  clearAuthUserCache();
  let now = 1_000_000_000_000;
  const clock = () => now;
  const token = jwt(Math.floor(now / 1000) + 3600);
  const { lookup, calls } = fakeLookup();
  await cachedGetUser(token, lookup, clock);
  now += AUTH_CACHE_TTL_MS + 1;
  await cachedGetUser(token, lookup, clock);
  assert.equal(calls(), 2);

  const shortLived = jwt(Math.floor(now / 1000) + 5);
  await cachedGetUser(shortLived, lookup, clock);
  now += 6_000;
  await cachedGetUser(shortLived, lookup, clock);
  assert.equal(calls(), 4);
});

test('failed lookups are never cached', async () => {
  clearAuthUserCache();
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  let calls = 0;
  const failing = async () => {
    calls += 1;
    return { data: { user: null }, error: { message: 'invalid JWT' } };
  };
  await cachedGetUser(token, failing);
  await cachedGetUser(token, failing);
  assert.equal(calls, 2);
});

test('sign-out and revoke make the next request ask Supabase again', async () => {
  clearAuthUserCache();
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  const { lookup, calls } = fakeLookup('u9');
  await cachedGetUser(token, lookup);
  forgetCachedUser('u9');
  await cachedGetUser(token, lookup);
  assert.equal(calls(), 2);
  forgetCachedToken(token);
  await cachedGetUser(token, lookup);
  assert.equal(calls(), 3);
});

test('a forget during an in-flight lookup is not undone by its answer', async () => {
  clearAuthUserCache();
  const token = jwt(Math.floor(Date.now() / 1000) + 3600);
  let calls = 0;
  let release!: () => void;
  const slow = () =>
    new Promise<{ data: { user: User }; error: null }>((resolve) => {
      calls += 1;
      release = () => resolve({ data: { user: { id: 'u5' } as User }, error: null });
    });
  const pending = cachedGetUser(token, slow);
  forgetCachedUser('u5');
  release();
  await pending;
  const { lookup } = fakeLookup('u5');
  await cachedGetUser(token, async () => {
    calls += 1;
    return lookup();
  });
  assert.equal(calls, 2);
});

test('requireAuth runs once per request even when several routers share a mount', () => {
  const src = readFileSync(new URL('../src/middleware/requireAuth.ts', import.meta.url), 'utf8');
  assert.match(src, /\[AUTH_DONE\] && req\.user\) \{\s*next\(\);/);
  assert.match(src, /cachedGetUser\(accessToken/);
  // Every successful path marks the request.
  assert.equal((src.match(/markAuthDone\(req\);/g) ?? []).length, 3);
});

test('removing someone from an org, deleting an account and changing a password drop cached tokens', () => {
  const revoke = readFileSync(new URL('../src/auth/revokeUserSessions.ts', import.meta.url), 'utf8');
  const del = readFileSync(new URL('../src/account/deleteAccount.ts', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../src/routes/auth.ts', import.meta.url), 'utf8');
  assert.match(revoke, /forgetCachedUser\(id\)/);
  assert.match(del, /forgetCachedUser\(userId\)/);
  assert.equal((auth.match(/forgetCachedUser\(updated\.user\.id\)/g) ?? []).length, 2);
  assert.match(auth, /forgetCachedToken\(req\.cookies/);
});
