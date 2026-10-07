import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearSiteIdentityCache,
  fetchPublicPage,
  identifySite,
  isPublicAddress,
  nameFromHtml,
  prettyDomain,
  publicOnlyLookup,
  quickSiteName,
} from '../src/computer/siteIdentity.js';

test('a catalog domain is named from the catalog, without fetching the page', async () => {
  let fetched = 0;
  const id = await identifySite('outlook.office.com', { fetchPage: async () => (fetched++, '<title>x</title>') });
  assert.ok(id);
  assert.equal(id.source, 'catalog');
  assert.equal(id.siteId, 'outlook');
  assert.match(id.name, /Outlook/);
  assert.ok(id.signInUrl?.startsWith('https://'));
  assert.equal(fetched, 0);
});

test('an unknown domain is named from its page (og:site_name, application-name, title) and cached', async () => {
  clearSiteIdentityCache();
  const seen: string[] = [];
  const page = async (url: string) => {
    seen.push(url);
    return '<html><head><title>Sign In | Acme Carrier Portal</title><meta property="og:site_name" content="Acme Insurance &amp; Co"></head>';
  };
  const id = await identifySite('portal.acme-carrier.com/login', { fetchPage: page });
  assert.deepEqual(
    { name: id?.name, source: id?.source, host: id?.host, url: id?.url, siteId: id?.siteId },
    { name: 'Acme Insurance & Co', source: 'page', host: 'portal.acme-carrier.com', url: 'https://portal.acme-carrier.com/login', siteId: null },
  );
  assert.deepEqual(seen, ['https://portal.acme-carrier.com/']);
  await identifySite('https://portal.acme-carrier.com/', { fetchPage: page });
  assert.equal(seen.length, 1, 'second lookup is cached');
});

test('page names are cleaned up; generic titles fall back to the domain', async () => {
  assert.equal(nameFromHtml('<title>Login - Summit Roofing Supply</title>', 'summitroofing.com'), 'Summit Roofing Supply');
  assert.equal(nameFromHtml('<title>Welcome to BuildPro</title>', 'buildpro.io'), 'BuildPro');
  assert.equal(nameFromHtml('<meta name="application-name" content="Claims Hub">', 'x.com'), 'Claims Hub');
  assert.equal(nameFromHtml('<title>Dashboard :: Acme</title>', 'acme.com'), 'Acme');
  assert.equal(nameFromHtml('<title>Sign in</title>', 'acme.com'), null);
  assert.equal(nameFromHtml('<title>Just a moment...</title>', 'acme.com'), null);
  assert.equal(nameFromHtml(`<title>${'A'.repeat(90)}</title>`, 'acme.com'), null);
  clearSiteIdentityCache();
  const id = await identifySite('secure.bigclaims.net', { fetchPage: async () => '<title>Sign in</title>' });
  assert.deepEqual([id?.name, id?.source], ['Bigclaims', 'domain']);
  clearSiteIdentityCache();
  const failed = await identifySite('my.acme-roofing.com', { fetchPage: async () => null });
  assert.deepEqual([failed?.name, failed?.source], ['Acme Roofing', 'domain']);
});

test('prettyDomain keeps the brand part of the host', () => {
  assert.equal(prettyDomain('portal.acme.com'), 'Acme');
  assert.equal(prettyDomain('www.acme-roofing.co.uk'), 'Acme Roofing');
  assert.equal(prettyDomain('abc.com'), 'ABC');
  assert.equal(quickSiteName('portal.acme.com'), 'Acme');
  assert.match(quickSiteName('outlook.office.com'), /Outlook/);
});

test('not a web address, or a private/internal host: no lookup at all', async () => {
  let fetched = 0;
  const page = async () => (fetched++, '<title>x</title>');
  for (const bad of ['', 'not a url', 'localhost', 'http://localhost:3000', 'printer.local', '10.0.0.5', '192.168.1.1', '169.254.169.254', 'metadata.internal', '[::1]']) {
    assert.equal(await identifySite(bad, { fetchPage: page }), null, bad);
  }
  assert.equal(fetched, 0);
});

test('isPublicAddress blocks private, loopback, link-local, CGNAT, mapped and reserved ranges', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
  assert.equal(isPublicAddress('not-an-ip'), false);
});

test('the socket lookup refuses hosts that resolve to private addresses', async () => {
  const err = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
    publicOnlyLookup('localhost', {}, (e) => resolve(e)),
  );
  assert.equal(err?.code, 'EPRIVATE');
});

test('fetchPublicPage: https only, default port, no credentials, no private hosts', async () => {
  for (const url of ['http://example.com/', 'https://example.com:8443/', 'https://u:p@example.com/', 'https://127.0.0.1/', 'https://localhost/', 'ftp://example.com/', 'nope']) {
    assert.equal(await fetchPublicPage(url), null, url);
  }
});
