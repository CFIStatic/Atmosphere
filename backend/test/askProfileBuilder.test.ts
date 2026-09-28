/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Supabase query builders are thenable-only: they have `then` but no `catch`.
 * Ask must not call `.catch` on one directly (production TypeError after #574).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { runProofAsk } from '../src/routes/proofOfWork.js';
import { config } from '../src/config.js';

/**
 * Every builder method chains; awaiting it resolves an empty result (or one
 * inserted row). The builder has `then` only — no `catch` or `finally`.
 */
function thenableOnlyClient(): any {
  const makeBuilder = (): any => {
    let single = false;
    let wrote = false;
    const builder: any = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') {
            const row = { id: '00000000-0000-4000-8000-0000000000aa', created_at: new Date().toISOString() };
            const data = wrote ? (single ? row : [row]) : single ? null : [];
            return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
              Promise.resolve({ data, error: null, count: 0 }).then(resolve, reject);
          }
          if (prop === 'catch' || prop === 'finally' || typeof prop === 'symbol') return undefined;
          return () => {
            if (prop === 'single' || prop === 'maybeSingle') single = true;
            if (prop === 'insert' || prop === 'upsert' || prop === 'update') wrote = true;
            return builder;
          };
        },
      },
    );
    return builder;
  };
  return {
    from: () => makeBuilder(),
    rpc: () => makeBuilder(),
    storage: { from: () => makeBuilder() },
  };
}

test('an org member Ask does not call .catch on a thenable-only Supabase builder', async () => {
  const saved = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
    google: process.env.GOOGLE_API_KEY,
  };
  // Keep the thenable-only fake as the only client (no service-role admin client).
  const savedServiceRole = config.supabase.serviceRoleKey;
  (config.supabase as { serviceRoleKey: string }).serviceRoleKey = '';
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  try {
    await assert.doesNotReject(async () => {
      try {
        await runProofAsk({
          supabase: thenableOnlyClient(),
          orgId: '00000000-0000-4000-8000-000000000001',
          jobId: '00000000-0000-4000-8000-000000000002',
          question: 'What happened on this job?',
          userId: '00000000-0000-4000-8000-000000000003',
          requestId: 'test:ask-profile-builder',
          access: 'org',
        });
      } catch (err) {
        // Other failures from the empty fake are out of scope; only the builder TypeError matters.
        if (err instanceof TypeError && /\.catch is not a function/.test(err.message)) throw err;
      }
    });
  } finally {
    (config.supabase as { serviceRoleKey: string }).serviceRoleKey = savedServiceRole;
    for (const [key, name] of [
      ['anthropic', 'ANTHROPIC_API_KEY'],
      ['gemini', 'GEMINI_API_KEY'],
      ['google', 'GOOGLE_API_KEY'],
    ] as const) {
      if (saved[key] === undefined) delete process.env[name];
      else process.env[name] = saved[key];
    }
  }
});
