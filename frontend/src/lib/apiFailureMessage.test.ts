import { describe, expect, it } from 'vitest';
import { apiFailureMessage, parseApiJson } from './api';

describe('parseApiJson', () => {
  it('returns {} for empty and non-JSON bodies', () => {
    expect(parseApiJson('')).toEqual({});
    expect(parseApiJson('Internal Server Error')).toEqual({});
  });

  it('parses JSON objects', () => {
    expect(parseApiJson('{"error":"nope","code":"x"}')).toEqual({
      error: 'nope',
      code: 'x',
    });
  });
});

describe('apiFailureMessage', () => {
  it('prefers an explicit API error body', () => {
    expect(
      apiFailureMessage(401, { error: 'Invalid email or password', code: 'invalid_credentials' }, ''),
    ).toEqual({
      message: 'Invalid email or password',
      code: 'invalid_credentials',
    });
  });

  it('maps empty 500 / gateway statuses to backend_unreachable', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(apiFailureMessage(status, {}, '')).toMatchObject({
        code: 'backend_unreachable',
      });
      expect(apiFailureMessage(status, {}, '').message).toMatch(/npm run dev/);
    }
  });

  it('keeps a generic fallback for non-empty unexplained 500s', () => {
    expect(apiFailureMessage(500, { oops: true }, '{"oops":true}')).toEqual({
      message: 'Request failed (500)',
      code: 'error',
    });
  });
});
