import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/routes/progressShare.ts', import.meta.url), 'utf8');
const route = src.slice(src.indexOf("'/:token/invite'"), src.indexOf('/** GET /api/progress-share/:token — read-only'));

test('invite endpoint validates the token like every share route and returns only invite basics', () => {
  assert.match(route, /inviteLimiter/);
  assert.match(route, /progressShareForToken\(tokenFromProgressRequest\(req\)\)/);
  assert.match(route, /no-store/);
  const json = route.slice(route.indexOf('res.json('));
  assert.match(json, /recipientEmail/);
  assert.doesNotMatch(json, /proof|scope|brief|access_token|open_count/);
  assert.doesNotMatch(route, /open_count|recordAccess/);
});

test('invite route is registered before the catch-all /:token GET', () => {
  assert.ok(src.indexOf("'/:token/invite'") < src.indexOf("progressShareRouter.get('/:token', sendProgressGuest)"));
});

test('claim still requires the signed-in email to match the invite', () => {
  const grants = readFileSync(new URL('../src/shared/jobProgressGrants.ts', import.meta.url), 'utf8');
  assert.match(grants, /recipient !== email/);
  assert.match(grants, /email_mismatch/);
});
