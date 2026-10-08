import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { clientIp, clientIpKeyGenerator, rateLimitKey } from './clientIp.js';

describe('clientIp', () => {
  it('uses the edge-set X-Real-IP and never X-Forwarded-For', () => {
    assert.equal(
      clientIp({
        headers: { 'x-forwarded-for': '6.6.6.6, 172.68.175.97', 'x-real-ip': ' 203.0.113.9 ' },
        ip: '100.64.0.14',
      }),
      '203.0.113.9',
    );
    assert.equal(
      clientIp({ headers: { 'x-forwarded-for': '6.6.6.6' }, ip: '100.64.0.14' }),
      '100.64.0.14',
    );
    assert.equal(clientIp({ headers: { 'x-real-ip': 'nope' }, ip: '100.64.0.2' }), '100.64.0.2');
    assert.equal(clientIp({}), null);
  });
});

describe('rateLimitKey', () => {
  it('keys IPv4 on the full address', () => {
    assert.equal(rateLimitKey({ headers: { 'x-real-ip': '198.51.100.4' } }), '198.51.100.4');
  });

  it('unwraps IPv4-mapped IPv6', () => {
    assert.equal(rateLimitKey({ ip: '::ffff:198.51.100.4' }), '198.51.100.4');
    assert.equal(rateLimitKey({ ip: '::ffff:c633:6404' }), '198.51.100.4');
  });

  it('keys IPv6 on the /56 prefix', () => {
    const a = rateLimitKey({ headers: { 'x-real-ip': '2001:db8:abcd:12ff:1::1' } });
    const b = rateLimitKey({ headers: { 'x-real-ip': '2001:db8:abcd:1200:ffff::9' } });
    const c = rateLimitKey({ headers: { 'x-real-ip': '2001:db8:abcd:1300::1' } });
    assert.equal(a, '2001:db8:abcd:1200::/56');
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.equal(rateLimitKey({ headers: { 'x-real-ip': '::1' } }), '0:0:0:0::/56');
  });

  it('never returns an empty key', () => {
    assert.equal(rateLimitKey({}), 'unknown');
  });
});

describe('rate limiter keyed by clientIpKeyGenerator', () => {
  async function withLimitedApp(run: (url: string) => Promise<void>): Promise<void> {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      rateLimit({
        keyGenerator: clientIpKeyGenerator,
        windowMs: 60_000,
        limit: 2,
        standardHeaders: true,
        legacyHeaders: false,
      }),
    );
    app.get('/', (_req, res) => {
      res.json({ ok: true });
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  const hit = (url: string, headers: Record<string, string>) =>
    fetch(url, { headers }).then((r) => r.status);

  it('gives two different X-Real-IP values separate buckets', async () => {
    await withLimitedApp(async (url) => {
      const a = { 'x-real-ip': '203.0.113.1' };
      const b = { 'x-real-ip': '203.0.113.2' };
      assert.deepEqual([await hit(url, a), await hit(url, a), await hit(url, a)], [200, 200, 429]);
      assert.equal(await hit(url, b), 200);
    });
  });

  it('ignores a faked X-Forwarded-For', async () => {
    await withLimitedApp(async (url) => {
      const real = '203.0.113.7';
      const statuses: number[] = [];
      for (const fake of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
        statuses.push(await hit(url, { 'x-real-ip': real, 'x-forwarded-for': fake }));
      }
      assert.deepEqual(statuses, [200, 200, 429]);
    });
  });
});
