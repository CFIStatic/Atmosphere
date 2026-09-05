import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JOB_SHARE_COOKIE, resolveShareToken } from './shareSession.js';

describe('resolveShareToken', () => {
  it('prefers the path token so Field Capture keeps working', () => {
    assert.equal(resolveShareToken('path-token', 'cookie-token'), 'path-token');
  });

  it('uses the cookie when the path is empty', () => {
    assert.equal(resolveShareToken('', 'cookie-token'), 'cookie-token');
    assert.equal(resolveShareToken(undefined, 'cookie-token'), 'cookie-token');
  });

  it('returns empty when neither is set', () => {
    assert.equal(resolveShareToken(undefined, ''), '');
  });
});

describe('cookie names', () => {
  it('keeps job-share cookies off the office session names', () => {
    assert.equal(JOB_SHARE_COOKIE, 'atm_job_share');
    assert.notEqual(JOB_SHARE_COOKIE, 'atm_access_token');
  });
});
