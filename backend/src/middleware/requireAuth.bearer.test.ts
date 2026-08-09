import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request } from 'express';
import { bearerAccessToken } from './requireAuth.js';

function req(headers: Record<string, string | undefined>): Request {
  return {
    get(name: string) {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    },
  } as Request;
}

describe('bearerAccessToken', () => {
  it('reads a Bearer access token for native Field Capture', () => {
    assert.equal(bearerAccessToken(req({ Authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
  });

  it('ignores missing or non-Bearer schemes', () => {
    assert.equal(bearerAccessToken(req({})), undefined);
    assert.equal(bearerAccessToken(req({ Authorization: 'Basic x' })), undefined);
  });
});
