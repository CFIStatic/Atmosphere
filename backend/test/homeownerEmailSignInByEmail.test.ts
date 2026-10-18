/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import test from 'node:test';
import { liveProgressShareTokenForEmail } from '../src/routes/progressShare.js';

function admin(rows: any[]) {
  const b: any = {
    select: () => b, eq: () => b, is: () => b, ilike: () => b, order: () => b, limit: () => b,
    then: (ok: any) => Promise.resolve({ data: rows, error: null }).then(ok),
  };
  return { from: () => b } as any;
}

test('homeowner email sign-in finds only a live, unexpired invite to that exact email', async () => {
  const past = '2000-01-01T00:00:00Z';
  assert.equal(
    await liveProgressShareTokenForEmail(admin([{ access_token: 't1', recipient_email: 'Home@Example.com', expires_at: null }]), 'home@example.com'),
    't1',
  );
  assert.equal(
    await liveProgressShareTokenForEmail(admin([{ access_token: 't2', recipient_email: 'home@example.com', expires_at: past }]), 'home@example.com'),
    null,
  );
  assert.equal(
    await liveProgressShareTokenForEmail(admin([{ access_token: 't3', recipient_email: 'other@example.com', expires_at: null }]), 'home@example.com'),
    null,
  );
  assert.equal(await liveProgressShareTokenForEmail(admin([]), 'nobody@example.com'), null);
});
