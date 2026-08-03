import test from 'node:test';
import assert from 'node:assert/strict';
import { pairNamesWithAddresses, robotsForbids } from '../src/prospecting/sources/webCrawl.js';
import { safeFetchText } from '../src/prospecting/sources/safeFetch.js';

/**
 * The crawler reaches out to hosts a *customer* named, which makes these the
 * highest-consequence tests in the prospecting code. Two failures matter:
 *
 *   - Fetching a private address. On a cloud host 169.254.169.254 is the
 *     instance metadata service and the response body is credentials.
 *   - Crawling a path a site told us not to. Legal exposure aside, it is the
 *     difference between a bot people tolerate and one they block.
 */

test('the crawler refuses private and loopback addresses', async () => {
  // Each of these is a server-side request forgery attempt dressed as a
  // company domain, which is exactly how it would arrive in a search query.
  const blocked = [
    'http://127.0.0.1/team',
    'http://localhost/team',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://10.0.0.5/team',
    'http://192.168.1.1/team',
    'http://172.16.0.1/team',
    'http://[::1]/team',
    'http://100.64.0.1/team', // CGNAT
  ];
  for (const url of blocked) {
    assert.equal(await safeFetchText(url, { timeoutMs: 1500 }), null, `${url} must be refused`);
  }
});

test('the crawler refuses non-HTTP schemes', async () => {
  assert.equal(await safeFetchText('file:///etc/passwd'), null);
  assert.equal(await safeFetchText('ftp://example.com/x'), null);
  assert.equal(await safeFetchText('not a url'), null);
});

test('robots.txt is obeyed, including the longest-match rule', () => {
  const robots = ['User-agent: *', 'Disallow: /private', 'Allow: /private/public'].join('\n');
  assert.equal(robotsForbids(robots, '/private'), true);
  assert.equal(robotsForbids(robots, '/private/secret'), true);
  // A more specific Allow beats a broader Disallow, which is what lets a site
  // say "none of this except that".
  assert.equal(robotsForbids(robots, '/private/public'), false);
  assert.equal(robotsForbids(robots, '/team'), false);
});

test('a blanket disallow stops everything', () => {
  const robots = ['User-agent: *', 'Disallow: /'].join('\n');
  assert.equal(robotsForbids(robots, '/team'), true);
  assert.equal(robotsForbids(robots, '/about'), true);
});

test('rules aimed at another bot do not apply to us', () => {
  const robots = ['User-agent: BadBot', 'Disallow: /', '', 'User-agent: *', 'Allow: /'].join('\n');
  assert.equal(robotsForbids(robots, '/team'), false);
});

test('a robots.txt naming us specifically is obeyed', () => {
  const robots = ['User-agent: AtmosphereBot', 'Disallow: /team'].join('\n');
  assert.equal(robotsForbids(robots, '/team'), true);
});

test('addresses are paired with the nearest plausible name', () => {
  const text =
    'Our Team. Marcia Delgado, Regional Manager m.delgado@acme.com ' +
    'Ray Calloway, Field Adjuster r.calloway@acme.com';
  const found = pairNamesWithAddresses(text, 'acme.com');
  const byEmail = new Map(found.map((f) => [f.email, f.fullName]));
  assert.equal(byEmail.get('m.delgado@acme.com'), 'Marcia Delgado');
  assert.equal(byEmail.get('r.calloway@acme.com'), 'Ray Calloway');
});

test('role and off-domain addresses are never collected as people', () => {
  // A shared mailbox is real and useless, and an address at another domain
  // teaches this domain's inference nothing — worse, it would teach it wrong.
  const text = 'Contact info@acme.com or sales@acme.com. Marcia Delgado marcia@other.com';
  assert.deepEqual(pairNamesWithAddresses(text, 'acme.com'), []);
});

test('an address with no name near it is dropped rather than guessed', () => {
  // A wrong name on a real address teaches pattern inference the wrong
  // convention, which then poisons every later guess at that domain. Silence
  // is strictly better than a plausible mistake here.
  const text = 'For enquiries write to m.delgado@acme.com at any time.';
  assert.deepEqual(pairNamesWithAddresses(text, 'acme.com'), []);
});
