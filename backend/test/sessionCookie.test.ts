import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Session } from '@supabase/supabase-js';
import { config } from '../src/config.ts';
import { clearSessionCookies, sessionCookieDomain, setSessionCookies } from '../src/lib/session.ts';

const session = {
  access_token: 'access-synthetic',
  refresh_token: 'refresh-synthetic',
} as Session;

function listen(app: express.Express): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('session cookies are parent-domain only on atmosphereteam.com', () => {
  assert.equal(sessionCookieDomain('platform.atmosphereteam.com'), 'atmosphereteam.com');
  assert.equal(sessionCookieDomain('app.atmosphereteam.com'), 'atmosphereteam.com');
  assert.equal(sessionCookieDomain('www.atmosphereteam.com'), 'atmosphereteam.com');
  assert.equal(sessionCookieDomain('atmosphere-production.up.railway.app'), undefined);
  assert.equal(sessionCookieDomain('field-capture-production.up.railway.app'), undefined);
  assert.equal(sessionCookieDomain('evilatmosphereteam.com'), undefined);
  assert.equal(sessionCookieDomain('atmosphereteam.com.evil.com'), undefined);
});

test('sign-in on one Atmosphere host is visible to the other, with the cookie flags intact', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.post('/api/auth/login', (req, res) => {
    setSessionCookies(res, session, req.hostname);
    res.json({ ok: true });
  });
  app.post('/api/auth/refresh', (req, res) => {
    const refresh = req.cookies?.[config.cookies.refreshTokenName];
    res.json({ signedIn: refresh === 'refresh-synthetic' });
  });
  app.post('/api/auth/logout', (req, res) => {
    clearSessionCookies(res, req.hostname);
    res.json({ ok: true });
  });

  const server = await listen(app);
  try {
    const port = (server.address() as AddressInfo).port;
    const call = (host: string, path: string, cookie?: string) =>
      new Promise<{ setCookie: string[]; body: string }>((resolve, reject) => {
        const req = http.request(
          {
            host: '127.0.0.1',
            port,
            path,
            method: 'POST',
            headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) },
          },
          (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk) => chunks.push(chunk as Buffer));
            res.on('end', () => {
              const raw = res.headers['set-cookie'];
              resolve({
                setCookie: Array.isArray(raw) ? raw : raw ? [raw] : [],
                body: Buffer.concat(chunks).toString(),
              });
            });
          },
        );
        req.on('error', reject);
        req.end();
      });

    const login = await call('platform.atmosphereteam.com', '/api/auth/login');
    const refresh = login.setCookie.find(
      (line) => line.startsWith(`${config.cookies.refreshTokenName}=refresh-synthetic`),
    );
    assert.ok(refresh, 'refresh cookie is set');
    assert.match(refresh!, /Domain=atmosphereteam\.com/i);
    assert.match(refresh!, /HttpOnly/i);
    assert.match(refresh!, /SameSite=Lax/i);
    assert.doesNotMatch(refresh!, /SameSite=None/i);
    assert.equal(login.setCookie.some((line) => line.startsWith(`${config.device.cookieName}=`)), false);

    const shared = login.setCookie
      .map((line) => line.split(';')[0] ?? '')
      .filter((pair) => pair.startsWith('atm_') && !pair.endsWith('='))
      .join('; ');
    const fromField = await call('app.atmosphereteam.com', '/api/auth/refresh', shared);
    assert.deepEqual(JSON.parse(fromField.body), { signedIn: true });

    const reverse = await call('app.atmosphereteam.com', '/api/auth/login');
    const fieldCookie = reverse.setCookie.find(
      (line) => line.startsWith(`${config.cookies.refreshTokenName}=refresh-synthetic`),
    );
    assert.match(fieldCookie ?? '', /Domain=atmosphereteam\.com/i);
    const back = await call('platform.atmosphereteam.com', '/api/auth/refresh', (fieldCookie ?? '').split(';')[0]);
    assert.deepEqual(JSON.parse(back.body), { signedIn: true });

    const railway = await call('atmosphere-production.up.railway.app', '/api/auth/login');
    const railwayCookie = railway.setCookie.find(
      (line) => line.startsWith(`${config.cookies.refreshTokenName}=refresh-synthetic`),
    );
    assert.ok(railwayCookie);
    assert.doesNotMatch(railwayCookie!, /Domain=/i);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});
