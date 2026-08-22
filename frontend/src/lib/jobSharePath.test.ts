import { matchPath } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  JOB_SHARE_PAGE_ROUTE,
  jobShareApiPath,
  jobSharePagePath,
  jobShareTokenFromRoute,
} from './jobSharePath';

const SLASH_TOKEN = '06mK2/nSHxdzmgX4Nd0R0Bow19Bb2gLG';

describe('jobSharePagePath', () => {
  it('preserves a slash inside a legacy base64 token', () => {
    expect(jobSharePagePath(SLASH_TOKEN, 'jack@jettx.ai')).toBe(
      `/shared/${SLASH_TOKEN}?email=jack%40jettx.ai`,
    );
  });
});

describe('jobShareTokenFromRoute', () => {
  it('joins the first segment and the splat', () => {
    expect(
      jobShareTokenFromRoute({ token: '06mK2', '*': 'nSHxdzmgX4Nd0R0Bow19Bb2gLG' }),
    ).toBe(SLASH_TOKEN);
  });

  it('keeps a single-segment token', () => {
    expect(jobShareTokenFromRoute({ token: 'tok123' })).toBe('tok123');
  });
});

describe('invite route matching', () => {
  it('keeps a slash-token invite on the job page instead of the catch-all', () => {
    const matched = matchPath(JOB_SHARE_PAGE_ROUTE, `/shared/${SLASH_TOKEN}`);
    expect(matched).not.toBeNull();
    expect(jobShareTokenFromRoute(matched!.params)).toBe(SLASH_TOKEN);
  });

  it('does not steal the exact /shared office redirect', () => {
    expect(matchPath(JOB_SHARE_PAGE_ROUTE, '/shared')).toBeNull();
  });

  it('still matches a one-segment token', () => {
    const matched = matchPath(JOB_SHARE_PAGE_ROUTE, '/shared/tok123');
    expect(matched).not.toBeNull();
    expect(jobShareTokenFromRoute(matched!.params)).toBe('tok123');
  });
});

describe('jobShareApiPath', () => {
  it('encodes slashes so the API path cannot split the token', () => {
    expect(jobShareApiPath(SLASH_TOKEN, '/proof')).toBe(
      `/api/job-share/${encodeURIComponent(SLASH_TOKEN)}/proof`,
    );
  });
});
