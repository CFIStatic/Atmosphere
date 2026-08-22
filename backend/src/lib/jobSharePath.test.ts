import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  jobShareActionPattern,
  jobShareApiPath,
  jobSharePagePath,
  jobShareTokenFromRoute,
  readJobShareToken,
} from './jobSharePath.js';

const SLASH_TOKEN = '06mK2/nSHxdzmgX4Nd0R0Bow19Bb2gLG';

describe('jobSharePagePath', () => {
  it('keeps a slash inside the token so the already-sent invite URL still works', () => {
    assert.equal(
      jobSharePagePath(SLASH_TOKEN, 'jack@jettx.ai'),
      `/shared/${SLASH_TOKEN}?email=jack%40jettx.ai`,
    );
  });

  it('omits the query when there is no email', () => {
    assert.equal(jobSharePagePath('abc'), '/shared/abc');
  });
});

describe('jobShareTokenFromRoute', () => {
  it('joins :token and the splat so a base64 slash is one credential', () => {
    assert.equal(
      jobShareTokenFromRoute({ token: '06mK2', '*': 'nSHxdzmgX4Nd0R0Bow19Bb2gLG' }),
      SLASH_TOKEN,
    );
  });

  it('accepts a single-segment hex token', () => {
    assert.equal(jobShareTokenFromRoute({ token: 'aa'.repeat(24) }), 'aa'.repeat(24));
  });
});

describe('jobShareActionPattern', () => {
  it('captures a token that itself contains slashes', () => {
    const match = `/${SLASH_TOKEN}/proof`.match(jobShareActionPattern('/proof'));
    assert.ok(match);
    assert.equal(match?.[1], SLASH_TOKEN);
  });

  it('does not treat a later action as part of the token', () => {
    const match = `/${SLASH_TOKEN}/proof/upload-url`.match(jobShareActionPattern('/proof/upload-url'));
    assert.equal(match?.[1], SLASH_TOKEN);
  });
});

describe('readJobShareToken', () => {
  it('prefers the regex capture, then :token', () => {
    assert.equal(readJobShareToken({ '0': SLASH_TOKEN }), SLASH_TOKEN);
    assert.equal(readJobShareToken({ token: 'plain' }), 'plain');
  });
});

describe('job-share route order', () => {
  const routes = [
    { name: 'capture-guide', re: jobShareActionPattern('/capture-guide') },
    { name: 'upload-url', re: jobShareActionPattern('/proof/upload-url') },
    { name: 'proof', re: jobShareActionPattern('/proof') },
    { name: 'job', re: jobShareActionPattern() },
  ];

  function match(path: string) {
    for (const route of routes) {
      const found = path.match(route.re);
      if (found) return { name: route.name, token: found[1] };
    }
    return null;
  }

  it('sends a slash-token proof request to proof, not the job view', () => {
    const found = match(`/${SLASH_TOKEN}/proof`);
    assert.equal(found?.name, 'proof');
    assert.equal(found?.token, SLASH_TOKEN);
  });

  it('still opens the job view for a slash token with no suffix', () => {
    const found = match(`/${SLASH_TOKEN}`);
    assert.equal(found?.name, 'job');
    assert.equal(found?.token, SLASH_TOKEN);
  });
});

describe('jobShareApiPath', () => {
  it('encodes the token so a slash cannot split the API path at the client', () => {
    assert.equal(
      jobShareApiPath(SLASH_TOKEN, '/proof'),
      `/api/job-share/${encodeURIComponent(SLASH_TOKEN)}/proof`,
    );
  });
});
