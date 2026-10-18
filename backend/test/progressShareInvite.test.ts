import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/routes/progressShare.ts', import.meta.url), 'utf8');
const route = src.slice(src.indexOf("'/:token/invite'"), src.indexOf('Retired: the anonymous share-data API'));

test('invite endpoint validates the token like every share route and returns only invite basics', () => {
  assert.match(route, /inviteLimiter/);
  assert.match(route, /progressShareForToken\(tokenFromProgressRequest\(req\)\)/);
  assert.match(route, /no-store/);
  const json = route.slice(route.indexOf('res.json('));
  assert.match(json, /recipientEmail/);
  assert.doesNotMatch(json, /proof|scope|brief|access_token|open_count/);
  assert.doesNotMatch(route, /open_count|recordAccess/);
});

test('invite route is registered before the retired catch-alls', () => {
  assert.ok(src.indexOf("'/:token/invite'") < src.indexOf("progressShareRouter.all('/:token', retiredGuestApi)"));
});

test('claim still requires the signed-in email to match the invite', () => {
  const grants = readFileSync(new URL('../src/shared/jobProgressGrants.ts', import.meta.url), 'utf8');
  assert.match(grants, /recipient !== email/);
  assert.match(grants, /email_mismatch/);
});

test('retired anonymous share routes answer 410 and never read job data', async () => {
  const express = (await import('express')).default;
  const { progressShareRouter } = await import('../src/routes/progressShare.js');
  const app = express();
  app.use('/api/progress-share', progressShareRouter);
  const server = app.listen(0);
  try {
    const port = (server.address() as { port: number }).port;
    for (const [method, path] of [
      ['GET', '/api/progress-share/fakefakefake000000000000'],
      ['GET', '/api/progress-share/session'],
      ['POST', '/api/progress-share/fakefakefake000000000000/ask'],
      ['GET', '/api/progress-share/fakefakefake000000000000/ask/threads'],
      ['GET', '/api/progress-share/fakefakefake000000000000/ask/questions'],
      ['GET', '/api/progress-share/fakefakefake000000000000/proof/p1/video'],
    ] as const) {
      const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      assert.equal(res.status, 410, `${method} ${path}`);
      assert.equal(((await res.json()) as { code: string }).code, 'share_api_retired');
    }
  } finally {
    server.close();
  }
});
